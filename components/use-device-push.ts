"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import { useCallback, useRef } from "react"
import { clearDevicePush, enableDevicePush, readDevicePush, withDevicePushLock, type DevicePush } from "@/lib/device-push"

export function useDevicePush(client: SupabaseClient | null, userId: string) {
  const pending = useRef<Promise<void> | null>(null)
  const signingOut = useRef(false)
  const load = useCallback(async () => client ? readDevicePush(client) : null, [client])

  async function toggle(device: DevicePush) {
    if (!client || signingOut.current || pending.current) return
    const change = device.enabled ? withDevicePushLock(() => clearDevicePush(client)) : enableDevicePush(client, device, userId)
    pending.current = change
    try { await change } finally { pending.current = null }
  }

  async function beforeSignOut(signOut: () => Promise<void>) {
    if (!client || signingOut.current) return
    signingOut.current = true
    try {
      await pending.current?.catch(() => {})
      await withDevicePushLock(async () => {
        await clearDevicePush(client)
        await signOut()
      })
    } finally {
      signingOut.current = false
    }
  }

  return { load, toggle, beforeSignOut }
}
