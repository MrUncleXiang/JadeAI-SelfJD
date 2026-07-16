import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const port = process.env.PLAYWRIGHT_PORT || '3100';
const tempDirectory = resolve(root, '.tmp/playwright');
const databasePath = resolve(tempDirectory, 'jadeai-e2e.sqlite');
const adminPassword = 'E2E-Admin-Password-2026!';

mkdirSync(tempDirectory, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${databasePath}${suffix}`, { force: true });
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  NEXT_TELEMETRY_DISABLED: '1',
  AUTH_ENABLED: 'true',
  ENABLE_FINGERPRINT_AUTH: 'false',
  REGISTRATION_MODE: 'closed',
  DB_TYPE: 'sqlite',
  SQLITE_PATH: databasePath,
  LLM_ENCRYPTION_KEYS: JSON.stringify({
    1: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  }),
  LLM_ENCRYPTION_ACTIVE_KEY_VERSION: '1',
  LLM_BASE_URL_ALLOWLIST: '',
};

const bootstrap = spawnSync(
  'corepack',
  [
    'pnpm',
    'auth:bootstrap-admin',
    '--',
    '--username',
    'e2e-admin',
    '--email',
    'e2e-admin@example.test',
    '--display-name',
    'E2E Admin',
  ],
  {
    cwd: root,
    env,
    input: adminPassword,
    stdio: ['pipe', 'inherit', 'inherit'],
  },
);

if (bootstrap.status !== 0) {
  process.exit(bootstrap.status ?? 1);
}

const server = spawn(
  'corepack',
  ['pnpm', 'dev', '--hostname', '127.0.0.1', '--port', port],
  {
    cwd: root,
    env,
    stdio: 'inherit',
  },
);

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  server.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

server.on('error', (error) => {
  process.stderr.write(`Failed to start Playwright web server: ${error.message}\n`);
  process.exitCode = 1;
});

server.on('exit', (code, signal) => {
  if (signal && !stopping) {
    process.stderr.write(`Playwright web server exited from signal ${signal}\n`);
  }
  process.exit(code ?? (signal ? 1 : 0));
});
