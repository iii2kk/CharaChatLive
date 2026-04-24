"use client";

import { useCallback, useRef, type ReactNode } from "react";
import ScrollArea from "@/components/ScrollArea";

interface FloatingWindowProps {
  title: string;
  children: ReactNode;
  visible: boolean;
  zIndex: number;
  position: { x: number; y: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  onFocus: () => void;
  onClose?: () => void;
  minimized?: boolean;
  onMinimizeToggle?: () => void;
}

export default function FloatingWindow({
  title,
  children,
  visible,
  zIndex,
  position,
  onPositionChange,
  onFocus,
  onClose,
  minimized,
  onMinimizeToggle,
}: FloatingWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const handleFocusPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      onFocus();
    },
    [onFocus]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      dragRef.current = {
        active: true,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: position.x,
        originY: position.y,
      };
    },
    [position.x, position.y]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || !drag.active || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const newX = Math.max(0, Math.min(drag.originX + dx, window.innerWidth - 100));
      const newY = Math.max(0, Math.min(drag.originY + dy, window.innerHeight - 32));
      if (windowRef.current) {
        windowRef.current.style.left = `${newX}px`;
        windowRef.current.style.top = `${newY}px`;
      }
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || !drag.active || e.pointerId !== drag.pointerId) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const newX = Math.max(0, Math.min(drag.originX + dx, window.innerWidth - 100));
      const newY = Math.max(0, Math.min(drag.originY + dy, window.innerHeight - 32));
      dragRef.current = null;
      onPositionChange({ x: newX, y: newY });
    },
    [onPositionChange]
  );

  if (!visible) return null;

  return (
    <div
      ref={windowRef}
      className="fixed pointer-events-auto bg-gray-900/95 border border-gray-700 rounded-lg shadow-xl backdrop-blur-sm text-gray-100"
      style={{ left: position.x, top: position.y, zIndex }}
      onPointerDownCapture={handleFocusPointerDown}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 cursor-grab active:cursor-grabbing select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <span className="text-sm font-medium truncate">{title}</span>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {onMinimizeToggle && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onMinimizeToggle();
              }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors text-xs"
              title={minimized ? "展開" : "最小化"}
            >
              {minimized ? "□" : "−"}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-700 text-gray-400 hover:text-gray-200 transition-colors text-xs"
              title="閉じる"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {/* Content */}
      {!minimized && (
        <ScrollArea className="p-3 overflow-y-auto" style={{ maxHeight: "70vh" }}>
          {children}
        </ScrollArea>
      )}
    </div>
  );
}
