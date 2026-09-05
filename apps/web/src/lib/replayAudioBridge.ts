type DuckListener = (ducked: boolean) => void;

/** Replay playback volume while private Voice AI is active (~15%). */
export const REPLAY_DUCKED_VOLUME = 0.15;

const listeners = new Set<DuckListener>();

export function setReplayAudioDucked(ducked: boolean) {
  listeners.forEach((listener) => listener(ducked));
}

export function onReplayAudioDuck(listener: DuckListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
