import { Buffer } from "node:buffer"
import { createHmac, timingSafeEqual } from "node:crypto"

export type PushEvent = {
  notification_id: string
  kind: "added" | "completed" | "changed"
  change_kind: "deadline" | "assignee" | "deadline_and_assignee" | "deleted" | null
  task_title: string
}

const actions = {
  added: "할 일을 추가했어요",
  completed: "할 일을 완료했어요",
  deadline: "마감일을 바꿨어요",
  assignee: "담당자를 바꿨어요",
  deadline_and_assignee: "마감일과 담당자를 바꿨어요",
  deleted: "할 일을 삭제했어요",
  changed: "할 일을 변경했어요",
}

export function notificationPayload(event: PushEvent) {
  const action = actions[event.change_kind ?? event.kind]

  return {
    title: "우리의 할 일",
    body: `상대가 ‘${event.task_title}’ ${action}.`,
    tag: `notification:${event.notification_id}`,
  }
}

export function isPushEndpoint(endpoint: string) {
  if (!/^https:\/\/[a-z0-9.-]+\/[\x21-\x7e]+$/i.test(endpoint) || /[#\\]/.test(endpoint)) {
    return false
  }

  const url = URL.parse(endpoint)
  if (!url || url.pathname === "/") return false

  const host = url.hostname
  return host.endsWith(".push.apple.com") || host === "web.push.dev.apple.com" ||
    host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com"
}

export function pushOutcome(status: number, reason?: unknown) {
  if (status >= 200 && status < 300) return "sent"
  if (status === 404 || status === 410 || (status === 400 && reason === "BadWebPushToken")) return "expired"
  if (status === 408 || status === 429 || status >= 500) return "retry"
  return "failed"
}

export function validDispatchSignature(header: string, key: string, now = Date.now()) {
  const parts = /^(\d{10})\.([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(header)
  if (!parts) return false

  const [, timestamp, nonce, signature] = parts
  const age = Math.floor(now / 1_000) - Number(timestamp)
  if (age < -5 || age > 60) return false

  const expected = createHmac("sha256", key).update(`${timestamp}.${nonce}`).digest()
  return timingSafeEqual(expected, Buffer.from(signature, "hex"))
}
