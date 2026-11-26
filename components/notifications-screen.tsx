"use client"

import Link from "next/link"
import { Bell, CalendarClock, Check, CheckCheck, ChevronLeft, ListPlus, Settings2, UserRound, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import {
  canEnableDevicePush, isAppleMobile, isHomeScreenApp, supportsDevicePush, type DevicePush,
} from "@/lib/device-push"
import { defaultNotificationPreferences, type NotificationPreferences, type TaskNotification } from "@/lib/notifications"
import { useApp } from "./app-provider"
import { Empty, Sheet } from "./ui"

const kindOptions = [
  ["task_added", "할 일 추가"],
  ["task_completed", "할 일 완료"],
  ["task_changed", "할 일 변경·삭제"],
] as const

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short",
})

function notificationLabel(entry: TaskNotification) {
  if (entry.kind === "added") return { label: "할 일 추가", Icon: ListPlus }
  if (entry.kind === "completed") return { label: "할 일 완료", Icon: Check }
  if (entry.change_kind === "deleted") return { label: "할 일 삭제", Icon: X }
  if (entry.change_kind === "assignee") return { label: "담당자 변경", Icon: UserRound }
  return { label: entry.change_kind === "deadline_and_assignee" ? "마감일·담당자 변경" : "마감일 변경", Icon: CalendarClock }
}

type DeviceStatus = DevicePush | "demo" | "install" | "unsupported" | "permission" | "checking" | "preparing" | "error" | "unconfigured"

const installHelp = "iOS 16.4 이상에서 Safari 공유 메뉴의 ‘홈 화면에 추가’를 선택하고, 홈 화면의 아이콘으로 다시 열어 주세요."
const deviceDescriptions = {
  demo: installHelp,
  install: installHelp,
  unsupported: "이 브라우저에서는 푸시를 지원하지 않아요. " + installHelp,
  permission: "이 기기의 알림 설정에서 ‘우리의 할 일’ 알림을 허용해 주세요.",
  checking: "이 기기의 알림 상태를 확인하고 있어요.",
  preparing: "이 기기에서 푸시를 준비 중이에요.",
  error: "푸시 상태를 확인할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요.",
  unconfigured: "현재 이 기기에서 푸시를 켤 수 없어요.",
} satisfies Record<string, string>

async function getDeviceStatus(demo: boolean, load: () => Promise<DevicePush | null>): Promise<DeviceStatus> {
  if (demo) return "demo"
  if (isAppleMobile() && !isHomeScreenApp()) return "install"
  if (!supportsDevicePush()) return "unsupported"
  if (Notification.permission === "denied") return "permission"
  const device = await load()
  if (device?.enabled) return device
  if (!canEnableDevicePush()) return "unconfigured"
  return device ?? "preparing"
}

function DevicePushControl() {
  const { demo, online, devicePush } = useApp()
  const load = devicePush.load
  const [status, setStatus] = useState<DeviceStatus>("checking")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const ticket = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++ticket.current
    const next = await getDeviceStatus(demo, load).catch(() => "error" as const)
    if (request === ticket.current) setStatus(next)
  }, [demo, load])

  useEffect(() => {
    const recheck = () => void refresh()
    recheck()
    window.addEventListener("focus", recheck)
    window.addEventListener("online", recheck)
    navigator.serviceWorker?.addEventListener("controllerchange", recheck)
    return () => {
      window.removeEventListener("focus", recheck)
      window.removeEventListener("online", recheck)
      navigator.serviceWorker?.removeEventListener("controllerchange", recheck)
    }
  }, [refresh])

  async function toggle() {
    if (typeof status === "string" || !online || busy) return
    setBusy(true)
    setError(false)
    try { await devicePush.toggle(status) }
    catch { setError(true) }
    finally {
      await refresh()
      setBusy(false)
    }
  }

  const enabled = typeof status !== "string" && status.enabled
  return <section className="device-settings" aria-labelledby="device-settings-title">
    <h3 id="device-settings-title">이 기기의 푸시 알림</h3>
    <p className="muted">{typeof status === "string" ? deviceDescriptions[status]
      : enabled ? "이 기기에 푸시 알림을 보내요." : "앱을 닫았을 때도 새 소식을 받을 수 있어요."}</p>
    {error && status !== "permission" && <p className="form-error" role="alert">푸시 설정을 바꾸지 못했어요. 연결과 알림 권한을 확인해 주세요.</p>}
    {status === "error" || status === "preparing" ? <button className="text-button" type="button" disabled={!online || busy}
      onClick={() => void refresh()}>다시 확인하기</button> : <button className="secondary-button" type="button"
      disabled={typeof status === "string" || busy || !online} onClick={() => void toggle()}>
      {busy ? "처리 중…" : enabled ? "이 기기에서 끄기" : "이 기기에서 켜기"}
    </button>}
  </section>
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="notification-switch-row">
    {label}
    <input className="notification-switch" type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} />
  </label>
}

function NotificationSettings({ close }: { close: () => void }) {
  const { online, notifications } = useApp()
  const loadPreferences = notifications.loadPreferences
  const [draft, setDraft] = useState<NotificationPreferences | null>(null)
  const [loadingError, setLoadingError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    void loadPreferences().then(value => { if (active) setDraft(value) }).catch(() => { if (active) setLoadingError(true) })
    return () => { active = false }
  }, [loadPreferences])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online || !draft || busy) return
    if (draft.quiet_enabled && draft.quiet_start === draft.quiet_end) {
      setError("시작 시간과 종료 시간을 서로 다르게 설정해 주세요.")
      return
    }
    setBusy(true)
    setError("")
    try {
      await notifications.savePreferences({
        ...draft,
        quiet_start: draft.quiet_start || defaultNotificationPreferences.quiet_start,
        quiet_end: draft.quiet_end || defaultNotificationPreferences.quiet_end,
      })
      close()
    }
    catch { setError("알림 설정을 저장하지 못했어요. 다시 시도해 주세요.") }
    finally { setBusy(false) }
  }

  return <Sheet title="알림 설정" close={close}>
    <DevicePushControl />
    {draft ? <form className="field-stack notification-settings" onSubmit={save}>
      <fieldset disabled={!online || busy}>
        <legend>받을 알림</legend>
        <p className="muted">내 계정의 알림함과 푸시에 적용돼요.</p>
        {kindOptions.map(([key, label]) => <Switch key={key} label={label} checked={draft[key]}
          onChange={value => setDraft({ ...draft, [key]: value })} />)}
      </fieldset>
      <fieldset disabled={!online || busy}>
        <legend>방해 금지</legend>
        <p className="muted">한국 시간 기준으로 푸시만 잠시 쉬어요.</p>
        <Switch label="방해 금지 시간" checked={draft.quiet_enabled} onChange={value => setDraft({ ...draft, quiet_enabled: value })} />
        {draft.quiet_enabled && <div className="quiet-times">
          <label className="field-label">시작 시간<input className="field number" type="time" required value={draft.quiet_start}
            onChange={event => setDraft({ ...draft, quiet_start: event.target.value })} /></label>
          <label className="field-label">종료 시간<input className="field number" type="time" required value={draft.quiet_end}
            onChange={event => setDraft({ ...draft, quiet_end: event.target.value })} /></label>
        </div>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={!online || busy}>{busy ? "저장 중…" : "저장하기"}</button>
    </form> : loadingError ? <p className="form-error" role="alert">알림 설정을 불러오지 못했어요. 설정을 다시 열어 주세요.</p>
      : <p className="muted" role="status">알림 설정을 불러오는 중이에요.</p>}
  </Sheet>
}

export function NotificationsScreen() {
  const { notifications, online } = useApp()
  const { entries, unread, loaded, readError } = notifications
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [visible, setVisible] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function markRead(id?: string) {
    if (!online || busy) return
    setBusy(true)
    setError(false)
    try { await notifications.markRead(id) }
    catch { setError(true) }
    finally { setBusy(false) }
  }

  return <>
    <Link href="/us" className="text-button inbox-back" aria-disabled={!online || undefined}
      onClick={event => { if (!online) event.preventDefault() }}>
      <ChevronLeft size={18} aria-hidden="true" /> 우리로 돌아가기
    </Link>
    <header className="page-heading inbox-heading">
      <div><h1>알림함</h1><p className="muted">상대가 공유 할 일에 남긴 활동이에요.</p></div>
      <button className="icon-button" aria-label="알림 설정" onClick={() => setSettingsOpen(true)}>
        <Settings2 size={20} aria-hidden="true" />
      </button>
    </header>
    {error && <p className="form-error" role="alert">읽음 처리하지 못했어요. 다시 시도해 주세요.</p>}
    {readError && <div className="connection" role="status"><Bell size={17} aria-hidden="true" /> 알림을 불러오지 못했어요.
      <button className="text-button" disabled={!online} onClick={() => void notifications.refresh()}>다시 시도</button></div>}
    {!loaded && !readError && <p className="muted" role="status">{online ? "알림을 불러오는 중이에요." : "연결되면 알림을 확인할 수 있어요."}</p>}
    {loaded && !entries.length && <Empty>받은 알림이 아직 없어요.</Empty>}
    {entries.length > 0 && <>
      <div className="inbox-toolbar">
        <p className="muted" aria-live="polite">{unread ? <>읽지 않은 알림 <strong className="number">{unread}</strong>개</> : "모든 알림을 읽었어요"}</p>
        {unread > 0 && <button className="text-button" disabled={!online || busy} onClick={() => void markRead()}>
          <CheckCheck size={17} aria-hidden="true" /> 모두 읽음
        </button>}
      </div>
      <ul className="panel inbox-list" aria-label="받은 알림">
        {entries.slice(0, visible).map(entry => {
          const { label, Icon } = notificationLabel(entry)
          return <li className="inbox-entry" key={entry.id} data-unread={!entry.read_at || undefined}>
            <span className="progress-icon"><Icon size={19} aria-hidden="true" /></span>
            <div className="inbox-entry-copy">
              <p className="inbox-entry-title">{entry.task_title}</p>
              <p className="muted inbox-entry-meta"><span>{label}</span><time dateTime={entry.created_at}>{dateTime.format(new Date(entry.created_at))}</time></p>
            </div>
            {!entry.read_at && <button className="text-button inbox-read" disabled={!online || busy}
              aria-label={`${entry.task_title} 읽음 처리`} onClick={() => void markRead(entry.id)}>
              <span className="inbox-unread-dot" aria-hidden="true" /> 읽음 처리
            </button>}
          </li>
        })}
      </ul>
      {entries.length > visible && <button className="secondary-button inbox-more" onClick={() => setVisible(visible + 30)}>알림 더 보기</button>}
    </>}
    {settingsOpen && <NotificationSettings close={() => setSettingsOpen(false)} />}
  </>
}
