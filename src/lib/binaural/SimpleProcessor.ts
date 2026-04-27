export class SimpleProcessor {
  private ctx: AudioContext;
  private splitter: ChannelSplitterNode;
  private merger: ChannelMergerNode;
  private leftDelay: DelayNode;
  private rightDelay: DelayNode;
  private leftFilter: BiquadFilterNode;
  private rightFilter: BiquadFilterNode;
  private leftGain: GainNode;
  private rightGain: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    // Input is mono (after downmix), split is 1->1 but we need stereo output
    this.splitter = ctx.createChannelSplitter(1);
    this.merger = ctx.createChannelMerger(2);

    // Left ear path
    this.leftDelay = ctx.createDelay(0.01); // max 10ms
    this.leftFilter = ctx.createBiquadFilter();
    this.leftFilter.type = 'lowpass';
    this.leftFilter.frequency.value = 20000; // initially no filtering
    this.leftGain = ctx.createGain();

    // Right ear path
    this.rightDelay = ctx.createDelay(0.01);
    this.rightFilter = ctx.createBiquadFilter();
    this.rightFilter.type = 'lowpass';
    this.rightFilter.frequency.value = 20000;
    this.rightGain = ctx.createGain();

    // Wire: mono input -> splitter -> [left path] -> merger ch0
    //                              -> [right path] -> merger ch1
    this.splitter.connect(this.leftDelay, 0);
    this.leftDelay.connect(this.leftFilter);
    this.leftFilter.connect(this.leftGain);
    this.leftGain.connect(this.merger, 0, 0);

    this.splitter.connect(this.rightDelay, 0);
    this.rightDelay.connect(this.rightFilter);
    this.rightFilter.connect(this.rightGain);
    this.rightGain.connect(this.merger, 0, 1);
  }

  get input(): ChannelSplitterNode {
    return this.splitter;
  }

  get output(): ChannelMergerNode {
    return this.merger;
  }

  update(
    azimuth: number,
    _elevation: number,
    distance: number,
    smoothingTime: number = 0.02,
  ): void {
    const now = this.ctx.currentTime;
    const timeConst = smoothingTime;

    const sinAz = Math.sin(Math.abs(azimuth));

    // ITD: 0.3ms - 0.7ms for the far ear
    const itd = 0.0003 + 0.0004 * sinAz;

    // ILD: lowpass frequency for far ear (6000Hz -> 2000Hz at 90 deg)
    const farFreq = 6000 - 4000 * sinAz;

    // ILD: amplitude reduction for far ear
    const farGain = 1 - 0.3 * sinAz;

    // Distance attenuation
    const distGain = distance > 1 ? 1 / (1 + (distance - 1)) : 1;

    if (azimuth >= 0) {
      // Source on right: left ear is far
      this.leftDelay.delayTime.setTargetAtTime(itd, now, timeConst);
      this.rightDelay.delayTime.setTargetAtTime(0, now, timeConst);
      this.leftFilter.frequency.setTargetAtTime(farFreq, now, timeConst);
      this.rightFilter.frequency.setTargetAtTime(20000, now, timeConst);
      this.leftGain.gain.setTargetAtTime(farGain * distGain, now, timeConst);
      this.rightGain.gain.setTargetAtTime(1 * distGain, now, timeConst);
    } else {
      // Source on left: right ear is far
      this.rightDelay.delayTime.setTargetAtTime(itd, now, timeConst);
      this.leftDelay.delayTime.setTargetAtTime(0, now, timeConst);
      this.rightFilter.frequency.setTargetAtTime(farFreq, now, timeConst);
      this.leftFilter.frequency.setTargetAtTime(20000, now, timeConst);
      this.rightGain.gain.setTargetAtTime(farGain * distGain, now, timeConst);
      this.leftGain.gain.setTargetAtTime(1 * distGain, now, timeConst);
    }
  }

  disconnect(): void {
    this.merger.disconnect();
  }

  dispose(): void {
    this.splitter.disconnect();
    this.leftDelay.disconnect();
    this.leftFilter.disconnect();
    this.leftGain.disconnect();
    this.rightDelay.disconnect();
    this.rightFilter.disconnect();
    this.rightGain.disconnect();
    this.merger.disconnect();
  }
}
