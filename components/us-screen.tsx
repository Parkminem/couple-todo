"use client"

import Link from "next/link"
import { Bell, Check, ChevronRight, Copy, HeartHandshake, ImagePlus, Share2, UserRound } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { useApp } from "./app-provider"
import { NameForm } from "./app-shell"
import { ProfileAvatar, ProfilePhotoButton, ProfilePhotoPreview } from "./profile-avatar"
import { ProfilePhotoSheet } from "./profile-photo-sheet"
import { DateText, Sheet } from "./ui"
import { seoulDate } from "@/lib/tasks"

const joinErrors: Record<string, string> = {
  invalid: "사용할 수 없는 코드예요. 코드를 다시 확인해 주세요.",
  rate_limited: "시도 횟수가 많아요. 15분 뒤 다시 시도해 주세요.",
  already_joined: "이미 공유 공간에 연결되어 있어요.",
}

export function UsScreen() {
  const app = useApp()
  const { snapshot, online, notifications } = app
  const { profile, pair } = snapshot
  const other = pair?.members.find(person => person.id !== profile.id)
  const [code, setCode] = useState("")
  const [invitation, setInvitation] = useState<{ code: string; expires_at: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [editing, setEditing] = useState<"name" | "photo" | null>(null)
  const [previewedId, setPreviewedId] = useState<string>()
  const [now, setNow] = useState(() => Date.now())
  const previewed = previewedId === profile.id ? profile : other?.id === previewedId ? other : undefined

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  async function run(action: () => Promise<void>) {
    if (!online || busy) return
    setBusy(true)
    setError("")
    setMessage("")
    try { await action() } catch {
      setError("요청을 처리하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.")
    } finally { setBusy(false) }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      const result = await app.joinSpace(code)
      if (result === "joined") { setMessage("공유 공간에 연결됐어요."); setCode("") }
      else setError(joinErrors[result] ?? joinErrors.invalid)
    })
  }

  const activeExpiry = pair?.invite_expires_at && Date.parse(pair.invite_expires_at) > now
    ? pair.invite_expires_at : null
  const canManage = pair && pair.owner_id === profile.id && !other
  return (
    <>
      <header className="page-heading"><h1>우리</h1></header>
      <section className="panel pair-panel">
        <div className="pair-title">
          <span className="progress-icon"><HeartHandshake size={26} aria-hidden="true" /></span>
          <div><h2>{other ? "연결 완료" : "연결 대기 중"}</h2>
            <p className="muted">{other ? "하나의 목록을 함께 쓰고 있어요." : "초대 코드로 두 사람을 연결할 수 있어요."}</p></div>
          {other && <Check className="accent" size={21} aria-hidden="true" />}
        </div>
        <ul className="pair-people">
          <li><ProfilePhotoButton person={profile} caption={profile.display_name + " (나)"} onPreview={setPreviewedId} /></li>
          <li>{other ? <ProfilePhotoButton person={other} partner caption={other.display_name} onPreview={setPreviewedId} />
            : <><ProfileAvatar partner /><span>연결 대기</span></>}</li>
        </ul>
      </section>
      <Link href="/notifications" className="panel inbox-link" aria-disabled={!online || undefined}
        onClick={event => { if (!online) event.preventDefault() }}>
        <span className="progress-icon"><Bell size={21} aria-hidden="true" /></span>
        <span>알림함</span>
        {notifications.unread > 0 && <span className="unread-count number" aria-label={`읽지 않은 알림 ${notifications.unread}개`}>{notifications.unread}</span>}
        <ChevronRight size={19} aria-hidden="true" />
      </Link>
      {!pair && <section className="panel settings-panel field-stack">
        <h2>공유 공간</h2>
        <button className="primary-button" disabled={!online || busy} onClick={() => void run(async () => {
          if (!await app.createSpace()) setMessage("상대가 만든 공간의 초대 코드를 입력해 주세요.")
        })}>공유 공간 만들기</button>
        <form className="field-stack" onSubmit={join}>
          <label className="field-label">초대 코드
            <input className="field number" name="invite-code" autoComplete="off" autoCapitalize="characters"
              placeholder="ABCD-1234-EF56-7890" maxLength={24} value={code} onChange={event => setCode(event.target.value)} required />
          </label>
          <button className="secondary-button" disabled={!online || busy || !code.trim()}>연결하기</button>
        </form>
      </section>}
      {canManage && <section className="panel settings-panel field-stack">
        <h2>초대 코드</h2>
        <p className="muted">{activeExpiry ? <>만료일 <DateText day={seoulDate(new Date(activeExpiry))} /> · 발급 후 24시간</> : "코드를 발급해 상대에게 전달하세요."}</p>
        {invitation && activeExpiry && Date.parse(activeExpiry) === Date.parse(invitation.expires_at) && <div className="invite-value">
          <output className="number">{invitation.code}</output>
          <button aria-label="초대 코드 복사" className="icon-button" type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(invitation.code); setMessage("초대 코드를 복사했어요.") }
            catch { setError("코드를 선택해 복사할 수 있어요.") }
          }}><Copy size={19} aria-hidden="true" /></button>
        </div>}
        <div className="actions">
          {activeExpiry && <button className="secondary-button" disabled={!online || busy} onClick={() => void run(async () => {
            if (!await app.revokeInvite()) throw new Error()
            setInvitation(null)
          })}>코드 폐기</button>}
          <button className="primary-button" disabled={!online || busy} onClick={() => void run(async () => {
            const next = await app.issueInvite()
            if (!next) throw new Error()
            setInvitation(next)
          })}>{activeExpiry ? "새 코드 발급" : "초대 코드 발급"}</button>
        </div>
      </section>}
      {message && <p className="muted" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="panel settings-panel field-stack">
        <h2>설정</h2>
        <button className="settings-action" onClick={() => setEditing("name")}><UserRound size={19} aria-hidden="true" /> 표시 이름 편집</button>
        <button className="settings-action" onClick={() => setEditing("photo")}><ImagePlus size={19} aria-hidden="true" /> 프로필 사진 편집</button>
        <details className="history install-help">
          <summary><Share2 size={18} aria-hidden="true" /> 홈 화면에 설치</summary>
          <p className="muted">iPhone Safari에서 공유 메뉴를 열고 ‘홈 화면에 추가’를 선택하세요.</p>
        </details>
        {!app.demo && <button className="settings-action" disabled={!online || busy} onClick={() => void run(app.signOut)}>로그아웃</button>}
      </section>
      {editing === "name" && <Sheet title="표시 이름 편집" close={() => setEditing(null)}><NameForm afterSave={() => setEditing(null)} /></Sheet>}
      {editing === "photo" && <ProfilePhotoSheet close={() => setEditing(null)} />}
      {previewed && <ProfilePhotoPreview person={previewed} partner={previewed.id !== profile.id} close={() => setPreviewedId(undefined)} />}
    </>
  )
}
