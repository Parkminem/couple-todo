import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { PGlite, type Transaction } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const [a, b, outsider] = [1, 2, 3].map(id => "10000000-0000-4000-8000-00000000000" + id)
const space = "20000000-0000-4000-8000-000000000001"
const shared = "30000000-0000-4000-8000-000000000001"
const endpoint = "https://fcm.googleapis.com/fcm/send/browser:token"
const alternateEndpoint = "https://web.push.apple.com/QaA-GY"
const p256dh = "B" + "A".repeat(86)
const authKey = "A".repeat(22)
const alternateKey = "B" + "A".repeat(21)

async function setup() {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    create schema realtime;
    create table realtime.messages (topic text, extension text, payload jsonb, event text, private boolean);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated;
    grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable
      as $$ select current_setting('realtime.topic', true) $$;
    create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
      returns void language sql as $$ insert into realtime.messages values (topic, 'broadcast', payload, event, private) $$;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  for (const migration of ["20261121000000_couple_todo.sql", "20261121000001_shared_notifications.sql"]) {
    await db.exec(await readFile(new URL("../supabase/migrations/" + migration, import.meta.url), "utf8"))
  }
  for (const [index, id] of [a, b, outsider].entries()) {
    await db.query("insert into auth.users values ($1)", [id])
    await db.query("insert into public.profiles values ($1, $2)", [id, "User " + index])
  }
  await db.query("insert into public.spaces (id, owner_id) values ($1, $2)", [space, a])
  await db.query("insert into public.space_members values ($1, $2, 1), ($1, $3, 2)", [space, a, b])
  await db.exec("truncate realtime.messages")

  function role<T>(role: "authenticated" | "anon" | "service_role", callback: (tx: Transaction) => Promise<T>, user?: string) {
    return db.transaction(async tx => {
      await tx.exec("set local role " + role)
      if (user) await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user])
      return callback(tx)
    })
  }
  function as<Row = unknown>(user: string, q: string, params: unknown[] = []) {
    return role("authenticated", tx => tx.query<Row>(q, params), user)
  }
  async function rpc(user: string, q: string, params: unknown[]) {
    return (await as<{ result: boolean }>(user, `select ${q} as result`, params)).rows[0].result
  }
  function register(user: string, url: string, key = authKey) {
    return rpc(user, "public.register_notification_subscription($1, $2, $3)", [url, p256dh, key])
  }
  function has(user: string, url: string) {
    return rpc(user, "public.has_notification_subscription($1)", [url])
  }
  function unregister(user: string, url: string) {
    return rpc(user, "public.unregister_notification_subscription($1)", [url])
  }
  function createShared(title: string, id = shared) {
    return as(a, "insert into public.tasks (id, title, scope, space_id) values ($1, $2, 'shared', $3)", [id, title, space])
  }
  async function claim() {
    return (await role("service_role", tx => tx.query<{ id: string; claim_token: string; endpoint: string; kind: string; task_title: string }>(
      "select * from public.claim_notification_push_jobs()"
    ))).rows
  }
  async function finish(job: { id: string; claim_token: string }, outcome: string) {
    return (await role("service_role", tx => tx.query<{ result: boolean }>(
      "select public.finish_notification_push_job($1, $2, $3) as result", [job.id, job.claim_token, outcome]
    ))).rows[0].result
  }
  return { db, role, as, rpc, register, has, unregister, createShared, claim, finish }
}

test("shared task notifications use the recipient’s inbox and private realtime topic", async t => {
  const { db, role, as, createShared } = await setup()
  t.after(() => db.close())
  const personal = "30000000-0000-4000-8000-000000000002"
  await as(a, "insert into public.tasks (id, title, scope, assignee_id) values ($1, 'Personal', 'personal', $2)", [personal, a])
  await as(a, "update public.tasks set is_complete = true where id = $1", [personal])
  await as(a, "delete from public.tasks where id = $1", [personal])
  await createShared("Shared")
  await as(a, "update public.tasks set title = 'Renamed' where id = $1", [shared])
  await as(b, "update public.tasks set is_complete = true where id = $1", [shared])
  await as(a, "update public.tasks set is_complete = false where id = $1", [shared])
  await as(a, "update public.tasks set due_on = '2027-01-01' where id = $1", [shared])
  await as(a, "update public.tasks set assignee_id = $2 where id = $1", [shared, b])
  await as(a, "update public.tasks set assignee_id = null, due_on = null where id = $1", [shared])
  await as(b, "delete from public.tasks where id = $1", [shared])

  const inbox = "select recipient_id, kind, change_kind, task_title from public.notifications order by kind, change_kind"
  assert.deepEqual((await as(a, inbox)).rows, [
    { recipient_id: a, kind: "changed", change_kind: "deleted", task_title: "Renamed" },
    { recipient_id: a, kind: "completed", change_kind: null, task_title: "Renamed" },
  ])
  assert.deepEqual((await as(b, inbox)).rows, [
    { recipient_id: b, kind: "added", change_kind: null, task_title: "Shared" },
    { recipient_id: b, kind: "changed", change_kind: "assignee", task_title: "Renamed" },
    { recipient_id: b, kind: "changed", change_kind: "deadline", task_title: "Renamed" },
    { recipient_id: b, kind: "changed", change_kind: "deadline_and_assignee", task_title: "Renamed" },
  ])
  assert.deepEqual((await as(outsider, inbox)).rows, [])
  await assert.rejects(role("anon", tx => tx.query(inbox)), /permission denied/)
  await assert.rejects(as(b, "update public.notifications set task_title = 'Fake'"), /permission denied/)
  await assert.rejects(as(b, "delete from public.notifications"), /permission denied/)

  async function broadcasts(user: string, topic: string) {
    return role("authenticated", async tx => {
      await tx.query("select set_config('realtime.topic', $1, true)", [topic])
      return (await tx.query("select payload, event, private from realtime.messages")).rows
    }, user)
  }
  const signal = { payload: {}, event: "changed", private: true }
  assert.deepEqual(await broadcasts(b, "user:" + b), Array(4).fill(signal))
  assert.deepEqual(await broadcasts(a, "user:" + b), [])
  assert.deepEqual((await as(a, "update public.notifications set read_at = now() where recipient_id = $1 returning id", [b])).rows, [])
  const read = await as<{ read_at: Date }>(b, "update public.notifications set read_at = now() where kind = 'added' returning read_at")
  assert.ok(read.rows[0].read_at)
  assert.deepEqual(await broadcasts(b, "user:" + b), Array(5).fill(signal))
})

test("only the recipient can upsert their notification settings and disable event types", async t => {
  const { db, as, createShared } = await setup()
  t.after(() => db.close())
  const preferenceFields = "task_added, task_completed, task_changed, quiet_enabled, quiet_start, quiet_end"
  const settings = "select " + preferenceFields + " from public.notification_preferences"
  assert.deepEqual((await as(b, settings)).rows, [])
  assert.deepEqual((await as(b, "insert into public.notification_preferences (user_id) values ($1) returning " + preferenceFields, [b])).rows, [
    { task_added: true, task_completed: true, task_changed: true, quiet_enabled: false, quiet_start: "22:00:00", quiet_end: "08:00:00" },
  ])
  assert.deepEqual((await as(a, settings)).rows, [])
  await assert.rejects(as(a, "insert into public.notification_preferences (user_id) values ($1)", [b]), /row-level security/)
  await assert.rejects(as(b, "update public.notification_preferences set user_id = $1", [a]), /row-level security/)
  await assert.rejects(as(b, "update public.notification_preferences set quiet_enabled = true, quiet_end = quiet_start"), /check constraint/)
  await as(b, `
    insert into public.notification_preferences (user_id, task_added, task_completed, task_changed)
    values ($1, false, false, false) on conflict (user_id) do update set user_id = excluded.user_id,
      task_added = excluded.task_added, task_completed = excluded.task_completed, task_changed = excluded.task_changed
  `, [b])
  await createShared("Muted")
  await as(a, "update public.tasks set is_complete = true where id = $1", [shared])
  await as(a, "update public.tasks set due_on = '2027-01-01' where id = $1", [shared])
  await as(a, "delete from public.tasks where id = $1", [shared])
  assert.deepEqual((await as(b, "select * from public.notifications")).rows, [])
})

test("device subscriptions enforce provider allowlists, owner checks, and private keys", async t => {
  const { db, role, as, register, has, unregister } = await setup()
  t.after(() => db.close())
  const rejectedEndpoints = [
    "https://127.0.0.1/notify",
    "https://localhost/notify",
    "http://fcm.googleapis.com/notify",
    "https://fcm.googleapis.com.evil.example/notify",
    "https://fcm.googleapis.com@evil.example/notify",
    "https://fcm.googleapis.com:443/notify",
    "https://web.push.apple.com.evil.example/notify",
    "https://web.push.apple.com\\@evil.example/notify",
    "https://updates.push.services.mozilla.com/notify#fragment",
    "https://fcm.googleapis.com/notify\n",
  ]
  for (const url of rejectedEndpoints) assert.equal(await register(b, url), false, url)
  for (const url of [
    endpoint, alternateEndpoint, "https://web.push.dev.apple.com/test",
    "https://eu01.web.push.apple.com/QaA-GY",
    "https://updates.push.services.mozilla.com/wpush/v2/alpha?beta=gamma",
  ]) assert.equal(await register(b, url), true, url)
  assert.equal(await register(b, endpoint, "short"), false)
  assert.equal(await register(outsider, endpoint, alternateKey), false)
  assert.equal(await unregister(outsider, endpoint), false)
  assert.equal(await has(outsider, endpoint), false)
  assert.equal(await has(b, endpoint), true)
  await assert.rejects(as(b, "select * from private.notification_subscriptions"), /permission denied/)
  await assert.rejects(as(b, "select * from public.claim_notification_push_jobs()"), /permission denied/)
  await assert.rejects(role("anon", tx => tx.query("select public.has_notification_subscription($1)", [endpoint])), /permission denied/)
  assert.equal(await register(outsider, endpoint), true)
  assert.equal(await unregister(b, endpoint), false)
  assert.equal(await has(outsider, endpoint), true)
  assert.equal(await unregister(outsider, endpoint), true)
  assert.equal(await has(outsider, endpoint), false)
})

test("quiet hours preserve the inbox and discard push jobs that enter a muted window", async t => {
  const { db, as, register, createShared, claim } = await setup()
  t.after(() => db.close())
  assert.equal(await register(b, endpoint), true)
  await createShared("Already queued")
  await as(b, `
    insert into public.notification_preferences (user_id, quiet_enabled, quiet_start, quiet_end)
    select $1, true, local_time - interval '30 minutes', local_time + interval '30 minutes'
    from (select (clock_timestamp() at time zone 'Asia/Seoul')::time as local_time) t
  `, [b])
  assert.deepEqual(await claim(), [])
  await as(a, "update public.tasks set due_on = '2027-01-01' where id = $1", [shared])
  assert.deepEqual((await as(b, "select kind, change_kind from public.notifications order by kind, change_kind")).rows, [
    { kind: "added", change_kind: null }, { kind: "changed", change_kind: "deadline" },
  ])
  await as(b, "update public.notification_preferences set quiet_enabled = false")
  assert.deepEqual(await claim(), [])
  await as(a, "update public.tasks set assignee_id = $2 where id = $1", [shared, b])
  assert.equal((await claim()).length, 1)
})

test("quiet intervals include their start and exclude their end across midnight", async t => {
  const { db } = await setup()
  t.after(() => db.close())
  const examples = await db.query(`
    select private.notification_is_quiet(
      row(null, true, true, true, true, start_time::time, end_time::time)::public.notification_preferences,
      local_time::time
    ) as quiet
    from (values
      ('22:00', '08:00', '21:59'),
      ('22:00', '08:00', '22:00'),
      ('22:00', '08:00', '00:00'),
      ('22:00', '08:00', '07:59'),
      ('22:00', '08:00', '08:00'),
      ('13:00', '15:00', '12:59'),
      ('13:00', '15:00', '13:00'),
      ('13:00', '15:00', '15:00')
    ) as intervals(start_time, end_time, local_time)
  `)
  assert.deepEqual(examples.rows, [false, true, true, true, false, false, true, false].map(quiet => ({ quiet })))
})

test("push leases retry with delay and stale delivery cannot remove a reassigned device", async t => {
  const { db, as, register, has, createShared, claim, finish } = await setup()
  t.after(() => db.close())
  assert.equal(await register(b, endpoint), true)
  assert.equal(await register(b, alternateEndpoint), true)
  await createShared("One push per device")
  const original = await claim()
  assert.deepEqual(original.map(job => job.endpoint).sort(), [endpoint, alternateEndpoint].sort())
  assert.ok(original.every(job => job.kind === "added" && job.task_title === "One push per device"))
  assert.deepEqual(await claim(), [])
  const retrying = original.find(job => job.endpoint === endpoint)!
  const delivered = original.find(job => job.endpoint === alternateEndpoint)!
  assert.equal(await finish(retrying, "unknown"), false)
  assert.equal(await finish(retrying, "retry"), true)
  assert.equal(await finish(delivered, "sent"), true)
  assert.deepEqual(await claim(), [])
  await db.query("update private.notification_push_jobs set available_at = now() where id = $1", [retrying.id])
  const [retried] = await claim()
  assert.equal(retried.id, retrying.id)
  assert.notEqual(retried.claim_token, retrying.claim_token)
  assert.equal(await finish(retrying, "expired"), false)
  assert.equal(await register(a, endpoint), true)
  await finish(retried, "expired")
  assert.equal(await has(a, endpoint), true)
  await as(b, "update public.tasks set is_complete = true where id = $1", [shared])
  const [aJob] = await claim()
  assert.equal(aJob.endpoint, endpoint)
  assert.equal(await finish(aJob, "expired"), true)
  assert.equal(await has(a, endpoint), false)
  assert.equal(await has(b, alternateEndpoint), true)
})

test("claiming respects updated type settings and bounds attempts after worker timeouts", async t => {
  const { db, as, register, has, createShared, claim, finish } = await setup()
  t.after(() => db.close())
  assert.equal(await register(b, endpoint), true)
  await createShared("Mute after queueing")
  await as(b, "insert into public.notification_preferences (user_id, task_added) values ($1, false)", [b])
  assert.deepEqual(await claim(), [])
  await as(b, "update public.notification_preferences set task_added = true")
  assert.deepEqual(await claim(), [])

  await as(a, "update public.tasks set is_complete = true where id = $1", [shared])
  for (let attempt = 0; attempt < 5; attempt++) {
    const jobs = await claim()
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].kind, "completed")
    await db.query("update private.notification_push_jobs set available_at = now() where id = $1", [jobs[0].id])
    assert.equal(await finish(jobs[0], "sent"), false)
  }
  assert.deepEqual(await claim(), [])
  assert.deepEqual((await db.query("select id from private.notification_push_jobs")).rows, [])
  assert.equal(await has(b, endpoint), true)
})
