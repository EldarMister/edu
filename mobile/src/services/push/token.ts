export type NativePushToken = { type: 'android' | 'ios'; data: string };
export type PushTokenDiagnostic = { stage: 'native' | 'expo'; code: string; reason?: string };

const SAFE_CODES = new Set([
  'E_REGISTRATION_FAILED', 'E_MODULE_NOT_FOUND', 'ERR_NOTIFICATIONS_NETWORK_ERROR',
  'ERR_NOTIFICATIONS_SERVER_ERROR', 'ERR_NOTIFICATIONS_NO_APPLICATION_ID', 'ERR_NOTIF_DEVICE_ID',
]);
const SAFE_REASONS = [
  'SERVICE_NOT_AVAILABLE', 'FIS_AUTH_ERROR', 'AUTHENTICATION_FAILED', 'TOO_MANY_REGISTRATIONS', 'BAD_CONFIG',
  'SSLHandshakeException', 'SSLPeerUnverifiedException', 'UnknownHostException', 'SocketTimeoutException', 'ConnectException',
];

class PushTokenError extends Error {
  constructor(readonly diagnostic: PushTokenDiagnostic) {
    super('Push token acquisition failed');
  }
}

function failure(error: unknown, stage: PushTokenDiagnostic['stage']): PushTokenError {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof record.code === 'string' && SAFE_CODES.has(record.code) ? record.code : 'UNKNOWN';
  const reason = typeof record.message === 'string'
    ? SAFE_REASONS.find(value => new RegExp(`\\b${value}\\b`).test(record.message as string))
    : undefined;
  return new PushTokenError({ stage, code, ...(reason ? { reason } : {}) });
}

type Adapter = {
  nativeToken(): Promise<NativePushToken>;
  expoToken(token: NativePushToken): Promise<string>;
  onFailure?(diagnostic: PushTokenDiagnostic): void;
};

/** SDK 52 caches a rejected native promise. Use its native bridge with our own recoverable request. */
export class PushTokenAcquisition {
  private inFlight: Promise<string> | null = null;
  private sequence = 0;
  private activeRequest: number | null = null;
  private fetchingNative: number | null = null;
  private stage: PushTokenDiagnostic['stage'] = 'native';
  private observedRevision = 0;
  private latestNative: NativePushToken | null = null;

  constructor(private adapter: Adapter, private timeoutMs = 15_000) {}

  /** Native getDevicePushTokenAsync also emits this event; identical emissions are not rotations. */
  onNativeToken(token: NativePushToken): boolean {
    if (!token.data || (this.latestNative?.type === token.type && this.latestNative.data === token.data)) return false;
    this.latestNative = token;
    this.observedRevision += 1;
    return this.fetchingNative === null;
  }

  acquire(): Promise<string> {
    if (this.inFlight) return this.inFlight;
    const request = ++this.sequence;
    this.activeRequest = request;
    this.stage = 'native';
    let timeout: ReturnType<typeof setTimeout>;
    const expired = new Promise<string>((_, reject) => {
      timeout = setTimeout(() => reject(new PushTokenError({ stage: this.stage, code: 'PUSH_TOKEN_TIMEOUT', reason: 'TIMEOUT' })), this.timeoutMs);
    });
    const acquisition = Promise.resolve().then(() => this.fetch(request));
    const pending = Promise.race([acquisition, expired]).catch(error => {
      this.adapter.onFailure?.(error instanceof PushTokenError ? error.diagnostic : { stage: this.stage, code: 'UNKNOWN' });
      throw error;
    }).finally(() => {
      clearTimeout(timeout);
      if (this.activeRequest === request) this.activeRequest = null;
      if (this.fetchingNative === request) this.fetchingNative = null;
      if (this.inFlight === pending) this.inFlight = null;
    });
    this.inFlight = pending;
    return pending;
  }

  private async fetch(request: number): Promise<string> {
    const revision = this.observedRevision;
    this.fetchingNative = request;
    let token: NativePushToken;
    try {
      token = await this.adapter.nativeToken();
    } catch (error) {
      throw failure(error, 'native');
    } finally {
      if (this.fetchingNative === request) this.fetchingNative = null;
    }
    // A timed out bridge call can complete later. It must not start an obsolete Expo exchange.
    if (this.activeRequest !== request) throw new PushTokenError({ stage: 'native', code: 'OBSOLETE_REQUEST' });
    if (this.observedRevision !== revision && this.latestNative) token = this.latestNative;
    if (!token.data) throw new PushTokenError({ stage: 'native', code: 'INVALID_NATIVE_TOKEN' });
    this.latestNative = token;
    this.stage = 'expo';
    try {
      return await this.adapter.expoToken(token);
    } catch (error) {
      throw failure(error, 'expo');
    }
  }
}
