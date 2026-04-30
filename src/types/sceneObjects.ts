import type * as THREE from "three";

export type SceneObjectKind = "vrm" | "mmd" | "gltf";

export interface SceneObjectMorphInfo {
  readonly name: string;
  readonly meshName?: string;
}

export interface SceneObjectMorphController {
  list(): SceneObjectMorphInfo[];
  get(name: string): number;
  set(name: string, weight: number): void;
  reset(): void;
}

export interface SceneObject {
  readonly id: string;
  readonly name: string;
  readonly sourcePath: string;
  readonly kind: SceneObjectKind;
  readonly object: THREE.Object3D;
  readonly morphs?: SceneObjectMorphController;
  dispose(): void;
}

export type SceneObjectScaleInput =
  | number
  | { x: number; y: number; z: number };
