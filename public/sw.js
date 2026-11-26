const CACHE_NAME = "couple-todo-static-v2"
const OFFLINE_URL = "/offline.html"
const STATIC_PATHS = ["/_next/static/", "/fonts/", "/icons/"]

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL)))
  void self.skipWaiting()
})

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith("couple-todo-static-") && key !== CACHE_NAME)
      .map(key => caches.delete(key))))
    .then(() => self.clients.claim()))
})

self.addEventListener("fetch", event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  if (STATIC_PATHS.some(prefix => url.pathname.startsWith(prefix))) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok && response.type === "basic") await cache.put(request, response.clone())
      return response
    })())
  }
})

self.addEventListener("push", event => {
  let payload
  try { payload = event.data?.json() } catch { /* Show a generic notification for malformed payloads. */ }
  const body = typeof payload?.body === "string" ? payload.body : "알림함에서 새 소식을 확인해 주세요."
  const tag = typeof payload?.tag === "string" && payload.tag.startsWith("notification:") ? payload.tag : undefined
  event.waitUntil(self.registration.showNotification("우리의 할 일", { body, tag, icon: "/icons/icon-192.png?v=2" }))
})

self.addEventListener("notificationclick", event => {
  event.notification.close()
  event.waitUntil((async () => {
    const inbox = new URL("/notifications", self.location.origin).href
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    try {
      const exact = windows.find(window => window.url === inbox)
      if (exact) return await exact.focus()
      const existing = windows.find(window => new URL(window.url).origin === self.location.origin)
      if (existing) {
        const navigated = await existing.navigate(inbox)
        if (navigated) return await navigated.focus()
      }
    } catch { /* Open the inbox if the existing window is already closing. */ }
    return self.clients.openWindow(inbox)
  })())
})
