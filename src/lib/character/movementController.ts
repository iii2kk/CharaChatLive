import * as THREE from "three";
import type { AutoMotionController } from "./autoMotionController";
import type { CharacterModel } from "./types";

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
  private unsubscribeOverride: () => void;
  private readonly modelForwardYawOffset: number;

  constructor(
    private readonly model: CharacterModel,
    private readonly autoMotion: AutoMotionController,
    opts: Partial<MovementOptions> = {}
  ) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    this.modelForwardYawOffset = model.object.rotation.y;

    this.unsubscribeOverride = autoMotion.onManualOverrideChange((active) => {
      if (active && this.state.kind === "moving") {
        this.cancelInternal("manual-base-play");
      }
    });
  }

  setTarget(target: THREE.Vector3): void {
    const pos = this.model.object.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const distance = Math.hypot(dx, dz);

    let mode: MovementMode =
      distance > this.opts.runDistanceThreshold ? "run" : "walk";
    if (!this.model.motionMapping[mode]) {
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

    this.rotateTowardsDirection(dx, dz);
    this.applyAutoForState();

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
    this.state = { kind: "idle" };
    if (reason === "user") {
      this.applyAutoForState();
    }
    this.emit({ type: "cancelled", reason });
  }

  /** 現在の state に応じて AutoMotionController に desired を伝える */
  private applyAutoForState(): void {
    if (this.state.kind === "idle") {
      this.autoMotion.setDesired("idle");
    } else if (this.state.mode === "walk" || this.state.mode === "run") {
      this.autoMotion.setDesired(this.state.mode);
    } else {
      this.autoMotion.setDesired(null);
    }
  }

  update(delta: number): void {
    if (this.state.kind !== "moving") return;

    const pos = this.model.object.position;
    const dx = this.state.target.x - pos.x;
    const dz = this.state.target.z - pos.z;
    const distance = Math.hypot(dx, dz);

    if (distance <= this.opts.arrivalEpsilon) {
      const target = this.state.target.clone();
      this.state = { kind: "idle" };
      this.applyAutoForState();
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

    this.rotateTowardsDirection(ix, iz);
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
    this.unsubscribeOverride();
    if (this.state.kind === "moving") {
      this.state = { kind: "idle" };
      this.autoMotion.setDesired("idle");
    }
    this.listeners.clear();
  }

  private emit(event: MovementEvent): void {
    for (const cb of this.listeners) cb(event);
  }

  private rotateTowardsDirection(x: number, z: number): void {
    if (!this.opts.rotateTowards) return;
    if (Math.hypot(x, z) <= 1e-6) return;
    this.model.object.rotation.y =
      this.modelForwardYawOffset + Math.atan2(x, z);
  }
}
