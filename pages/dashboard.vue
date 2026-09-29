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

// Repository selection. Repositories are live-fetched with a blank id, so
// selecting one persists it (POST /api/github/repositories) to obtain the
// stored uuid the pulls/analyses endpoints require. The uuid is keyed by the
// GitHub repository id so re-selecting is cheap and idempotent.
const selectedGithubRepoId = ref<number | null>(null)
const selectedRepositoryId = ref<string | null>(null)
const repoSelectPending = ref(false)
const repoError = ref('')

// Open pull requests for the selected (persisted) repository.
const pulls = ref<Array<{ number: number; title: string; authorLogin: string | null; headSha: string }>>([])
const pullsPending = ref(false)

// Per-PR "Run analysis" in-flight number (the pipeline runs synchronously).
const analyzingPr = ref<number | null>(null)

async function selectRepository(repo: { githubRepositoryId: number; installationId: string }) {
  repoError.value = ''
  selectedGithubRepoId.value = repo.githubRepositoryId
  selectedRepositoryId.value = null
  pulls.value = []
  repoSelectPending.value = true
  try {
    const { repository } = await $fetch('/api/github/repositories', {
      method: 'POST',
      body: {
        installationId: repo.installationId,
        githubRepositoryId: repo.githubRepositoryId,
      },
    })
    selectedRepositoryId.value = repository.id
    await loadPulls(repository.id)
  }
  catch (err: any) {
    repoError.value = errorMessage(err, 'Could not open this repository.')
  }
  finally {
    repoSelectPending.value = false
  }
}

async function loadPulls(repositoryId: string) {
  pullsPending.value = true
  try {
    const res = await $fetch('/api/github/pulls', { query: { repositoryId } })
    pulls.value = res.pulls ?? []
  }
  catch (err: any) {
    repoError.value = errorMessage(err, 'Could not load pull requests.')
  }
  finally {
    pullsPending.value = false
  }
}

async function runAnalysis(pullRequestNumber: number) {
  if (!selectedRepositoryId.value) return
  repoError.value = ''
  analyzingPr.value = pullRequestNumber
  try {
    const { analysisId } = await $fetch('/api/analyses', {
      method: 'POST',
      body: { repositoryId: selectedRepositoryId.value, pullRequestNumber },
    })
    await navigateTo(`/analyses/${analysisId}`)
  }
  catch (err: any) {
    repoError.value = errorMessage(err, 'Analysis failed. Please try again.')
    analyzingPr.value = null
  }
}

function errorMessage(err: any, fallback: string): string {
  return err?.data?.statusMessage || err?.statusMessage || err?.message || fallback
}

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
          <p class="dashboard-note">Select a repository to list its open pull requests.</p>
          <p v-if="repoPending" class="dashboard-loading">Loading repositories...</p>
          <ul v-else class="dashboard-repos">
            <li v-for="repo in repositories" :key="repo.githubRepositoryId">
              <button
                type="button"
                class="repo-button"
                :class="{ active: selectedGithubRepoId === repo.githubRepositoryId }"
                :disabled="repoSelectPending && selectedGithubRepoId === repo.githubRepositoryId"
                @click="selectRepository(repo)"
              >
                {{ repo.owner }}/{{ repo.name }}
                <span v-if="repo.isPrivate" class="repo-private">private</span>
                <span
                  v-if="repoSelectPending && selectedGithubRepoId === repo.githubRepositoryId"
                  class="repo-loading"
                >opening...</span>
              </button>
            </li>
          </ul>

          <p v-if="repoError" class="dashboard-banner dashboard-banner-error" role="alert">
            {{ repoError }}
          </p>

          <template v-if="selectedGithubRepoId && !repoSelectPending">
            <h2>Open pull requests</h2>
            <p v-if="pullsPending" class="dashboard-loading">Loading pull requests...</p>
            <ul v-else-if="pulls.length" class="dashboard-pulls">
              <li v-for="pr in pulls" :key="pr.number">
                <div class="pull-meta">
                  <span class="pull-number">#{{ pr.number }}</span>
                  <span class="pull-title">{{ pr.title }}</span>
                  <span v-if="pr.authorLogin" class="pull-author">by {{ pr.authorLogin }}</span>
                </div>
                <button
                  type="button"
                  class="pull-analyze"
                  :disabled="analyzingPr !== null"
                  @click="runAnalysis(pr.number)"
                >
                  {{ analyzingPr === pr.number ? 'Analyzing...' : 'Run analysis' }}
                </button>
              </li>
            </ul>
            <p v-else-if="selectedRepositoryId" class="dashboard-note">
              No open pull requests found for this repository.
            </p>
          </template>
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
  padding: 0.15rem 0;
}
.dashboard-note {
  color: #666;
  font-size: 0.9rem;
  margin: 0.25rem 0 0.5rem;
}
.repo-button {
  cursor: pointer;
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  text-align: left;
}
.repo-button:disabled {
  cursor: default;
  opacity: 0.7;
}
.repo-button.active {
  border-color: #1a73e8;
  background: #eef4ff;
}
.repo-loading {
  color: #777;
  font-size: 0.75rem;
  margin-left: 0.4rem;
}
.dashboard-pulls {
  list-style: none;
  padding: 0;
}
.dashboard-pulls li {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0;
  border-bottom: 1px solid #f0f0f0;
  flex-wrap: wrap;
}
.pull-meta {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  flex-wrap: wrap;
}
.pull-number {
  font-family: monospace;
  color: #555;
}
.pull-title {
  font-weight: 500;
}
.pull-author {
  color: #777;
  font-size: 0.8rem;
}
.pull-analyze {
  cursor: pointer;
  border: 1px solid #1a73e8;
  background: #1a73e8;
  color: #fff;
  border-radius: 6px;
  padding: 0.3rem 0.7rem;
}
.pull-analyze:disabled {
  cursor: default;
  opacity: 0.6;
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
