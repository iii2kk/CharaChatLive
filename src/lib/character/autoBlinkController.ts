import type { CharacterModel } from "./types";

export interface AutoBlinkOptions {
  minIntervalMs?: number;
  maxIntervalMs?: number;
  closeDurationMs?: number;
  openDurationMs?: number;
  doubleBlinkChance?: number;
}

const DEFAULTS: Required<AutoBlinkOptions> = {
  minIntervalMs: 2000,
  maxIntervalMs: 5500,
  closeDurationMs: 80,
  openDurationMs: 120,
  doubleBlinkChance: 0.15,
};

const FRAME_MS = 16;
const OVERRIDE_EPSILON = 0.02;
const OVERRIDE_POLL_MS = 1000;

type Phase = "idle" | "closing" | "opening";

/**
 * VRM / PMX 用の自動まばたき。
 * Live2D は Cubism Framework の CubismEyeBlink が組み込み済みのため対象外。
 *
 * expressionMapping.blink に割り当てられた raw 表情名を解決し、
 * 設定された間隔/カーブで weight を 0→1→0 と補間する。
 *
 * ユーザが ExpressionControlWindow から手動で同じ表情を操作した場合、
 * lastWrittenValue と現在値の乖離を検知して manualOverride に入り、
 * 自動 blink は一時停止する (AutoMotionController と同等の振る舞い)。
 */
export class AutoBlinkController {
  private readonly options: Required<AutoBlinkOptions>;
  private readonly active: boolean;
  private enabled = true;
  private disposed = false;
  private manualOverride = false;

  private phase: Phase = "idle";
  private phaseElapsedMs = 0;
  private phaseDurationMs = 0;
  private animTimer: ReturnType<typeof setTimeout> | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private overridePollTimer: ReturnType<typeof setInterval> | null = null;

  private currentName: string | null = null;
  private lastWrittenValue: number | null = null;
  private pendingDoubleBlink = false;

  private readonly unsubscribers: Array<() => void> = [];
  private readonly overrideListeners = new Set<(active: boolean) => void>();

  constructor(
    private readonly model: CharacterModel,
    options?: AutoBlinkOptions
  ) {
    this.options = { ...DEFAULTS, ...(options ?? {}) };
    this.active = model.kind === "vrm" || model.kind === "mmd";
    if (!this.active) return;

    this.unsubscribers.push(
      model.expressionMapping.subscribe(() => {
        if (this.disposed) return;
        this.handleMappingChanged();
      })
    );

    this.overridePollTimer = setInterval(() => {
      if (this.disposed) return;
      this.pollManualOverride();
    }, OVERRIDE_POLL_MS);

    this.scheduleNextBlink();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!this.active) return;
    if (!enabled) {
      this.cancelTimers();
      this.zeroOutCurrent();
    } else {
      this.scheduleNextBlink();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isManualOverride(): boolean {
    return this.manualOverride;
  }

  onManualOverrideChange(cb: (active: boolean) => void): () => void {
    this.overrideListeners.add(cb);
    return () => {
      this.overrideListeners.delete(cb);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTimers();
    if (this.overridePollTimer !== null) {
      clearInterval(this.overridePollTimer);
      this.overridePollTimer = null;
    }
    for (const u of this.unsubscribers) u();
    this.unsubscribers.length = 0;
    this.zeroOutCurrent();
    this.overrideListeners.clear();
  }

  private resolveBlinkName(): string | null {
    return this.model.expressionMapping.blink;
  }

  private handleMappingChanged(): void {
    if (!this.enabled || this.manualOverride) return;
    const next = this.resolveBlinkName();
    if (next === this.currentName) return;
    if (this.currentName && this.lastWrittenValue !== null) {
      this.model.expressions.set(this.currentName, 0);
    }
    this.currentName = null;
    this.lastWrittenValue = null;
    this.cancelTimers();
    this.phase = "idle";
    this.phaseElapsedMs = 0;
    this.scheduleNextBlink();
  }

  private scheduleNextBlink(): void {
    if (!this.active || this.disposed) return;
    if (!this.enabled || this.manualOverride) return;
    if (this.waitTimer !== null) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }

    const delay = this.pendingDoubleBlink
      ? 80 + Math.random() * 170
      : this.randomInterval();
    this.pendingDoubleBlink = false;

    this.waitTimer = setTimeout(() => {
      this.waitTimer = null;
      this.startBlink();
    }, delay);
  }

  private randomInterval(): number {
    const { minIntervalMs, maxIntervalMs } = this.options;
    const min = Math.min(minIntervalMs, maxIntervalMs);
    const max = Math.max(minIntervalMs, maxIntervalMs);
    return min + Math.random() * (max - min);
  }

  private startBlink(): void {
    if (!this.active || this.disposed) return;
    if (!this.enabled || this.manualOverride) return;

    const name = this.resolveBlinkName();
    if (!name) {
      // マッピング未設定 → そのまま再スケジュール (再度待機)
      this.scheduleNextBlink();
      return;
    }

    if (this.detectExternalChange(name)) {
      this.enterManualOverride();
      return;
    }

    this.currentName = name;
    this.phase = "closing";
    this.phaseElapsedMs = 0;
    this.phaseDurationMs = this.options.closeDurationMs;
    this.tickAnim();
  }

  private tickAnim(): void {
    if (!this.active || this.disposed) return;
    if (!this.enabled || this.manualOverride) return;
    if (this.animTimer !== null) {
      clearTimeout(this.animTimer);
      this.animTimer = null;
    }

    const name = this.currentName;
    if (!name) return;

    if (this.detectExternalChange(name)) {
      this.enterManualOverride();
      return;
    }

    this.phaseElapsedMs += FRAME_MS;
    const t = Math.min(1, this.phaseElapsedMs / Math.max(1, this.phaseDurationMs));
    const eased = (1 - Math.cos(t * Math.PI)) / 2;
    const value =
      this.phase === "closing" ? eased : 1 - eased;

    this.writeValue(name, value);

    if (t >= 1) {
      if (this.phase === "closing") {
        this.phase = "opening";
        this.phaseElapsedMs = 0;
        this.phaseDurationMs = this.options.openDurationMs;
        this.animTimer = setTimeout(() => this.tickAnim(), FRAME_MS);
        return;
      }
      // opening 完了
      this.writeValue(name, 0);
      this.lastWrittenValue = null;
      this.phase = "idle";
      this.phaseElapsedMs = 0;
      this.pendingDoubleBlink = Math.random() < this.options.doubleBlinkChance;
      this.scheduleNextBlink();
      return;
    }

    this.animTimer = setTimeout(() => this.tickAnim(), FRAME_MS);
  }

  private writeValue(name: string, value: number): void {
    this.model.expressions.set(name, value);
    this.lastWrittenValue = value;
  }

  private detectExternalChange(name: string): boolean {
    if (this.lastWrittenValue === null) return false;
    const current = this.model.expressions.get(name);
    return Math.abs(current - this.lastWrittenValue) > OVERRIDE_EPSILON;
  }

  private pollManualOverride(): void {
    if (!this.enabled) return;
    const name = this.resolveBlinkName();
    if (!name) return;

    if (this.manualOverride) {
      const current = this.model.expressions.get(name);
      if (current < OVERRIDE_EPSILON) {
        this.exitManualOverride();
      }
      return;
    }

    if (this.lastWrittenValue !== null) {
      if (this.detectExternalChange(name)) {
        this.enterManualOverride();
      }
      return;
    }

    // idle 中の検出: 自分は何も書いていないので 0 が期待値
    const current = this.model.expressions.get(name);
    if (current > OVERRIDE_EPSILON) {
      this.enterManualOverride();
    }
  }

  private enterManualOverride(): void {
    if (this.manualOverride) return;
    this.manualOverride = true;
    this.cancelTimers();
    this.phase = "idle";
    this.phaseElapsedMs = 0;
    this.lastWrittenValue = null;
    this.notifyOverrideChange(true);
  }

  private exitManualOverride(): void {
    if (!this.manualOverride) return;
    this.manualOverride = false;
    this.lastWrittenValue = null;
    this.notifyOverrideChange(false);
    if (this.enabled) this.scheduleNextBlink();
  }

  private notifyOverrideChange(active: boolean): void {
    for (const cb of this.overrideListeners) cb(active);
  }

  private cancelTimers(): void {
    if (this.animTimer !== null) {
      clearTimeout(this.animTimer);
      this.animTimer = null;
    }
    if (this.waitTimer !== null) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
  }

  private zeroOutCurrent(): void {
    if (this.currentName && this.lastWrittenValue !== null) {
      this.model.expressions.set(this.currentName, 0);
    }
    this.currentName = null;
    this.lastWrittenValue = null;
  }
}
