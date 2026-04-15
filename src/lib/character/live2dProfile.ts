"use client";

type Live2DProfileStat = {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
};

const PROFILE_FLUSH_INTERVAL_MS = 2000;

const stats = new Map<string, Live2DProfileStat>();

let frameCount = 0;
let lastModelCount = 0;
let lastFlushAt = 0;

declare global {
  interface Window {
    __LIVE2D_PROFILE__?: boolean;
  }
}

function isProfilingEnabled(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  if (typeof window === "undefined" || typeof performance === "undefined") {
    return false;
  }

  return window.__LIVE2D_PROFILE__ !== false;
}

function ensureFlushTime(now: number): void {
  if (lastFlushAt === 0) {
    lastFlushAt = now;
  }
}

function maybeFlush(now: number): void {
  if (!isProfilingEnabled()) {
    return;
  }

  ensureFlushTime(now);
  if (now - lastFlushAt < PROFILE_FLUSH_INTERVAL_MS || stats.size === 0) {
    return;
  }

  const rows = Array.from(stats.entries())
    .map(([label, stat]) => ({
      label,
      count: stat.count,
      avgMs: Number((stat.totalMs / stat.count).toFixed(3)),
      maxMs: Number(stat.maxMs.toFixed(3)),
      lastMs: Number(stat.lastMs.toFixed(3)),
      totalMs: Number(stat.totalMs.toFixed(3)),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  console.groupCollapsed(
    `[Live2D Profile] ${frameCount} frames / ${lastModelCount} models`
  );
  console.table(rows);
  console.groupEnd();

  stats.clear();
  frameCount = 0;
  lastFlushAt = now;
}

export function beginLive2DProfile(): number {
  if (!isProfilingEnabled()) {
    return 0;
  }

  const now = performance.now();
  ensureFlushTime(now);
  return now;
}

export function endLive2DProfile(label: string, startAt: number): void {
  if (!isProfilingEnabled() || startAt === 0) {
    return;
  }

  const now = performance.now();
  const durationMs = now - startAt;
  const stat = stats.get(label) ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
  };

  stat.count += 1;
  stat.totalMs += durationMs;
  stat.maxMs = Math.max(stat.maxMs, durationMs);
  stat.lastMs = durationMs;
  stats.set(label, stat);

  maybeFlush(now);
}

export function profileLive2D<T>(label: string, fn: () => T): T {
  const startAt = beginLive2DProfile();
  try {
    return fn();
  } finally {
    endLive2DProfile(label, startAt);
  }
}

export function markLive2DFrame(modelCount: number): void {
  if (!isProfilingEnabled()) {
    return;
  }

  frameCount += 1;
  lastModelCount = modelCount;
  maybeFlush(performance.now());
}
