export interface VowelWeights {
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
  /** 0..1 程度の音量 (RMS)。無音判定に使う */
  volume: number;
}

export const ZERO_VOWEL_WEIGHTS: Readonly<VowelWeights> = Object.freeze({
  aa: 0,
  ih: 0,
  ou: 0,
  ee: 0,
  oh: 0,
  volume: 0,
});

export interface VowelDetector {
  /** 現在のオーディオフレームから5母音重みを返す。毎フレーム呼ばれる想定。 */
  analyze(): VowelWeights;
  dispose(): void;
}

export type VowelDetectorFactory = (
  analyser: AnalyserNode,
  sampleRate: number
) => VowelDetector;
