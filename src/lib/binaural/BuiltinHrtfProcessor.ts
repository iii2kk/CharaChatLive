import type { Position3D } from './types';

export class BuiltinHrtfProcessor {
  private ctx: AudioContext;
  private panner: PannerNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 1;
    this.panner.maxDistance = 100;
    this.panner.rolloffFactor = 1;
    this.panner.coneInnerAngle = 360;
    this.panner.coneOuterAngle = 360;
    this.panner.coneOuterGain = 0;
  }

  get input(): PannerNode {
    return this.panner;
  }

  get output(): PannerNode {
    return this.panner;
  }

  updatePosition(pos: Position3D, smoothingTime: number = 0.02): void {
    const now = this.ctx.currentTime;
    const tc = smoothingTime;
    // Web Audio uses right-hand coordinate: x=right, y=up, z=toward listener (out of screen)
    // Our coordinate: x=right, y=front, z=up
    this.panner.positionX.setTargetAtTime(pos.x, now, tc);
    this.panner.positionY.setTargetAtTime(pos.z ?? 0, now, tc);
    this.panner.positionZ.setTargetAtTime(-pos.y, now, tc);
  }

  disconnect(): void {
    this.panner.disconnect();
  }

  dispose(): void {
    this.panner.disconnect();
  }
}
