import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import type { H3Event } from 'h3'
import { getHeader, setResponseHeader } from 'h3'

// Per-request SSR Supabase client boundary.
//
// This client runs on the server for a single request. It reads the auth
// cookies off the incoming request so the resulting Supabase session is the
// signed-in user's, and it writes refreshed auth cookies back on the response.
// It uses the PUBLIC anon key, so all queries remain subject to RLS scoped to
// the authenticated user. It never uses the service-role key.
export function createSupabaseServerClient(event: H3Event) {
  const config = useRuntimeConfig()
  const { supabaseUrl, supabaseAnonKey } = config.public

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NUXT_PUBLIC_SUPABASE_URL or NUXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.',
    )
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        const header = getHeader(event, 'cookie') ?? ''
        return parseCookieHeader(header)
      },
      setAll(cookies) {
        for (const { name, value, options } of cookies) {
          setResponseHeader(
            event,
            'set-cookie',
            serializeCookieHeader(name, value, options),
          )
        }
      },
    },
  })
}
