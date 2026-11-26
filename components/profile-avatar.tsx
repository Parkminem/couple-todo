"use client"

import { UserRound, X } from "lucide-react"
import Image from "next/image"
import { useEffect, useId, useRef, useState } from "react"
import { PROFILE_PHOTO_DATA_PREFIX, PROFILE_PHOTO_SIZE, PROFILE_THUMBNAIL_SIZE } from "@/lib/profile-photo"
import type { Person } from "@/lib/types"
import { useApp } from "./app-provider"

export function ProfileAvatar({ person, partner = false, preview, fullSize = false }: {
  person?: Person
  partner?: boolean
  preview?: string
  fullSize?: boolean
}) {
  const { demo, demoPhoto, snapshot } = useApp()
  const [failedSource, setFailedSource] = useState<string>()
  let saved: string | undefined
  if (person?.photo_version) {
    if (!demo) {
      saved = `/profile-photo/${encodeURIComponent(person.id)}?v=${encodeURIComponent(person.photo_version)}${fullSize ? "&size=full" : ""}`
    } else if (demoPhoto && person.id === snapshot.profile.id) {
      saved = PROFILE_PHOTO_DATA_PREFIX + (fullSize ? demoPhoto.full : demoPhoto.thumbnail)
    }
  }
  const source = preview ?? saved
  const size = fullSize ? PROFILE_PHOTO_SIZE : PROFILE_THUMBNAIL_SIZE
  return (
    <span className={`profile-avatar ${partner ? "profile-avatar-partner" : "profile-avatar-self"}`} aria-hidden="true">
      {source && source !== failedSource
        ? <Image key={source} src={source} width={size} height={size} alt="" unoptimized
          loading={fullSize ? "eager" : undefined} onError={() => setFailedSource(source)} />
        : <UserRound />}
    </span>
  )
}

export function ProfilePhotoButton({ person, partner = false, caption, onPreview }: {
  person: Person
  partner?: boolean
  caption?: string
  onPreview: (id: string) => void
}) {
  return (
    <button type="button" className="profile-photo-trigger" aria-label={(caption ?? person.display_name) + " 프로필 사진 크게 보기"}
      aria-haspopup="dialog" onClick={event => {
        event.currentTarget.focus({ preventScroll: true })
        onPreview(person.id)
      }}>
      <ProfileAvatar person={person} partner={partner} />
      {caption && <span className="profile-photo-caption">{caption}</span>}
    </button>
  )
}

export function AvatarStack({ self, partner, label, onPreview, fullSize = false }: {
  self: Person
  partner?: Person
  label?: string
  onPreview?: (id: string) => void
  fullSize?: boolean
}) {
  return (
    <span className="avatar-stack" role={label ? "group" : undefined} aria-label={label}>
      {onPreview ? <ProfilePhotoButton person={self} onPreview={onPreview} /> : <ProfileAvatar person={self} fullSize={fullSize} />}
      {onPreview && partner ? <ProfilePhotoButton person={partner} partner onPreview={onPreview} />
        : <ProfileAvatar person={partner} partner fullSize={fullSize} />}
    </span>
  )
}

export function ProfilePhotoPreview({ person, partner, companion, close }: {
  person: Person
  partner: boolean
  companion?: Person | null
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const together = companion !== undefined
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  function dismiss() {
    dialog.current?.close()
    close()
  }

  return (
    <dialog ref={dialog} className="profile-preview" aria-labelledby={title}
      onCancel={event => { event.preventDefault(); dismiss() }}
      onClick={event => { if (event.target === event.currentTarget) dismiss() }}>
      <button type="button" className="icon-button profile-preview-close" aria-label="닫기" onClick={dismiss}>
        <X size={22} aria-hidden="true" />
      </button>
      <figure className={together ? "profile-preview-content profile-preview-together" : "profile-preview-content"}>
        {together ? <AvatarStack self={person} partner={companion ?? undefined} fullSize />
          : <ProfileAvatar person={person} partner={partner} fullSize />}
        <figcaption id={title}>{person.display_name}{together && (" · " + (companion?.display_name ?? "연결 대기"))}</figcaption>
      </figure>
    </dialog>
  )
}
