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
  private outputGain: GainNode;
  private simpleProcessor: SimpleProcessor;
  private builtinHrtf: BuiltinHrtfProcessor;
  private mode: BinauralMode;
  private position: Required<Position3D>;
  private smoothingTime: number;
  private downmix: boolean;

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
    this.outputGain = ctx.createGain();

    this.simpleProcessor = new SimpleProcessor(ctx);
    this.builtinHrtf = new BuiltinHrtfProcessor(ctx);

    this.connectProcessor();
  }

  get input(): AudioNode {
    return this.inputGain;
  }

  get output(): AudioNode {
    return this.outputGain;
  }

  setMode(mode: BinauralMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.connectProcessor();
  }

  setPosition(position: Position3D): void {
    this.position = withDefaultZ(position);
    this.updateProcessorPosition();
  }

  setGain(value: number): void {
    this.outputGain.gain.setTargetAtTime(value, this.ctx.currentTime, this.smoothingTime);
  }

  connect(destination: AudioNode | AudioParam): void {
    if (destination instanceof AudioNode) {
      this.outputGain.connect(destination);
      return;
    }

    this.outputGain.connect(destination);
  }

  disconnect(): void {
    this.outputGain.disconnect();
  }

  dispose(): void {
    this.inputGain.disconnect();
    this.downmixGain.disconnect();
    this.simpleProcessor.dispose();
    this.builtinHrtf.dispose();
    this.outputGain.disconnect();
  }

  private connectProcessor(): void {
    this.inputGain.disconnect();
    this.downmixGain.disconnect();
    this.simpleProcessor.disconnect();
    this.builtinHrtf.disconnect();

    const processorInput = this.downmix ? this.downmixGain : this.inputGain;
    if (this.downmix) {
      this.inputGain.connect(this.downmixGain);
    }

    if (this.mode === 'simple') {
      processorInput.connect(this.simpleProcessor.input);
      this.simpleProcessor.output.connect(this.outputGain);
    } else {
      processorInput.connect(this.builtinHrtf.input);
      this.builtinHrtf.output.connect(this.outputGain);
    }

    this.updateProcessorPosition();
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
