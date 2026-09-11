const fs = require('fs');

const CONFIG = {
  MIN_DELAY: 5 * 1000,    // 生通信なので5〜10秒の待機で十分！
  MAX_DELAY: 10 * 1000
};

async function scrapeSingleItem(item) {
  try {
    // Puppeteerを使わず、直接URLからHTMLテキストをダウンロードする
    const response = await fetch(item.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    });

    const status = response.status;
    if (status === 403 || status === 429 || status === 503) {
      console.warn(`🚨 アクセス拒否検知 (ステータス: ${status}) [${item.row}行目]`);
      item._isBlocked = true; 
      return item;
    }

    const html = await response.text();

    // 取得したHTMLの文字列の中から、強引に `prices = [...]` のJSON部分だけを切り出す
    const match = html.match(/prices\s*=\s*(\[.*?\]);/s);

    let priceData = [];
    if (match && match[1]) {
      const rawJson = JSON.parse(match[1]);
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
      console.log(`✅ 取得成功 [${item.row}行目]: (価格データ ${priceData.length}件 抽出)`);
    } else {
      console.log(`⚠️ ページは開けましたが、価格データ(prices)が見つかりません [${item.row}行目]`);
      // Cloudflareの「人間ですか？」画面（チャレンジページ）を食らっている可能性大
      item._isBlocked = true; 
    }

    item.priceData = priceData;
    return item;

  } catch (error) {
    console.error(`⚠️ 一時エラー [${item.row}行目]: ${error.message}`);
    item._isSoftError = true;
    return item;
  }
}

async function runScrapingLoop() {
  const rawData = fs.readFileSync('input.json', 'utf-8');
  const items = JSON.parse(rawData);
  let results = [];

  console.log(`🏃‍♂️ ${items.length} 件の【生通信】スクレイピングを開始します...`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`\n[${i + 1} / ${items.length}] 処理開始...`);
    
    const result = await scrapeSingleItem(item);
    
    if (result._isBlocked) {
      console.log(`\n🚨 WAFブロックを検知。現在のIPでの処理を打ち切り撤退します。`);
      results.push(result);
      break; 
    }
    
    results.push(result);

    if (i < items.length - 1) {
      const waitTime = Math.floor(Math.random() * (CONFIG.MAX_DELAY - CONFIG.MIN_DELAY + 1)) + CONFIG.MIN_DELAY;
      console.log(`⏳ ${waitTime / 1000}秒待機します...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  fs.writeFileSync('result.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n🎉 処理完了（取得/判定済み件数: ${results.length}件）。Artifactとして保存します。`);
}

runScrapingLoop();
