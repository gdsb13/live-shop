type DuckListener = (ducked: boolean) => void;

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
