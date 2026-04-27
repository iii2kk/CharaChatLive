import * as THREE from "three";
import type { CharacterModel } from "./types";
import type { AudioSourceHandle } from "./lipSync/audioSource";
import { getSharedAudioContext } from "./lipSync/audioSource";
import { createFormantBandVowelDetector } from "./lipSync/formantBandVowelDetector";
import type {
  VowelDetector,
  VowelDetectorFactory,
  VowelWeights,
} from "./lipSync/types";
import {
  createBinauralRenderer,
  positionFromThreeCameraLocal,
} from "@/lib/binaural";
import type { BinauralMode, BinauralRenderer } from "@/lib/binaural";

/** Three.js 1 ユニット相当を Web Audio の何メートル分として扱うか */
const WORLD_TO_AUDIO_SCALE = 0.1;

export interface LipSyncListener {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const VOWEL_KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;
type VowelKey = (typeof VOWEL_KEYS)[number];

const ATTACK_TAU = 0.005;
const RELEASE_TAU = 0.10;
const OVERRIDE_EPSILON = 0.05;

export interface LipSyncOptions {
  detectorFactory?: VowelDetectorFactory;
}

/**
 * オーディオを `AudioSourceHandle` 経由で受け取り、毎フレーム母音重みを
 * `model.expressions` に書き込む。
 *
 * - 母音判定は VowelDetector に委譲しており、将来 Whisper 等に差し替え可能。
 * - `expressionMapping` の aa/ih/ou/ee/oh 各キーが null の場合は該当母音をスキップ。
 * - ユーザが ExpressionControlWindow からスライダ操作した場合、
 *   `lastWritten` と現在値の乖離を検知して manualOverride に入り、
 *   そのキーの自動更新を一時停止する (autoBlinkController と同方針)。
 */
export class LipSyncController {
  private readonly detectorFactory: VowelDetectorFactory;
  private detector: VowelDetector | null = null;
  private source: AudioSourceHandle | null = null;
  private current: Record<VowelKey, number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  private lastWritten: Record<VowelKey, number | null> = {
    aa: null,
    ih: null,
    ou: null,
    ee: null,
    oh: null,
  };
  private overridden: Record<VowelKey, boolean> = {
    aa: false,
    ih: false,
    ou: false,
    ee: false,
    oh: false,
  };
  private enabled = true;
  private disposed = false;
  private mappingUnsubscribe: (() => void) | null = null;
  private renderer: BinauralRenderer | null = null;
  private spatialEnabled = false;
  private spatialMode: BinauralMode = "builtin-hrtf";
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  /** 直近の resolveName キャッシュ。mapping 更新時に invalidate される */
  private resolvedNames: Record<VowelKey, string | null> = {
    aa: null,
    ih: null,
    ou: null,
    ee: null,
    oh: null,
  };

  constructor(
    private readonly model: CharacterModel,
    options?: LipSyncOptions
  ) {
    this.detectorFactory = options?.detectorFactory ?? createFormantBandVowelDetector;
    this.refreshMapping();
    this.mappingUnsubscribe = model.expressionMapping.subscribe(() => {
      if (this.disposed) return;
      this.handleMappingChanged();
    });
  }

  /** AudioSource を接続。既存接続があれば置き換え。 */
  attach(source: AudioSourceHandle): void {
    if (this.disposed) return;
    this.detach();
    this.source = source;
    this.detector = this.detectorFactory(source.analyser, source.sampleRate);
  }

  /** 立体音響の設定を更新する。再生中でも setBypass / setMode により即時反映される。 */
  setSpatial(opts: { enabled: boolean; mode: BinauralMode }): void {
    this.spatialEnabled = opts.enabled;
    this.spatialMode = opts.mode;
    if (this.renderer) {
      this.renderer.setMode(opts.mode);
      this.renderer.setBypass(!opts.enabled);
    }
  }

  /**
   * AudioSource 生成時に渡す BinauralRenderer を取得する。
   * 無効時もチェーンには差しておき、`setBypass(true)` で素通しにすることで
   * 再生中のライブ ON/OFF 切替を可能にする。
   */
  acquireSpatializer(): BinauralRenderer {
    if (this.renderer) {
      return this.renderer;
    }
    const ctx = getSharedAudioContext();
    this.renderer = createBinauralRenderer(ctx, { mode: this.spatialMode });
    // 冪等な connect なので 1 回だけで OK。dispose まで維持される。
    this.renderer.connect(ctx.destination);
    this.renderer.setBypass(!this.spatialEnabled);
    return this.renderer;
  }

  /** 現在の AudioSource を切断し dispose する。 */
  detach(): void {
    if (this.detector) {
      this.detector.dispose();
      this.detector = null;
    }
    if (this.source) {
      this.source.dispose();
      this.source = null;
    }
    this.zeroOutAll();
  }

  /** 現在ぶら下がっている <audio> 要素 (URL 由来時のみ)。再生制御に使う。 */
  getAudioElement(): HTMLAudioElement | null {
    return this.source?.audio ?? null;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.zeroOutAll();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** useFrame から毎フレーム呼ぶ。 */
  update(delta: number, listener?: LipSyncListener): void {
    if (this.disposed) return;

    if (this.renderer && this.spatialEnabled && listener) {
      this.updateSpatialPosition(listener);
    }

    if (!this.enabled) return;
    if (!this.detector) return;

    const weights: VowelWeights = this.detector.analyze();

    for (const key of VOWEL_KEYS) {
      const name = this.resolvedNames[key];
      if (!name) continue;

      // manual override 検出
      const last = this.lastWritten[key];
      if (last !== null) {
        const observed = this.model.expressions.get(name);
        if (Math.abs(observed - last) > OVERRIDE_EPSILON) {
          this.overridden[key] = true;
          this.current[key] = observed;
          this.lastWritten[key] = null;
        }
      } else if (this.overridden[key]) {
        // override 中: ユーザが 0 付近に戻したら復帰
        const observed = this.model.expressions.get(name);
        if (observed < OVERRIDE_EPSILON) {
          this.overridden[key] = false;
        }
      }

      if (this.overridden[key]) continue;

      const target = weights[key];
      const tau = target > this.current[key] ? ATTACK_TAU : RELEASE_TAU;
      const alpha = 1 - Math.exp(-Math.max(0, delta) / Math.max(1e-3, tau));
      const next = this.current[key] + (target - this.current[key]) * alpha;
      this.current[key] = next;
      this.model.expressions.set(name, next);
      this.lastWritten[key] = next;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.mappingUnsubscribe) {
      this.mappingUnsubscribe();
      this.mappingUnsubscribe = null;
    }
    this.detach();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }

  private updateSpatialPosition(listener: LipSyncListener): void {
    if (!this.renderer) return;
    // モデルのワールド座標 → カメラローカルへ
    const local = this.model.object.getWorldPosition(this.tmpVec);
    local.sub(listener.position);
    this.tmpQuat.copy(listener.quaternion).invert();
    local.applyQuaternion(this.tmpQuat);
    local.multiplyScalar(WORLD_TO_AUDIO_SCALE);
    this.renderer.setPosition(positionFromThreeCameraLocal(local));
  }

  private refreshMapping(): void {
    for (const key of VOWEL_KEYS) {
      this.resolvedNames[key] = this.model.expressionMapping[key];
    }
  }

  private handleMappingChanged(): void {
    // 旧マッピングのキーは 0 に戻す
    for (const key of VOWEL_KEYS) {
      const old = this.resolvedNames[key];
      const next = this.model.expressionMapping[key];
      if (old && old !== next && this.lastWritten[key] !== null) {
        this.model.expressions.set(old, 0);
      }
      if (old !== next) {
        this.current[key] = 0;
        this.lastWritten[key] = null;
        this.overridden[key] = false;
      }
    }
    this.refreshMapping();
  }

  private zeroOutAll(): void {
    for (const key of VOWEL_KEYS) {
      const name = this.resolvedNames[key];
      if (name && this.lastWritten[key] !== null) {
        this.model.expressions.set(name, 0);
      }
      this.current[key] = 0;
      this.lastWritten[key] = null;
    }
  }
}
