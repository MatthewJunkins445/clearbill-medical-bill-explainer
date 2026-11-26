import { describe, expect, it } from 'vitest';
import { ConfigError, readClientEnv } from '../../src/firebase/index.ts';

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
  it('maps a complete env to config and defaults the AI mode to prefer_on_device', () => {
    const env = readClientEnv(complete);
    expect(env.firebase.projectId).toBe('demo');
    expect(env.aiMode).toBe('prefer_on_device');
  });

  it('names every missing key without echoing any values', () => {
    const partial: Record<string, string> = { ...complete };
    delete partial['VITE_FIREBASE_APP_ID'];
    delete partial['VITE_RECAPTCHA_ENTERPRISE_SITE_KEY'];
    expect(() => readClientEnv(partial)).toThrow(ConfigError);
    expect(() => readClientEnv(partial)).toThrow(/VITE_FIREBASE_APP_ID, VITE_RECAPTCHA_ENTERPRISE_SITE_KEY/);
    expect(() => readClientEnv(partial)).not.toThrow(/test-api-key/);
  });

  it('rejects an unknown AI mode', () => {
    expect(() => readClientEnv({ ...complete, VITE_AI_MODE: 'cloud_please' })).toThrow(/VITE_AI_MODE/);
  });

  it('uses the App Check debug token only in development builds', () => {
    const withToken = { ...complete, VITE_APPCHECK_DEBUG_TOKEN: 'debug-token' };
    expect(readClientEnv({ ...withToken, DEV: true }).appCheckDebugToken).toBe('debug-token');
    expect(readClientEnv({ ...withToken, DEV: false }).appCheckDebugToken).toBeUndefined();
  });
});
