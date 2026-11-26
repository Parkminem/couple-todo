import { expect, test } from "@playwright/test"

test("serves install metadata and keeps authenticated documents out of offline storage", async ({ page, context, request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest")
  expect(manifestResponse.ok()).toBe(true)
  const manifest = await manifestResponse.json()
  expect(manifest).toMatchObject({ start_url: "/", display: "standalone", lang: "ko" })
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)

  const login = await page.goto("/")
  expect(new URL(page.url()).pathname).toBe("/login")
  expect(login?.headers()["cache-control"]).toContain("no-store")
  const inbox = await request.get("/notifications", { maxRedirects: 0 })
  expect(inbox.status()).toBe(307)
  expect(inbox.headers()["location"]).toBe("/login")
  expect(inbox.headers()["cache-control"]).toContain("no-store")
  const photo = await request.get(`/profile-photo/${crypto.randomUUID()}?v=${crypto.randomUUID()}`)
  expect(photo.status()).toBe(404)
  expect(photo.headers()["cache-control"]).toBe("private, no-store")
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  const cachedPaths = await page.evaluate(async () => {
    const cacheNames = await caches.keys()
    const appCaches = cacheNames.filter(name => name.startsWith("couple-todo-static-"))
    const cached = await Promise.all(appCaches.map(async name => (await caches.open(name)).keys()))
    return cached.flat().map(request => new URL(request.url).pathname)
  })
  expect(cachedPaths).toContain("/offline.html")
  expect(cachedPaths.some(path => path === "/" || ["/login", "/calendar", "/stats", "/us", "/notifications"].includes(path))).toBe(false)

  await context.setOffline(true)
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "인터넷 연결이 필요해요" })).toBeVisible()
})
