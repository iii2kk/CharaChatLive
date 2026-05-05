"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import ScrollArea from "@/components/ScrollArea";
import type { ChatMessage } from "@/types/chat";

interface ChatLogWindowProps {
  messages: ChatMessage[];
}

function getInitial(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "U";
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export default function ChatLogWindow({ messages }: ChatLogWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return <p className="text-xs text-gray-500">まだ会話はありません</p>;
  }

  return (
    <ScrollArea className="max-h-[56vh] w-96 overflow-y-auto pr-1">
      <div className="flex flex-col gap-2">
        {messages.map((message) => {
          const isUser = message.role === "user";
          const displayName = isUser ? "You" : message.modelName ?? "Assistant";

          return (
            <div
              key={message.id}
              className={`rounded border px-3 py-2 ${
                isUser
                  ? "border-sky-800 bg-sky-950/30"
                  : "border-gray-700 bg-gray-800/40"
              }`}
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    isUser
                      ? "bg-sky-600 text-white"
                      : "bg-gray-700 text-gray-100"
                  }`}
                >
                  {getInitial(displayName)}
                </span>
                <span className="min-w-0 truncate text-xs font-medium text-gray-100">
                  {displayName}
                </span>
                {message.modelKind ? (
                  <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">
                    {message.modelKind}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-[10px] text-gray-500">
                  {formatTime(message.createdAt)}
                </span>
              </div>

              <p className="whitespace-pre-wrap break-words text-sm text-gray-200">
                {message.content}
                {message.status === "streaming" ? (
                  <span className="ml-1 text-sky-300">▌</span>
                ) : null}
              </p>

              {message.attachments && message.attachments.length > 0 ? (
                <div className="mt-2 flex gap-2 overflow-x-auto">
                  {message.attachments.map((attachment) => (
                    <Image
                      key={attachment.id}
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      title={attachment.name}
                      width={64}
                      height={64}
                      unoptimized
                      className="h-16 w-16 rounded object-cover"
                    />
                  ))}
                </div>
              ) : null}

              {message.status === "error" ? (
                <div className="mt-1 text-[10px] text-red-300">エラー</div>
              ) : message.status === "streaming" ? (
                <div className="mt-1 text-[10px] text-sky-300">生成中...</div>
              ) : null}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
