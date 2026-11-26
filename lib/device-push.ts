import type { SupabaseClient } from "@supabase/supabase-js"

const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_KEY

export type DevicePush = {
  registration: ServiceWorkerRegistration
  subscription: PushSubscription | null
  enabled: boolean
}

export function isAppleMobile() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

export function isHomeScreenApp() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function supportsDevicePush() {
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

export async function readDevicePush(client: SupabaseClient): Promise<DevicePush | null> {
  const registration = await navigator.serviceWorker.getRegistration("/")
  if (!registration?.active) return null
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return { registration, subscription, enabled: false }
  const { data, error } = await client.rpc("has_notification_subscription", { endpoint: subscription.endpoint })
  if (error) throw error
  return { registration, subscription, enabled: data === true }
}

export function canEnableDevicePush() {
  return Boolean(publicKey)
}

export async function withDevicePushLock(action: () => Promise<void>): Promise<void> {
  if (navigator.locks) await navigator.locks.request("couple-todo-device-push", action)
  else await action()
}

export async function enableDevicePush(client: SupabaseClient, device: DevicePush, userId: string) {
  if (!publicKey) throw new Error("Web push is unavailable")
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/")
  const applicationServerKey = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
  // Safari expects subscribe to begin in the click handler's user activation.
  const subscription = device.subscription ?? await device.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
  const { p256dh, auth } = subscription.toJSON().keys ?? {}
  if (!p256dh || !auth) throw new Error("The push subscription has no keys")
  await withDevicePushLock(async () => {
    const session = await client.auth.getSession()
    if (session.error || session.data.session?.user.id !== userId) throw new Error("The push session has changed")
    const current = await device.registration.pushManager.getSubscription()
    if (current?.endpoint !== subscription.endpoint) throw new Error("The device subscription has changed")
    const { data, error } = await client.rpc("register_notification_subscription", { endpoint: subscription.endpoint, p256dh, auth_key: auth })
    if (error || data !== true) throw error ?? new Error("The push subscription could not be saved")
  })
}

export async function clearDevicePush(client: SupabaseClient) {
  if (!("serviceWorker" in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration("/")
  if (!registration) return
  const subscription = await registration.pushManager?.getSubscription()
  if (subscription) {
    const endpoint = subscription.endpoint
    const [remote, local] = await Promise.allSettled([
      client.rpc("unregister_notification_subscription", { endpoint }),
      subscription.unsubscribe(),
    ])
    const revoked = remote.status === "fulfilled" && !remote.value.error && remote.value.data === true
    const unsubscribed = local.status === "fulfilled" && local.value
    if (!revoked && !unsubscribed && await registration.pushManager.getSubscription()) {
      throw new Error("The push subscription could not be revoked")
    }
  }
  try {
    const shown = await registration.getNotifications()
    shown.forEach(notification => notification.close())
  } catch {
    // Removing the subscription also prevents future deliveries.
  }
}
