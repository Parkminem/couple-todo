import { redirect } from "next/navigation"
import { LoginForm } from "@/components/login-form"
import { supabaseConfigured } from "@/lib/supabase/env"
import { serverSupabase } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  if (supabaseConfigured) {
    const client = await serverSupabase()
    const { data } = await client.auth.getClaims()
    if (data?.claims.sub) redirect("/")
  }
  return <LoginForm configured={supabaseConfigured} />
}
