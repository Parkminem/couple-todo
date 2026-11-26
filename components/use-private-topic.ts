"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import { useEffect, useRef, useState } from "react"
import { queueSubscription } from "@/lib/supabase/subscription"

export function usePrivateTopic(client: SupabaseClient | null, topic: string | null, onChange: () => void) {
  const [connection, setConnection] = useState<{ topic: string; status: string }>()
  const pendingRemoval = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!client || !topic) return
    let active = true
    let timer: number | undefined
    function notify() {
      window.clearTimeout(timer)
      timer = window.setTimeout(onChange, 120)
    }

    const stop = queueSubscription(pendingRemoval.current, () => {
      const channel = client.channel(topic, { config: { private: true } })
        .on("broadcast", { event: "changed" }, notify)
        .subscribe(status => {
          if (!active) return
          setConnection({ topic, status })
          if (status === "SUBSCRIBED") notify()
        })
      return () => client.removeChannel(channel)
    })
    return () => {
      active = false
      window.clearTimeout(timer)
      pendingRemoval.current = stop()
    }
  }, [client, topic, onChange])

  return connection?.topic === topic ? connection.status : undefined
}
