"use client"

import { CalendarDays, Check, ChevronRight, Plus } from "lucide-react"
import { useState, type FormEvent } from "react"
import { useApp } from "./app-provider"
import { AvatarStack, ProfileAvatar, ProfilePhotoButton, ProfilePhotoPreview } from "./profile-avatar"
import { DateText, Empty, Sheet } from "./ui"
import type { Scope, Task } from "@/lib/types"

export type Editing = { task?: Task; date?: string | null }

function TaskRow({ task, open }: { task: Task; open: () => void }) {
  const { snapshot, today, online, completeTask, isCompletingTask, taskCompletionError } = useApp()
  const pending = isCompletingTask(task.id)
  const error = taskCompletionError(task.id)
  const done = Boolean(task.completed_at)
  const [previewedId, setPreviewedId] = useState<string>()
  const { profile, pair } = snapshot
  const partner = pair?.members.find(member => member.id !== profile.id)
  const together = task.assignee_id === null
  const isMine = task.assignee_id === profile.id
  const assignee = isMine ? profile : partner?.id === task.assignee_id ? partner : undefined
  const previewTogether = previewedId === "together"
  const previewed = previewTogether || previewedId === profile.id ? profile : partner?.id === previewedId ? partner : undefined
  return (
    <li>
      <div className="task-card" data-complete={done}>
        <label className="check-target">
          <input type="checkbox" checked={done} onChange={() => { if (!pending && online) void completeTask(task, !done) }}
            aria-label={task.title + " 완료"} disabled={!online || pending} />
          <span className="check-visual" aria-hidden="true">{done && <Check size={18} strokeWidth={2.8} />}</span>
        </label>
        <div className="task-main">
          <div className="task-detail">
            <button type="button" className="task-open task-title" onClick={open} aria-label={task.title + " 상세"}>
              {task.title}
            </button>
            <span className="task-meta">
              <span className="task-date">
                <CalendarDays size={15} aria-hidden="true" />
                <span>{task.due_on ? <DateText day={task.due_on} today={today} relative /> : "날짜 미정"}</span>
              </span>
              <span className="meta-divider" aria-hidden="true" />
              <span className="assignee">
                {together ? (
                  <button type="button" className="profile-photo-trigger" aria-label="함께 프로필 사진 크게 보기"
                    aria-haspopup="dialog" onClick={event => {
                      event.currentTarget.focus({ preventScroll: true })
                      setPreviewedId("together")
                    }}>
                    <AvatarStack self={profile} partner={partner} />
                    <span className="assignee-name">함께</span>
                  </button>
                ) : assignee ? <ProfilePhotoButton person={assignee} partner={!isMine}
                  caption={isMine ? "나" : assignee.display_name} onPreview={setPreviewedId} />
                  : <><ProfileAvatar partner /><span className="assignee-name">상대</span></>}
              </span>
            </span>
          </div>
          <ChevronRight className="task-chevron" size={19} aria-hidden="true" />
        </div>
      </div>
      {error && <p className="form-error row-error" role="alert">{error}</p>}
      {previewed && <ProfilePhotoPreview person={previewed} partner={previewed.id !== profile.id}
        companion={previewTogether ? partner ?? null : undefined} close={() => setPreviewedId(undefined)} />}
    </li>
  )
}

export function TaskList({ tasks, edit, empty }: { tasks: Task[]; edit: (task: Task) => void; empty: string }) {
  if (!tasks.length) return <Empty>{empty}</Empty>
  return <ul className="task-list">{tasks.map(task => <TaskRow key={task.id} task={task} open={() => edit(task)} />)}</ul>
}

export function AddButton({ click, disabled }: { click: () => void; disabled: boolean }) {
  return <button type="button" className="fab" aria-label="할 일 추가" disabled={disabled} onClick={click}>
    <Plus size={31} strokeWidth={2.2} aria-hidden="true" />
  </button>
}

export function TaskSheet({ editing, close }: { editing: Editing; close: () => void }) {
  const { snapshot, scope, setScope, today, online, saveTask, deleteTask, refresh } = useApp()
  const existing = editing.task
  const [original, setOriginal] = useState(existing)
  const [newId, setNewId] = useState("")
  const [title, setTitle] = useState(existing?.title ?? "")
  const [list, setList] = useState<Scope>(existing?.scope ?? (snapshot.pair ? scope : "personal"))
  const [date, setDate] = useState(existing ? existing.due_on ?? "" : editing.date ?? today)
  const [assignee, setAssignee] = useState(existing?.assignee_id ?? "")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const current = snapshot.tasks.find(task => task.id === original?.id)
  const conflict = Boolean(original && (!current || original.version !== current.version))
  const events = snapshot.events.filter(event => event.task_id === existing?.id)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || conflict || !online || !title.trim()) return
    const id = original?.id ?? (newId || crypto.randomUUID())
    if (!original && !newId) setNewId(id)
    setError("")
    setBusy(true)
    try {
      const result = await saveTask({ id, original, draft: {
        title, scope: list, due_on: date || null, assignee_id: list === "personal" ? snapshot.profile.id : assignee || null,
      } })
      if (result === "ok") {
        if (!original) setScope(list)
        close()
      }
      else if (original) setError("이 할 일이 변경됐어요. 현재 버전을 확인해 주세요.")
      else {
        setNewId("")
        setError("이전 저장 결과가 현재 입력과 달라요. 새 할 일로 추가하려면 한 번 더 눌러 주세요.")
      }
    } catch {
      setError("저장 결과를 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.")
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!original || busy || !online || conflict) return
    setBusy(true)
    try {
      if (await deleteTask(original) === "ok") close()
      else setError("이 할 일이 변경됐어요. 현재 버전을 확인해 주세요.")
    } catch {
      setError("삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.")
    } finally { setBusy(false) }
  }

  return (
    <Sheet title={confirmDelete ? "할 일 삭제" : existing ? "할 일 편집" : "할 일 추가"} close={close}>
      {conflict && (
        <div className="conflict-message" role="status">
          {current ? <>최신 상태는 ‘{current.title}’ · {current.completed_at ? "완료" : "진행 중"}{current.due_on ? " · " + current.due_on : ""}입니다.</>
            : "이미 삭제된 할 일이에요."}
          {current && <button type="button" className="text-button" onClick={() => { setOriginal(current); setError("") }}>
            내 입력을 유지하고 계속
          </button>}
        </div>
      )}
      {confirmDelete ? (
        <div className="field-stack">
          <p className="muted">이 할 일과 완료 이력이 함께 삭제돼요.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="actions">
            <button className="secondary-button" onClick={() => setConfirmDelete(false)}>취소</button>
            <button className="danger-button" disabled={!online || busy || conflict} onClick={() => void remove()}>삭제하기</button>
          </div>
        </div>
      ) : (
        <form className="field-stack" onSubmit={submit}>
          <label className="field-label">할 일 제목
            <input className="field" name="title" required maxLength={120} value={title} autoComplete="off" onChange={event => setTitle(event.target.value)} />
          </label>
          <label className="field-label">목록
            <select className="field" value={list} disabled={Boolean(existing)} onChange={event => setList(event.target.value as Scope)}>
              {snapshot.pair && <option value="shared">공유 할 일</option>}
              <option value="personal">내 할 일</option>
            </select>
          </label>
          <div className="form-grid">
            <label className="field-label">마감일
              <input className="field" type="date" min="1900-01-01" max="9999-12-31" value={date} onChange={event => setDate(event.target.value)} />
            </label>
            <label className="field-label">담당자
              <select className="field" value={list === "personal" ? snapshot.profile.id : assignee}
                disabled={list === "personal"} onChange={event => setAssignee(event.target.value)}>
                <option value={snapshot.profile.id}>나</option>
                {list === "shared" && <>
                  <option value="">함께</option>
                  {snapshot.pair?.members.filter(member => member.id !== snapshot.profile.id).map(member =>
                    <option key={member.id} value={member.id}>{member.display_name}</option>)}
                </>}
              </select>
            </label>
          </div>
          {date && <button type="button" className="text-button align-start" onClick={() => setDate("")}>마감일 지우기</button>}
          {error && <p className="form-error" role="alert">{error} <button className="text-button" type="button" onClick={() => void refresh().catch(() => {})}>새로 고침</button></p>}
          <div className="actions">
            {existing && <button className="secondary-button" type="button" disabled={!online || busy} onClick={() => { setError(""); setConfirmDelete(true) }}>삭제</button>}
            <button className="primary-button" disabled={!online || busy || conflict || !title.trim()}>
              {busy ? "저장 중…" : existing ? "저장하기" : "추가하기"}
            </button>
          </div>
          {existing && <details className="history">
            <summary>완료 이력</summary>
            {events.length ? <ul>{events.map(event => {
              const name = event.actor_id === snapshot.profile.id ? "나" : snapshot.pair?.members.find(member => member.id === event.actor_id)?.display_name ?? "상대"
              return <li key={event.id}><span>{name} · {event.completed ? "완료" : "다시 열기"}</span>
                <time dateTime={event.occurred_at}>{new Intl.DateTimeFormat("ko-KR", {
                  timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short",
                }).format(new Date(event.occurred_at))}</time></li>
            })}</ul> : <p className="muted">아직 기록이 없어요.</p>}
          </details>}
        </form>
      )}
    </Sheet>
  )
}
