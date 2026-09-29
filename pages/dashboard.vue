<script setup lang="ts">
// Protected dashboard (Milestone 1/2). Lists the connected installations the
// user owns and, for a selected installation, the repositories reachable
// through it. Selecting a repository navigates to the pull-request picker.
import { runInstallCallback } from '~/pages/dashboard-callback'

definePageMeta({
  middleware: 'auth',
})

const { user, loading } = useAuth()

const { data: installData, pending: installPending, refresh: refreshInstalls } = await useFetch('/api/github/installations')
const installations = computed(() => installData.value?.installations ?? [])
const hasInstallations = computed(() => installations.value.length > 0)

// Post-install callback state. When the GitHub App Setup URL redirects back to
// this page it appends installation_id, setup_action, and the server-issued
// state token as query params. We POST them to /api/github/installations so the
// installation is persisted for the signed-in user (the server verifies the
// state token before recording anything), then refresh the list. The query is
// cleared ONLY on success so a reload does not re-post; on failure the query is
// preserved so a reload re-attempts. The connectHandled guard keeps this to a
// single run per landing, preventing an infinite re-POST loop.
//
// The normalization + POST + success/failure branching lives in the extracted
// runInstallCallback so it can be unit-tested without Vue/Nitro (see
// pages/dashboard-callback.ts and test/dashboard-callback.test.ts).
const route = useRoute()
const connectStatus = ref<'idle' | 'success' | 'error'>('idle')
const connectMessage = ref('')
let connectHandled = false

async function handleInstallCallback() {
  if (connectHandled) return
  connectHandled = true

  const result = await runInstallCallback({
    installationId: route.query.installation_id,
    setupAction: route.query.setup_action,
    state: route.query.state,
    post: (body) =>
      $fetch('/api/github/installations', { method: 'POST', body }),
    refresh: () => refreshInstalls(),
    // Strip the connect query params so a reload does not re-post. Only invoked
    // by runInstallCallback on success.
    stripQuery: () => navigateTo({ path: route.path, query: {} }, { replace: true }),
  })

  if (result.status !== 'idle') {
    connectStatus.value = result.status
    connectMessage.value = result.message
  }
}

// onMounted only runs on the client, so no inner import.meta.client check is
// needed. The connectHandled guard keeps this to a single run per landing.
onMounted(() => {
  void handleInstallCallback()
})

const selectedInstallationId = ref<string | null>(null)

const { data: repoData, pending: repoPending } = await useAsyncData(
  'repositories',
  () =>
    selectedInstallationId.value
      ? $fetch('/api/github/repositories', {
          query: { installationId: selectedInstallationId.value },
        })
      : Promise.resolve({ repositories: [] }),
  { watch: [selectedInstallationId] },
)
const repositories = computed(() => repoData.value?.repositories ?? [])

// The "Connect GitHub App" link uses a server-issued install URL that carries a
// per-user state token (GET /api/github/connect signs it bound to the signed-in
// user). GitHub echoes the token back on the setup redirect, and the connect
// route verifies it before recording the installation. Building the URL
// client-side from the slug alone would omit the state and reopen the
// cross-tenant claim, so the URL is fetched from the server. The link stays
// hidden when the URL is unavailable (e.g. slug or secret not configured).
const { data: connectData } = await useFetch('/api/github/connect', {
  // A failed connect-URL fetch must not break the dashboard render; the link
  // simply stays hidden.
  default: () => ({ installUrl: '' }),
})
const installUrl = computed(() => connectData.value?.installUrl || null)
</script>

<template>
  <section class="dashboard">
    <h1>Dashboard</h1>

    <p v-if="connectStatus === 'success'" class="dashboard-banner dashboard-banner-success" role="status">
      {{ connectMessage }}
    </p>
    <p v-else-if="connectStatus === 'error'" class="dashboard-banner dashboard-banner-error" role="alert">
      {{ connectMessage }}
    </p>

    <p v-if="loading || installPending" class="dashboard-loading">Loading your account...</p>

    <template v-else>
      <p v-if="user" class="dashboard-welcome">
        Signed in as {{ user.email }}.
      </p>

      <div v-if="!hasInstallations" class="dashboard-empty">
        <h2>No GitHub App connected yet</h2>
        <p>
          Connect a read-only GitHub App installation to select a pull request
          for analysis.
        </p>
        <a v-if="installUrl" :href="installUrl" class="dashboard-connect">Connect GitHub App</a>
      </div>

      <template v-else>
        <h2>Installations</h2>
        <ul class="dashboard-installations">
          <li v-for="inst in installations" :key="inst.id">
            <button
              type="button"
              :class="{ active: selectedInstallationId === inst.id }"
              @click="selectedInstallationId = inst.id"
            >
              {{ inst.accountLogin }} ({{ inst.accountType }})
            </button>
          </li>
        </ul>

        <template v-if="selectedInstallationId">
          <h2>Repositories</h2>
          <p v-if="repoPending" class="dashboard-loading">Loading repositories...</p>
          <ul v-else class="dashboard-repos">
            <li v-for="repo in repositories" :key="repo.githubRepositoryId">
              {{ repo.owner }}/{{ repo.name }}
              <span v-if="repo.isPrivate" class="repo-private">private</span>
            </li>
          </ul>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.dashboard {
  max-width: 720px;
}
.dashboard-loading {
  color: #777;
}
.dashboard-banner {
  margin-top: 1rem;
  padding: 0.6rem 0.9rem;
  border-radius: 6px;
  border: 1px solid transparent;
}
.dashboard-banner-success {
  color: #1b5e20;
  background: #e8f5e9;
  border-color: #a5d6a7;
}
.dashboard-banner-error {
  color: #8a1c1c;
  background: #fdecea;
  border-color: #f5b5b0;
}
.dashboard-welcome {
  color: #555;
}
.dashboard-empty {
  margin-top: 1.5rem;
  padding: 1.25rem;
  border: 1px dashed #ccc;
  border-radius: 8px;
  background: #fafafa;
}
.dashboard-empty h2 {
  margin-top: 0;
  font-size: 1.1rem;
}
.dashboard-connect {
  display: inline-block;
  margin-top: 0.5rem;
}
.dashboard-installations,
.dashboard-repos {
  list-style: none;
  padding: 0;
}
.dashboard-installations button {
  cursor: pointer;
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  margin: 0.15rem 0;
}
.dashboard-installations button.active {
  border-color: #1a73e8;
  background: #eef4ff;
}
.dashboard-repos li {
  padding: 0.25rem 0;
}
.repo-private {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: #8a5a00;
  border: 1px solid #f0d68a;
  border-radius: 4px;
  padding: 0 0.35rem;
  margin-left: 0.5rem;
}
</style>
