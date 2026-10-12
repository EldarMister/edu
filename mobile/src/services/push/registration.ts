export type PushStatus = 'unsupported' | 'unavailable' | 'default' | 'denied' | 'checking' | 'subscribed' | 'error';
export type PushSession = { userId: string; accessToken: string };
type Binding = PushSession & { pushToken: string };
export type PushRegistrationState = { deviceId: string; binding: Binding | null; pending: Binding[] };
export interface PushRegistrationAdapter {
  session(): PushSession | null;
  available(): 'supported' | 'unsupported' | 'unavailable';
  permission(prompt: boolean): Promise<'granted' | 'denied' | 'default'>;
  token(): Promise<string>;
  load(): Promise<PushRegistrationState | null>;
  save(state: PushRegistrationState): Promise<void>;
  deviceId(): string;
  register(binding: Binding, deviceId: string): Promise<void>;
  unregister(binding: Binding): Promise<void>;
}

/** One serialized lifecycle for every screen, including logout during token acquisition. */
export class PushRegistrationManager {
  private state: PushRegistrationState | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  status: PushStatus = 'checking';
  private listeners = new Set<(status: PushStatus) => void>();

  constructor(private adapter: PushRegistrationAdapter) {}

  get hasPendingRevocations() { return !!this.state?.pending.length; }
  get hasRegisteredBinding() { return !!this.state?.binding && this.state.binding.userId === this.adapter.session()?.userId; }

  subscribe(listener: (status: PushStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => { this.listeners.delete(listener); };
  }

  private setStatus(status: PushStatus) {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
    return status;
  }

  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async load() {
    if (!this.state) {
      this.state = await this.adapter.load() ?? { deviceId: this.adapter.deviceId(), binding: null, pending: [] };
    }
    return this.state;
  }

  private async save() { await this.adapter.save(this.state!); }

  private pend(binding: Binding) {
    if (!this.state!.pending.some((item) => item.userId === binding.userId && item.pushToken === binding.pushToken)) {
      this.state!.pending.push(binding);
    }
  }

  private async drain() {
    for (const binding of [...this.state!.pending]) {
      try {
        await this.adapter.unregister(binding);
        this.state!.pending = this.state!.pending.filter((item) => item !== binding);
        await this.save();
      } catch { /* Keep failed revocations across process restarts; retry on resume. */ }
    }
  }

  /** Capture credentials before the caller clears auth. Never revoke with another user's JWT. */
  unregister(session = this.adapter.session()): Promise<void> {
    this.epoch += 1;
    this.setStatus('default');
    return this.run(async () => {
      const state = await this.load();
      if (state.binding && (!session || state.binding.userId === session.userId)) {
        this.pend({ ...state.binding, ...(session ?? {}) });
        state.binding = null;
        await this.save();
      }
      await this.drain();
    });
  }

  /** Permission alone is never a successful server subscription. */
  reconcile(prompt = false): Promise<PushStatus> {
    const session = this.adapter.session();
    const epoch = this.epoch;
    return this.run(async () => {
      try {
        if (epoch !== this.epoch || this.adapter.session()?.userId !== session?.userId) return this.status;
        const state = await this.load();
        if (state.binding && state.binding.userId !== session?.userId) {
          this.pend(state.binding);
          state.binding = null;
          await this.save();
        }
        await this.drain();
        if (!session) return this.setStatus('default');
        const availability = this.adapter.available();
        if (availability !== 'supported') return this.setStatus(availability);
        this.setStatus('checking');
        const permission = await this.adapter.permission(prompt);
        if (permission !== 'granted') {
          if (state.binding) {
            this.pend(state.binding);
            state.binding = null;
            await this.save();
            await this.drain();
          }
          return this.setStatus(permission);
        }
        const pushToken = await this.adapter.token();
        if (epoch !== this.epoch || this.adapter.session()?.userId !== session.userId) return this.status;
        const binding = { ...session, pushToken };
        // Refresh registration on resume: the server may have removed a failed token.
        await this.adapter.register(binding, state.deviceId);
        if (epoch !== this.epoch || this.adapter.session()?.userId !== session.userId) {
          this.pend(binding);
          await this.save();
          await this.drain();
          return this.status;
        }
        if (state.binding && state.binding.pushToken !== pushToken) this.pend(state.binding);
        state.binding = binding;
        // Successful registration transfers this installation atomically on the server.
        // Revocations that preceded it no longer need stale account credentials.
        state.pending = [];
        await this.save();
        await this.drain();
        return this.setStatus('subscribed');
      } catch { return this.setStatus('error'); }
    });
  }
}
