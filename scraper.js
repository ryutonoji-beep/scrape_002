const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const CONFIG = {
  CRAWL_DELAY: 65 * 1000,
  PAGE_TIMEOUT: 30 * 1000,
  POST_LOAD_WAIT: 2 * 1000,
  CHUNK_SIZE: 2,
};

async function scrapeSingleItem(item, browser) {
  let page;
  try {
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) request.abort();
      else request.continue();
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    const response = await page.goto(item.url, { waitUntil: 'networkidle2', timeout: CONFIG.PAGE_TIMEOUT });
    const status = response ? response.status() : 0;

    if (status === 403 || status === 429 || status >= 500) {
      console.warn(`🚨 アクセス拒否検知 (ステータス: ${status}) [${item.row}行目]`);
      return { _isError: true, item: item }; 
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
    console.error(`❌ エラー [${item.row}行目]: ${error.message}`);
    item.priceData = []; // 失敗
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

  for (let i = 0; i < items.length; i += CONFIG.CHUNK_SIZE) {
    const chunkItems = items.slice(i, i + CONFIG.CHUNK_SIZE);
    console.log(`\n[${i + 1}〜${i + chunkItems.length} / ${items.length}] 処理開始...`);
    
    const chunkResults = await Promise.all(chunkItems.map(item => scrapeSingleItem(item, browser)));
    
    // エラー（ブロック）が1件でもあった場合の処理
    const errorResult = chunkResults.find(res => res._isError);
    if (errorResult) {
      console.log(`\n🚨 サイト側からのブロックを検知しました。以降の処理を打ち切ります。`);
      
      // 成功した分は格納
      results.push(...chunkResults.filter(res => !res._isError));
      
      // 今回のチャンクの失敗分 ＋ まだ処理していない残りのURL 全てにエラーフラグを付ける
      const remainingItems = items.slice(i).map(item => {
        item.priceData = "取得失敗(ブロック)";
        return item;
      });
      results.push(...remainingItems);
      break; 
    }

    results.push(...chunkResults);

    if (i + CONFIG.CHUNK_SIZE < items.length) {
      console.log(`⏳ crawl-delay: ${CONFIG.CRAWL_DELAY / 1000}秒待機します...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.CRAWL_DELAY));
    }
  }

  await browser.close();
  
  fs.writeFileSync('result.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n🎉 処理が終了しました。リポジトリに保存します。`);
}

runScrapingLoop();
