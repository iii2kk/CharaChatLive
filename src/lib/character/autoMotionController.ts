import type { CharacterModel, MotionMappingKey } from "./types";

export type AutoMotionMode = MotionMappingKey;

/**
 * idle / walk / run の自動モーション再生を管理する。
 * MotionControlWindow からの手動 base 再生はイベント駆動で検出し、
 * 検出中は auto モーションの play を抑止する (manualOverride)。
 *
 * 自他の判別: 自分が play した handle id を ourHandleIds に登録し、
 * "start" / "end" イベントで Set を照合する。
 */
export class AutoMotionController {
  private desired: AutoMotionMode | null = "idle";
  private manualOverride = false;
  private ourHandleIds = new Set<string>();
  private unsubscribers: Array<() => void> = [];
  private overrideListeners = new Set<(active: boolean) => void>();
  private disposed = false;
  private applyQueued = false;

  constructor(private readonly model: CharacterModel) {
    this.unsubscribers.push(
      model.animation.on("start", (event) => {
        if (this.disposed) return;
        if (event.layer !== "base") return;
        if (this.ourHandleIds.has(event.handle.id)) return;
        if (!this.manualOverride) {
          this.manualOverride = true;
          this.notifyOverrideChange(true);
        }
      })
    );

    this.unsubscribers.push(
      model.animation.on("end", (event) => {
        if (this.disposed) return;
        if (event.layer !== "base") return;
        if (this.ourHandleIds.has(event.handle.id)) {
          this.ourHandleIds.delete(event.handle.id);
          return;
        }
        if (this.manualOverride) {
          this.manualOverride = false;
          this.notifyOverrideChange(false);
        }
        this.queueApplyAuto();
      })
    );

    this.unsubscribers.push(
      model.motionMapping.subscribe(() => {
        if (this.disposed) return;
        this.applyAuto();
      })
    );

    this.applyAuto();
  }

  setDesired(mode: AutoMotionMode | null): void {
    if (this.desired === mode) return;
    this.desired = mode;
    this.applyAuto();
  }

  getDesired(): AutoMotionMode | null {
    return this.desired;
  }

  isManualOverride(): boolean {
    return this.manualOverride;
  }

  /** 自分が auto として再生した handle か */
  isOurHandle(handleId: string): boolean {
    return this.ourHandleIds.has(handleId);
  }

  /** manualOverride の遷移を購読 */
  onManualOverrideChange(cb: (active: boolean) => void): () => void {
    this.overrideListeners.add(cb);
    return () => {
      this.overrideListeners.delete(cb);
    };
  }

  private applyAuto(): void {
    this.applyQueued = false;
    if (this.disposed) return;
    if (this.manualOverride) return;

    const desired = this.desired;
    if (desired === null) {
      this.stopOurAuto();
      return;
    }

    const handleId = this.model.motionMapping[desired];
    if (!handleId) {
      this.stopOurAuto();
      return;
    }

    const handle = this.model.animation.library
      .list()
      .find((h) => h.id === handleId);
    if (!handle) {
      this.stopOurAuto();
      return;
    }

    const active = this.model.animation.getActive("base");
    if (
      active &&
      active.id === handle.id &&
      this.ourHandleIds.has(handle.id)
    ) {
      return;
    }

    this.ourHandleIds.add(handle.id);
    void this.model.animation
      .play(handle, "base", { loop: true })
      .catch(() => {
        this.ourHandleIds.delete(handle.id);
      });
  }

  private queueApplyAuto(): void {
    if (this.disposed) return;
    if (this.applyQueued) return;
    this.applyQueued = true;
    queueMicrotask(() => {
      this.applyAuto();
    });
  }

  private stopOurAuto(): void {
    const active = this.model.animation.getActive("base");
    if (active && this.ourHandleIds.has(active.id)) {
      this.model.animation.stopLayer("base");
    }
  }

  private notifyOverrideChange(active: boolean): void {
    for (const cb of this.overrideListeners) cb(active);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.stopOurAuto();
    this.ourHandleIds.clear();
    this.overrideListeners.clear();
  }
}
