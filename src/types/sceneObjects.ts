import type * as THREE from "three";

export type SceneObjectKind = "vrm" | "mmd" | "gltf";

export interface SceneObject {
  readonly id: string;
  readonly name: string;
  readonly sourcePath: string;
  readonly kind: SceneObjectKind;
  readonly object: THREE.Object3D;
  dispose(): void;
}

export type SceneObjectScaleInput =
  | number
  | { x: number; y: number; z: number };
