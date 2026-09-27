// Nuxt 3 configuration for the PR Evidence Pack application.
//
// Secret handling policy:
//   - `runtimeConfig` (top level) is SERVER-ONLY. Values here are never sent to
//     the browser bundle. The GitHub App private key, Supabase service-role key,
//     and AI provider key MUST live here.
//   - `runtimeConfig.public` is exposed to the browser. Only browser-safe values
//     (Supabase URL + anon key, app URL, GitHub App slug) belong here.
//
// See README.md ("Environment variables") for ownership of each value.
export default defineNuxtConfig({
  compatibilityDate: '2024-09-01',

  typescript: {
    strict: true,
    typeCheck: false,
  },

  runtimeConfig: {
    // SERVER-ONLY secrets. Do NOT move any of these under `public`.
    githubAppId: '', // NUXT_GITHUB_APP_ID
    githubAppPrivateKey: '', // NUXT_GITHUB_APP_PRIVATE_KEY (PEM, server-only)
    githubWebhookSecret: '', // NUXT_GITHUB_WEBHOOK_SECRET
    supabaseServiceRoleKey: '', // NUXT_SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)
    aiApiKey: '', // NUXT_AI_API_KEY
    aiGatewayBaseUrl: '', // NUXT_AI_GATEWAY_BASE_URL (optional gateway endpoint)

    // Browser-safe values.
    public: {
      supabaseUrl: '', // NUXT_PUBLIC_SUPABASE_URL
      supabaseAnonKey: '', // NUXT_PUBLIC_SUPABASE_ANON_KEY
      appUrl: 'http://localhost:3000', // NUXT_PUBLIC_APP_URL
      githubAppSlug: '', // NUXT_PUBLIC_GITHUB_APP_SLUG
    },
  },

  nitro: {
    // The service-role Supabase client must only ever run on the server.
    // Nitro auto-imports helpers from server/utils.
  },

  app: {
    head: {
      title: 'PR Evidence Pack',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
})
