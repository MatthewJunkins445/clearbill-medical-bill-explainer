// Types for the mock-mode-only test hook installed by src/ui/app.ts.
import type { AppContext } from '../../src/ui/context.ts';

declare global {
  interface Window {
    __clearbill?: { current(): AppContext };
    __disposed?: number;
  }
}
