import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "우리의 할 일", short_name: "우리의 할 일",
    lang: "ko", description: "두 사람을 위한 공유 할 일",
    start_url: "/", scope: "/", display: "standalone", orientation: "portrait",
    background_color: "#101014", theme_color: "#101014",
    icons: [
      { src: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
