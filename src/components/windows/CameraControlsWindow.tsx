"use client";

interface CameraControlsWindowProps {
  freeCameraEnabled: boolean;
  onFreeCameraEnabledChange: (enabled: boolean) => void;
}

export default function CameraControlsWindow({
  freeCameraEnabled,
  onFreeCameraEnabledChange,
}: CameraControlsWindowProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => onFreeCameraEnabledChange(!freeCameraEnabled)}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            freeCameraEnabled
              ? "bg-cyan-700 hover:bg-cyan-600 text-white"
              : "bg-gray-800 hover:bg-gray-700 text-gray-200"
          }`}
        >
          {freeCameraEnabled ? "フリーカメラ ON" : "通常カメラ"}
        </button>
      </div>
      <div className="text-xs text-gray-500">
        {freeCameraEnabled ? (
          <>
            <p>W/A/S/D: 前後左右移動</p>
            <p className="mt-1">Q / E: 上下移動</p>
            <p className="mt-1">左ドラッグ: 視線移動</p>
            <p className="mt-1">Shift: 加速</p>
          </>
        ) : (
          <>
            <p>ドラッグ: 視点移動</p>
            <p className="mt-1">Shift + ドラッグ: 選択モデルを移動</p>
          </>
        )}
      </div>
    </div>
  );
}
