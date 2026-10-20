import { defineConfig } from '@playwright/test';

const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox', '--no-zygote'] } : {},
  },
  webServer: {
    command: 'npx vite preview --outDir dist-e2e --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/he/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
