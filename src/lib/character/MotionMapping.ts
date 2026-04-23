import type {
  MotionMapping,
  MotionMappingKey,
  MotionMappingSnapshot,
} from "./types";

export class MutableMotionMapping implements MotionMapping {
  private _idle: string | null = null;
  private _walk: string | null = null;
  private _run: string | null = null;
  private listeners = new Set<() => void>();

  get idle(): string | null {
    return this._idle;
  }

  get walk(): string | null {
    return this._walk;
  }

  get run(): string | null {
    return this._run;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(key: MotionMappingKey, handleId: string | null): void {
    switch (key) {
      case "idle":
        if (this._idle === handleId) return;
        this._idle = handleId;
        break;
      case "walk":
        if (this._walk === handleId) return;
        this._walk = handleId;
        break;
      case "run":
        if (this._run === handleId) return;
        this._run = handleId;
        break;
      default: {
        // 将来の拡張用
        const _exhaustive: never = key;
        void _exhaustive;
        return;
      }
    }
    this.notify();
  }

  toJSON(): MotionMappingSnapshot {
    return { idle: this._idle, walk: this._walk, run: this._run };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("[motionMapping listener error]", err);
      }
    }
  }
}
