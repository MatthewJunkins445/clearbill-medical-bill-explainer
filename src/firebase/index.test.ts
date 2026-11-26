import { afterEach, describe, expect, it, vi } from 'vitest';
import { appCheckDebugToken, ConfigError, readClientEnv } from './index.ts';

const complete = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
  VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'test-site-key',
};

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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
