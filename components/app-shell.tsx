"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarDays, ChartNoAxesColumnIncreasing, House, UsersRound, WifiOff } from "lucide-react"
import { useState, type FormEvent, type ReactNode } from "react"
import { useApp } from "./app-provider"
import { BrandMark } from "./ui"

const navigation = [
  { path: "/", title: "투두", icon: House },
  { path: "/calendar", title: "캘린더", icon: CalendarDays },
  { path: "/stats", title: "통계", icon: ChartNoAxesColumnIncreasing },
  { path: "/us", title: "우리", icon: UsersRound },
]

export function NameForm({ afterSave }: { afterSave?: () => void }) {
  const { online, snapshot, saveName } = useApp()
  const [name, setName] = useState(snapshot.profile.display_name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online || !name.trim() || busy) return
    setError("")
    setBusy(true)
    try {
      await saveName(name.trim())
      afterSave?.()
    } catch {
      setError("이름을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.")
    } finally { setBusy(false) }
  }
  return (
    <form className="field-stack" onSubmit={submit}>
      <label className="field-label">표시 이름
        <input className="field" name="name" required maxLength={20} value={name} onChange={event => setName(event.target.value)} autoComplete="nickname" />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy || !online || !name.trim()}>{busy ? "저장 중…" : "저장하기"}</button>
    </form>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname()
  const { online, syncing, refresh, snapshot } = useApp()
  return (
    <div className="app-frame">
      <main className="app-content" id="main">
        {(!online || syncing) && (
          <div className="connection" role="status">
            <WifiOff aria-hidden="true" size={17} />
            {online ? "변경 사항을 다시 연결하고 있어요." : "오프라인 · 이전 목록을 표시하고 있어요."}
            {online && <button onClick={() => void refresh().catch(() => {})} className="text-button">새로 고침</button>}
          </div>
        )}
        {snapshot.profile.display_name ? children : (
          <section className="setup">
            <BrandMark />
            <h1>우리의 할 일</h1>
            <p className="muted">상대에게 보일 이름을 정해 주세요.</p>
            <NameForm />
          </section>
        )}
      </main>
      <nav aria-label="하단 메뉴" className="bottom-nav">
        {navigation.map(({ path: href, title, icon: Icon }) => (
          <Link href={href} key={href} aria-current={path === href ? "page" : path === "/notifications" && href === "/us" ? "location" : undefined}
            aria-disabled={!online && path !== href ? true : undefined}
            onClick={event => { if (!online && path !== href) event.preventDefault() }}>
            <Icon size={25} strokeWidth={2.2} aria-hidden="true" />
            <span>{title}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
