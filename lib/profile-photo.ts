export const PROFILE_PHOTO_DATA_PREFIX = "data:image/jpeg;base64,"
export const PROFILE_THUMBNAIL_SIZE = 192
export const PROFILE_PHOTO_SIZE = 768

const maxFileSize = 20 * 1024 * 1024
const maxThumbnailBytes = 64 * 1024
const maxPhotoBytes = 768 * 1024

export type ProfilePhotoUpload = { thumbnail: string; full: string }

function encodeSquare(image: HTMLImageElement, maxSize: number, maxBytes: number, qualities: readonly number[]) {
  const crop = Math.min(image.naturalWidth, image.naturalHeight)
  const size = Math.min(maxSize, crop)
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d", { alpha: false })
  if (!context || !crop) throw new Error()

  context.fillStyle = "#292632"
  context.fillRect(0, 0, size, size)
  context.imageSmoothingQuality = "high"
  const x = (image.naturalWidth - crop) / 2
  const y = (image.naturalHeight - crop) / 2
  context.drawImage(image, x, y, crop, crop, 0, 0, size, size)

  for (const quality of qualities) {
    const result = canvas.toDataURL("image/jpeg", quality)
    if (!result.startsWith(PROFILE_PHOTO_DATA_PREFIX)) break
    const photo = result.slice(PROFILE_PHOTO_DATA_PREFIX.length)
    if (photo && atob(photo).length <= maxBytes) return photo
  }
  throw new Error()
}

export async function prepareProfilePhoto(file: File): Promise<ProfilePhotoUpload> {
  if (file.size === 0) throw new Error("다른 사진을 선택해 주세요.")
  if (file.size > maxFileSize) throw new Error("20MB 이하인 사진을 선택해 주세요.")

  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return {
      thumbnail: encodeSquare(image, PROFILE_THUMBNAIL_SIZE, maxThumbnailBytes, [0.86, 0.78]),
      full: encodeSquare(image, PROFILE_PHOTO_SIZE, maxPhotoBytes, [0.94, 0.90, 0.84]),
    }
  } catch {
    throw new Error("이 사진을 열 수 없어요. JPG 또는 PNG 사진을 선택해 주세요.")
  } finally {
    URL.revokeObjectURL(url)
  }
}
