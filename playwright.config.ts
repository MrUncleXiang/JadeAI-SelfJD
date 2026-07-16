import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/usr/bin/google-chrome-stable';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  outputDir: '.tmp/playwright/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: '.tmp/playwright/report', open: 'never' }],
  ],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'system-chrome',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath,
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
  ],
  webServer: {
    command: 'node scripts/start-playwright-server.mjs',
    url: `${baseURL}/api/auth/register`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PLAYWRIGHT_PORT: String(port),
    },
  },
});
