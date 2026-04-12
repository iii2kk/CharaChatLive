export default function ViewHelpWindow() {
  return (
    <div className="text-xs text-gray-500">
      <p>クリック: モデル選択</p>
      <p className="mt-1">通常カメラ: ドラッグで視点移動</p>
      <p className="mt-1">通常カメラ: Shift + ドラッグで選択モデル移動</p>
      <p className="mt-1">通常カメラ: ライト本体/target ハンドルをドラッグ</p>
      <p className="mt-1">フリーカメラ: W/A/S/D + 左ドラッグ</p>
    </div>
  );
}
