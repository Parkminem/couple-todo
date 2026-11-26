"use client"

import { useRouter } from "next/navigation"

export default function ErrorScreen({ reset }: { reset: () => void }) {
  const router = useRouter()
  return <main className="login-frame"><section className="login-panel panel field-stack">
    <h1>목록을 불러오지 못했어요</h1>
    <p className="muted">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
    <button className="primary-button" onClick={() => { router.refresh(); reset() }}>다시 시도</button>
  </section></main>
}
