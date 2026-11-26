// Typed client env keys that code reads directly from import.meta.env (owned by devops).
// Declaring them lets code use dot access, which Vite replaces statically at build time.
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string;
  /** Development only. Read solely by appCheckDebugToken() behind an import.meta.env.DEV check. */
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
  /** Development and tests only: `mock` selects the AI mock. No other value is accepted. */
  readonly VITE_AI_MODE?: string;
}

// Development only: the App Check SDK reads this global when a debug token is configured. The
// initializer sets it immediately before initializeAppCheck(); it is never bundled in production
// because the value comes from appCheckDebugToken(), which is undefined outside DEV.
interface Window {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: string;
}
