import type { Position3D } from './types';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export function positionFromThreeCameraLocal(vector: Vector3Like): Position3D {
  return {
    x: vector.x,
    y: -vector.z,
    z: vector.y,
  };
}
