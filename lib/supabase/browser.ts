import { createBrowserClient } from "@supabase/ssr"
import { supabaseKey, supabaseUrl } from "./env"

export function browserSupabase() {
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase 환경 변수가 필요합니다.")
  return createBrowserClient(supabaseUrl, supabaseKey)
}
