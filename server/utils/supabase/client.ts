import { createBrowserClient } from '@supabase/ssr'

// Browser (anon) Supabase client boundary.
//
// This uses the PUBLIC Supabase URL and anon key and is safe to run in the
// browser. Per-user access is enforced by row-level security (see
// supabase/migrations/0002_rls.sql), never by hiding the anon key.
//
// It reads only `runtimeConfig.public` values so nothing server-only leaks.
export function createSupabaseBrowserClient() {
  const config = useRuntimeConfig()
  const { supabaseUrl, supabaseAnonKey } = config.public

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NUXT_PUBLIC_SUPABASE_URL or NUXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.',
    )
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
