import { defineConfig } from "@playwright/test";

// Browser smoke tests for the built site. They never call Production: Supabase
// is intercepted in the specs. `pnpm test:smoke` builds, then serves `vite preview`.
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.js",
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] },
  },
  webServer: {
    command: "pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    timeout: 180_000,
  },
});
