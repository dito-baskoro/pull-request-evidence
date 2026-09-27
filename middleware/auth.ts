// Route middleware that gates authenticated pages.
//
// Apply per page with `definePageMeta({ middleware: 'auth' })`. It checks the
// current Supabase session (via the browser client) and redirects anonymous
// visitors to /login. It runs on the client where the Supabase session cookie
// is available; server-rendered navigations fall through and the client-side
// check enforces the redirect.
export default defineNuxtRouteMiddleware(async (to) => {
  // Only guard on the client, where the auth session is resolvable.
  if (import.meta.server) return

  const { user, refresh } = useAuth()
  if (!user.value) {
    await refresh()
  }

  if (!user.value) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
