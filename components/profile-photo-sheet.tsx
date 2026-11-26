"use client"

import { ImagePlus } from "lucide-react"
import { useRef, useState, type ChangeEvent } from "react"
import { prepareProfilePhoto, PROFILE_PHOTO_DATA_PREFIX, type ProfilePhotoUpload } from "@/lib/profile-photo"
import { useApp } from "./app-provider"
import { ProfileAvatar } from "./profile-avatar"
import { Sheet } from "./ui"

export function ProfilePhotoSheet({ close }: { close: () => void }) {
  const { online, snapshot, saveProfilePhoto } = useApp()
  const { profile } = snapshot
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<ProfilePhotoUpload | null>(null)
  const [pending, setPending] = useState<"file" | "save" | "reset" | null>(null)
  const [error, setError] = useState("")
  const disabled = !online || Boolean(pending)

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || disabled) return
    setError("")
    setDraft(null)
    setPending("file")
    try {
      setDraft(await prepareProfilePhoto(file))
    } catch (error) {
      setError(error instanceof Error ? error.message : "다른 사진을 선택해 주세요.")
    } finally {
      setPending(null)
    }
  }

  async function persist(photo: ProfilePhotoUpload | null) {
    if (disabled) return
    setError("")
    setPending(photo ? "save" : "reset")
    try {
      await saveProfilePhoto(photo)
      close()
    } catch {
      setError("프로필 사진을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.")
    } finally {
      setPending(null)
    }
  }

  return (
    <Sheet title="프로필 사진 편집" close={close} busy={Boolean(pending)}>
      <form className="field-stack" onSubmit={event => {
        event.preventDefault()
        if (draft) void persist(draft)
      }}>
        <div className="profile-photo-picker">
          <ProfileAvatar person={profile} preview={draft ? PROFILE_PHOTO_DATA_PREFIX + draft.full : undefined} />
          <button className="secondary-button" type="button" disabled={disabled} onClick={() => input.current?.click()}>
            <ImagePlus size={18} aria-hidden="true" />{pending === "file" ? "사진 여는 중…" : "사진 선택"}
          </button>
          <input ref={input} type="file" hidden accept="image/*,.heic,.heif" aria-label="프로필 사진 파일"
            disabled={disabled} onChange={event => void selectPhoto(event)} />
        </div>
        {!online && <p className="muted">인터넷에 연결하면 사진을 변경할 수 있어요.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="actions">
          <button className="secondary-button" type="button" disabled={disabled || (!profile.photo_version && !draft)} onClick={() => void persist(null)}>
            {pending === "reset" ? "변경 중…" : "기본 이미지 사용"}
          </button>
          <button className="primary-button" type="submit" disabled={disabled || !draft}>{pending === "save" ? "저장 중…" : "저장하기"}</button>
        </div>
      </form>
    </Sheet>
  )
}
