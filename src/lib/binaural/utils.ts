import type { Position3D } from './types';

export function calcAzimuth(pos: Position3D): number {
  // Returns azimuth in radians: 0 = front, positive = right, negative = left
  // Range: [-PI, PI]
  return Math.atan2(pos.x, pos.y);
}

export function calcElevation(pos: Position3D): number {
  const horizontalDist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
  return Math.atan2(pos.z ?? 0, horizontalDist);
}

export function calcDistance(pos: Position3D): number {
  const z = pos.z ?? 0;
  return Math.sqrt(pos.x * pos.x + pos.y * pos.y + z * z);
}

export function distanceGain(
  distance: number,
  refDistance: number = 1,
  rolloff: number = 1,
): number {
  if (distance <= refDistance) return 1;
  return refDistance / (refDistance + rolloff * (distance - refDistance));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}
