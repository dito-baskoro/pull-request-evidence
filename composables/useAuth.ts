import type { Session, User } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

// Browser-side authentication composable.
//
// This wraps a single shared browser (anon) Supabase client and exposes the
// current user plus sign-in / sign-out helpers. It is browser-only by design;
// server code should use createSupabaseServerClient instead. It reads only
// public runtime config, so no server-only secret is referenced here.
//
// FEAT-001 wires magic-link email sign-in as the default; an OAuth stub is
// provided as a seam for later work. The Supabase project must have the chosen
// provider enabled.

let browserClient: ReturnType<typeof createBrowserClient> | null = null

function getClient() {
  if (browserClient) return browserClient
  const config = useRuntimeConfig()
  const { supabaseUrl, supabaseAnonKey } = config.public
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NUXT_PUBLIC_SUPABASE_URL or NUXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.',
    )
  }
  browserClient = createBrowserClient(supabaseUrl as string, supabaseAnonKey as string)
  return browserClient
}

export function useSupabaseClient() {
  return getClient()
}

export function useAuth() {
  const config = useRuntimeConfig()
  const user = useState<User | null>('auth:user', () => null)
  const session = useState<Session | null>('auth:session', () => null)
  const loading = useState<boolean>('auth:loading', () => true)

  async function refresh() {
    loading.value = true
    try {
      const client = getClient()
      const { data } = await client.auth.getSession()
      session.value = data.session
      user.value = data.session?.user ?? null
    }
    finally {
      loading.value = false
    }
  }

  /** Send a magic-link email. The link returns the user to the app. */
  async function signInWithEmail(email: string) {
    const client = getClient()
    const redirectTo = `${config.public.appUrl}/dashboard`
    return client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })
  }

  /**
   * OAuth sign-in seam. Left as a thin wrapper so later work can enable a
   * provider (for example GitHub) without changing call sites.
   */
  async function signInWithOAuth(provider: 'github') {
    const client = getClient()
    const redirectTo = `${config.public.appUrl}/dashboard`
    return client.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    })
  }

  async function signOut() {
    const client = getClient()
    await client.auth.signOut()
    session.value = null
    user.value = null
    await navigateTo('/login')
  }

  return {
    user,
    session,
    loading,
    refresh,
    signInWithEmail,
    signInWithOAuth,
    signOut,
  }
}
