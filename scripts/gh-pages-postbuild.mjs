import { copyFileSync, existsSync } from 'fs';
import { join } from 'path';

const dist = join(process.cwd(), 'dist');
const index = join(dist, 'index.html');

if (!existsSync(index)) {
  console.error('[gh-pages] dist/index.html not found — run vite build first');
  process.exit(1);
}

copyFileSync(index, join(dist, '404.html'));
console.log('[gh-pages] copied index.html → 404.html (SPA deep links)');
