import type { VowelDetector, VowelWeights } from "./types";

const BAND_LOW_HZ = [200, 800] as const;
const BAND_MID_HZ = [800, 2500] as const;
const BAND_HIGH_HZ = [2500, 4000] as const;

const VOWEL_TEMPLATES: Record<"aa" | "ih" | "ou" | "ee" | "oh", [number, number, number]> = {
  aa: [1.0, 0.6, 0.2],
  ih: [0.2, 1.0, 0.5],
  ou: [0.3, 0.3, 0.1],
  ee: [0.7, 0.9, 0.3],
  oh: [0.7, 0.4, 0.2],
};

const SOFTMAX_TEMPERATURE = 8;
const VOLUME_GATE = 0.02;
const VOLUME_GAIN = 1.6;

/**
 * FFT 帯域のエネルギー比から母音 (aa/ih/ou/ee/oh) の重みを推定する。
 *
 * 1. AnalyserNode から dB スペクトルを取り 3 バンド (低 / 中 / 高) に集約
 * 2. バンド比を 5 母音テンプレートとコサイン類似度で比較
 * 3. softmax で 0..1 比率に正規化、音量 (RMS) でゲートを掛ける
 */
export class FormantBandVowelDetector implements VowelDetector {
  private readonly freqBuf: Float32Array<ArrayBuffer>;
  private readonly timeBuf: Float32Array<ArrayBuffer>;
  private readonly binHz: number;

  constructor(
    private readonly analyser: AnalyserNode,
    sampleRate: number
  ) {
    this.freqBuf = new Float32Array(new ArrayBuffer(analyser.frequencyBinCount * 4));
    this.timeBuf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    this.binHz = sampleRate / analyser.fftSize;
  }

  analyze(): VowelWeights {
    this.analyser.getFloatFrequencyData(this.freqBuf);
    this.analyser.getFloatTimeDomainData(this.timeBuf);

    const volume = computeRms(this.timeBuf);
    if (volume < VOLUME_GATE) {
      return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, volume };
    }

    const low = this.bandEnergy(BAND_LOW_HZ[0], BAND_LOW_HZ[1]);
    const mid = this.bandEnergy(BAND_MID_HZ[0], BAND_MID_HZ[1]);
    const high = this.bandEnergy(BAND_HIGH_HZ[0], BAND_HIGH_HZ[1]);

    const sum = low + mid + high;
    if (sum <= 1e-6) {
      return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, volume };
    }

    const ratio: [number, number, number] = [low / sum, mid / sum, high / sum];

    const sims = {
      aa: cosineSim(ratio, VOWEL_TEMPLATES.aa),
      ih: cosineSim(ratio, VOWEL_TEMPLATES.ih),
      ou: cosineSim(ratio, VOWEL_TEMPLATES.ou),
      ee: cosineSim(ratio, VOWEL_TEMPLATES.ee),
      oh: cosineSim(ratio, VOWEL_TEMPLATES.oh),
    };

    const norm = softmax(sims, SOFTMAX_TEMPERATURE);
    const gain = Math.min(1, volume * VOLUME_GAIN);

    return {
      aa: norm.aa * gain,
      ih: norm.ih * gain,
      ou: norm.ou * gain,
      ee: norm.ee * gain,
      oh: norm.oh * gain,
      volume,
    };
  }

  dispose(): void {
    // FFT/Time バッファは GC 任せで問題なし
  }

  private bandEnergy(lowHz: number, highHz: number): number {
    const lowBin = Math.max(0, Math.floor(lowHz / this.binHz));
    const highBin = Math.min(
      this.freqBuf.length - 1,
      Math.ceil(highHz / this.binHz)
    );
    if (highBin <= lowBin) return 0;
    let sum = 0;
    for (let i = lowBin; i <= highBin; i++) {
      // dB → リニア (おおよそ)。-100dB を下限として正の値域に
      const db = this.freqBuf[i];
      const lin = Math.pow(10, Math.max(-100, db) / 20);
      sum += lin;
    }
    return sum / (highBin - lowBin + 1);
  }
}

function computeRms(samples: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

function cosineSim(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const na = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  const nb = Math.sqrt(b[0] * b[0] + b[1] * b[1] + b[2] * b[2]);
  if (na <= 1e-6 || nb <= 1e-6) return 0;
  return dot / (na * nb);
}

function softmax(
  sims: { aa: number; ih: number; ou: number; ee: number; oh: number },
  temperature: number
): { aa: number; ih: number; ou: number; ee: number; oh: number } {
  const keys = ["aa", "ih", "ou", "ee", "oh"] as const;
  const maxVal = Math.max(sims.aa, sims.ih, sims.ou, sims.ee, sims.oh);
  let total = 0;
  const exps: Record<(typeof keys)[number], number> = {
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
  };
  for (const k of keys) {
    const v = Math.exp((sims[k] - maxVal) * temperature);
    exps[k] = v;
    total += v;
  }
  if (total <= 1e-6) {
    return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  }
  return {
    aa: exps.aa / total,
    ih: exps.ih / total,
    ou: exps.ou / total,
    ee: exps.ee / total,
    oh: exps.oh / total,
  };
}

export const createFormantBandVowelDetector = (
  analyser: AnalyserNode,
  sampleRate: number
): VowelDetector => new FormantBandVowelDetector(analyser, sampleRate);
