import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { AppProvider } from "@/components/app-provider"
import { AppShell } from "@/components/app-shell"
import { demoEnabled, demoSnapshot, demoToday } from "@/lib/demo"
import { readSnapshot } from "@/lib/supabase/data"
import { supabaseConfigured } from "@/lib/supabase/env"
import { serverSupabase } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function Layout({ children }: { children: ReactNode }) {
  if (demoEnabled) {
    return <AppProvider initial={demoSnapshot} demoDate={demoToday}><AppShell>{children}</AppShell></AppProvider>
  }
  if (!supabaseConfigured) redirect("/login")
  const client = await serverSupabase()
  const { data, error } = await client.auth.getClaims()
  if (error || typeof data?.claims.sub !== "string") redirect("/login")
  const initial = await readSnapshot(client, data.claims.sub)
  return <AppProvider initial={initial}><AppShell>{children}</AppShell></AppProvider>
}
