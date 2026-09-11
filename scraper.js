const fs = require('fs');

const CONFIG = {
  MIN_DELAY: 15 * 1000, // 15秒
  MAX_DELAY: 25 * 1000, // 25秒
  FLARESOLVERR_URL: 'http://localhost:8191/v1' // 隣にいるFlareSolverrのアドレス
};

async function scrapeSingleItemWithFlareSolverr(item) {
  try {
    // 1. FlareSolverrにリクエストを投げる
    const payload = {
      cmd: 'request.get',
      url: item.url,
      maxTimeout: 60000, 
      // ★ ここを追加！ページ読み込み後に強制的に5秒（5000ms）待機させる
      postTimeout: 5000 
    };

    const response = await fetch(CONFIG.FLARESOLVERR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    // ★ 追加：FlareSolverrの生レスポンス情報をログに出力（HTML本体は長すぎるので除外）
    const debugResult = JSON.parse(JSON.stringify(result));
    if (debugResult.solution && debugResult.solution.response) {
      debugResult.solution.response = "（省略）";
    }
    console.log(`\n🔍 FlareSolverr 生レスポンス [${item.row}行目]:`);
    console.log(JSON.stringify(debugResult, null, 2));

    // 2. FlareSolverrが取得失敗した場合（ブロック等）
    if (result.status === 'error' || !result.solution || !result.solution.response) {
      console.warn(`🚨 FlareSolverrでの取得失敗 [${item.row}行目]: ${result.message || '詳細不明'}`);
      item._isBlocked = true;
      return item;
    }

    // 3. 取得成功したHTMLテキスト
    const html = result.solution.response;

    // 4. HTMLの中から価格データ（JSON部分）を正規表現で引っこ抜く
    const match = html.match(/prices\s*=\s*(\[.*?\]);/s);

    let priceData = [];
    if (match && match[1]) {
      // 価格データの抽出処理（ここは変更なし）
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
      // ★ 調査用：価格が見つからなかった場合、そのHTMLをファイルに保存する！
      console.log(`⚠️ 価格データ(prices)が見つかりません [${item.row}行目]`);
      
      // html文字列をファイルに書き出す (ファイル名: debug_html_5.html など)
      const debugFileName = `debug_html_${item.row}.html`;
      fs.writeFileSync(debugFileName, html, 'utf-8');
      console.log(`🔍 デバッグ用HTMLを保存しました: ${debugFileName}`);

      item._isSoftError = true; 
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

  console.log(`🏃‍♂️ ${items.length} 件のスクレイピング(FlareSolverr経由)を開始します...`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`\n[${i + 1} / ${items.length}] 処理開始...`);
    
    const result = await scrapeSingleItemWithFlareSolverr(item);
    
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
