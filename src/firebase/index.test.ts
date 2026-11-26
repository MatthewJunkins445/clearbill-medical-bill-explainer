import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
import type { AppCheck, AppCheckOptions } from 'firebase/app-check';
import type { Auth } from 'firebase/auth';
import type { RemoteConfig, Value } from 'firebase/remote-config';
import {
  ANONYMOUS_SIGN_IN_TIMEOUT_MS,
  REMOTE_CONFIG_DEV_FETCH_INTERVAL_MS,
  REMOTE_CONFIG_FETCH_INTERVAL_MS,
  appCheckDebugToken,
  ConfigError,
  initializeFirebase,
  readClientEnv,
  type ClientEnv,
  type FirebaseWebConfig,
} from './index.ts';

const mocks = vi.hoisted(() => {
  const app = { name: 'app' } as FirebaseApp;
  const auth = { name: 'auth' } as Auth;
  const appCheck = {} as AppCheck;
  const remoteConfig = { settings: { minimumFetchIntervalMillis: 43_200_000, fetchTimeoutMillis: 60_000 } } as RemoteConfig;

  return {
    app,
    auth,
    appCheck,
    remoteConfig,
    getApps: vi.fn<() => FirebaseApp[]>(),
    getApp: vi.fn<() => FirebaseApp>(),
    initializeApp: vi.fn<(config: FirebaseWebConfig) => FirebaseApp>(),
    initializeAppCheck: vi.fn<(app: FirebaseApp, options: AppCheckOptions) => AppCheck>(),
    ReCaptchaEnterpriseProvider: vi.fn<(siteKey: string) => AppCheckOptions['provider']>(),
    getAuth: vi.fn<(app: FirebaseApp) => Auth>(),
    signInAnonymously: vi.fn<(auth: Auth) => Promise<unknown>>(),
    getRemoteConfig: vi.fn<(app: FirebaseApp) => RemoteConfig>(),
    fetchAndActivate: vi.fn<(remoteConfig: RemoteConfig) => Promise<boolean>>(),
    getAll: vi.fn<(remoteConfig: RemoteConfig) => Record<string, Value>>(),
  };
});

vi.mock('firebase/app', () => ({
  getApp: mocks.getApp,
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp,
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: mocks.initializeAppCheck,
  ReCaptchaEnterpriseProvider: mocks.ReCaptchaEnterpriseProvider,
}));

vi.mock('firebase/auth', () => ({
  getAuth: mocks.getAuth,
  signInAnonymously: mocks.signInAnonymously,
}));

vi.mock('firebase/remote-config', () => ({
  fetchAndActivate: mocks.fetchAndActivate,
  getAll: mocks.getAll,
  getRemoteConfig: mocks.getRemoteConfig,
}));

const complete = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
  VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'test-site-key',
};

const clientEnv: ClientEnv = readClientEnv(complete);

function remoteValue(value: string, source: 'static' | 'default' | 'remote' = 'remote'): Value {
  return {
    asBoolean: () => ['1', 'true', 't', 'yes', 'y', 'on'].includes(value.toLowerCase()),
    asNumber: () => Number(value),
    asString: () => value,
    getSource: () => source,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('self', globalThis);
  Reflect.deleteProperty(globalThis, 'FIREBASE_APPCHECK_DEBUG_TOKEN');

  mocks.getApps.mockReturnValue([]);
  mocks.getApp.mockReturnValue(mocks.app);
  mocks.initializeApp.mockReturnValue(mocks.app);
  mocks.initializeAppCheck.mockReturnValue(mocks.appCheck);
  mocks.getAuth.mockReturnValue(mocks.auth);
  mocks.signInAnonymously.mockResolvedValue({});
  mocks.getRemoteConfig.mockReturnValue(mocks.remoteConfig);
  mocks.fetchAndActivate.mockResolvedValue(true);
  mocks.getAll.mockReturnValue({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('readClientEnv', () => {
  it('maps a complete env to config with no app-wide AI mode', () => {
    const env = readClientEnv(complete);
    expect(env.firebase.projectId).toBe('demo');
    expect(env.recaptchaSiteKey).toBe('test-site-key');
    expect(Object.keys(env).sort()).toEqual(['firebase', 'recaptchaSiteKey']);
  });

  it('names every missing key without echoing any values', () => {
    const partial: Record<string, string> = { ...complete };
    delete partial['VITE_FIREBASE_APP_ID'];
    delete partial['VITE_RECAPTCHA_ENTERPRISE_SITE_KEY'];
    expect(() => readClientEnv(partial)).toThrow(ConfigError);
    expect(() => readClientEnv(partial)).toThrow(/VITE_FIREBASE_APP_ID, VITE_RECAPTCHA_ENTERPRISE_SITE_KEY/);
    expect(() => readClientEnv(partial)).not.toThrow(/test-api-key/);
  });

  it('accepts VITE_AI_MODE unset, empty or exactly mock', () => {
    expect(() => readClientEnv(complete)).not.toThrow();
    expect(() => readClientEnv({ ...complete, VITE_AI_MODE: '' })).not.toThrow();
    expect(() => readClientEnv({ ...complete, VITE_AI_MODE: 'mock' })).not.toThrow();
  });

  it.each(['prefer_on_device', 'only_on_device', 'prefer_in_cloud', 'only_in_cloud', 'MOCK', 'cloud_please'])(
    'rejects VITE_AI_MODE=%s, since inference modes come from Remote Config',
    (value) => {
      expect(() => readClientEnv({ ...complete, VITE_AI_MODE: value })).toThrow(ConfigError);
      expect(() => readClientEnv({ ...complete, VITE_AI_MODE: value })).toThrow(/VITE_AI_MODE/);
    },
  );

  it('never reads or forwards the App Check debug token, even in development', () => {
    const env = readClientEnv({ ...complete, DEV: true, VITE_APPCHECK_DEBUG_TOKEN: 'debug-token' });
    expect(JSON.stringify(env)).not.toContain('debug-token');
  });
});

describe('appCheckDebugToken', () => {
  it('returns the token in development', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'debug-token');
    expect(appCheckDebugToken()).toBe('debug-token');
  });

  it('returns undefined outside development', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'debug-token');
    expect(appCheckDebugToken()).toBeUndefined();
  });
});

describe('initializeFirebase', () => {
  it('initializes App Check before Auth before the Remote Config fetch', async () => {
    const order: string[] = [];
    mocks.initializeApp.mockImplementation(() => {
      order.push('initializeApp');
      return mocks.app;
    });
    mocks.initializeAppCheck.mockImplementation(() => {
      order.push('app-check');
      return mocks.appCheck;
    });
    mocks.getAuth.mockImplementation(() => {
      order.push('auth');
      return mocks.auth;
    });
    mocks.signInAnonymously.mockImplementation(() => {
      order.push('anonymous-sign-in');
      return Promise.resolve({});
    });
    mocks.getRemoteConfig.mockImplementation(() => {
      order.push('remote-config');
      return mocks.remoteConfig;
    });
    mocks.fetchAndActivate.mockImplementation(() => {
      order.push('fetch');
      return Promise.resolve(true);
    });

    await initializeFirebase(clientEnv);

    expect(order).toEqual(['initializeApp', 'app-check', 'auth', 'anonymous-sign-in', 'remote-config', 'fetch']);
  });

  it('creates the Firebase app from the client config when none exists', async () => {
    const runtime = await initializeFirebase(clientEnv);

    expect(mocks.initializeApp).toHaveBeenCalledWith(clientEnv.firebase);
    expect(runtime.app).toBe(mocks.app);
  });

  it('reuses an existing app instead of initializing a second one', async () => {
    const existing = { name: 'existing' } as FirebaseApp;
    mocks.getApps.mockReturnValue([existing]);
    mocks.getApp.mockReturnValue(existing);

    const runtime = await initializeFirebase(clientEnv);

    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(runtime.app).toBe(existing);
  });

  it('sets the App Check debug token before initializeAppCheck in development', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'debug-token');
    let tokenSeenByAppCheck: string | undefined;
    mocks.initializeAppCheck.mockImplementation(() => {
      tokenSeenByAppCheck = self.FIREBASE_APPCHECK_DEBUG_TOKEN;
      return mocks.appCheck;
    });

    await initializeFirebase(clientEnv);

    expect(tokenSeenByAppCheck).toBe('debug-token');
  });

  it('does not set the App Check debug token outside development', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'debug-token');
    let tokenSeenByAppCheck: string | undefined = 'unset';
    mocks.initializeAppCheck.mockImplementation(() => {
      tokenSeenByAppCheck = self.FIREBASE_APPCHECK_DEBUG_TOKEN;
      return mocks.appCheck;
    });

    await initializeFirebase(clientEnv);

    expect(tokenSeenByAppCheck).toBeUndefined();
  });

  it('registers reCAPTCHA Enterprise with the configured site key and auto-refresh', async () => {
    await initializeFirebase(clientEnv);

    expect(mocks.ReCaptchaEnterpriseProvider).toHaveBeenCalledWith('test-site-key');
    const options = mocks.initializeAppCheck.mock.calls[0]?.[1];
    expect(options?.provider).toBeInstanceOf(mocks.ReCaptchaEnterpriseProvider);
    expect(options?.isTokenAutoRefreshEnabled).toBe(true);
  });

  it('signs in anonymously and reports auth and cloud readiness', async () => {
    const runtime = await initializeFirebase(clientEnv);

    expect(mocks.signInAnonymously).toHaveBeenCalledWith(mocks.auth);
    expect(runtime.authReady).toBe(true);
    expect(runtime.appCheckReady).toBe(true);
    expect(runtime.cloudReady).toBe(true);
  });

  it('resolves with authReady false when anonymous sign-in rejects', async () => {
    mocks.signInAnonymously.mockRejectedValue(new Error('auth unavailable'));

    const runtime = await initializeFirebase(clientEnv);

    expect(runtime.auth).toBe(mocks.auth);
    expect(runtime.authReady).toBe(false);
    expect(runtime.cloudReady).toBe(false);
    expect(runtime.remoteConfig.fetched).toBe(true);
  });

  it('resolves with appCheckReady false when App Check initialization throws', async () => {
    mocks.initializeAppCheck.mockImplementation(() => {
      throw new Error('app check unavailable');
    });

    const runtime = await initializeFirebase(clientEnv);

    expect(runtime.appCheckReady).toBe(false);
    expect(runtime.authReady).toBe(true);
    expect(runtime.cloudReady).toBe(false);
    expect(runtime.remoteConfig.fetched).toBe(true);
  });

  it('rejects with ConfigError naming keys when no env is injected', async () => {
    for (const key of Object.keys(complete)) {
      vi.stubEnv(key, '');
    }

    await expect(initializeFirebase()).rejects.toThrow(ConfigError);
    await expect(initializeFirebase()).rejects.toThrow(/VITE_FIREBASE_API_KEY/);
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it('fetches and activates Remote Config and snapshots typed values', async () => {
    mocks.getAll.mockReturnValue({
      cloud_features_enabled: remoteValue('false'),
      cloud_model: remoteValue('gemini-3.8-flash'),
      max_device_input_chars: remoteValue('16000'),
      not_remote: remoteValue('ignored', 'static'),
    });

    const runtime = await initializeFirebase(clientEnv);

    expect(mocks.fetchAndActivate).toHaveBeenCalledWith(mocks.remoteConfig);
    expect(runtime.remoteConfig.fetched).toBe(true);
    expect(runtime.remoteConfig.getBoolean('cloud_features_enabled', true)).toBe(false);
    expect(runtime.remoteConfig.getString('cloud_model', 'fallback-model')).toBe('gemini-3.8-flash');
    expect(runtime.remoteConfig.getNumber('max_device_input_chars', 0)).toBe(16000);
    expect(runtime.remoteConfig.getBoolean('missing_key', true)).toBe(true);
    expect(runtime.remoteConfig.getBoolean('not_remote', true)).toBe(true);
  });

  it('treats an already-activated fetch as fetched', async () => {
    mocks.fetchAndActivate.mockResolvedValue(false);

    const runtime = await initializeFirebase(clientEnv);

    expect(runtime.remoteConfig.fetched).toBe(true);
  });

  it('fails closed with fallbacks when the Remote Config fetch rejects', async () => {
    mocks.fetchAndActivate.mockRejectedValue(new Error('offline'));

    const runtime = await initializeFirebase(clientEnv);

    expect(runtime.remoteConfig.fetched).toBe(false);
    expect(runtime.remoteConfig.getBoolean('cloud_region_allowed', false)).toBe(false);
    expect(runtime.remoteConfig.getBoolean('cloud_features_enabled', true)).toBe(true);
    expect(runtime.authReady).toBe(true);
    expect(runtime.cloudReady).toBe(true);
  });

  it('fails closed with fallbacks when the Remote Config fetch times out', async () => {
    vi.useFakeTimers();
    mocks.fetchAndActivate.mockImplementation(() => new Promise<boolean>(() => undefined));

    const pending = initializeFirebase(clientEnv);
    await vi.advanceTimersByTimeAsync(5000);
    const runtime = await pending;

    expect(runtime.remoteConfig.fetched).toBe(false);
    expect(runtime.remoteConfig.getBoolean('cloud_region_allowed', false)).toBe(false);
    expect(runtime.remoteConfig.getBoolean('cloud_features_enabled', true)).toBe(true);
  });
});

describe('startup bounds (final fix wave)', () => {
  it('continues with authReady false when anonymous sign-in stalls past the timeout', async () => {
    vi.useFakeTimers();
    let rejectLate: (reason: unknown) => void = () => undefined;
    mocks.signInAnonymously.mockImplementation(() => new Promise((_resolve, reject) => { rejectLate = reject; }));

    const pending = initializeFirebase(clientEnv);
    await vi.advanceTimersByTimeAsync(ANONYMOUS_SIGN_IN_TIMEOUT_MS);
    const runtime = await pending;

    expect(ANONYMOUS_SIGN_IN_TIMEOUT_MS).toBe(8000);
    expect(runtime.authReady).toBe(false);
    expect(runtime.cloudReady).toBe(false);
    expect(runtime.remoteConfig.fetched).toBe(true);
    // A late failure after the timeout is swallowed (vitest fails the run on an unhandled rejection).
    rejectLate(new Error('late auth failure'));
    await vi.advanceTimersByTimeAsync(10);
  });

  it('does not time out a sign-in that completes in time', async () => {
    vi.useFakeTimers();
    mocks.signInAnonymously.mockImplementation(() => new Promise((resolve) => setTimeout(() => { resolve({}); }, ANONYMOUS_SIGN_IN_TIMEOUT_MS - 1)));

    const pending = initializeFirebase(clientEnv);
    await vi.advanceTimersByTimeAsync(ANONYMOUS_SIGN_IN_TIMEOUT_MS - 1);
    expect((await pending).authReady).toBe(true);
  });

  it('sets a 10 minute Remote Config fetch interval outside development', async () => {
    vi.stubEnv('DEV', false);
    await initializeFirebase(clientEnv);
    expect(REMOTE_CONFIG_FETCH_INTERVAL_MS).toBe(600_000);
    expect(mocks.remoteConfig.settings.minimumFetchIntervalMillis).toBe(600_000);
  });

  it('always refetches Remote Config in development', async () => {
    vi.stubEnv('DEV', true);
    await initializeFirebase(clientEnv);
    expect(REMOTE_CONFIG_DEV_FETCH_INTERVAL_MS).toBe(0);
    expect(mocks.remoteConfig.settings.minimumFetchIntervalMillis).toBe(0);
  });

  it('takes an explicit fetch interval and sets it before the fetch', async () => {
    let intervalAtFetch: number | undefined;
    mocks.fetchAndActivate.mockImplementation((rc) => {
      intervalAtFetch = rc.settings.minimumFetchIntervalMillis;
      return Promise.resolve(true);
    });
    await initializeFirebase(clientEnv, { remoteConfigFetchIntervalMs: 1234 });
    expect(intervalAtFetch).toBe(1234);
  });
});
