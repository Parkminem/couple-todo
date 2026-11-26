import type { SupabaseClient } from "@supabase/supabase-js"
import type { CompletionEvent, Pair, Person, Snapshot, Task } from "@/lib/types"

export const TASK_COLUMNS = "id,title,scope,space_id,assignee_id,due_on,created_by,created_at,completed_at,completed_by,version"

type RowPage<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export async function readAll<T>(query: (start: number, end: number) => RowPage<T>) {
  const rows: T[] = []
  const pageSize = 500
  for (let start = 0; ; start += pageSize) {
    const result = await query(start, start + pageSize - 1)
    if (result.error) throw result.error
    rows.push(...(result.data ?? []))
    if (!result.data || result.data.length < pageSize) return rows
  }
}

export async function readSnapshot(client: SupabaseClient, userId: string): Promise<Snapshot> {
  const [profiles, space, tasks, events] = await Promise.all([
    client.from("profiles").select("id,display_name,photo_version").order("id"),
    client.from("spaces").select("id,owner_id,invite_expires_at").maybeSingle(),
    readAll<Task>((start, end) => client.from("tasks").select(TASK_COLUMNS).order("id")
      .range(start, end).returns<Task[]>()),
    readAll<CompletionEvent>((start, end) => client.from("task_completion_events")
      .select("id,task_id,actor_id,occurred_at,completed").order("id", { ascending: false })
      .range(start, end).returns<CompletionEvent[]>()),
  ])
  if (profiles.error) throw profiles.error
  if (space.error) throw space.error
  const people: Person[] = profiles.data ?? []
  const profile = people.find(person => person.id === userId) ?? { id: userId, display_name: "", photo_version: null }
  const pair: Pair | null = space.data ? { ...space.data, members: people } : null
  return { profile, pair, tasks, events }
}
