const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Lambdaレイヤー用のパッケージを準備しています...');

// レイヤー用の出力先ディレクトリ
const layerPythonDir = path.join(__dirname, '../backend/layers/common_layer/python');

// フォルダが存在しない場合は作成
if (!fs.existsSync(layerPythonDir)) {
  fs.mkdirSync(layerPythonDir, { recursive: true });
}

// requirements.txtで指定したパッケージをインストール
const requirementsPath = path.join(__dirname, '../backend/requirements.txt');

if (fs.existsSync(requirementsPath)) {
  console.log('pip install を実行中...');
  execSync(`pip install -r ${requirementsPath} -t ${layerPythonDir} --platform manylinux2014_x86_64 --python-version 3.12 --only-binary=:all:`, {
    stdio: 'inherit'
  });
  console.log('Lambdaレイヤーの構築が完了しました！');
} else {
  console.log('requirements.txt が見つかりませんでした。');
}