const fs = require('fs');
const path = require('path');

// cdk deploy で出力された outputs.json のパス
const outputsPath = path.join(__dirname, '../frontend/outputs.json');
// Next.js 側に書き出す .env.local のパス
const envPath = path.join(__dirname, '../frontend/.env.local');

try {
  if (!fs.existsSync(outputsPath)) {
    console.error('エラー: outputs.json が見つかりません。先に cdk deploy を実行してください。');
    process.exit(1);
  }

  // JSONファイルを読み込む
  const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));

  // スタック名（例: InfraStack）配下の出力を取得
  const stackName = Object.keys(outputs)[0];
  const stackOutputs = outputs[stackName];

  if (!stackOutputs || !stackOutputs.HttpApiURL) {
    console.error('エラー: HttpApiURL が outputs.json に見つかりません。');
    process.exit(1);
  }

  if (!stackOutputs || !stackOutputs.UserPoolId) {
    console.error('エラー: UserPoolId が outputs.json に見つかりません。');
    process.exit(1);
  }

  if (!stackOutputs || !stackOutputs.UserPoolClientId) {
    console.error('エラー: UserPoolClientId が outputs.json に見つかりません。');
    process.exit(1);
  }

  // API URL や Cognito の情報を抽出
  const apiUrl = stackOutputs.HttpApiURL || '';
  const userPoolId = stackOutputs.UserPoolId || '';
  const userPoolClientId = stackOutputs.UserPoolClientId || '';

  // .env.local に正しいURL形式で書き出す
  const envContent = `
  NEXT_PUBLIC_API_URL=${apiUrl}
  NEXT_PUBLIC_USER_POOL_ID=${userPoolId}
  NEXT_PUBLIC_USER_POOL_CLIENT_ID=${userPoolClientId}
  `.trim();

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('環境変数 (.env.local) の生成が完了しました！');

} catch (error) {
  console.error('環境ファイルの生成中にエラーが発生しました:', error);
  process.exit(1);
}