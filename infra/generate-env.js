const fs = require('fs');
const path = require('path');

// 1. cdk deploy で出力された outputs.json のパス
const outputsPath = path.join(__dirname, '../frontend/outputs.json');
// 2. Next.js 側に書き出す .env.local のパス
const envPath = path.join(__dirname, '../frontend/.env.local');

try {
  if (!fs.existsSync(outputsPath)) {
    console.error('エラー: outputs.json が見つかりません。先に cdk deploy を実行してください。');
    process.exit(1);
  }

  // JSONファイルを読み込む
  const rawData = fs.readFileSync(outputsPath, 'utf8');
  const outputs = JSON.parse(rawData);

  // スタック名（例: InfraStack）配下の出力を取得
  const stackName = Object.keys(outputs)[0];
  const stackOutputs = outputs[stackName];

  if (!stackOutputs || !stackOutputs.HttpApiURL) {
    console.error('エラー: HttpApiURL が outputs.json に見つかりません。');
    process.exit(1);
  }

  const apiUrl = stackOutputs.HttpApiURL;

  // .env.local に正しいURL形式で書き出す
  const envContent = `NEXT_PUBLIC_API_URL=${apiUrl}\n`;
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`成功: .env.local に API URL (${apiUrl}) を書き出しました！`);

} catch (error) {
  console.error('環境ファイルの生成中にエラーが発生しました:', error);
  process.exit(1);
}