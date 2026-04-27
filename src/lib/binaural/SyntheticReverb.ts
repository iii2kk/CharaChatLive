export interface SyntheticReverbOptions {
  duration?: number;
  decay?: number;
  wetGain?: number;
}

export interface SyntheticReverb {
  input: GainNode;
  output: GainNode;
  convolver: ConvolverNode;
  setWet(value: number): void;
  dispose(): void;
}

export function createSyntheticReverb(
  context: AudioContext,
  options: SyntheticReverbOptions = {},
): SyntheticReverb {
  const input = context.createGain();
  const output = context.createGain();
  const convolver = context.createConvolver();
  const duration = options.duration ?? 1.5;
  const decay = options.decay ?? 0.4;
  const wetGain = options.wetGain ?? 0.3;

  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const impulse = context.createBuffer(2, length, context.sampleRate);

  for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * decay));
    }
  }

  convolver.buffer = impulse;
  output.gain.value = wetGain;
  input.connect(convolver);
  convolver.connect(output);

  return {
    input,
    output,
    convolver,
    setWet(value: number) {
      output.gain.setTargetAtTime(value, context.currentTime, 0.02);
    },
    dispose() {
      input.disconnect();
      convolver.disconnect();
      output.disconnect();
    },
  };
}
