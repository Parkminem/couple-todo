"use client"

import { Check, Users, UserRound } from "lucide-react"
import Image from "next/image"
import { useEffect, useRef, type ReactNode } from "react"
import { addDays, weekdays } from "@/lib/tasks"
import type { Scope } from "@/lib/types"

export function BrandMark() {
  return <Image src="/icons/brand-mark.svg" width={52} height={32} alt="" className="brand-mark" loading="eager" />
}

export function DateText({ day, today, relative = false }: { day: string; today?: string; relative?: boolean }) {
  const [, month, date] = day.split("-").map(Number)
  const calendarDate = <><span className="number">{month}</span>월 <span className="number">{date}</span>일</>
  if (!relative || !today) return <>{calendarDate}</>
  const label = day === today ? "오늘" : day === addDays(today, 1) ? "내일"
    : weekdays[(new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7] + "요일"
  return <>{label} ({calendarDate})</>
}

export function ScopeTabs({ scope, onChange }: { scope: Scope; onChange: (scope: Scope) => void }) {
  return (
    <div className="segments" role="group" aria-label="할 일 목록">
      <button type="button" aria-pressed={scope === "shared"} onClick={() => onChange("shared")}>
        <Users size={19} aria-hidden="true" /> 공유 할 일
      </button>
      <button type="button" aria-pressed={scope === "personal"} onClick={() => onChange("personal")}>
        <UserRound size={19} aria-hidden="true" /> 내 할 일
      </button>
    </div>
  )
}

export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <section className="progress-card" aria-label="오늘의 완료 진행률">
      <div className="progress-main">
        <p className="progress-copy"><span className="number progress-value">{done}</span><span className="progress-slash"> / </span><span className="number progress-total">{total}</span> 완료</p>
        <progress aria-label="오늘의 완료율" max={total || 1} value={done} />
      </div>
      <span className="progress-icon" aria-hidden="true"><Check size={25} strokeWidth={2.8} /></span>
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Sheet({ children, title, close, busy = false }: { children: ReactNode; title: string; close: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="sheet-title"
      onCancel={event => { event.preventDefault(); if (!busy) close() }}
      onClick={event => { if (!busy && event.target === event.currentTarget) close() }}>
      <div className="sheet-content">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="sheet-title">{title}</h2>
          <button className="text-button" type="button" disabled={busy} onClick={close}>닫기</button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
