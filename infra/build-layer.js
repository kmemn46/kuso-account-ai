const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Lambdaレイヤー用のパッケージを準備しています...');

// レイヤー用の出力先ディレクトリ
const layerPythonDir = path.join(__dirname, '../backend/layers/common-layer/python');
const winPath = path.win32.normalize(layerPythonDir);

// 既存のレイヤー用フォルダが存在する場合は、中身ごと一度きれいスッキリ削除
if (fs.existsSync(winPath)) {
  try {
    console.log('古いレイヤーフォルダをクリーンアップ中...');
    execSync(`del /q /f /s "${winPath}\\*"` , { stdio: 'ignore' });
    execSync(`rmdir /s /q "${winPath}"`, { stdio: 'ignore' });
  } catch (error) {
    // 万が一のWindowsの一時的なロック対策として、最低限のフォルダ担保
    if (!fs.existsSync(winPath)) {
      fs.mkdirSync(winPath, { recursive: true });
    }
  }
} else {
  // --- 存在しない場合：フォルダを作成 ---
  fs.mkdirSync(winPath, { recursive: true });
}

// requirements.txtで指定したパッケージをインストール
const requirementsPath = path.join(__dirname, '../backend/requirements.txt');
const reqPath = path.win32.normalize(requirementsPath);

if (fs.existsSync(reqPath)) {
  console.log('Lambda向けLinuxバイナリのインストールを開始します...');

  try {
    // Windowsのロングパス対策
    const extendedWinPath = winPath.startsWith('\\\\?\\') ? winPath : `\\\\?\\${winPath}`;

    const pipCmd = [
      'pip install',
      `-r "${reqPath}"`,
      `-t "${extendedWinPath}"`,
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