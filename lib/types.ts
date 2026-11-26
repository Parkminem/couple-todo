export type Scope = "shared" | "personal"
export type Screen = "todo" | "calendar" | "stats" | "us"

export type Person = { id: string; display_name: string; photo_version: string | null }
export type Task = {
  id: string
  title: string
  scope: Scope
  space_id: string | null
  assignee_id: string | null
  due_on: string | null
  created_by: string
  created_at: string
  completed_at: string | null
  completed_by: string | null
  version: number
}
export type TaskDraft = Pick<Task, "title" | "scope" | "assignee_id" | "due_on">
export type CompletionEvent = {
  id: number
  task_id: string
  actor_id: string
  occurred_at: string
  completed: boolean
}
export type Pair = {
  id: string
  owner_id: string
  invite_expires_at: string | null
  members: Person[]
}
export type Snapshot = {
  profile: Person
  pair: Pair | null
  tasks: Task[]
  events: CompletionEvent[]
}
