// @deno-types="npm:@types/web-push@3.6.4"
import webPush from "web-push"
import {
  isPushEndpoint,
  notificationPayload,
  type PushEvent,
  pushOutcome,
  validDispatchSignature,
} from "./notification.ts"

type PushJob = PushEvent & {
  id: string
  claim_token: string
  endpoint: string
  p256dh: string
  auth_key: string
}

type VapidDetails = webPush.VapidKeys & { subject: string }

const projectUrl = Deno.env.get("SUPABASE_URL")
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const dispatchKey = Deno.env.get("NOTIFICATION_DISPATCH_KEY")
const vapidSubject = Deno.env.get("NOTIFICATION_VAPID_SUBJECT")
const vapidPublicKey = Deno.env.get("NOTIFICATION_VAPID_PUBLIC_KEY")
const vapidPrivateKey = Deno.env.get("NOTIFICATION_VAPID_PRIVATE_KEY")

async function rpc<T>(credentials: { projectUrl: string; serviceKey: string }, name: string, body: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${credentials.projectUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: credentials.serviceKey,
      Authorization: `Bearer ${credentials.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Database request failed (${response.status})`)
  }
  return response.json()
}

async function deliver(job: PushJob, vapidDetails: VapidDetails) {
  if (!isPushEndpoint(job.endpoint)) return { outcome: "failed" }

  let request: webPush.RequestDetails
  try {
    request = webPush.generateRequestDetails(
      { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth_key } },
      JSON.stringify(notificationPayload(job)),
      { vapidDetails, TTL: 120, topic: job.notification_id.replaceAll("-", "") },
    )
  } catch {
    return { outcome: "failed" }
  }

  try {
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers: new Headers(Object.entries(request.headers).map(([key, value]) => [key, String(value)])),
      body: request.body ? Uint8Array.from(request.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    })
    const reason: unknown = response.status === 400
      ? (await response.json().catch(() => null))?.reason
      : undefined
    if (!response.bodyUsed) await response.body?.cancel().catch(() => {})
    return { outcome: pushOutcome(response.status, reason), status: response.status }
  } catch {
    return { outcome: "retry" }
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } })
  if (!dispatchKey || !validDispatchSignature(request.headers.get("x-notification-signature") ?? "", dispatchKey)) {
    return new Response(null, { status: 401 })
  }
  if (!projectUrl || !serviceKey || !vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    return new Response(null, { status: 503 })
  }

  try {
    const credentials = { projectUrl, serviceKey }
    const jobs = await rpc<PushJob[]>(credentials, "claim_notification_push_jobs")
    const vapidDetails = { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey }
    let finalized = 0
    const providerStatuses: Record<number, number> = {}

    for (let index = 0; index < jobs.length; index += 5) {
      const results = await Promise.allSettled(jobs.slice(index, index + 5).map(async (job) => {
        const { outcome, status } = await deliver(job, vapidDetails)
        if (status) providerStatuses[status] = (providerStatuses[status] ?? 0) + 1
        return rpc<boolean>(credentials, "finish_notification_push_job", {
          job_id: job.id, lease_token: job.claim_token, outcome,
        })
      }))
      finalized += results.filter((result) => result.status === "fulfilled" && result.value).length
    }

    if (finalized !== jobs.length) console.error("Push job finalization failed", jobs.length - finalized)
    return Response.json({ claimed: jobs.length, finalized, providerStatuses }, { status: finalized === jobs.length ? 200 : 502 })
  } catch {
    console.error("Push dispatch could not claim jobs")
    return new Response(null, { status: 502 })
  }
})
