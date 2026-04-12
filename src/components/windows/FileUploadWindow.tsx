"use client";

import { useCallback, useRef } from "react";

interface FileUploadWindowProps {
  onModelFolderSelected: (files: FileList) => void;
  onAnimationFilesSelected: (files: FileList) => void;
  loading: boolean;
  error: string | null;
  modelName: string | null;
}

export default function FileUploadWindow({
  onModelFolderSelected,
  onAnimationFilesSelected,
  loading,
  error,
  modelName,
}: FileUploadWindowProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const animationInputRef = useRef<HTMLInputElement>(null);

  const handleFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onModelFolderSelected(e.target.files);
      }
    },
    [onModelFolderSelected]
  );

  const handleAnimationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onAnimationFilesSelected(e.target.files);
      }
    },
    [onAnimationFilesSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const hasModel = Array.from(e.dataTransfer.files).some((f) =>
          /\.(pmx|pmd|vrm)$/i.test(f.name)
        );
        if (hasModel) {
          onModelFolderSelected(e.dataTransfer.files);
        } else {
          const hasAnimation = Array.from(e.dataTransfer.files).some((f) =>
            /\.(vmd|vrma)$/i.test(f.name)
          );
          if (hasAnimation) {
            onAnimationFilesSelected(e.dataTransfer.files);
          }
        }
      }
    },
    [onAnimationFilesSelected, onModelFolderSelected]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {/* Model Folder Upload */}
      <div
        className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-gray-800 transition-colors"
        onClick={() => folderInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          onChange={handleFolderChange}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
        <div className="text-3xl mb-2">📁</div>
        <p className="text-sm font-medium">モデルフォルダを選択</p>
        <p className="text-xs text-gray-400 mt-1">
          .pmx / .pmd / .vrm + 関連ファイルを含むフォルダ
        </p>
      </div>

      {/* Animation Upload */}
      <div
        className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-green-400 hover:bg-gray-800 transition-colors"
        onClick={() => animationInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={animationInputRef}
          type="file"
          className="hidden"
          accept=".vmd,.vrma"
          multiple
          onChange={handleAnimationChange}
        />
        <div className="text-3xl mb-2">🎬</div>
        <p className="text-sm font-medium">アニメーションファイルを選択</p>
        <p className="text-xs text-gray-400 mt-1">.vmd / .vrma ファイル</p>
      </div>

      {/* Status */}
      {loading && (
        <div className="flex items-center gap-2 text-blue-400 text-sm">
          <svg
            className="animate-spin h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          読み込み中...
        </div>
      )}

      {error && (
        <div className="text-red-400 text-sm bg-red-900/30 rounded p-2">
          {error}
        </div>
      )}

      {!modelName && !loading && (
        <p className="text-xs text-gray-500">
          PMX/PMD/VRM モデルを含むフォルダを選択してください
        </p>
      )}
    </div>
  );
}
