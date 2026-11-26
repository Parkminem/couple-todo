"use client"

import Link from "next/link"
import { useId, useState, type ReactNode } from "react"
import { homeSections } from "@/lib/tasks"
import { useApp } from "./app-provider"
import { AvatarStack, ProfilePhotoPreview } from "./profile-avatar"
import { AddButton, TaskList, TaskSheet, type Editing } from "./tasks-ui"
import { BrandMark, Progress, ScopeTabs } from "./ui"

function TaskSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const titleId = useId()
  return <section className="task-section" aria-labelledby={titleId}>
    <h2 id={titleId}>{title} <span className="section-count number">{count}</span></h2>
    {children}
  </section>
}

export function TodoScreen() {
  const { snapshot, scope, setScope, today, online } = useApp()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [previewedId, setPreviewedId] = useState<string>()
  const { profile } = snapshot
  const partner = snapshot.pair?.members.find(member => member.id !== profile.id)
  const previewed = previewedId === profile.id ? profile : partner?.id === previewedId ? partner : undefined
  const lists = homeSections(snapshot.tasks.filter(task => task.scope === scope), today)
  const canAdd = online && (scope === "personal" || Boolean(snapshot.pair))
  return (
    <>
      <header className="home-heading">
        <div>
          <h1><BrandMark />우리의 할 일</h1>
          <p className="home-subtitle">함께 만드는 오늘의 하루</p>
        </div>
        <AvatarStack self={profile} partner={partner} label={partner ? "나와 " + partner.display_name : "나, 연결 대기 중"} onPreview={setPreviewedId} />
      </header>
      <Progress done={lists.done} total={lists.today.length + lists.done} />
      <ScopeTabs scope={scope} onChange={setScope} />
      {scope === "shared" && !snapshot.pair ? (
        <section className="empty empty-pair">
          <h2>함께 할 일을 시작해 보세요</h2>
          <p>공유 공간을 만들거나 초대 코드로 연결할 수 있어요.</p>
          <Link className="secondary-button" href="/us" aria-disabled={!online || undefined}
            onClick={event => { if (!online) event.preventDefault() }}>우리 화면 열기</Link>
        </section>
      ) : (
        <>
          <TaskSection title="오늘의 할 일" count={lists.today.length}>
            <TaskList tasks={lists.today} edit={task => setEditing({ task })} empty="오늘 마감인 할 일이 없어요." />
          </TaskSection>
          {lists.overdue.length > 0 && (
            <TaskSection title="기한 지난 할 일" count={lists.overdue.length}>
              <TaskList tasks={lists.overdue} edit={task => setEditing({ task })} empty="" />
            </TaskSection>
          )}
          <TaskSection title="앞으로 할 일" count={lists.upcoming.length}>
            <TaskList tasks={lists.upcoming} edit={task => setEditing({ task })} empty="앞으로 할 일이 없어요." />
          </TaskSection>
          <TaskSection title="완료" count={lists.completed.length}>
            <TaskList tasks={lists.completed} edit={task => setEditing({ task })} empty="아직 완료한 할 일이 없어요." />
          </TaskSection>
        </>
      )}
      <AddButton disabled={!canAdd} click={() => setEditing({ date: today })} />
      {editing && <TaskSheet editing={editing} close={() => setEditing(null)} />}
      {previewed && <ProfilePhotoPreview person={previewed} partner={previewed.id !== profile.id} close={() => setPreviewedId(undefined)} />}
    </>
  )
}
