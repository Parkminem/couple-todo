"use client"

import { Check, UserRound } from "lucide-react"
import { useState } from "react"
import { addDays, weeklyStats } from "@/lib/tasks"
import { useApp } from "./app-provider"
import { DateText, Empty, ScopeTabs } from "./ui"
import { TaskList, TaskSheet, type Editing } from "./tasks-ui"

export function StatsScreen() {
  const { snapshot, today } = useApp()
  const [scope, setScope] = useState<"shared" | "personal">("shared")
  const [editing, setEditing] = useState<Editing | null>(null)
  const stats = weeklyStats(snapshot.tasks.filter(task => task.scope === scope), today)
  const members = scope === "personal" ? [snapshot.profile] : snapshot.pair?.members ?? []
  return (
    <>
      <header className="page-heading">
        <h1>통계</h1>
        <p className="muted"><DateText day={stats.start} /> – <DateText day={addDays(stats.end, -1)} /></p>
      </header>
      <ScopeTabs scope={scope} onChange={setScope} />
      <section className="panel weekly-card">
        <div>
          <h2>이번 주 완료율</h2>
          {stats.rate === null ? <p className="muted">이번 주 마감인 할 일이 없어요.</p> : (
            <>
              <p className="percentage number">{stats.rate}%</p>
              <progress aria-label="이번 주 마감 기준 완료율" value={stats.rate} max={100} />
              <p className="muted">이번 주 마감 기준</p>
            </>
          )}
        </div>
        <span className="progress-icon" aria-hidden="true"><Check size={25} /></span>
      </section>
      {members.length > 0 && <section className="task-section">
        <h2>개인별 완료 현황</h2>
        <ul className="member-list">
          {members.map(member => <li key={member.id} className="panel member-row">
            <span className="member-icon"><UserRound size={19} aria-hidden="true" /></span>
            <span>{member.display_name}{member.id === snapshot.profile.id ? " (나)" : ""}</span>
            <strong><span className="number">{stats.byMember.get(member.id) ?? 0}</span>건</strong>
          </li>)}
        </ul>
      </section>}
      <section className="task-section">
        <h2>이번 주 완료한 할 일 <span className="section-count number">{stats.completed.length}</span></h2>
        {stats.completed.length ? <TaskList tasks={stats.completed} edit={task => setEditing({ task })} empty="" />
          : <Empty>이번 주에 완료한 할 일이 없어요.</Empty>}
      </section>
      {editing && <TaskSheet editing={editing} close={() => setEditing(null)} />}
    </>
  )
}
