import { Buffer } from "node:buffer"
import { supabaseConfigured } from "@/lib/supabase/env"
import { serverSupabase } from "@/lib/supabase/server"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const version = searchParams.get("v")
  const fullSize = searchParams.get("size") === "full"
  const notFound = () => new Response(null, { status: 404, headers: privateHeaders })
  if (!supabaseConfigured || !uuid.test(id) || !version || !uuid.test(version)) return notFound()

  const client = await serverSupabase()
  const { data: auth, error: authError } = await client.auth.getClaims()
  if (authError || !auth?.claims.sub) return notFound()

  const { data, error } = await client.from("profile_photos").select(fullSize ? "jpeg,full_jpeg" : "jpeg")
    .eq("profile_id", id).eq("version", version).maybeSingle().returns<{ jpeg: string; full_jpeg?: string | null }>()
  if (error || !data) return notFound()

  const photo = data.full_jpeg ?? data.jpeg
  const image = Uint8Array.from(Buffer.from(photo, "base64"))
  return new Response(image, { headers: { ...privateHeaders, "Content-Type": "image/jpeg" } })
}
