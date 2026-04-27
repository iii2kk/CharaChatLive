const FFT_SIZE = 1024;
const SMOOTHING = 0.1;

export interface AudioSourceHandle {
  /** AnalyserNode (VowelDetector に渡す) */
  readonly analyser: AnalyserNode;
  /** AudioContext.sampleRate */
  readonly sampleRate: number;
  /** HTMLAudio 経由の場合は <audio> 要素 (再生制御用)。それ以外は null */
  readonly audio: HTMLAudioElement | null;
  /** 接続を切断しリソースを解放する */
  dispose(): void;
}

/**
 * AnalyserNode と destination の間に差し込むエフェクトノード。
 * `BinauralRenderer` 互換の `input` を持ち、`connect(destination)` を実装していれば渡せる。
 */
export interface AudioEffect {
  readonly input: AudioNode;
  connect(destination: AudioNode): void;
  disconnect(): void;
}

export interface AudioSourceOptions {
  /** スピーカー出力を有効にするか (既定: true) */
  playToSpeaker?: boolean;
  /** AnalyserNode と destination の間に差し込むエフェクト (例: BinauralRenderer) */
  effect?: AudioEffect | null;
}

export function getSharedAudioContext(): AudioContext {
  return getAudioContext();
}

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (sharedContext && sharedContext.state !== "closed") {
    return sharedContext;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio API is not supported in this environment");
  }
  sharedContext = new Ctor();
  return sharedContext;
}

async function ensureRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      // resume は user gesture 外だと失敗するが、再生開始時に再試行されるため握り潰す
    }
  }
}

function buildAnalyser(ctx: AudioContext): AnalyserNode {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = SMOOTHING;
  return analyser;
}

/**
 * URL から HTMLAudioElement を生成し、Web Audio に接続する。
 * <audio> 要素は CORS 回避のため anonymous モードで開く。
 * 再生は呼び出し側で `audio.play()` を行う。
 */
export async function createAudioSourceFromUrl(
  url: string,
  options?: AudioSourceOptions
): Promise<AudioSourceHandle> {
  const ctx = getAudioContext();
  await ensureRunning(ctx);

  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.src = url;
  audio.preload = "auto";

  const sourceNode = ctx.createMediaElementSource(audio);
  const analyser = buildAnalyser(ctx);
  sourceNode.connect(analyser);
  const effect = options?.effect ?? null;
  if (options?.playToSpeaker !== false) {
    if (effect) {
      analyser.connect(effect.input);
      effect.connect(ctx.destination);
    } else {
      analyser.connect(ctx.destination);
    }
  }

  return {
    analyser,
    sampleRate: ctx.sampleRate,
    audio,
    dispose: () => {
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch {
        /* noop */
      }
      try {
        sourceNode.disconnect();
      } catch {
        /* noop */
      }
      try {
        analyser.disconnect();
      } catch {
        /* noop */
      }
      if (effect) {
        try {
          effect.disconnect();
        } catch {
          /* noop */
        }
      }
    },
  };
}

/**
 * MediaStream (マイク等) を Web Audio に接続する。
 * 既定でスピーカーへも出力するが、ループバックを避けたい場合は
 * `{ playToSpeaker: false }` を指定する。
 */
export async function createAudioSourceFromStream(
  stream: MediaStream,
  options?: AudioSourceOptions
): Promise<AudioSourceHandle> {
  const ctx = getAudioContext();
  await ensureRunning(ctx);

  const sourceNode = ctx.createMediaStreamSource(stream);
  const analyser = buildAnalyser(ctx);
  sourceNode.connect(analyser);
  const effect = options?.effect ?? null;
  if (options?.playToSpeaker !== false) {
    if (effect) {
      analyser.connect(effect.input);
      effect.connect(ctx.destination);
    } else {
      analyser.connect(ctx.destination);
    }
  }

  return {
    analyser,
    sampleRate: ctx.sampleRate,
    audio: null,
    dispose: () => {
      try {
        sourceNode.disconnect();
      } catch {
        /* noop */
      }
      try {
        analyser.disconnect();
      } catch {
        /* noop */
      }
      if (effect) {
        try {
          effect.disconnect();
        } catch {
          /* noop */
        }
      }
    },
  };
}
