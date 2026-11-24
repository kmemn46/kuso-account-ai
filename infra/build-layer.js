const { execSync } = require('node:child_process');
const fs = require("node:fs");
const path = require("node:path");

console.log('Lambdaレイヤー用のパッケージを準備しています...');

// レイヤー用の出力先ディレクトリ
const layerPythonDir = path.join(__dirname, '../backend/layers/common-layer/python');

// 既存のレイヤー用フォルダが存在する場合は、中身ごと一度きれいスッキリ削除
if (fs.existsSync(layerPythonDir)) {
  console.log(`既存のフォルダを削除中: ${layerPythonDir}`);
  fs.rmSync(layerPythonDir, { recursive: true, force: true });
}

// 存在しない場合はフォルダを作成（親も含めて再帰作成）
console.log(`フォルダを作成中: ${layerPythonDir}`);
fs.mkdirSync(layerPythonDir, { recursive: true });

// requirements.txtで指定したパッケージをインストール
const requirementsPath = path.join(__dirname, '../backend/requirements.txt');

if (fs.existsSync(requirementsPath)) {
  console.log('Lambda向けLinuxバイナリのインストールを開始します...');

  try {

    const pipCmd = [
      'pip install',
      `-r "${requirementsPath}"`,
      `-t "${layerPythonDir}"`,
      '--no-cache-dir',
      '--platform manylinux2014_x86_64',
      '--python-version 3.12',
      '--only-binary=:all:',
      '--implementation cp', // CPythonを指定（Windows混入防止）
      '--abi cp312'           // Python 3.12用のABIを指定（Windows混入防止）
    ].join(' ');

    execSync(pipCmd, { stdio: 'inherit' });
    console.log('Lambda用のパッケージ作成が正常に完了しました！');

  } catch (pipError) {
    console.error('pip install 中にエラーが発生しました:', pipError.message);
    process.exit(1);
  }
} else {
  console.log('requirements.txt が見つからないため、pip install をスキップします。');
}