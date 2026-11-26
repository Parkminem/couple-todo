import assert from "node:assert/strict"
import { test } from "node:test"
import { queueSubscription } from "../lib/supabase/subscription.ts"

test("a channel's replacement starts after the previous unsubscribe completes", async () => {
  const activities: string[] = []
  let finishLeaving!: () => void
  const leaving = new Promise<void>(resolve => { finishLeaving = resolve })
  const stopOld = queueSubscription(Promise.resolve(), () => {
    activities.push("join first")
    return async () => {
      activities.push("leave first")
      await leaving
    }
  })
  await Promise.resolve()
  const drained = stopOld()
  const stopNew = queueSubscription(drained, () => {
    activities.push("join second")
    return async () => { activities.push("leave second") }
  })
  await Promise.resolve()
  assert.deepEqual(activities, ["join first", "leave first"])
  finishLeaving()
  await drained
  await Promise.resolve()
  assert.deepEqual(activities, ["join first", "leave first", "join second"])
  await stopNew()
  assert.equal(activities.at(-1), "leave second")
})
