// Public entry point for Firebase wiring (owned by devops). src/ui may import only this file
// and src/ai/index.ts. App initialization and App Check are added in a later work item.

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
