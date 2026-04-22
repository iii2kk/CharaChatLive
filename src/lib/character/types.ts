import type * as THREE from "three";
import type { FileMap, ModelKind } from "@/lib/file-map";
import type { ViewerSettings } from "@/lib/viewer-settings";

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

export interface PresetExpressionInfo {
  name: string;
}

export interface PresetExpressionController {
  list(): readonly PresetExpressionInfo[];
  getActive(): string | null;
  apply(name: string): void;
  clear(): void;
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

export interface SemanticMappingOption {
  value: string;
  label: string;
}

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
  getOptions?(key: SemanticExpressionKey): readonly SemanticMappingOption[];
}

export interface BoneRef {
  name: string;
  bone: THREE.Bone;
}

export interface BoneController {
  list(): readonly BoneRef[];
  find(name: string): BoneRef | null;
}

export type MotionLayer = "base" | "overlay";
export type MotionSource = "vmd" | "vrma" | "motion3";

export interface MotionHandle {
  readonly id: string;
  readonly source: MotionSource;
}

export interface MotionInfo {
  id: string;
  name: string;
  /** バックエンドが長さを報告できないとき null (Live2D のループモーション等) */
  durationSec: number | null;
  loopable: boolean;
  source: MotionSource;
  /** Live2D の model3.json 同梱モーションなら true */
  embedded: boolean;
}

export interface LoadOptions {
  name?: string;
}

export interface PlayOptions {
  /** base のデフォルト: true / overlay のデフォルト: false */
  loop?: boolean;
  /** 再生速度 (デフォルト 1.0) */
  speed?: number;
  /** フェードイン秒 (デフォルト 0.2) */
  fadeInSec?: number;
  /** フェードアウト秒 (このレイヤー停止/置換時に適用、デフォルト 0.2) */
  fadeOutSec?: number;
  /** overlay のブレンドウェイト (デフォルト 1.0) */
  weight?: number;
}

export type AnimationEvent =
  | { type: "start"; layer: MotionLayer; handle: MotionHandle }
  | { type: "end"; layer: MotionLayer; handle: MotionHandle }
  | { type: "loop"; layer: MotionLayer; handle: MotionHandle };

export type AnimationEventType = AnimationEvent["type"];

export interface MotionCapability {
  readonly layers: readonly MotionLayer[];
  readonly crossfade: boolean;
  readonly seek: boolean;
  readonly externalLoad: boolean;
  readonly embeddedLibrary: boolean;
}

export class MotionHandleDisposedError extends Error {
  constructor(handleId: string) {
    super(`motion handle "${handleId}" has been disposed`);
    this.name = "MotionHandleDisposedError";
  }
}

export interface MotionLibrary {
  load(
    urls: string[],
    fileMap: FileMap | null,
    opts?: LoadOptions
  ): Promise<MotionHandle>;
  /** 利用可能な全ハンドル (埋め込み + ロード済み外部) */
  list(): readonly MotionHandle[];
  /** model3.json 同梱モーション等。VRM/MMD では空配列 */
  listEmbedded(): readonly MotionHandle[];
  getInfo(handle: MotionHandle): MotionInfo;
  dispose(handle: MotionHandle): void;
}

export type MotionMappingKey = "idle";

export interface MotionMappingSnapshot {
  idle: string | null;
}

/** モーションの用途 (idle 等) と handle.id の対応。購読可能 */
export interface MotionMapping {
  idle: string | null;
  subscribe(listener: () => void): () => void;
  set(key: MotionMappingKey, handleId: string | null): void;
  toJSON(): MotionMappingSnapshot;
}

export interface AnimationController {
  // ── 既存 API (後方互換) ──
  getCurrentClip(): THREE.AnimationClip | null;
  isLoaded(): boolean;
  loadAndPlay(urls: string[], fileMap: FileMap | null): Promise<void>;
  stop(): void;
  setPaused(paused: boolean): void;
  setTime(seconds: number): void;

  // ── 新 API ──
  readonly library: MotionLibrary;
  readonly capabilities: MotionCapability;
  play(
    handle: MotionHandle,
    layer: MotionLayer,
    opts?: PlayOptions
  ): Promise<void>;
  stopLayer(layer: MotionLayer, fadeOutSec?: number): void;
  setLayerSpeed(layer: MotionLayer, timeScale: number): void;
  getActive(layer: MotionLayer): MotionInfo | null;
  on(
    event: AnimationEventType,
    cb: (e: AnimationEvent) => void
  ): () => void;
}

export type PhysicsCapability = "full" | "spring-bone";

export interface PhysicsController {
  readonly capability: PhysicsCapability;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): Promise<void>;
  setGravity(gravity: THREE.Vector3): void;
}

export interface CharacterFrameContext {
  readonly camera: THREE.Camera;
  readonly renderer: THREE.WebGLRenderer;
  readonly viewerSettings: ViewerSettings;
  readonly delta: number;
  readonly deltaMs: number;
  readonly frameId: number;
}

export interface CharacterModel {
  readonly id: string;
  readonly name: string;
  readonly kind: ModelKind;
  readonly object: THREE.Object3D;

  readonly expressions: ExpressionController;
  readonly expressionMapping: ExpressionMapping;
  readonly presetExpressions?: PresetExpressionController;
  readonly bones: BoneController;
  readonly animation: AnimationController;
  readonly motionMapping: MotionMapping;
  readonly physics: PhysicsController;

  /** Live2D のみ: ベースの offscreen canvas 解像度スケール */
  readonly renderScale?: number;
  /** Live2D のみ: 距離補正込みの実効解像度スケール */
  readonly effectiveRenderScale?: number;
  /** Live2D のみ: 現在の板ポリ表示スケール */
  readonly planeScale?: number;

  /** physics + animation + expression 適用 */
  update(delta: number): void;
  prepareFrame(context: CharacterFrameContext): void;
  finalizeFrame(context: CharacterFrameContext): void;
  setRenderScale?(scale: number): void;
  setDisplayScale?(scale: number): void;
  dispose(): void;
}
