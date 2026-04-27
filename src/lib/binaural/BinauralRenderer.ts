import { BuiltinHrtfProcessor } from './BuiltinHrtfProcessor';
import { SimpleProcessor } from './SimpleProcessor';
import type {
  BinauralMode,
  BinauralRenderer,
  BinauralRendererOptions,
  Position3D,
} from './types';
import { calcAzimuth, calcDistance, calcElevation } from './utils';

const DEFAULT_POSITION: Required<Position3D> = { x: 0, y: 1, z: 0 };

function withDefaultZ(position: Position3D): Required<Position3D> {
  return { x: position.x, y: position.y, z: position.z ?? 0 };
}

export class WebAudioBinauralRenderer implements BinauralRenderer {
  private ctx: AudioContext;
  private inputGain: GainNode;
  private downmixGain: GainNode;
  private dryGain: GainNode;
  private simpleGain: GainNode;
  private hrtfGain: GainNode;
  private outputGain: GainNode;
  private simpleProcessor: SimpleProcessor;
  private builtinHrtf: BuiltinHrtfProcessor;
  private mode: BinauralMode;
  private position: Required<Position3D>;
  private smoothingTime: number;
  private downmix: boolean;
  private _bypassed = false;
  private destinations = new Set<AudioNode | AudioParam>();

  constructor(ctx: AudioContext, options: BinauralRendererOptions = {}) {
    this.ctx = ctx;
    this.mode = options.mode ?? 'simple';
    this.position = withDefaultZ(options.position ?? DEFAULT_POSITION);
    this.smoothingTime = options.smoothingTime ?? 0.02;
    this.downmix = options.downmix ?? true;

    this.inputGain = ctx.createGain();
    this.downmixGain = ctx.createGain();
    this.downmixGain.channelCount = 1;
    this.downmixGain.channelCountMode = 'explicit';
    this.downmixGain.channelInterpretation = 'speakers';
    this.dryGain = ctx.createGain();
    this.simpleGain = ctx.createGain();
    this.hrtfGain = ctx.createGain();
    this.outputGain = ctx.createGain();

    this.simpleProcessor = new SimpleProcessor(ctx);
    this.builtinHrtf = new BuiltinHrtfProcessor(ctx);

    this.connectInternalGraph();
    this.applyRouteGains(true);
    this.updateProcessorPosition();
  }

  get input(): AudioNode {
    return this.inputGain;
  }

  get output(): AudioNode {
    return this.outputGain;
  }

  get bypassed(): boolean {
    return this._bypassed;
  }

  setBypass(enabled: boolean): void {
    if (this._bypassed === enabled) return;
    this._bypassed = enabled;
    this.applyRouteGains();
  }

  setMode(mode: BinauralMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.applyRouteGains();
    this.updateProcessorPosition();
  }

  setPosition(position: Position3D): void {
    this.position = withDefaultZ(position);
    this.updateProcessorPosition();
  }

  setGain(value: number): void {
    this.outputGain.gain.setTargetAtTime(value, this.ctx.currentTime, this.smoothingTime);
  }

  connect(destination: AudioNode | AudioParam): void {
    if (this.destinations.has(destination)) return;

    if (destination instanceof AudioNode) {
      this.outputGain.connect(destination);
    } else {
      this.outputGain.connect(destination);
    }

    this.destinations.add(destination);
  }

  disconnect(destination?: AudioNode | AudioParam): void {
    if (destination) {
      if (!this.destinations.has(destination)) return;

      if (destination instanceof AudioNode) {
        this.outputGain.disconnect(destination);
      } else {
        this.outputGain.disconnect(destination);
      }
      this.destinations.delete(destination);
      return;
    }

    for (const connectedDestination of this.destinations) {
      if (connectedDestination instanceof AudioNode) {
        this.outputGain.disconnect(connectedDestination);
      } else {
        this.outputGain.disconnect(connectedDestination);
      }
    }
    this.destinations.clear();
  }

  dispose(): void {
    this.disconnect();
    this.inputGain.disconnect();
    this.downmixGain.disconnect();
    this.dryGain.disconnect();
    this.simpleProcessor.dispose();
    this.builtinHrtf.dispose();
    this.simpleGain.disconnect();
    this.hrtfGain.disconnect();
    this.outputGain.disconnect();
  }

  private connectInternalGraph(): void {
    this.inputGain.connect(this.dryGain);
    this.dryGain.connect(this.outputGain);

    if (this.downmix) {
      this.inputGain.connect(this.downmixGain);
      this.downmixGain.connect(this.simpleProcessor.input);
      this.downmixGain.connect(this.builtinHrtf.input);
    } else {
      this.inputGain.connect(this.simpleProcessor.input);
      this.inputGain.connect(this.builtinHrtf.input);
    }

    this.simpleProcessor.output.connect(this.simpleGain);
    this.simpleGain.connect(this.outputGain);
    this.builtinHrtf.output.connect(this.hrtfGain);
    this.hrtfGain.connect(this.outputGain);
  }

  private applyRouteGains(immediate = false): void {
    const dry = this._bypassed ? 1 : 0;
    const simple = !this._bypassed && this.mode === 'simple' ? 1 : 0;
    const hrtf = !this._bypassed && this.mode === 'builtin-hrtf' ? 1 : 0;

    if (immediate) {
      this.dryGain.gain.value = dry;
      this.simpleGain.gain.value = simple;
      this.hrtfGain.gain.value = hrtf;
      return;
    }

    const now = this.ctx.currentTime;
    this.dryGain.gain.setTargetAtTime(dry, now, this.smoothingTime);
    this.simpleGain.gain.setTargetAtTime(simple, now, this.smoothingTime);
    this.hrtfGain.gain.setTargetAtTime(hrtf, now, this.smoothingTime);
  }

  private updateProcessorPosition(): void {
    if (this.mode === 'simple') {
      this.simpleProcessor.update(
        calcAzimuth(this.position),
        calcElevation(this.position),
        calcDistance(this.position),
        this.smoothingTime,
      );
      return;
    }

    this.builtinHrtf.updatePosition(this.position, this.smoothingTime);
  }
}

export function createBinauralRenderer(
  context: AudioContext,
  options?: BinauralRendererOptions,
): BinauralRenderer {
  return new WebAudioBinauralRenderer(context, options);
}
