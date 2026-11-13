type Entry = { id: string; parent?: string; persistent: boolean; inline: boolean };
export type PanelSnapshot = { active: string | null; temporary: number; inline: boolean };

/** Suspended entries stay mounted; returning to them preserves form/scroll state. */
export class PanelHistory {
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: PanelSnapshot = { active: null, temporary: 0, inline: false };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish() {
    const temporary = this.entries.filter(entry => !entry.persistent);
    const active = temporary[temporary.length - 1] ?? this.entries[this.entries.length - 1];
    this.snapshot = { active: active?.id ?? null, temporary: temporary.length, inline: !!active?.inline };
    this.listeners.forEach(listener => listener());
  }
  add(entry: Entry) {
    if (this.entries.some(value => value.id === entry.id)) return;
    const child = this.entries.findIndex(value => value.parent === entry.id);
    if (child >= 0) this.entries.splice(child, 0, entry); else this.entries.push(entry);
    this.publish();
  }
  remove(id: string) {
    const index = this.entries.findIndex(entry => entry.id === id);
    if (index < 0) return;
    this.entries.splice(index, 1);
    this.publish();
  }
}

export const panelHistory = new PanelHistory();
