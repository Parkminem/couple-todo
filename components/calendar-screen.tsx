"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"
import { calendarDays, shiftMonth, weekdays } from "@/lib/tasks"
import { useApp } from "./app-provider"
import { AddButton, TaskList, TaskSheet, type Editing } from "./tasks-ui"
import { DateText, ScopeTabs } from "./ui"

export function CalendarScreen() {
  const { snapshot, today, scope, setScope, online } = useApp()
  const [selected, setSelected] = useState(today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [editing, setEditing] = useState<Editing | null>(null)
  const datedTasks = snapshot.tasks.filter(task => task.scope === scope && task.due_on)
  const [year, monthNumber] = month.split("-").map(Number)

  function moveMonth(amount: number) {
    const next = shiftMonth(month, amount)
    setMonth(next)
    setSelected(next + "-01")
  }

  return (
    <>
      <header className="page-heading"><h1>캘린더</h1></header>
      <ScopeTabs scope={scope} onChange={setScope} />
      <section className="calendar panel" aria-label="월간 달력">
        <div className="calendar-head">
          <button className="icon-button" aria-label="이전 달" onClick={() => moveMonth(-1)}><ChevronLeft size={22} /></button>
          <h2><span className="number">{year}</span>년 <span className="number">{monthNumber}</span>월</h2>
          <button className="icon-button" aria-label="다음 달" onClick={() => moveMonth(1)}><ChevronRight size={22} /></button>
        </div>
        <div className="calendar-grid">
          {weekdays.map(day => <span className="calendar-weekday" key={day}>{day}</span>)}
          {calendarDays(month).map(day => {
            const items = datedTasks.filter(task => task.due_on === day)
            const done = items.filter(task => task.completed_at).length
            const caption = day + (items.length ? " · " + items.length + "건 중 " + done + "건 완료" : "")
            return (
              <button className="calendar-day" key={day} aria-label={caption} aria-pressed={day === selected}
                aria-current={day === today ? "date" : undefined} data-outside={!day.startsWith(month)}
                onClick={() => { setSelected(day); setMonth(day.slice(0, 7)) }}>
                <span className="number">{Number(day.slice(-2))}</span>
                <span className="calendar-dots" aria-hidden="true">
                  {items.length > done && <i className="calendar-dot dot-open" />}
                  {done > 0 && <i className="calendar-dot dot-done" />}
                </span>
              </button>
            )
          })}
        </div>
      </section>
      <section className="task-section">
        <h2><span><DateText day={selected} /> 할 일</span></h2>
        <TaskList tasks={datedTasks.filter(task => task.due_on === selected)} edit={task => setEditing({ task })}
          empty="이 날짜에 마감하는 할 일이 없어요." />
      </section>
      <AddButton click={() => setEditing({ date: selected })} disabled={!online || (scope === "shared" && !snapshot.pair)} />
      {editing && <TaskSheet editing={editing} close={() => setEditing(null)} />}
    </>
  )
}
