type DuckListener = (ducked: boolean) => void;

/** Host remote audio volume while private Voice AI is active (~15%). */
export const LIVE_DUCKED_VOLUME_PERCENT = 15;

const listeners = new Set<DuckListener>();

export function setLiveAudioDucked(ducked: boolean) {
  listeners.forEach((listener) => listener(ducked));
}

export function onLiveAudioDuck(listener: DuckListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
