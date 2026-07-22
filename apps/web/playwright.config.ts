import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run -w apps/mock-api dev',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4000/verify/status/not-a-uuid',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run -w apps/web dev -- --host 127.0.0.1 --port 4173',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4173',
      env: {
        VITE_API_BASE_URL: 'http://127.0.0.1:4173',
      },
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
