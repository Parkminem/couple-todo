import type { Task, TaskDraft } from "./types.ts"

const korea = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
})
export const weekdays = ["월", "화", "수", "목", "금", "토", "일"]

export function seoulDate(value = new Date()) {
  const parts = korea.formatToParts(value)
  const part = (type: string) => parts.find(item => item.type === type)?.value
  return [part("year"), part("month"), part("day")].join("-")
}

export function addDays(day: string, amount: number) {
  const date = new Date(day + "T00:00:00Z")
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function monday(day: string) {
  const date = new Date(day + "T00:00:00Z")
  return addDays(day, -((date.getUTCDay() + 6) % 7))
}

export function calendarDays(month: string) {
  const start = monday(month + "-01")
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

export function shiftMonth(month: string, amount: number) {
  const date = new Date(month + "-01T00:00:00Z")
  date.setUTCMonth(date.getUTCMonth() + amount)
  return date.toISOString().slice(0, 7)
}

export function homeSections(tasks: Task[], today: string) {
  const open = tasks.filter(task => !task.completed_at).sort((a, b) =>
    Number(a.due_on === null) - Number(b.due_on === null) || (a.due_on ?? "").localeCompare(b.due_on ?? "") ||
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const completed = tasks.filter((task): task is Task & { completed_at: string } => Boolean(task.completed_at))
    .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at) || a.id.localeCompare(b.id))
  return {
    today: open.filter(task => task.due_on === today),
    done: completed.filter(task => task.due_on === today).length,
    overdue: open.filter(task => task.due_on && task.due_on < today),
    upcoming: open.filter(task => !task.due_on || task.due_on > today),
    completed,
  }
}

export function weeklyStats(tasks: Task[], today: string) {
  const start = monday(today)
  const end = addDays(start, 7)
  const due = tasks.filter(task => task.due_on && task.due_on >= start && task.due_on < end)
  const completed = tasks.filter(task => {
    if (!task.completed_at) return false
    const day = seoulDate(new Date(task.completed_at))
    return day >= start && day < end
  }).sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))
  const byMember = new Map<string, number>()
  for (const task of completed) {
    if (task.completed_by) byMember.set(task.completed_by, (byMember.get(task.completed_by) ?? 0) + 1)
  }
  return {
    start, end, completed, byMember,
    rate: due.length ? Math.round(due.filter(task => task.completed_at).length * 100 / due.length) : null,
  }
}

export function taskMatchesDraft(task: Task, draft: TaskDraft, target: Pick<Task, "space_id" | "created_by">) {
  return task.scope === draft.scope && task.space_id === target.space_id && task.created_by === target.created_by
    && task.title === draft.title && task.assignee_id === draft.assignee_id && task.due_on === draft.due_on
}
