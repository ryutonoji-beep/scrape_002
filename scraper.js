const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const CONFIG = {
  MIN_DELAY: 60 * 1000,            // 最小待機時間（60秒）
  MAX_DELAY: 80 * 1000,            // 最大待機時間（80秒）
  PAGE_TIMEOUT: 30 * 1000,         // タイムアウト
  POST_LOAD_WAIT: 2 * 1000,        // 描画待ち
};

async function scrapeSingleItem(item, browser) {
  let page;
  try {
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // 必要なHTMLとスクリプト以外はブロックして高速化・通信量削減
      if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) request.abort();
      else request.continue();
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    const response = await page.goto(item.url, { waitUntil: 'networkidle2', timeout: CONFIG.PAGE_TIMEOUT });
    const status = response ? response.status() : 0;

    // ハードエラー（WAFブロックなど）
    if (status === 403 || status === 429 || status >= 500) {
      console.warn(`🚨 アクセス拒否検知 (ステータス: ${status}) [${item.row}行目]`);
      item._isBlocked = true; 
      return item;
    }

    await new Promise(resolve => setTimeout(resolve, CONFIG.POST_LOAD_WAIT));
    const pageTitle = await page.title();

    // ★ 改善点：正規表現をやめ、ブラウザ内でJSのグローバル変数「prices」を直接取得
    const rawJson = await page.evaluate(() => {
      if (typeof prices !== 'undefined') {
        return prices;
      }
      return null;
    });

    let priceData = [];
    if (rawJson) {
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
    }

    console.log(`✅ 取得成功 [${item.row}行目]: ${pageTitle}`);
    item.priceData = priceData;
    return item;

  } catch (error) {
    // タイムアウトなどのソフトエラー
    console.error(`⚠️ 一時エラー (タイムアウト等) [${item.row}行目]: ${error.message}`);
    item._isSoftError = true;
    return item;
  } finally {
    if (page) await page.close();
  }
}

async function runScrapingLoop() {
  const rawData = fs.readFileSync('input.json', 'utf-8');
  const items = JSON.parse(rawData);
  let results = [];

  console.log(`🏃‍♂️ ${items.length} 件のスクレイピング処理を開始します...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  // ★ 改善点：Promise.all を廃止し、完全に1件ずつの直列処理に変更（バーストアクセスを防ぐ）
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`\n[${i + 1} / ${items.length}] 処理開始...`);
    
    const result = await scrapeSingleItem(item, browser);
    
    if (result._isBlocked) {
      console.log(`\n🚨 WAFブロックを検知。現在のIPでの処理を打ち切り撤退します。`);
      results.push(result);
      break; 
    }
    
    results.push(result);

    // 最後のアイテムでなければランダム待機
    if (i < items.length - 1) {
      const waitTime = Math.floor(Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY + 1)) + CONFIG.MIN_DELAY;
      console.log(`⏳ ${waitTime / 1000}秒待機します... (ランダムディレイ)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  await browser.close();
  
  fs.writeFileSync('result.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n🎉 処理完了（取得/判定済み件数: ${results.length}件）。Artifactとして保存します。`);
}

runScrapingLoop();
