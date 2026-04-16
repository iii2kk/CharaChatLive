import type * as THREE from "three";
import type { FileMap, ModelKind } from "@/lib/file-map";

export type ExpressionCategory = "eye" | "lip" | "brow" | "other";

export interface ExpressionInfo {
  /** raw 名（PMX=日本語、VRM=preset/custom 名） */
  name: string;
  /** UI グルーピング用ヒント */
  category: ExpressionCategory;
}

export interface ExpressionController {
  list(): readonly ExpressionInfo[];
  has(name: string): boolean;
  /** 未登録は 0 を返す */
  get(name: string): number;
  /** 0..1 にクランプ。未登録は no-op */
  set(name: string, weight: number): void;
  setMany(values: Record<string, number>): void;
  reset(): void;
}

export type SemanticExpressionKey =
  | "blink"
  | "blinkLeft"
  | "blinkRight"
  | "aa"
  | "ih"
  | "ou"
  | "ee"
  | "oh";

export const SEMANTIC_EXPRESSION_KEYS: readonly SemanticExpressionKey[] = [
  "blink",
  "blinkLeft",
  "blinkRight",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
];

export type SemanticExpressionMappingSnapshot = Record<
  SemanticExpressionKey,
  string | null
>;

export interface ExpressionMapping {
  blink: string | null;
  blinkLeft: string | null;
  blinkRight: string | null;
  aa: string | null;
  ih: string | null;
  ou: string | null;
  ee: string | null;
  oh: string | null;

  /** 状態が変わったときに通知。UI 再描画用 */
  subscribe(listener: () => void): () => void;
  set(key: SemanticExpressionKey, name: string | null): void;
  toJSON(): SemanticExpressionMappingSnapshot;
}

export interface BoneRef {
  name: string;
  bone: THREE.Bone;
}

export interface BoneController {
  list(): readonly BoneRef[];
  find(name: string): BoneRef | null;
}

export interface AnimationController {
  getCurrentClip(): THREE.AnimationClip | null;
  isLoaded(): boolean;

  loadAndPlay(urls: string[], fileMap: FileMap | null): Promise<void>;
  stop(): void;
  setPaused(paused: boolean): void;
  setTime(seconds: number): void;
}

export type PhysicsCapability = "full" | "spring-bone";

export interface PhysicsController {
  readonly capability: PhysicsCapability;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): Promise<void>;
  setGravity(gravity: THREE.Vector3): void;
}

export interface CharacterModel {
  readonly id: string;
  readonly name: string;
  readonly kind: ModelKind;
  readonly object: THREE.Object3D;

  readonly expressions: ExpressionController;
  readonly expressionMapping: ExpressionMapping;
  readonly bones: BoneController;
  readonly animation: AnimationController;
  readonly physics: PhysicsController;

  /** Live2D のみ: 現在の offscreen canvas 解像度スケール */
  readonly renderScale?: number;
  /** Live2D のみ: 現在の板ポリ表示スケール */
  readonly planeScale?: number;

  /** physics + animation + expression 適用 */
  update(delta: number): void;
  afterSharedRender?(): void;
  setRenderScale?(scale: number): void;
  setDisplayScale?(scale: number): void;
  dispose(): void;
}
