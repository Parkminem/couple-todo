import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { PGlite, type Transaction } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const [a, b, outsider] = [1, 2, 3].map(id => "10000000-0000-4000-8000-00000000000" + id)
const personal = "20000000-0000-4000-8000-000000000001"
const shared = "20000000-0000-4000-8000-000000000002"
const migrations = ["20261121000000_couple_todo.sql", "20261121071721_profile_photos.sql", "20261123083543_high_resolution_profile_photos.sql"]

test("database enforces private lists, one-use invites, state history and broadcast isolation", async t => {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  try {
    // Only Supabase platform-owned objects are simulated. App SQL, triggers,
    // grants, checks and RLS run on Postgres.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
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
    for (const migration of migrations) {
      await db.exec(await readFile(new URL("../supabase/migrations/" + migration, import.meta.url), "utf8"))
    }
    for (const id of [a, b, outsider]) await db.query("insert into auth.users values ($1)", [id])
    function asRole<T>(role: "authenticated" | "anon" | "service_role", callback: (tx: Transaction) => Promise<T>, id?: string) {
      return db.transaction(async tx => {
        await tx.exec("set local role " + role)
        if (id) await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [id])
        return callback(tx)
      })
    }
    function as<T>(id: string, callback: (tx: Transaction) => Promise<T>) {
      return asRole("authenticated", callback, id)
    }
    for (const [index, id] of [a, b, outsider].entries()) {
      const row = await as(id, tx => tx.query<{ id: string }>("insert into public.profiles (display_name) values ($1) returning id", ["Member " + index]))
      assert.equal(row.rows[0].id, id)
    }
    await assert.rejects(db.transaction(async tx => {
      await tx.exec("set local role anon")
      await tx.query("select * from public.tasks")
    }), /permission denied/)
    assert.equal((await as(a, tx => tx.query<{ success: boolean }>("select public.create_space() as success"))).rows[0].success, true)
    assert.equal((await as(b, tx => tx.query<{ success: boolean }>("select public.create_space() as success"))).rows[0].success, false)
    assert.equal((await as(b, tx => tx.query<{ invite: null }>("select public.issue_invite() as invite"))).rows[0].invite, null)

    async function invite() {
      const result = await as(a, tx => tx.query<{ invite: { code: string } }>("select public.issue_invite() as invite"))
      return result.rows[0].invite.code
    }
    async function join(id: string, code: string) {
      return (await as(id, tx => tx.query<{ result: string }>("select public.join_space($1) as result", [code]))).rows[0].result
    }

    const old = await invite()
    await db.exec("update private.invitations set expires_at = now() - interval '1 minute'")
    assert.equal(await join(b, old), "invalid")
    const revoked = await invite()
    assert.equal((await as(a, tx => tx.query<{ result: boolean }>("select public.revoke_invite() as result"))).rows[0].result, true)
    assert.equal(await join(b, revoked), "invalid")
    const current = await invite()
    assert.match(current, /^[A-F0-9]{4}(-[A-F0-9]{4}){3}$/)
    assert.equal(await join(b, old), "invalid")
    for (let trial = 0; trial < 5; trial++) assert.equal(await join(outsider, "bad"), "invalid")
    assert.equal(await join(outsider, current), "rate_limited")
    assert.equal(await join(b, current.toLowerCase()), "joined")
    assert.equal(await join(b, current), "already_joined")
    assert.equal(await join(outsider, current), "rate_limited")
    assert.equal((await as(a, tx => tx.query<{ invite: null }>("select public.issue_invite() as invite"))).rows[0].invite, null)
    const spaceId = (await as(a, tx => tx.query<{ id: string }>("select id from public.spaces"))).rows[0].id
    assert.equal((await as(outsider, tx => tx.query<{ id: string }>("select id from public.spaces"))).rows.length, 0)
    await as(a, tx => tx.query("insert into public.tasks (id, title, scope, assignee_id) values ($1,'Private','personal',$2)", [personal, a]))
    await as(a, tx => tx.query("insert into public.tasks (id, title, scope, space_id) values ($1,'Shared','shared',$2)", [shared, spaceId]))
    await assert.rejects(as(b, tx => tx.query("update public.tasks set assignee_id=$1 where id=$2", [outsider, shared])), /foreign key/)
    await assert.rejects(as(a, tx => tx.query("update public.tasks set scope='shared' where id=$1", [personal])), /permission denied/)
    assert.deepEqual((await as(b, tx => tx.query<{ title: string }>("select title from public.tasks"))).rows.map(row => row.title), ["Shared"])
    assert.equal((await as(outsider, tx => tx.query("select id from public.tasks"))).rows.length, 0)

    await as(a, tx => tx.query("update public.tasks set is_complete=true where id=$1 and version=1", [personal]))
    await as(b, tx => tx.query("update public.tasks set is_complete=true where id=$1 and version=1", [shared]))
    const stale = await as(a, tx => tx.query("update public.tasks set title='Stale' where id=$1 and version=1 returning id", [shared]))
    assert.equal(stale.rows.length, 0)
    await as(a, tx => tx.query("update public.tasks set is_complete=false where id=$1 and version=2", [shared]))
    const events = await as(b, tx => tx.query("select actor_id, completed from public.task_completion_events order by id"))
    assert.deepEqual(events.rows, [{ actor_id: b, completed: true }, { actor_id: a, completed: false }])
    await assert.rejects(as(b, tx => tx.query("insert into public.task_completion_events (task_id, actor_id, completed) values ($1,$2,true)", [shared, a])), /permission denied/)

    async function listen(id: string, topic: string) {
      return as(id, async tx => {
        await tx.query("select set_config('realtime.topic', $1, true)", [topic])
        return (await tx.query("select distinct topic, payload from realtime.messages")).rows
      })
    }
    assert.deepEqual(await listen(b, "user:" + a), [])
    assert.deepEqual(await listen(outsider, "space:" + spaceId), [])
    assert.deepEqual(await listen(b, "space:" + spaceId), [{ topic: "space:" + spaceId, payload: {} }])
    await as(b, tx => tx.query("delete from public.tasks where id=$1 and version=3", [shared]))
    assert.equal((await as(b, tx => tx.query("select id from public.task_completion_events"))).rows.length, 0)

    await t.test("profile photo mutations are private, validated, and invalidate both viewers", async () => {
      function jpegWithMarkers(size: number, value = 0) {
        const bytes = Buffer.alloc(size, value)
        bytes.writeUInt16BE(0xffd8)
        bytes.writeUInt16BE(0xffd9, size - 2)
        return bytes.toString("base64")
      }
      const jpeg = jpegWithMarkers(64)
      const replacementJpeg = jpegWithMarkers(65536, 1)
      const highResolution = jpegWithMarkers(786432, 2)
      const photoQuery = "select profile_id, version, jpeg from public.profile_photos where profile_id = $1"
      const profileQuery = "select photo_version from public.profiles where id = $1"
      const update = "select public.set_profile_photo(photo => $1) as version"
      async function setPhoto(id: string, value: string | null) {
        return (await as(id, tx => tx.query<{ version: string | null }>(update, [value]))).rows[0].version
      }
      const updateBoth = "select public.set_profile_photo(photo => $1, full_photo => $2) as version"
      async function setPhotoVariants(id: string, small: string | null, large: string | null) {
        return (await as(id, tx => tx.query<{ version: string | null }>(updateBoth, [small, large]))).rows[0].version
      }
      await db.exec("truncate realtime.messages")
      assert.deepEqual((await as(a, tx => tx.query(profileQuery, [a]))).rows, [{ photo_version: null }])
      const version = await setPhoto(a, jpeg)
      assert.ok(version, "saving a photo returns its version")
      const stored = [{ profile_id: a, version, jpeg }]
      for (const viewer of [a, b]) {
        assert.deepEqual((await as(viewer, tx => tx.query(photoQuery, [a]))).rows, stored)
        assert.deepEqual((await as(viewer, tx => tx.query(profileQuery, [a]))).rows, [{ photo_version: version }])
      }
      assert.deepEqual((await as(outsider, tx => tx.query(photoQuery, [a]))).rows, [])
      assert.deepEqual((await as(outsider, tx => tx.query(profileQuery, [a]))).rows, [])
      assert.deepEqual(await listen(a, "user:" + a), [{ topic: "user:" + a, payload: {} }])
      assert.deepEqual(await listen(b, "space:" + spaceId), [{ topic: "space:" + spaceId, payload: {} }])
      assert.deepEqual(await listen(outsider, "space:" + spaceId), [])
      assert.deepEqual((await db.query("select distinct event, private from realtime.messages")).rows, [{ event: "changed", private: true }])

      for (const role of ["anon", "service_role"] as const) {
        await assert.rejects(asRole(role, tx => tx.query(photoQuery, [a])), { code: "42501" })
        await assert.rejects(asRole(role, tx => tx.query(update, [jpeg]), a), { code: "42501" })
      }
      await assert.rejects(asRole("authenticated", tx => tx.query(update, [jpeg])), { code: "42501" })
      for (const role of ["authenticated", "service_role"] as const) {
        await assert.rejects(asRole(role, tx => tx.query(
          "insert into public.profile_photos (profile_id, version, jpeg) values ($1, $2, $3)", [b, version, jpeg]
        ), b), { code: "42501" })
        await assert.rejects(asRole(role, tx => tx.query("update public.profile_photos set jpeg = $1", [replacementJpeg]), a), { code: "42501" })
        await assert.rejects(asRole(role, tx => tx.query("delete from public.profile_photos"), a), { code: "42501" })
        await assert.rejects(asRole(role, tx => tx.query("update public.profiles set photo_version = null where id = $1", [a]), a), { code: "42501" })
        await assert.rejects(asRole(role, tx => tx.query(
          "insert into public.profiles (display_name, photo_version) values ('Spoof', $1)", [version]
        ), a), { code: "42501" })
      }

      await db.exec("truncate realtime.messages")
      const bytes = Buffer.from(jpeg, "base64")
      const badJpegs = [
        "", "%%%", jpeg.replace(/==$/, ""), `${jpeg}\n`,
        bytes.subarray(1).toString("base64"), bytes.subarray(0, -1).toString("base64"), jpegWithMarkers(65537),
      ]
      for (const invalid of badJpegs) await assert.rejects(setPhoto(a, invalid), { code: "23514" })
      assert.deepEqual((await as(b, tx => tx.query(photoQuery, [a]))).rows, stored)
      assert.deepEqual((await as(b, tx => tx.query(profileQuery, [a]))).rows, [{ photo_version: version }])
      assert.deepEqual(await listen(b, "space:" + spaceId), [])

      const replacement = await setPhotoVariants(a, replacementJpeg, highResolution)
      assert.ok(replacement)
      assert.notEqual(replacement, version)
      const largeSize = "select octet_length(decode(full_jpeg, 'base64')) as bytes from public.profile_photos where profile_id = $1"
      assert.deepEqual((await as(b, tx => tx.query(largeSize, [a]))).rows, [{ bytes: 786432 }])
      assert.deepEqual((await as(outsider, tx => tx.query(largeSize, [a]))).rows, [])
      await assert.rejects(asRole("anon", tx => tx.query(updateBoth, [jpeg, highResolution]), a), { code: "42501" })
      await assert.rejects(setPhotoVariants(a, jpeg, jpegWithMarkers(786433)), { code: "23514" })
      await assert.rejects(setPhotoVariants(a, jpeg, "%%%"), { code: "23514" })
      await assert.rejects(setPhotoVariants(a, null, highResolution), { code: "23514" })
      assert.deepEqual((await as(b, tx => tx.query(photoQuery, [a]))).rows, [{ profile_id: a, version: replacement, jpeg: replacementJpeg }])
      assert.deepEqual((await as(b, tx => tx.query(profileQuery, [a]))).rows, [{ photo_version: replacement }])
      assert.equal(await setPhoto(b, null), null)
      assert.equal((await as(b, tx => tx.query(photoQuery, [a]))).rows.length, 1)
      await db.exec("truncate realtime.messages")
      assert.equal(await setPhotoVariants(a, null, null), null)
      assert.deepEqual((await as(b, tx => tx.query(photoQuery, [a]))).rows, [])
      assert.deepEqual((await as(b, tx => tx.query(profileQuery, [a]))).rows, [{ photo_version: null }])
      assert.deepEqual(await listen(b, "space:" + spaceId), [{ topic: "space:" + spaceId, payload: {} }])
    })
  } finally {
    await db.close()
  }
})
