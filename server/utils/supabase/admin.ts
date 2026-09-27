// !!! SERVER-ONLY MODULE. DO NOT IMPORT INTO CLIENT CODE !!!
//
// This module builds a Supabase client with the SERVICE-ROLE key, which
// BYPASSES row-level security. It must never be imported into a Vue component,
// a composable that runs in the browser, or anything bundled for the client.
// It lives under server/utils so Nitro keeps it out of the browser bundle.
//
// Use it only for trusted server-side work that must run with elevated
// privileges (for example, persisting ingestion artifacts on behalf of a user
// after an explicit ownership check). Always perform ownership checks yourself
// because RLS will not protect you here.
import { createClient } from '@supabase/supabase-js'

export function createSupabaseAdminClient() {
  const config = useRuntimeConfig()
  const supabaseUrl = config.public.supabaseUrl
  const serviceRoleKey = config.supabaseServiceRoleKey

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NUXT_PUBLIC_SUPABASE_URL or NUXT_SUPABASE_SERVICE_ROLE_KEY. See .env.example.',
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
