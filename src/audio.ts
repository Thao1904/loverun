export type HeartbeatSongController = {
  start: (startProgress?: number) => void;
  stop: () => void;
};

export function createHeartbeatSongController(
  heartRates: number[],
  options?: {
    onProgressChange?: (progress: number) => void;
    cycleDurationMs?: number;
  },
): HeartbeatSongController {
  if (typeof window === "undefined") {
    return {
      start: () => undefined,
      stop: () => undefined,
    };
  }

  const AudioContextClass = window.AudioContext;

  if (!AudioContextClass) {
    return {
      start: () => undefined,
      stop: () => undefined,
    };
  }

  const audioContext = new AudioContextClass();
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0.12;
  gainNode.connect(audioContext.destination);

  let intervalId: number | null = null;
  let progressIntervalId: number | null = null;
  let stepIndex = 0;
  let startedAt = 0;
  let startOffsetMs = 0;

  const sequence = heartRates.length > 0 ? heartRates : [120];
  const cycleDurationMs = options?.cycleDurationMs ?? Math.max(sequence.length * 520, 4800);

  const playStep = () => {
    const heartRate = sequence[stepIndex % sequence.length];
    const now = audioContext.currentTime;
    const beatGapSeconds = Math.max(0.38, 60 / Math.max(heartRate, 60));

    playBeatPulse(audioContext, gainNode, now, 158, 0.045, 0.3);
    playBeatPulse(audioContext, gainNode, now + 0.12, 132, 0.06, 0.22);

    playEcgClick(audioContext, gainNode, now + 0.02, 880);
    playEcgClick(audioContext, gainNode, now + 0.14, 720);

    stepIndex += 1;
    return beatGapSeconds;
  };

  return {
    start: (startProgress = 0) => {
      startOffsetMs = Math.max(0, Math.min(1, startProgress)) * cycleDurationMs;
      startedAt = performance.now() - startOffsetMs;
      stepIndex = Math.floor((sequence.length * Math.max(0, Math.min(1, startProgress))) % sequence.length);
      void audioContext.resume();
      const gapSeconds = playStep();
      intervalId = window.setInterval(playStep, gapSeconds * 1000);
      progressIntervalId = window.setInterval(() => {
        const elapsed = (performance.now() - startedAt) % cycleDurationMs;
        options?.onProgressChange?.(elapsed / cycleDurationMs);
      }, 50);
    },
    stop: () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }

      if (progressIntervalId !== null) {
        window.clearInterval(progressIntervalId);
        progressIntervalId = null;
      }

      void audioContext.close();
    },
  };
}

function playBeatPulse(
  audioContext: AudioContext,
  gainNode: GainNode,
  startTime: number,
  frequency: number,
  duration: number,
  peakGain: number,
) {
  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(70, frequency * 0.62), startTime + duration);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(780, startTime);

  envelope.gain.setValueAtTime(0.0001, startTime);
  envelope.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(filter);
  filter.connect(envelope);
  envelope.connect(gainNode);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function playEcgClick(
  audioContext: AudioContext,
  gainNode: GainNode,
  startTime: number,
  frequency: number,
) {
  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, startTime);

  envelope.gain.setValueAtTime(0.0001, startTime);
  envelope.gain.exponentialRampToValueAtTime(0.06, startTime + 0.003);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.02);

  oscillator.connect(envelope);
  envelope.connect(gainNode);
  oscillator.start(startTime);
  oscillator.stop(startTime + 0.025);
}
