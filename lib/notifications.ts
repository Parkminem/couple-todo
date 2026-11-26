import type { SupabaseClient } from "@supabase/supabase-js"
import { readAll } from "./supabase/data"

export type TaskNotification = {
  id: string
  kind: "added" | "completed" | "changed"
  change_kind: "deadline" | "assignee" | "deadline_and_assignee" | "deleted" | null
  task_title: string
  created_at: string
  read_at: string | null
}

export const defaultNotificationPreferences = {
  task_added: true,
  task_completed: true,
  task_changed: true,
  quiet_enabled: false,
  quiet_start: "22:00",
  quiet_end: "08:00",
}

export type NotificationPreferences = typeof defaultNotificationPreferences

const preferenceColumns = "task_added,task_completed,task_changed,quiet_enabled,quiet_start,quiet_end"

export async function readNotifications(client: SupabaseClient, userId: string, includeEntries: boolean) {
  const [unread, entries] = await Promise.all([
    client.from("notifications").select("id", { count: "exact", head: true })
      .eq("recipient_id", userId).is("read_at", null),
    includeEntries ? readAll<TaskNotification>((start, end) => client.from("notifications")
      .select("id,kind,change_kind,task_title,created_at,read_at").eq("recipient_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(start, end).returns<TaskNotification[]>()) : undefined,
  ])
  if (unread.error) throw unread.error
  return { entries, unread: unread.count ?? 0 }
}

export async function readNotificationPreferences(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("notification_preferences").select(preferenceColumns)
    .eq("user_id", userId).maybeSingle().returns<NotificationPreferences>()
  if (error) throw error
  return data ? { ...data, quiet_start: data.quiet_start.slice(0, 5), quiet_end: data.quiet_end.slice(0, 5) }
    : defaultNotificationPreferences
}

export async function writeNotificationPreferences(client: SupabaseClient, userId: string, preferences: NotificationPreferences) {
  const { error } = await client.from("notification_preferences").upsert({ ...preferences, user_id: userId }, { onConflict: "user_id" })
  if (error) throw error
}
