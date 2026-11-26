import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { seoulDate } from "../../lib/tasks"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const adminKey = process.env.COUPLE_TEST_SUPABASE_SECRET_KEY
const mailpit = "http://127.0.0.1:54324"

async function logIn(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/")
  await page.getByRole("textbox", { name: "이메일" }).fill(email)
  await page.getByRole("button", { name: "인증번호 받기" }).click()
  await expect(page.getByRole("textbox", { name: "인증번호" })).toBeVisible()
  let code = ""
  await expect.poll(async () => {
    const response = await request.get(mailpit + "/view/latest.html", { params: { query: "to:" + email } })
    if (response.ok()) code = (await response.text()).match(/<strong>([0-9]{6})<\/strong>/)?.[1] ?? ""
    return code
  }, { timeout: 12_000 }).toMatch(/^\d{6}$/)
  await page.getByRole("textbox", { name: "인증번호" }).fill(code)
  await page.getByRole("button", { name: "로그인", exact: true }).click()
}

test("two provisioned accounts pair through OTP, share live updates and keep personal tasks private", async ({ page, browser, request, baseURL }) => {
  test.setTimeout(65_000)
  if (!url || !adminKey || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "54321") {
    throw new Error("This test requires a fresh local Supabase project at 127.0.0.1:54321 and its local admin key.")
  }
  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const emails = [crypto.randomUUID() + "@example.test", crypto.randomUUID() + "@example.test"]
  for (const email of emails) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (error) throw error
  }
  const accountB = await browser.newContext({ baseURL, locale: "ko-KR", timezoneId: "Asia/Seoul" })
  const other = await accountB.newPage()
  await Promise.all([logIn(page, request, emails[0]), logIn(other, request, emails[1])])
  for (const [session, name] of [[page, "민혁"], [other, "수현"]] as const) {
    await session.getByRole("textbox", { name: "표시 이름" }).fill(name)
    await session.getByRole("button", { name: "저장하기" }).click()
    await session.getByRole("link", { name: "우리", exact: true }).click()
  }
  await page.getByRole("button", { name: "공유 공간 만들기" }).click()
  await page.getByRole("button", { name: "초대 코드 발급" }).click()
  const code = await page.locator("output").innerText()
  await other.getByRole("textbox", { name: "초대 코드" }).fill(code)
  await other.getByRole("button", { name: "연결하기" }).click()
  await expect(page.getByText("연결 완료")).toBeVisible({ timeout: 8000 })
  for (const session of [page, other]) await session.getByRole("link", { name: "투두", exact: true }).click()

  async function add(session: Page, title: string) {
    await session.getByRole("button", { name: "할 일 추가" }).click()
    await session.getByRole("textbox", { name: "할 일 제목" }).fill(title)
    await session.getByRole("button", { name: "추가하기" }).click()
  }
  await add(page, "공유 책 주문")
  const otherTask = other.getByRole("checkbox", { name: "공유 책 주문 완료" })
  await expect(otherTask).toBeVisible({ timeout: 8000 })
  await otherTask.click()
  await expect(page.getByRole("checkbox", { name: "공유 책 주문 완료" })).toBeChecked({ timeout: 8000 })

  await page.getByRole("button", { name: "내 할 일" }).click()
  await add(page, "개인 기록")
  await expect(page.getByRole("button", { name: "개인 기록 상세" })).toBeVisible()
  await other.getByRole("button", { name: "내 할 일" }).click()
  await expect(other.getByText("개인 기록", { exact: true })).toHaveCount(0)
  await other.reload()
  await expect(other.getByRole("heading", { name: "우리의 할 일" })).toBeVisible()
  await accountB.close()
})

async function testProfile(context: BrowserContext, baseURL: string | undefined, displayName: string) {
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const preview = process.env.COUPLE_TEST_PREVIEW_URL
  if (!baseURL || !url || !adminKey || !publicKey || (url !== "http://127.0.0.1:54321" && url !== preview)) {
    throw new Error("This test requires a local or explicitly selected Preview Supabase project.")
  }
  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `${crypto.randomUUID()}@example.test`
  const created = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (created.error) throw created.error
  const userId = created.data.user.id
  const cookies = new Map<string, string>()
  const client = createServerClient(url, publicKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)),
    },
  })
  async function cleanup() {
    const cleaned = await admin.auth.admin.deleteUser(userId)
    if (cleaned.error) throw cleaned.error
  }

  try {
    const link = await admin.auth.admin.generateLink({ email, type: "magiclink" })
    if (link.error) throw link.error
    const session = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" })
    if (session.error) throw session.error
    const profile = await client.from("profiles").insert({ display_name: displayName })
    if (profile.error) throw profile.error
    await context.addCookies([...cookies].map(([name, value]) => ({ name, value, url: baseURL })))
    return { client, userId, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

test("completion changes immediately and restores the saved state on failure", async ({ page, context, baseURL }) => {
  const { client, userId, cleanup } = await testProfile(context, baseURL, "속도 테스트")
  const taskId = crypto.randomUUID()
  const tasksPath = `${url}/rest/v1/tasks?*`
  try {
    const title = "즉시 완료 테스트"
    const due_on = seoulDate()
    const insert = await client.from("tasks").insert({ id: taskId, title, scope: "personal", assignee_id: userId, due_on })
    if (insert.error) throw insert.error
    await page.goto("/")
    await page.getByRole("button", { name: "내 할 일" }).click()
    const checkbox = page.getByRole("checkbox", { name: `${title} 완료` })
    const today = page.getByRole("region", { name: /^오늘의 할 일/ })
    const done = page.getByRole("region", { name: /^완료/ })
    const progress = page.getByRole("progressbar", { name: "오늘의 완료율" })
    await expect(checkbox).not.toBeChecked()

    async function toggleWhileResponseIsHeld(checked: boolean, fail: boolean) {
      const request = Promise.withResolvers<void>()
      const response = Promise.withResolvers<void>()
      await page.route(tasksPath, async route => {
        if (route.request().method() !== "PATCH") return route.fallback()
        request.resolve()
        await response.promise
        if (fail) {
          await route.fulfill({ status: 400, json: { code: "23514", message: "Test write failure" } })
        } else {
          await route.continue()
        }
      })
      try {
        await checkbox.click()
        await request.promise
        await expect(checkbox).toBeChecked({ checked, timeout: 1500 })
        await expect((checked ? done : today).getByRole("checkbox", { name: `${title} 완료` })).toBeVisible()
        await expect(checkbox).toBeDisabled()
        await expect(progress).toHaveJSProperty("value", Number(checked))
        const refresh = page.waitForResponse(result => result.request().method() === "GET" && result.url().startsWith(`${url}/rest/v1/tasks?`))
        await page.evaluate(() => window.dispatchEvent(new Event("online")))
        await refresh
        await expect(checkbox).toBeChecked({ checked })
      } finally {
        response.resolve()
        await page.unrouteAll({ behavior: "wait" })
      }
    }

    await toggleWhileResponseIsHeld(true, true)
    await expect(today.getByRole("checkbox", { name: `${title} 완료` })).not.toBeChecked()
    await expect(today.getByText("완료 상태를 저장하지 못했어요.")).toBeVisible()
    await expect(checkbox).toBeEnabled()
    await toggleWhileResponseIsHeld(true, false)
    await expect(checkbox).toBeEnabled()
    await expect(checkbox).toBeChecked()
    await toggleWhileResponseIsHeld(false, true)
    await expect(checkbox).toBeChecked()
    await expect(done.getByRole("checkbox", { name: `${title} 완료` })).toBeVisible()
    await expect(progress).toHaveJSProperty("value", 1)
    await expect(page.getByText("완료 상태를 저장하지 못했어요.")).toBeVisible()
    await expect(checkbox).toBeEnabled()
    const saved = await client.from("tasks").select("is_complete").eq("id", taskId).single()
    expect(saved.data?.is_complete).toBe(true)
  } finally {
    await client.from("tasks").delete().eq("id", taskId)
    await cleanup()
  }
})

test("a saved profile photo survives reload and appears on an assigned task", async ({ page, context, baseURL, request }) => {
  const { client, userId, cleanup } = await testProfile(context, baseURL, "사진 테스트")
  const taskId = crypto.randomUUID()
  try {
    const title = "프로필 사진 테스트"
    const task = await client.from("tasks").insert({
      id: taskId, title, scope: "personal", assignee_id: userId, due_on: seoulDate(),
    })
    if (task.error) throw task.error

    await page.goto("/us")
    await page.getByRole("button", { name: "프로필 사진 편집" }).click()
    const picker = page.getByRole("dialog").locator('input[type="file"]')
    const image = await page.evaluate(() => {
      const canvas = document.createElement("canvas")
      canvas.width = 1024
      canvas.height = 900
      const paint = canvas.getContext("2d")!
      const fill = paint.createLinearGradient(0, 0, 1024, 900)
      fill.addColorStop(0, "#1b0b35")
      fill.addColorStop(1, "#e3c6ff")
      paint.fillStyle = fill
      paint.fillRect(0, 0, 1024, 900)
      return canvas.toDataURL("image/png").split(",")[1]
    })
    await picker.setInputFiles({ name: "profile-fixture.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") })
    await page.getByRole("dialog").getByRole("button", { name: "저장하기" }).click()
    await expect(page.getByRole("dialog")).toBeHidden()

    const saved = await client.from("profile_photos").select("version").eq("profile_id", userId).single()
    if (saved.error) throw saved.error
    const path = `/profile-photo/${userId}?v=${saved.data.version}`
    const owned = await context.request.get(path)
    expect(owned.status()).toBe(200)
    expect(owned.headers()["content-type"]).toBe("image/jpeg")
    expect(owned.headers()["cache-control"]).toBe("private, no-store")
    const thumbnail = await owned.body()
    expect(thumbnail.subarray(0, 3).toString("hex")).toBe("ffd8ff")
    expect((await request.get(path)).status()).toBe(404)

    const browserPhoto = page.waitForResponse(response => response.url().endsWith(path))
    await page.reload()
    const shown = await browserPhoto
    expect(shown.status()).toBe(200)
    const avatar = page.locator(".pair-people img")
    await expect(avatar).toBeVisible()
    await expect(avatar).toHaveJSProperty("src", new URL(path, page.url()).href)
    await expect(avatar).toHaveJSProperty("naturalWidth", 192)
    await page.getByRole("button", { name: "사진 테스트 (나) 프로필 사진 크게 보기" }).click()
    const preview = page.getByRole("dialog", { name: "사진 테스트" })
    await expect(preview.locator("img")).toHaveJSProperty("src", new URL(path + "&size=full", page.url()).href)
    await expect(preview.locator("img")).toHaveJSProperty("naturalWidth", 768)
    expect((await request.get(path + "&size=full")).status()).toBe(404)
    await preview.getByRole("button", { name: "닫기" }).click()

    await page.getByRole("link", { name: "투두", exact: true }).click()
    await page.getByRole("button", { name: "내 할 일" }).click()
    const card = page.locator(".task-card").filter({ hasText: title })
    const taskAvatar = card.locator("img")
    await expect(taskAvatar).toHaveJSProperty("src", new URL(path, page.url()).href)
    await expect(taskAvatar).toHaveJSProperty("naturalWidth", 192)
    await card.getByRole("button", { name: "나 프로필 사진 크게 보기" }).click()
    await expect(preview.locator("img")).toHaveJSProperty("naturalWidth", 768)
    await preview.getByRole("button", { name: "닫기" }).click()

    await page.getByRole("link", { name: "우리", exact: true }).click()
    await page.getByRole("button", { name: "프로필 사진 편집" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "기본 이미지 사용" }).click()
    await expect(page.getByRole("dialog")).toBeHidden()
    expect((await context.request.get(path)).status()).toBe(404)
    await page.reload()
    await expect(avatar).toHaveCount(0)

    const legacy = await client.rpc("set_profile_photo", { photo: thumbnail.toString("base64") })
    if (legacy.error) throw legacy.error
    const legacyFull = await context.request.get(`/profile-photo/${userId}?v=${legacy.data}&size=full`)
    expect(legacyFull.status()).toBe(200)
    expect(await legacyFull.body()).toEqual(thumbnail)
  } finally {
    await client.from("tasks").delete().eq("id", taskId)
    await cleanup()
  }
})
