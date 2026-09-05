type DuckListener = (ducked: boolean) => void;

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
