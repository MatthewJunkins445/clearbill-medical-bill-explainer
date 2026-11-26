// Application entry point. The UI is owned by frontend under src/ui; this file only mounts it.
import { mountApp } from './ui/app.ts';

const root = document.getElementById('app');
if (root) {
  mountApp(root);
}
