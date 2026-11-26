import { defineConfig, devices } from "@playwright/test"

const live = process.env.COUPLE_TODO_LIVE_TEST === "1"
const production = process.env.COUPLE_TODO_PWA_TEST === "1"
const port = production ? 3200 : 3100

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: production ? "test-results/pwa" : live ? "test-results/live" : "test-results/screens",
  testMatch: live ? "live-supabase.spec.ts" : production ? "production.spec.ts" : "couple-todo.spec.ts",
  use: { baseURL: "http://localhost:" + port, locale: "ko-KR", timezoneId: "Asia/Seoul" },
  projects: [
    { name: "chromium", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    ...(live ? [] : [{ name: "webkit", use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" as const } }]),
  ],
  webServer: {
    command: (production ? "pnpm start" : live ? "pnpm dev" : "COUPLE_TODO_DEMO=1 pnpm dev") + " --hostname 127.0.0.1 --port " + port,
    url: "http://localhost:" + port,
    reuseExistingServer: false,
    timeout: 120000,
  },
  workers: 2,
})
