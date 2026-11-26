// Typed client env keys that code reads directly from import.meta.env (owned by devops).
// Declaring them lets code use dot access, which Vite replaces statically at build time.
interface ImportMetaEnv {
  /** Development only. Read solely by appCheckDebugToken() behind an import.meta.env.DEV check. */
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
  /** Development and tests only: `mock` selects the AI mock. No other value is accepted. */
  readonly VITE_AI_MODE?: string;
}
