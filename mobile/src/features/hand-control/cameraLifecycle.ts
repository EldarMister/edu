type CameraAppState = {
  currentState: string | null;
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void };
};

/** Permission results can arrive before Android resumes the RN activity. */
export function waitForCameraForeground(state: CameraAppState, timeoutMs = 2000): Promise<boolean> {
  if (state.currentState === 'active') return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = (active: boolean) => { clearTimeout(timer); subscription.remove(); resolve(active); };
    const subscription = state.addEventListener('change', next => { if (next === 'active') finish(true); });
    const timer = setTimeout(() => finish(false), timeoutMs);
    // Covers a state change between the first read and subscription.
    if (state.currentState === 'active') finish(true);
  });
}
