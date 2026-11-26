"use client"

import { useEffect } from "react"

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(error => {
        console.warn("Service worker registration failed", error)
      })
    }
  }, [])
  return null
}
