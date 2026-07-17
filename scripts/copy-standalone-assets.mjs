import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standaloneDir = join(root, '.next', 'standalone');
const standaloneNextDir = join(standaloneDir, '.next');

if (!existsSync(standaloneDir)) {
  console.log('[copy-standalone-assets] .next/standalone not found, skipping');
  process.exit(0);
}

mkdirSync(standaloneNextDir, { recursive: true });

const copies = [
  [join(root, '.next', 'static'), join(standaloneNextDir, 'static')],
  [join(root, 'public'), join(standaloneDir, 'public')],
];

for (const [source, destination] of copies) {
  if (!existsSync(source)) {
    console.log(`[copy-standalone-assets] ${source} not found, skipping`);
    continue;
  }
  if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
  console.log(`[copy-standalone-assets] Copied ${source} -> ${destination}`);
}
