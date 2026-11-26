import assert from "node:assert/strict"
import { test } from "node:test"
import { calendarDays, seoulDate, weeklyStats, homeSections, taskMatchesDraft } from "../lib/tasks.ts"
import type { Task } from "../lib/types.ts"

function task(id: string, due_on: string | null, completed_at: string | null = null, completed_by = "b"): Task {
  return { id, title: id, due_on, completed_at, completed_by: completed_at ? completed_by : null,
    scope: "shared", created_by: "a", space_id: "space", assignee_id: null, version: 1,
    created_at: "2026-11-20T00:00:00Z" }
}

test("Seoul date rolls over at 15:00 UTC and the calendar starts on Monday", () => {
  assert.equal(seoulDate(new Date("2026-11-22T14:59:59Z")), "2026-11-22")
  assert.equal(seoulDate(new Date("2026-11-22T15:00:00Z")), "2026-11-23")
  assert.equal(calendarDays("2026-11")[0], "2026-10-26")
  assert.equal(calendarDays("2026-11").length, 42)
})

test("home shows completed tasks once, newest first, while counting today's progress", () => {
  const items = [task("late", "2026-11-20"), task("old", "2026-11-20", "2026-11-20T00:00Z"),
    task("today", "2026-11-21"), { ...task("done", "2026-11-21", "2026-11-20T16:00Z"), created_at: "2026-11-20T01:00:00Z" },
    task("future", "2026-11-22"), task("undated", null),
    task("future-done", "2026-11-22", "2026-11-21T08:00:00+09:00"),
    task("undated-done", null, "2026-11-21T04:00:00Z")]
  const sections = homeSections(items, "2026-11-21")
  assert.deepEqual(sections.today.map(item => item.id), ["today"])
  assert.deepEqual(sections.overdue.map(item => item.id), ["late"])
  assert.deepEqual(sections.upcoming.map(item => item.id), ["future", "undated"])
  assert.equal(sections.done, 1)
  assert.deepEqual(sections.completed.map(item => item.id), ["undated-done", "future-done", "done", "old"])
})

test("weekly activity credits the actual actor and the rate includes only due tasks", () => {
  const items = [task("due-done", "2026-11-22", "2026-11-18T00:00Z"),
    task("due-open", "2026-11-20"), task("undated-done", null, "2026-11-19T00:00Z", "a"),
    task("previous-week", "2026-11-16", "2026-11-15T14:59:00Z")]
  const result = weeklyStats(items, "2026-11-21")
  assert.equal(result.rate, 67)
  assert.deepEqual(result.completed.map(item => item.id), ["undated-done", "due-done"])
  assert.equal(result.byMember.get("a"), 1)
  assert.equal(result.byMember.get("b"), 1)
  assert.equal(weeklyStats([], "2026-11-21").rate, null)
})

test("retry reconciliation matches the full task identity and destination", () => {
  const shared = { ...task("saved", "2026-11-21"), assignee_id: "a" }
  const targets = { created_by: "a", space_id: "space" }
  assert.equal(taskMatchesDraft(shared, shared, targets), true)
  assert.equal(taskMatchesDraft(shared, { ...shared, scope: "personal" }, { ...targets, space_id: null }), false)
  assert.equal(taskMatchesDraft(shared, shared, { ...targets, created_by: "b" }), false)
  assert.equal(taskMatchesDraft(shared, shared, { ...targets, space_id: "other" }), false)
})
