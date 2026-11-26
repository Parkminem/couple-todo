import "server-only"
import { addDays } from "./tasks"
import type { Snapshot, Task } from "./types"

// Only loaded by the explicitly enabled local Next.js development session.
export const demoToday = "2026-11-21"
export const demoEnabled = process.env.NODE_ENV === "development" && process.env.COUPLE_TODO_DEMO === "1" && !process.env.VERCEL
export const demoProfile = { id: "demo-me", display_name: "민혁", photo_version: null }
const other = { id: "demo-partner", display_name: "그녀", photo_version: null }

const fixture: [string, number, string | null, boolean][] = [
  ["주말 장보기", 0, null, false],
  ["영화 예매하기", 0, demoProfile.id, true],
  ["카페 예약하기", 0, other.id, false],
  ["분리수거", 1, null, false],
  ["집 청소하기", 2, demoProfile.id, false],
]
const tasks: Task[] = fixture.map(([title, day, assignee_id, complete], index) => ({
  id: "demo-" + index, title, scope: "shared", space_id: "demo-space", assignee_id,
  created_by: demoProfile.id, due_on: addDays(demoToday, day), version: 1,
  created_at: "2026-11-21T02:00:0" + index + "Z",
  completed_at: complete ? "2026-11-21T03:00:00Z" : null, completed_by: complete ? demoProfile.id : null,
}))

export const demoSnapshot: Snapshot = {
  profile: demoProfile, pair: { id: "demo-space", owner_id: demoProfile.id, members: [demoProfile, other], invite_expires_at: null },
  tasks,
  events: [{ id: 1, task_id: "demo-1", actor_id: demoProfile.id, occurred_at: "2026-11-21T03:00:00Z", completed: true }],
}
