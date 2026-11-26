"use client"

import { usePathname, useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import type { ProfilePhotoUpload } from "@/lib/profile-photo"
import { browserSupabase } from "@/lib/supabase/browser"
import { readSnapshot, TASK_COLUMNS } from "@/lib/supabase/data"
import { seoulDate, taskMatchesDraft } from "@/lib/tasks"
import { useDevicePush } from "./use-device-push"
import { useNotifications } from "./use-notifications"
import { usePrivateTopic } from "./use-private-topic"
import type { Scope, Snapshot, Task, TaskDraft } from "@/lib/types"

type Save = { id: string; draft: TaskDraft; original?: Task }
type Result = "ok" | "conflict"
type Invitation = { code: string; expires_at: string }
type PendingCompletion = Pick<Task, "version" | "completed_at" | "completed_by">
type AppModel = {
  snapshot: Snapshot
  scope: Scope
  setScope: (scope: Scope) => void
  today: string
  online: boolean
  syncing: boolean
  demo: boolean
  demoPhoto: ProfilePhotoUpload | null
  notifications: ReturnType<typeof useNotifications>
  devicePush: ReturnType<typeof useDevicePush>
  refresh: () => Promise<Snapshot | undefined>
  saveTask: (input: Save) => Promise<Result>
  completeTask: (task: Task, completed: boolean) => Promise<void>
  isCompletingTask: (id: string) => boolean
  taskCompletionError: (id: string) => string | undefined
  deleteTask: (task: Task) => Promise<Result>
  saveName: (name: string) => Promise<void>
  saveProfilePhoto: (photo: ProfilePhotoUpload | null) => Promise<void>
  createSpace: () => Promise<boolean>
  issueInvite: () => Promise<Invitation | null>
  revokeInvite: () => Promise<boolean>
  joinSpace: (code: string) => Promise<string>
  signOut: () => Promise<void>
}

const AppContext = createContext<AppModel | null>(null)

function newDemoTask(input: Save, profileId: string, spaceId: string | null): Task {
  const existing = input.original
  return {
    id: input.id, ...input.draft, space_id: input.draft.scope === "shared" ? spaceId : null,
    created_by: existing?.created_by ?? profileId, created_at: existing?.created_at ?? new Date().toISOString(),
    completed_at: existing?.completed_at ?? null, completed_by: existing?.completed_by ?? null, version: (existing?.version ?? 0) + 1,
  }
}

export function AppProvider({ children, initial, demoDate }: { children: ReactNode; initial: Snapshot; demoDate?: string }) {
  const router = useRouter()
  const path = usePathname()
  const demo = Boolean(demoDate)
  const [snapshot, setSnapshot] = useState(initial)
  const [demoPhoto, setDemoPhoto] = useState<ProfilePhotoUpload | null>(null)
  const [scope, setScope] = useState<Scope>("shared")
  const [online, setOnline] = useState(true)
  const [readFailed, setReadFailed] = useState(false)
  const [sessionChanged, setSessionChanged] = useState(false)
  const [today, setToday] = useState(demoDate ?? seoulDate())
  const [client] = useState(() => demo ? null : browserSupabase())
  const request = useRef(0)
  const completing = useRef(new Map<string, PendingCompletion>())
  const [pendingCompletions, setPendingCompletions] = useState<ReadonlyMap<string, PendingCompletion>>(() => new Map())
  // A task row remounts when it moves between lists during a save.
  const [completionErrors, setCompletionErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const userId = initial.profile.id
  const pairId = snapshot.pair?.id
  const notifications = useNotifications(client, userId, path, demoDate)
  const refreshNotifications = notifications.refresh
  const devicePush = useDevicePush(client, userId)

  const refresh = useCallback(async () => {
    if (demoDate) setToday(demoDate)
    else setToday(seoulDate())
    if (!client || !navigator.onLine) return
    const ticket = ++request.current
    try {
      const next = await readSnapshot(client, userId)
      if (ticket === request.current) {
        setSnapshot(next)
        setReadFailed(false)
      }
      return next
    } catch (error) {
      if (ticket === request.current) setReadFailed(true)
      throw error
    }
  }, [client, demoDate, userId])

  useEffect(() => {
    const askRefresh = () => {
      void refresh().catch(() => {})
      void refreshNotifications()
    }
    const onConnectivity = () => {
      setOnline(navigator.onLine)
      if (navigator.onLine) askRefresh()
    }
    const onVisible = () => { if (document.visibilityState === "visible") askRefresh() }
    onConnectivity()
    window.addEventListener("online", onConnectivity)
    window.addEventListener("offline", onConnectivity)
    window.addEventListener("pageshow", onConnectivity)
    document.addEventListener("visibilitychange", onVisible)
    const clock = window.setInterval(() => setToday(demoDate ?? seoulDate()), 30_000)
    return () => {
      window.removeEventListener("online", onConnectivity)
      window.removeEventListener("offline", onConnectivity)
      window.removeEventListener("pageshow", onConnectivity)
      document.removeEventListener("visibilitychange", onVisible)
      window.clearInterval(clock)
    }
  }, [demoDate, refresh, refreshNotifications])

  const refreshOnSignal = useCallback(() => void refresh().catch(() => {}), [refresh])
  const refreshAccountOnSignal = useCallback(() => {
    refreshOnSignal()
    void refreshNotifications()
  }, [refreshNotifications, refreshOnSignal])
  const realtimeClient = sessionChanged ? null : client
  const accountChannel = usePrivateTopic(realtimeClient, "user:" + userId, refreshAccountOnSignal)
  const pairChannel = usePrivateTopic(realtimeClient, pairId ? "space:" + pairId : null, refreshOnSignal)
  const syncing = readFailed || [accountChannel, pairChannel].some(status => status && status !== "SUBSCRIBED")

  useEffect(() => {
    if (!client) return
    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshAccountOnSignal()
    }, 25_000)
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || session?.user.id !== userId) {
        request.current++
        setSessionChanged(true)
        window.location.replace(session ? "/" : "/login")
      }
    })
    return () => {
      window.clearInterval(fallback)
      data.subscription.unsubscribe()
    }
  }, [client, refreshAccountOnSignal, userId])

  async function refreshAfterWrite() {
    try { await refresh() } catch { /* The saved mutation will be reflected after reconnect. */ }
  }

  async function saveTask(input: Save): Promise<Result> {
    const draft = { ...input.draft, title: input.draft.title.trim() }
    if (!client) {
      const saved = newDemoTask({ ...input, draft }, userId, pairId ?? null)
      setSnapshot(current => ({ ...current, tasks: [...current.tasks.filter(task => task.id !== input.id), saved] }))
      return "ok"
    }
    const { title, assignee_id, due_on } = draft
    const existing = input.original
    const result = existing
      ? await client.from("tasks").update({ title, assignee_id, due_on })
        .eq("id", existing.id).eq("version", existing.version).select(TASK_COLUMNS).maybeSingle()
      : await client.from("tasks").insert({ ...draft, id: input.id, space_id: draft.scope === "shared" ? pairId : null })
        .select(TASK_COLUMNS).single()
    if (result.error || !result.data) {
      const current = await refresh().catch(() => undefined)
      const latest = current?.tasks.find(task => task.id === input.id)
      if (latest && taskMatchesDraft(latest, draft, {
        created_by: existing?.created_by ?? userId,
        space_id: existing?.space_id ?? (draft.scope === "shared" ? pairId ?? null : null),
      })) return "ok"
      if (latest && !existing) return "conflict"
      if (result.error) throw result.error
      return "conflict"
    }
    const saved: Task = result.data
    setSnapshot(current => {
      const known = current.tasks.find(task => task.id === saved.id)
      if (known && known.version > saved.version) return current
      return { ...current, tasks: [...current.tasks.filter(task => task.id !== saved.id), saved] }
    })
    void refreshAfterWrite()
    return "ok"
  }

  function updateCompletionError(id: string, message?: string) {
    setCompletionErrors(current => {
      if (current.get(id) === message) return current
      const next = new Map(current)
      if (message) next.set(id, message)
      else next.delete(id)
      return next
    })
  }

  async function completeTask(task: Task, completed: boolean) {
    if (!client) {
      const occurred = new Date(demoDate + "T12:00:00+09:00").toISOString()
      setSnapshot(current => ({
        ...current,
        tasks: current.tasks.map(item => item.id === task.id ? {
          ...item, version: item.version + 1, completed_at: completed ? occurred : null, completed_by: completed ? userId : null,
        } : item),
        events: [{ id: Date.now(), task_id: task.id, actor_id: userId, occurred_at: occurred, completed }, ...current.events],
      }))
      return
    }
    const pending = completing.current
    if (pending.has(task.id)) return
    updateCompletionError(task.id)
    pending.set(task.id, {
      version: task.version,
      completed_at: completed ? new Date().toISOString() : null,
      completed_by: completed ? userId : null,
    })
    setPendingCompletions(new Map(pending))
    try {
      const result = await client.from("tasks").update({ is_complete: completed }).eq("id", task.id)
        .eq("version", task.version).select(TASK_COLUMNS).maybeSingle()
      if (result.error || !result.data) {
        const current = await refresh().catch(() => undefined)
        const latest = current?.tasks.find(item => item.id === task.id)
        if (latest && Boolean(latest.completed_at) === completed) return
        if (result.error) throw result.error
        updateCompletionError(task.id, "다른 곳에서 변경했어요. 다시 확인해 주세요.")
        return
      }
      const saved: Task = result.data
      setSnapshot(current => ({
        ...current,
        tasks: current.tasks.map(item => item.id === saved.id && item.version <= saved.version ? saved : item),
      }))
      void refreshAfterWrite()
    } catch {
      updateCompletionError(task.id, "완료 상태를 저장하지 못했어요.")
    } finally {
      pending.delete(task.id)
      setPendingCompletions(new Map(pending))
    }
  }

  async function deleteTask(task: Task): Promise<Result> {
    if (client) {
      const { data, error } = await client.from("tasks").delete().eq("id", task.id)
        .eq("version", task.version).select("id").maybeSingle()
      if (error || !data) {
        const current = await refresh().catch(() => undefined)
        if (current && !current.tasks.some(item => item.id === task.id)) return "ok"
        if (error) throw error
        return "conflict"
      }
    }
    setSnapshot(current => ({
      ...current, tasks: current.tasks.filter(item => item.id !== task.id),
      events: current.events.filter(item => item.task_id !== task.id),
    }))
    updateCompletionError(task.id)
    if (client) void refreshAfterWrite()
    return "ok"
  }

  async function saveName(display_name: string) {
    if (client) {
      const table = client.from("profiles")
      const result = snapshot.profile.display_name
        ? await table.update({ display_name }).eq("id", userId).select("id").single()
        : await table.insert({ display_name }).select("id").single()
      if (result.error) throw result.error
      await refreshAfterWrite()
      return
    }
    setSnapshot(current => ({
      ...current, profile: { ...current.profile, display_name },
      pair: current.pair && {
        ...current.pair, members: current.pair.members.map(person => person.id === userId ? { ...person, display_name } : person),
      },
    }))
  }

  async function saveProfilePhoto(photo: ProfilePhotoUpload | null) {
    const before = snapshot.profile.photo_version
    let photo_version: string | null
    if (client) {
      const { data, error } = await client.rpc("set_profile_photo", {
        photo: photo?.thumbnail ?? null,
        full_photo: photo?.full ?? null,
      })
      if (error) throw error
      photo_version = data
      request.current++
    } else {
      photo_version = photo && crypto.randomUUID()
      setDemoPhoto(photo)
    }
    setSnapshot(current => {
      if (current.profile.photo_version !== before) return current
      return {
        ...current, profile: { ...current.profile, photo_version },
        pair: current.pair && {
          ...current.pair, members: current.pair.members.map(person => person.id === userId ? { ...person, photo_version } : person),
        },
      }
    })
    if (client) void refreshAfterWrite()
  }

  async function rpc<T>(name: string, args?: Record<string, string>): Promise<T> {
    if (!client) throw new Error("공유 공간 기능은 계정 연결 후 이용할 수 있습니다.")
    const { data, error } = await client.rpc(name, args)
    if (error) throw error
    await refreshAfterWrite()
    return data as T
  }

  async function issueInvite() {
    const invitation = await rpc<Invitation | null>("issue_invite")
    if (invitation) setSnapshot(current => ({
      ...current,
      pair: current.pair && { ...current.pair, invite_expires_at: invitation.expires_at },
    }))
    return invitation
  }

  async function revokeInvite() {
    const revoked = await rpc<boolean>("revoke_invite")
    if (revoked) setSnapshot(current => ({
      ...current, pair: current.pair && { ...current.pair, invite_expires_at: null },
    }))
    return revoked
  }

  async function signOut() {
    if (!client) return router.replace("/login")
    await devicePush.beforeSignOut(async () => {
      const { error } = await client.auth.signOut({ scope: "local" })
      if (error) throw error
      window.location.replace("/login")
    })
  }

  if (sessionChanged) return <main className="login-frame"><p role="status">로그인을 다시 확인하고 있어요.</p></main>

  const visibleSnapshot = pendingCompletions.size ? {
    ...snapshot,
    tasks: snapshot.tasks.map(task => {
      const pending = pendingCompletions.get(task.id)
      return pending?.version === task.version ? { ...task, ...pending } : task
    }),
  } : snapshot

  return (
    <AppContext.Provider value={{
      snapshot: visibleSnapshot, scope, setScope, today, demo, demoPhoto, online, syncing, refresh, saveTask, completeTask, notifications, devicePush,
      isCompletingTask: id => pendingCompletions.has(id),
      taskCompletionError: id => completionErrors.get(id),
      deleteTask, saveName, saveProfilePhoto, signOut, createSpace: () => rpc<boolean>("create_space"),
      issueInvite, revokeInvite,
      joinSpace: code => rpc<string>("join_space", { code }),
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error("AppProvider is required")
  return value
}
