// Application entry point (owned by frontend). It only mounts the UI shell.
import { mountApp } from './app.ts';

const root = document.getElementById('app');
if (root) {
  mountApp(root);
}
