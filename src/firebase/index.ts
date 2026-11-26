// Public entry point for Firebase wiring (owned by devops). src/ui may import only this file
// and src/ai/index.ts.

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import {
  fetchAndActivate,
  getAll,
  getRemoteConfig,
  type RemoteConfig,
  type Value,
} from 'firebase/remote-config';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

/**
 * Client configuration. There is deliberately no app-wide AI mode here: per-feature hybrid
 * inference modes come from Remote Config (owned by ai). The App Check debug token is not here
 * either; see appCheckDebugToken().
 */
export interface ClientEnv {
  firebase: FirebaseWebConfig;
  recaptchaSiteKey: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Reads and validates client configuration from a Vite-style env record.
 * Throws ConfigError naming the missing keys, never their values.
 *
 * VITE_AI_MODE is development and test only: it may be unset or exactly `mock` (which selects the
 * AI mock in src/ai). Any other value is rejected so nobody mistakes it for an inference mode.
 * VITE_APPCHECK_DEBUG_TOKEN is never read or returned here.
 */
export function readClientEnv(env: Readonly<Record<string, string | boolean | undefined>>): ClientEnv {
  const text = (key: string): string => {
    const value = env[key];
    return typeof value === 'string' ? value.trim() : '';
  };

  const missing: string[] = [];
  const need = (key: string): string => {
    const value = text(key);
    if (!value) missing.push(key);
    return value;
  };

  const firebase: FirebaseWebConfig = {
    apiKey: need('VITE_FIREBASE_API_KEY'),
    authDomain: need('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: need('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: need('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: need('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: need('VITE_FIREBASE_APP_ID'),
  };
  const recaptchaSiteKey = need('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY');

  if (missing.length > 0) {
    throw new ConfigError(`Missing client config: ${missing.join(', ')}. Copy .env.example to .env.local.`);
  }

  const aiMode = text('VITE_AI_MODE');
  if (aiMode !== '' && aiMode !== 'mock') {
    throw new ConfigError(
      'VITE_AI_MODE may only be `mock` (development and tests) or unset. Inference modes come from Remote Config.',
    );
  }

  return { firebase, recaptchaSiteKey };
}

/**
 * The App Check debug token, in development builds only.
 *
 * Keep this exact expression at the call site: `vite build` replaces import.meta.env.DEV with
 * `false`, the minifier then drops the whole branch, so the token value is never inlined into a
 * production bundle. Never pass import.meta.env as a whole object anywhere: Vite would inline
 * every VITE_ variable, this token included. CI builds with a canary token to enforce this.
 */
export function appCheckDebugToken(): string | undefined {
  return import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN : undefined;
}

/** A snapshot of the Remote Config values fetched at startup, with in-app fallbacks. */
export interface RemoteConfigReader {
  /** Whether the startup fetch and activation succeeded (a timeout counts as failure). */
  readonly fetched: boolean;
  getBoolean(key: string, fallback: boolean): boolean;
  getString(key: string, fallback: string): string;
  getNumber(key: string, fallback: number): number;
}

export interface FirebaseRuntime {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly remoteConfig: RemoteConfigReader;
  readonly appCheckReady: boolean;
  readonly authReady: boolean;
  readonly cloudReady: boolean; // appCheckReady && authReady
}

/**
 * Startup must not wait forever for Remote Config. Five seconds is long enough for a warm fetch
 * on a typical connection and short enough that a stalled request does not block first paint; on
 * timeout the runtime uses the in-app fallbacks (region denied, kill switch not triggered).
 */
const REMOTE_CONFIG_FETCH_TIMEOUT_MS = 5000;

/**
 * Used whenever Remote Config is unavailable. Every key resolves to the caller's fallback; ai
 * passes false for `cloud_region_allowed` (fail closed) and true for `cloud_features_enabled`,
 * so a failed fetch does not look like a kill switch.
 */
const FALLBACK_READER: RemoteConfigReader = {
  fetched: false,
  getBoolean: (_key, fallback) => fallback,
  getString: (_key, fallback) => fallback,
  getNumber: (_key, fallback) => fallback,
};

/**
 * Reads only the declared VITE_ keys. Passing import.meta.env itself would make Vite inline
 * every VITE_ variable, including the App Check debug token, so the pick is spelled out.
 */
function readEnvFromVite(): ClientEnv {
  return readClientEnv({
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
    VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
    VITE_AI_MODE: import.meta.env.VITE_AI_MODE,
  });
}

/**
 * A key with source "static" was never set by defaults or a fetch, so the caller's fallback wins.
 */
function createRemoteConfigReader(values: ReadonlyMap<string, Value>, fetched: boolean): RemoteConfigReader {
  const read = (key: string): Value | undefined => {
    const value = values.get(key);
    if (!value || value.getSource() === 'static') return undefined;
    return value;
  };

  return {
    fetched,
    getBoolean: (key, fallback) => read(key)?.asBoolean() ?? fallback,
    getString: (key, fallback) => read(key)?.asString() ?? fallback,
    getNumber: (key, fallback) => read(key)?.asNumber() ?? fallback,
  };
}

/**
 * Resolves true once fetchAndActivate settles and false if the timeout wins. fetchAndActivate
 * resolves false when the fetched config was already active, which is still a successful fetch.
 */
async function fetchAndActivateWithTimeout(remoteConfig: RemoteConfig): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, REMOTE_CONFIG_FETCH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([fetchAndActivate(remoteConfig).then(() => true as const), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function initializeAppCheckSafe(app: FirebaseApp, siteKey: string): boolean {
  try {
    const debugToken = appCheckDebugToken();
    if (debugToken) {
      // In a browser self is window is globalThis; tests stub self to observe the ordering.
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    return true;
  } catch {
    // App Check problems are reported through appCheckReady; startup continues without it.
    return false;
  }
}

async function initializeRemoteConfig(app: FirebaseApp): Promise<RemoteConfigReader> {
  try {
    const remoteConfig = getRemoteConfig(app);
    if (!(await fetchAndActivateWithTimeout(remoteConfig))) {
      return FALLBACK_READER;
    }
    return createRemoteConfigReader(new Map(Object.entries(getAll(remoteConfig))), true);
  } catch {
    // A failed fetch must not block startup: callers get the in-app fallbacks and can retry.
    return FALLBACK_READER;
  }
}

/**
 * Boots the Firebase runtime. Only configuration and app creation can reject; App Check, Anonymous
 * Auth and Remote Config failures resolve with their readiness flags set to false.
 */
export async function initializeFirebase(env?: ClientEnv): Promise<FirebaseRuntime> {
  const config = env ?? readEnvFromVite();
  const app = getApps().length > 0 ? getApp() : initializeApp(config.firebase);

  const appCheckReady = initializeAppCheckSafe(app, config.recaptchaSiteKey);

  const auth = getAuth(app);
  let authReady = false;
  try {
    await signInAnonymously(auth);
    authReady = true;
  } catch {
    // Anonymous sign-in can fail offline; startup continues and authReady reports it.
  }

  const remoteConfig = await initializeRemoteConfig(app);

  return {
    app,
    auth,
    remoteConfig,
    appCheckReady,
    authReady,
    cloudReady: appCheckReady && authReady,
  };
}
