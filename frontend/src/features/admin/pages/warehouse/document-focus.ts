/** Run after React commits a newly added row or enables its quantity field. */
export function focusDocumentInput(id: string) {
  requestAnimationFrame(() => {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement) || input.disabled) return;
    input.focus();
    input.select();
  });
}
