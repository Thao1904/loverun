export type HeartbeatSongController = {
  start: () => void;
  stop: () => void;
};

const melodyRatios = [1, 1.125, 1.25, 1.5, 1.333, 1.2];

export function createHeartbeatSongController(heartRates: number[]): HeartbeatSongController {
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
  gainNode.gain.value = 0.06;
  gainNode.connect(audioContext.destination);

  let intervalId: number | null = null;
  let stepIndex = 0;

  const sequence = heartRates.flatMap((rate, index) => {
    const base = 180 + rate * 1.2;
    return melodyRatios.map((ratio, ratioIndex) => ({
      frequency: base * ratio,
      duration: 0.18 + (index + ratioIndex) * 0.01,
    }));
  });

  const playStep = () => {
    const step = sequence[stepIndex % sequence.length];
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();

    oscillator.type = stepIndex % 2 === 0 ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(step.frequency, now);

    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + step.duration);

    oscillator.connect(envelope);
    envelope.connect(gainNode);
    oscillator.start(now);
    oscillator.stop(now + step.duration + 0.03);

    stepIndex += 1;
  };

  return {
    start: () => {
      void audioContext.resume();
      playStep();
      intervalId = window.setInterval(playStep, 320);
    },
    stop: () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }

      void audioContext.close();
    },
  };
}
