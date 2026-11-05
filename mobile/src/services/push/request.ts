import type { PushSession } from './registration';

type Adapter = {
  session(): PushSession | null;
  refresh(): Promise<unknown>;
  send(accessToken: string): Promise<unknown>;
};

/** Retry an expired registration JWT without ever rebinding an old account as a new one. */
export async function registerPushWithSession(owner: PushSession, adapter: Adapter): Promise<void> {
  const currentToken = () => {
    const current = adapter.session();
    if (!current || current.userId !== owner.userId) throw new Error('Push session changed');
    return current.accessToken;
  };
  const token = currentToken();
  try {
    await adapter.send(token);
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status !== 401) throw error;
    // Another API request may already have refreshed this same account.
    if (currentToken() === token) await adapter.refresh();
    await adapter.send(currentToken());
  }
}
