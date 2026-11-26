"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  defaultNotificationPreferences, readNotificationPreferences, readNotifications, writeNotificationPreferences,
  type NotificationPreferences, type TaskNotification,
} from "@/lib/notifications"

function demoNotifications(date: string): TaskNotification[] {
  return [
    { id: "demo-added", kind: "added", change_kind: null, task_title: "주말 장보기", created_at: date + "T03:00:00Z", read_at: null },
    { id: "demo-completed", kind: "completed", change_kind: null, task_title: "영화 예매하기", created_at: date + "T02:00:00Z", read_at: date + "T02:10:00Z" },
    { id: "demo-changed", kind: "changed", change_kind: "deadline", task_title: "카페 예약하기", created_at: date + "T01:00:00Z", read_at: date + "T01:15:00Z" },
  ]
}

export function useNotifications(client: SupabaseClient | null, userId: string, path: string, demoDate?: string) {
  const [entries, setEntries] = useState(() => demoDate ? demoNotifications(demoDate) : [])
  const [unread, setUnread] = useState(demoDate ? 1 : 0)
  const [loaded, setLoaded] = useState(Boolean(demoDate))
  const [readError, setReadError] = useState(false)
  const [demoPreferences, setDemoPreferences] = useState(defaultNotificationPreferences)
  const request = useRef(0)
  const currentPath = useRef(path)

  const refresh = useCallback(async () => {
    const path = currentPath.current
    const ticket = ++request.current
    if (!client || !navigator.onLine || (path !== "/us" && path !== "/notifications")) return
    try {
      const result = await readNotifications(client, userId, path === "/notifications")
      if (ticket !== request.current) return
      setUnread(result.unread)
      if (result.entries) {
        setEntries(result.entries)
        setLoaded(true)
        setReadError(false)
      }
    } catch {
      if (ticket === request.current && path === "/notifications") setReadError(true)
    }
  }, [client, userId])

  useEffect(() => {
    currentPath.current = path
    void refresh()
  }, [path, refresh])

  async function markRead(id?: string) {
    const read_at = new Date().toISOString()
    let affected = 1
    if (client) {
      let query = client.from("notifications").update({ read_at }, { count: "exact" })
        .eq("recipient_id", userId).is("read_at", null)
      if (id) query = query.eq("id", id)
      const { count, error } = await query
      if (error) throw error
      affected = count ?? affected
    }
    request.current++
    setEntries(current => current.map(entry => !entry.read_at && (!id || entry.id === id) ? { ...entry, read_at } : entry))
    setUnread(current => id ? Math.max(0, current - affected) : 0)
    void refresh()
  }

  const loadPreferences = useCallback(async () => client ? readNotificationPreferences(client, userId) : demoPreferences,
    [client, demoPreferences, userId])

  async function savePreferences(preferences: NotificationPreferences) {
    if (client) await writeNotificationPreferences(client, userId, preferences)
    else setDemoPreferences(preferences)
  }

  return { entries, unread, loaded, readError, refresh, markRead, loadPreferences, savePreferences }
}
