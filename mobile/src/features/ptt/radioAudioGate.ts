let recording: symbol | undefined;
const callbacks = new Set<() => void>();

export function startRadioInput() {
  const lease = Symbol('radio input');
  recording = lease;
  for (const callback of callbacks) callback();
  return () => { if (recording === lease) recording = undefined; };
}

export function radioInputActive() {
  return recording !== undefined;
}

export function onRadioInput(callback: () => void) {
  callbacks.add(callback);
  return () => { callbacks.delete(callback); };
}
