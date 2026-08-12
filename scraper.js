const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// ==========================================
// ⚙️ 動作パラメーター設定
// ==========================================
const CONFIG = {
  MIN_DELAY: 60 * 1000,            // 最小待機時間（60秒）
  MAX_DELAY: 90 * 1000,            // 最大待機時間（90秒）
  PAGE_TIMEOUT: 30 * 1000,         // ページの読み込み限界時間（30秒）
  POST_LOAD_WAIT: 2 * 1000,        // ページ読み込み完了後の追加待機（2秒）
  CHUNK_SIZE: 2,                   // 同時にアクセスするURL数（2件）
};
// ==========================================

async function scrapeSingleItem(item, browser) {
  let page;
  try {
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // 余計なリソースは読み込まずに高速化＆通信量削減
      if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) request.abort();
      else request.continue();
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    const response = await page.goto(item.url, { waitUntil: 'networkidle2', timeout: CONFIG.PAGE_TIMEOUT });
    const status = response ? response.status() : 0;

    // ★ WAFブロック等 ハードエラー検知
    if (status === 403 || status === 429 || status >= 500) {
      console.warn(`🚨 アクセス拒否検知 (ステータス: ${status}) [${item.row}行目]`);
      item._isBlocked = true; // GASにブロックを知らせるフラグ
      return item;
    }

    await new Promise(resolve => setTimeout(resolve, CONFIG.POST_LOAD_WAIT));

    const html = await page.content();
    const pageTitle = await page.title();

    let priceData = [];
    const match = html.match(/var\s+prices\s*=\s*JSON\.parse\((['"])(.*?)\1\)/);
    if (match) {
      try {
        const rawJson = JSON.parse(match[2].replace(/\\"/g, '"'));
        const volumeMap = new Map();
        for (const p of rawJson) {
          const capacityKey = p.volume ? p.volume : "容量なし";
          if (!volumeMap.has(capacityKey)) {
            volumeMap.set(capacityKey, {
              volume: p.volume || "容量なし",
              name: p.name, color: p.color, series: p.series,
              price_s: p.price_s, price_a1: p.price_a1, price_b1: p.price_b1,
              price_c1: p.price_c1, price_d: p.price_d, price_junk: p.price_junk
            });
          }
        }
        priceData = Array.from(volumeMap.values());
      } catch (e) {
        console.warn(`⚠️ JSONパース失敗`);
      }
    }

    console.log(`✅ 取得成功 [${item.row}行目]: ${pageTitle}`);
    item.priceData = priceData;
    return item;

  } catch (error) {
    // ★ タイムアウト等のソフトエラー検知
    console.error(`⚠️ 一時エラー (タイムアウト等) [${item.row}行目]: ${error.message}`);
    item._isSoftError = true; // GASに一時エラーを知らせるフラグ
    return item;
  } finally {
    if (page) await page.close();
  }
}

async function runScrapingLoop() {
  // Actions側で生成された input.json を読み込む
  const rawData = fs.readFileSync('input.json', 'utf-8');
  const items = JSON.parse(rawData);
  let results = [];

  console.log(`🏃‍♂️ ${items.length} 件のスクレイピング処理を開始します...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  for (let i = 0; i < items.length; i += CONFIG.CHUNK_SIZE) {
    const chunkItems = items.slice(i, i + CONFIG.CHUNK_SIZE);
    console.log(`\n[${i + 1}〜${i + chunkItems.length} / ${items.length}] 処理開始...`);
    
    const chunkResults = await Promise.all(chunkItems.map(item => scrapeSingleItem(item, browser)));
    
    // チャンク内にブロックされたものが1つでもあれば、即座に白旗を上げる
    const blockedItem = chunkResults.find(res => res._isBlocked);
    if (blockedItem) {
      console.log(`\n🚨 WAFブロックを検知しました。現在のIPでの処理を打ち切り、撤退します。(残りは次回のIPガチャへ託す)`);
      results.push(...chunkResults); 
      // 残りのアイテムは results に追加しない = GAS側で空欄のまま保持される
      break; 
    }

    results.push(...chunkResults);

    if (i + CONFIG.CHUNK_SIZE < items.length) {
      // ★ 60秒〜90秒の間でランダムな待機時間を生成
      const waitTime = Math.floor(Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY + 1)) + CONFIG.MIN_DELAY;
      console.log(`⏳ ${waitTime / 1000}秒待機します... (ランダムディレイ)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  await browser.close();
  
  // 結果を保存してActionsの次ステップ(コミット)へ渡す
  fs.writeFileSync('result.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n🎉 処理・撤退完了（取得/判定済み件数: ${results.length}件）。リポジトリに保存します。`);
}

runScrapingLoop();
