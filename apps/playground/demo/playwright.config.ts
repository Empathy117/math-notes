import { defineConfig } from '@playwright/test';

// Records the README's GIFs into docs/media: `pnpm -C apps/playground demo`, or one of them with
// `-g <name>`. Needs ffmpeg on PATH. The AI is the playground's mock, so every run is the same.
export default defineConfig({
  testDir: '.',
  // Next to this file, so a recording run leaves the e2e suite's results alone.
  outputDir: './test-results',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5180',
    viewport: { width: 900, height: 580 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5180',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
