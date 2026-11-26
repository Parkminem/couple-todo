import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import {
  isPushEndpoint,
  notificationPayload,
  pushOutcome,
  validDispatchSignature,
} from "../supabase/functions/dispatch-notifications/notification.ts"

test("push delivery accepts only HTTPS endpoints on supported providers", () => {
  for (const endpoint of [
    "https://web.push.apple.com/abc",
    "https://web.push.dev.apple.com/abc",
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
  ]) assert.equal(isPushEndpoint(endpoint), true, endpoint)

  for (const endpoint of [
    "http://web.push.apple.com/abc",
    "https://web.push.apple.com.evil.example/abc",
    "https://web.push.apple.com@127.0.0.1/abc",
    "https://user@web.push.apple.com/abc",
    "https://web.push.apple.com:8080/abc",
    "https://fcm.googleapis.com/abc#fragment",
    "https://web.push.apple.com/",
    "not a URL",
  ]) assert.equal(isPushEndpoint(endpoint), false, endpoint)
})

test("dispatch rejects stale and tampered requests without sharing the signing key", () => {
  const timestamp = 1_800_000_000
  const nonce = "326be732-1084-4f05-a2b3-69507bf6ef2a"
  const key = "test-signing-key"
  const message = `${timestamp}.${nonce}`
  const signature = createHmac("sha256", key).update(message).digest("hex")
  const header = `${message}.${signature}`

  assert.equal(validDispatchSignature(header, key, timestamp * 1_000), true)
  assert.equal(validDispatchSignature(header, key, (timestamp + 61) * 1_000), false)
  assert.equal(validDispatchSignature(header, key, (timestamp - 6) * 1_000), false)
  assert.equal(validDispatchSignature(`${timestamp + 1}.${nonce}.${signature}`, key, timestamp * 1_000), false)
  assert.equal(validDispatchSignature(key, key, timestamp * 1_000), false)
})

test("only expired subscriptions are revoked and temporary failures are retried", () => {
  assert.equal(pushOutcome(201), "sent")
  for (const status of [404, 410]) assert.equal(pushOutcome(status), "expired")
  assert.equal(pushOutcome(400, "BadWebPushToken"), "expired")
  assert.equal(pushOutcome(400, "BadWebPushRequest"), "failed")
  for (const status of [408, 429, 500, 503]) assert.equal(pushOutcome(status), "retry")
  for (const status of [302, 400, 401, 403, 413]) assert.equal(pushOutcome(status), "failed")
})

test("push describes the partner action and uses the inbox event as its deduplication tag", () => {
  const event = { notification_id: "abc", task_title: "주말 장보기" }
  const cases = [
    ["added", null, "추가했어요"],
    ["completed", null, "완료했어요"],
    ["changed", "deadline", "마감일을 바꿨어요"],
    ["changed", "assignee", "담당자를 바꿨어요"],
    ["changed", "deadline_and_assignee", "마감일과 담당자를 바꿨어요"],
    ["changed", "deleted", "삭제했어요"],
  ] as const

  for (const [kind, change_kind, action] of cases) {
    const payload = notificationPayload({ ...event, kind, change_kind })
    assert.equal(payload.title, "우리의 할 일")
    assert.equal(payload.tag, "notification:abc")
    assert.match(payload.body, /주말 장보기/)
    assert.ok(payload.body.includes(action))
  }
})
