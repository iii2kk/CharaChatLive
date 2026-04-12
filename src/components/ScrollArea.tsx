"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import scrollbarStyles from "@/components/floating-window-scrollbar.module.css";

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export default function ScrollArea({
  children,
  className,
  style,
}: ScrollAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  const updateOverflow = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    setHasOverflow(element.scrollHeight > element.clientHeight + 1);
  }, []);

  useEffect(() => {
    updateOverflow();

    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      updateOverflow();
    });

    resizeObserver.observe(element);
    window.addEventListener("resize", updateOverflow);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [children, updateOverflow]);

  const classes = [
    scrollbarStyles.scrollRegion,
    hasOverflow ? scrollbarStyles.hasOverflow : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={containerRef} className={classes} style={style}>
      {children}
    </div>
  );
}
