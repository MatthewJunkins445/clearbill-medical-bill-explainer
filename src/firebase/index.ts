// Public entry point for Firebase wiring (owned by devops). src/ui may import only this file
// and src/ai/index.ts. App initialization and App Check are added in a later work item.

export const AI_MODES = ['prefer_on_device', 'only_on_device', 'only_in_cloud', 'prefer_in_cloud'] as const;
export type AiMode = (typeof AI_MODES)[number];

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface ClientEnv {
  firebase: FirebaseWebConfig;
  recaptchaSiteKey: string;
  aiMode: AiMode;
  /** Present only in development builds; a debug token must never ship to production. */
  appCheckDebugToken: string | undefined;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function isAiMode(value: string): value is AiMode {
  return (AI_MODES as readonly string[]).includes(value);
}

/**
 * Reads and validates client configuration from a Vite-style env record (import.meta.env).
 * Throws ConfigError naming the missing keys, never their values.
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

  const mode = text('VITE_AI_MODE') || 'prefer_on_device';
  if (!isAiMode(mode)) {
    throw new ConfigError(`VITE_AI_MODE must be one of: ${AI_MODES.join(', ')}.`);
  }

  const debugToken = text('VITE_APPCHECK_DEBUG_TOKEN');
  return {
    firebase,
    recaptchaSiteKey,
    aiMode: mode,
    appCheckDebugToken: env['DEV'] === true && debugToken ? debugToken : undefined,
  };
}
