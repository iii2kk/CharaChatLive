export interface Position3D {
  x: number; // left-right (meters), positive = right
  y: number; // front-back (meters), positive = front
  z?: number; // up-down (meters), 0 for 2D mode
}

export type ProcessorMode = 'simple' | 'builtin-hrtf';
export type BinauralMode = ProcessorMode;
export type SyncPlayerState = 'stopped' | 'playing' | 'paused';

export interface BinauralRendererOptions {
  mode?: BinauralMode;
  position?: Position3D;
  smoothingTime?: number;
  downmix?: boolean;
}

export interface BinauralRenderer {
  readonly input: AudioNode;
  readonly output: AudioNode;
  setMode(mode: BinauralMode): void;
  setPosition(position: Position3D): void;
  setGain(value: number): void;
  connect(destination: AudioNode | AudioParam): void;
  disconnect(): void;
  dispose(): void;
}

export type BinauralSourceInput = string | URL | HTMLAudioElement | AudioNode;
export type BinauralSourceInputKind = 'url' | 'element' | 'node';

export interface BinauralSourceOptions extends BinauralRendererOptions {
  volume?: number;
  loop?: boolean;
  normalize?: boolean;
  reverbSend?: number;
}

export interface BinauralSource {
  readonly renderer: BinauralRenderer;
  readonly inputKind: BinauralSourceInputKind;
  readonly duration: number;
  readonly currentTime: number;
  readonly playing: boolean;

  load(input: BinauralSourceInput): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;

  setPosition(position: Position3D): void;
  setMode(mode: BinauralMode): void;
  setVolume(value: number): void;
  setLoop(loop: boolean): void;
  setNormalize(enabled: boolean): void;

  connect(destination: AudioNode): void;
  disconnect(): void;
  dispose(): void;
}

export interface SyncPlayerConfig {
  id: string;
  name: string;
  sourceIds: string[];
  state: SyncPlayerState;
  timelinePosition: number;
}

export interface SourceConfig {
  id: string;
  name: string;
  fileUrl: string;
  position: Position3D;
  mode: ProcessorMode;
  volume: number; // 0-1
  normalize: boolean;
  loop: boolean;
  playing: boolean;
  duration: number;
}

export interface RoomPreset {
  name: string;
  irUrl: string;
  wetGain: number;
}
