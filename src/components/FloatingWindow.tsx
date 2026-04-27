"use client";

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import ScrollArea from "@/components/ScrollArea";

type WindowPosition = { x: number; y: number };

interface FloatingWindowProps {
  title: string;
  children: ReactNode;
  visible: boolean;
  zIndex: number;
  position: WindowPosition;
  onPositionChange: (pos: WindowPosition) => void;
  onFocus: () => void;
  onClose?: () => void;
  minimized?: boolean;
  onMinimizeToggle?: () => void;
}

function clampPosition(position: WindowPosition, element: HTMLElement): WindowPosition {
  const rect = element.getBoundingClientRect();
  const maxX = Math.max(0, window.innerWidth - rect.width);
  const maxY = Math.max(0, window.innerHeight - rect.height);

  return {
    x: Math.max(0, Math.min(position.x, maxX)),
    y: Math.max(0, Math.min(position.y, maxY)),
  };
}

function isSamePosition(a: WindowPosition, b: WindowPosition) {
  return a.x === b.x && a.y === b.y;
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

  const clampAndCommitPosition = useCallback(() => {
    const element = windowRef.current;
    if (!element) return;

    const clamped = clampPosition(position, element);
    element.style.left = `${clamped.x}px`;
    element.style.top = `${clamped.y}px`;

    if (!isSamePosition(position, clamped)) {
      onPositionChange(clamped);
    }
  }, [onPositionChange, position]);

  useLayoutEffect(() => {
    if (!visible) return;

    clampAndCommitPosition();

    const element = windowRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(clampAndCommitPosition);
    resizeObserver.observe(element);
    window.addEventListener("resize", clampAndCommitPosition);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", clampAndCommitPosition);
    };
  }, [clampAndCommitPosition, visible]);

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
      if (windowRef.current) {
        const next = clampPosition(
          { x: drag.originX + dx, y: drag.originY + dy },
          windowRef.current
        );
        windowRef.current.style.left = `${next.x}px`;
        windowRef.current.style.top = `${next.y}px`;
      }
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || !drag.active || e.pointerId !== drag.pointerId) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const next = windowRef.current
        ? clampPosition({ x: drag.originX + dx, y: drag.originY + dy }, windowRef.current)
        : { x: drag.originX + dx, y: drag.originY + dy };
      dragRef.current = null;
      onPositionChange(next);
    },
    [onPositionChange]
  );

  if (!visible) return null;

  return (
    <div
      ref={windowRef}
      className="fixed pointer-events-auto bg-gray-900/95 border border-gray-700 rounded-lg shadow-xl backdrop-blur-sm text-gray-100"
      style={{ left: position.x, top: position.y, zIndex, maxWidth: "100vw" }}
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
