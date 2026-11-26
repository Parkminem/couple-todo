import "server-only"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { supabaseKey, supabaseUrl } from "./env"

export async function serverSupabase() {
  const cookieStore = await cookies()
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase 환경 변수가 필요합니다.")
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
        } catch {
          // Server Components rely on the proxy to refresh and write cookies.
        }
      },
    },
  })
}
