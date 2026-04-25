import * as THREE from "three";
import type { CharacterModel, MotionHandle } from "./types";

export type MovementMode = "walk" | "run" | "none";

export type MovementState =
  | { kind: "idle" }
  | {
      kind: "moving";
      target: THREE.Vector3;
      mode: MovementMode;
      startedAt: number;
    };

export type MovementEvent =
  | { type: "started"; target: THREE.Vector3; mode: MovementMode }
  | { type: "arrived"; target: THREE.Vector3 }
  | { type: "cancelled"; reason: "user" | "manual-base-play" }
  | { type: "modeChanged"; mode: MovementMode };

export interface MovementOptions {
  walkSpeed: number;
  runSpeed: number;
  runDistanceThreshold: number;
  arrivalEpsilon: number;
  rotateTowards: boolean;
}

const DEFAULT_OPTIONS: MovementOptions = {
  walkSpeed: 1.2,
  runSpeed: 3.5,
  runDistanceThreshold: 4.0,
  arrivalEpsilon: 0.05,
  rotateTowards: true,
};

export class MovementController {
  private state: MovementState = { kind: "idle" };
  private listeners = new Set<(event: MovementEvent) => void>();
  private opts: MovementOptions;
  private currentMotionId: string | null = null;
  private unsubscribeStart: () => void;

  constructor(
    private readonly model: CharacterModel,
    opts: Partial<MovementOptions> = {}
  ) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };

    this.unsubscribeStart = model.animation.on("start", (event) => {
      if (this.state.kind !== "moving") return;
      if (event.layer !== "base") return;
      if (event.handle.id === this.currentMotionId) return;
      this.cancelInternal("manual-base-play");
    });
  }

  setTarget(target: THREE.Vector3): void {
    const pos = this.model.object.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const distance = Math.hypot(dx, dz);

    let mode: MovementMode =
      distance > this.opts.runDistanceThreshold ? "run" : "walk";
    const handleId = this.model.motionMapping[mode];
    let handle: MotionHandle | null = null;
    if (handleId) {
      handle =
        this.model.animation.library
          .list()
          .find((h) => h.id === handleId) ?? null;
    }
    if (!handle) {
      mode = "none";
    }

    const wasMoving = this.state.kind === "moving";
    const previousMode = wasMoving
      ? (this.state as Extract<MovementState, { kind: "moving" }>).mode
      : null;

    this.state = {
      kind: "moving",
      target: target.clone(),
      mode,
      startedAt: performance.now(),
    };

    if (handle) {
      this.currentMotionId = handle.id;
      void this.model.animation.play(handle, "base", { loop: true });
    } else {
      this.currentMotionId = null;
    }

    if (wasMoving && previousMode !== mode) {
      this.emit({ type: "modeChanged", mode });
    } else if (!wasMoving) {
      this.emit({ type: "started", target: target.clone(), mode });
    }
  }

  cancel(): void {
    this.cancelInternal("user");
  }

  private cancelInternal(reason: "user" | "manual-base-play"): void {
    if (this.state.kind === "idle") return;
    const mode = this.state.mode;
    this.state = { kind: "idle" };
    if (reason === "user" && (mode === "walk" || mode === "run")) {
      this.model.animation.stopLayer("base");
    }
    this.currentMotionId = null;
    this.emit({ type: "cancelled", reason });
  }

  update(delta: number): void {
    if (this.state.kind !== "moving") return;

    const pos = this.model.object.position;
    const dx = this.state.target.x - pos.x;
    const dz = this.state.target.z - pos.z;
    const distance = Math.hypot(dx, dz);

    if (distance <= this.opts.arrivalEpsilon) {
      const target = this.state.target.clone();
      const mode = this.state.mode;
      this.state = { kind: "idle" };
      if (mode === "walk" || mode === "run") {
        this.model.animation.stopLayer("base");
      }
      this.currentMotionId = null;
      this.emit({ type: "arrived", target });
      return;
    }

    const speed =
      this.state.mode === "run"
        ? this.opts.runSpeed
        : this.opts.walkSpeed;
    const stepDistance = Math.min(speed * delta, distance);
    const ix = dx / distance;
    const iz = dz / distance;
    pos.x += ix * stepDistance;
    pos.z += iz * stepDistance;

    if (this.opts.rotateTowards) {
      this.model.object.rotation.y = Math.atan2(ix, iz);
    }
  }

  getState(): MovementState {
    return this.state;
  }

  getOptions(): MovementOptions {
    return { ...this.opts };
  }

  setOptions(opts: Partial<MovementOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  subscribe(cb: (event: MovementEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  dispose(): void {
    this.unsubscribeStart();
    if (
      this.state.kind === "moving" &&
      (this.state.mode === "walk" || this.state.mode === "run")
    ) {
      this.model.animation.stopLayer("base");
    }
    this.state = { kind: "idle" };
    this.currentMotionId = null;
    this.listeners.clear();
  }

  private emit(event: MovementEvent): void {
    for (const cb of this.listeners) cb(event);
  }
}
