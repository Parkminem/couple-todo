import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import { ServiceWorker } from "@/components/service-worker"
import "./globals.css"

export const metadata: Metadata = {
  title: "우리의 할 일",
  description: "두 사람을 위한 공유 할 일",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "우리의 할 일" },
  icons: {
    icon: { url: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png" },
    apple: { url: "/icons/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" },
  },
}
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#101014", colorScheme: "dark",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body>{children}<ServiceWorker /></body></html>
}
