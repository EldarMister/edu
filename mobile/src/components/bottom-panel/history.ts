type Entry = { id: string; parent?: string; persistent: boolean; inline: boolean };
export type PanelSnapshot = { active: string | null; desired: string | null; temporary: number; inline: boolean };

/** Suspended entries stay mounted; returning to them preserves form/scroll state. */
export class PanelHistory {
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: PanelSnapshot = { active: null, desired: null, temporary: 0, inline: false };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(active: string | null) {
    const desired = [...this.entries].reverse().find(entry => !entry.persistent) ?? this.entries[this.entries.length - 1];
    this.snapshot = { active, desired: desired?.id ?? null, temporary: this.entries.filter(entry => !entry.persistent).length, inline: !!desired?.inline };
    this.listeners.forEach(listener => listener());
  }
  add(entry: Entry) {
    if (this.entries.some(value => value.id === entry.id)) return;
    const child = this.entries.findIndex(value => value.parent === entry.id);
    if (child >= 0) this.entries.splice(child, 0, entry); else this.entries.push(entry);
    this.publish(this.snapshot.active ?? entry.id);
  }
  remove(id: string) {
    this.entries = this.entries.filter(entry => entry.id !== id);
    const next = [...this.entries].reverse().find(entry => !entry.persistent) ?? this.entries[this.entries.length - 1];
    this.publish(this.snapshot.active === id ? next?.id ?? null : this.snapshot.active);
  }
  yield(id: string) {
    if (this.snapshot.active === id) this.publish(this.snapshot.desired);
  }
}

export const panelHistory = new PanelHistory();
