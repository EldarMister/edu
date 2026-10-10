/** Send only locally changed fields, preserving newer server values elsewhere. */
export function changedSettingsFields<T extends object>(draft: T, baseline: T): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(draft) as (keyof T)[]) {
    if (!Object.is(draft[key], baseline[key])) patch[key] = draft[key];
  }
  return patch;
}

/** A save response must preserve edits entered while the request was in flight. */
export function mergeSavedSettingsDraft<T extends object>(submitted: T, current: T, saved: T) {
  const pendingEdits = changedSettingsFields(current, submitted);
  return { form: { ...saved, ...pendingEdits }, dirty: Object.keys(pendingEdits).length > 0 };
}
