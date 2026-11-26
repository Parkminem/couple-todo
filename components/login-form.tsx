"use client"

import { useState, type FormEvent } from "react"
import { browserSupabase } from "@/lib/supabase/browser"
import { BrandMark } from "./ui"

export function LoginForm({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("")
  const [token, setToken] = useState("")
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [retryAt, setRetryAt] = useState(0)

  async function send() {
    if (busy || !configured) return
    if (Date.now() < retryAt) { setError("인증번호는 1분 뒤 다시 요청할 수 있어요."); return }
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const result = await browserSupabase().auth.signInWithOtp({
        email: email.trim().toLowerCase(), options: { shouldCreateUser: false },
      })
      if (result.error && result.error.status === 429) {
        setError("잠시 기다린 뒤 다시 요청해 주세요.")
        return
      }
      if (result.error && (!result.error.status || result.error.status >= 500)) throw result.error
      setSent(true)
      setRetryAt(Date.now() + 60_000)
      setMessage("등록된 이메일로 인증번호를 보냈어요. 받은 편지함을 확인해 주세요.")
    } catch {
      setError("인증번호를 요청하지 못했어요. 잠시 뒤 다시 시도해 주세요.")
    } finally { setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !configured) return
    if (!sent) { await send(); return }
    setBusy(true)
    setError("")
    try {
      const { error } = await browserSupabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "email" })
      if (error) { setError("인증번호가 잘못됐거나 만료됐어요. 확인 후 다시 입력해 주세요."); return }
      window.location.replace("/")
    } catch {
      setError("로그인 연결을 확인하고 다시 시도해 주세요.")
    } finally { setBusy(false) }
  }

  return (
    <main className="login-frame">
      <section className="login-panel panel">
        <div className="login-brand"><BrandMark /><h1>우리의 할 일</h1></div>
        <p className="muted">등록된 이메일로 로그인하세요.</p>
        <form className="field-stack" onSubmit={submit}>
          <label className="field-label">이메일
            <input className="field" type="email" name="email" required autoComplete="email"
              value={email} disabled={sent || busy} onChange={event => setEmail(event.target.value)} />
          </label>
          {sent && <label className="field-label">인증번호
            <input className="field number" name="code" required inputMode="numeric" autoComplete="one-time-code"
              pattern="[0-9]{6}" maxLength={6} value={token} onChange={event => setToken(event.target.value.replace(/\D/g, ""))} />
          </label>}
          {!configured && <p className="form-error" role="status">로그인 연결을 설정한 뒤 사용할 수 있어요.</p>}
          {message && <p className="muted" role="status">{message}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={!configured || busy}>{busy ? "연결 중…" : sent ? "로그인" : "인증번호 받기"}</button>
          {sent && <div className="actions">
            <button type="button" className="text-button" onClick={() => { setSent(false); setMessage(""); setError(""); setRetryAt(0); setToken("") }}>이메일 변경</button>
            <button type="button" className="text-button" onClick={() => void send()} disabled={busy}>인증번호 다시 받기</button>
          </div>}
        </form>
      </section>
    </main>
  )
}
