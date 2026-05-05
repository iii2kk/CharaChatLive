"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import type {
  ChatAttachment,
  ChatSendPayload,
  ChatTargetMode,
  ChatTargetsSnapshot,
} from "@/types/chat";

interface ChatInputBarProps {
  targetMode: ChatTargetMode;
  onTargetModeChange: (mode: ChatTargetMode) => void;
  targets: ChatTargetsSnapshot;
  sending: boolean;
  onSend: (payload: ChatSendPayload) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("画像の読み込みに失敗しました"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("画像の読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatInputBar({
  targetMode,
  onTargetModeChange,
  targets,
  sending,
  onSend,
}: ChatInputBarProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const activeTargets = useMemo(
    () =>
      targetMode === "front"
        ? targets.front
          ? [targets.front]
          : []
        : targets.nearby,
    [targetMode, targets.front, targets.nearby]
  );

  const targetLabel =
    targetMode === "front"
      ? targets.front
        ? `正面: ${targets.front.name}`
        : "正面: 対象なし"
      : targets.nearby.length > 0
      ? `周囲: ${targets.nearby.length}人`
      : "周囲: 対象なし";

  const canSend =
    activeTargets.length > 0 &&
    !sending &&
    (text.trim().length > 0 || attachments.length > 0);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setDropError(null);
    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    );

    if (imageFiles.length === 0) {
      setDropError("画像ファイルだけ追加できます");
      return;
    }

    try {
      const loaded = await Promise.all(
        imageFiles.map(async (file) => ({
          id: `attachment-${crypto.randomUUID()}`,
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        }))
      );
      setAttachments((prev) => [...prev, ...loaded]);
    } catch (error) {
      setDropError(error instanceof Error ? error.message : "画像の読み込みに失敗しました");
    }
  }, []);

  const submit = useCallback(() => {
    if (!canSend) return;
    onSend({ text: text.trim(), attachments });
    setText("");
    setAttachments([]);
    setDropError(null);
  }, [attachments, canSend, onSend, text]);

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[1200] w-[min(920px,calc(100vw-32px))] -translate-x-1/2 pointer-events-auto"
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <div
        className={`rounded-lg border bg-gray-950/90 p-2 shadow-2xl backdrop-blur-sm transition-colors ${
          dragging ? "border-sky-400" : "border-gray-700"
        }`}
      >
        {attachments.length > 0 ? (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex w-44 shrink-0 items-center gap-2 rounded border border-gray-700 bg-gray-900 px-2 py-1"
              >
                <Image
                  src={attachment.dataUrl}
                  alt=""
                  width={40}
                  height={40}
                  unoptimized
                  className="h-10 w-10 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-gray-200" title={attachment.name}>
                    {attachment.name}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {formatBytes(attachment.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((prev) =>
                      prev.filter((item) => item.id !== attachment.id)
                    )
                  }
                  className="h-6 w-6 rounded text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                  title="削除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <select
            value={targetMode}
            onChange={(e) => onTargetModeChange(e.currentTarget.value as ChatTargetMode)}
            className="h-10 w-40 shrink-0 rounded border border-gray-700 bg-gray-900 px-2 text-sm text-gray-100"
            title={targetLabel}
          >
            <option value="front">正面のモデル</option>
            <option value="nearby">周囲の全員</option>
          </select>

          <textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            className="min-h-10 flex-1 resize-none rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-sky-500"
            placeholder="メッセージを入力..."
          />

          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="h-10 shrink-0 rounded bg-sky-600 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
          >
            {sending ? "送信中" : "送信"}
          </button>
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-500">
          <span className="truncate">{targetLabel}</span>
          <span className={dropError ? "text-red-300" : ""}>
            {dropError ?? "画像はここへドラッグアンドドロップ"}
          </span>
        </div>
      </div>
    </div>
  );
}
