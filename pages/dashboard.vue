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
  <section class="dash">
    <header class="dash-head">
      <p class="eyebrow">Workspace</p>
      <h1 class="dash-title">Choose a pull request to analyze</h1>
      <p class="dash-sub">
        Pick a connected installation, open a repository, then run analysis on an
        open pull request. The result is a cited evidence pack, not an approval.
      </p>
    </header>

    <p v-if="connectStatus === 'success'" class="notice notice-ok" role="status">
      {{ connectMessage }}
    </p>
    <p v-else-if="connectStatus === 'error'" class="notice notice-err" role="alert">
      {{ connectMessage }}
    </p>

    <p v-if="loading || installPending" class="dash-loading">Loading your account&hellip;</p>

    <template v-else>
      <!-- Empty state: no installation connected. -->
      <div v-if="!hasInstallations" class="panel dash-empty">
        <p class="eyebrow">Get started</p>
        <h2 class="dash-empty-title">No GitHub App connected yet</h2>
        <p class="dash-empty-body">
          Connect a read-only GitHub App installation to select a pull request
          for analysis. The app only ever reads; it never comments or approves.
        </p>
        <a v-if="installUrl" :href="installUrl" class="btn btn-primary dash-empty-cta">
          Connect GitHub App
        </a>
      </div>

      <!-- Three-step flow, laid out as a numbered pipeline. -->
      <ol v-else class="flow">
        <!-- Step 1: installations -->
        <li class="flow-step">
          <div class="flow-marker"><span>1</span></div>
          <div class="flow-body">
            <h2 class="flow-title">Installation</h2>
            <div class="chip-row">
              <button
                v-for="inst in installations"
                :key="inst.id"
                type="button"
                class="pick"
                :class="{ 'pick-active': selectedInstallationId === inst.id }"
                @click="selectedInstallationId = inst.id"
              >
                <span class="pick-name">{{ inst.accountLogin }}</span>
                <span class="chip">{{ inst.accountType }}</span>
              </button>
            </div>
          </div>
        </li>

        <!-- Step 2: repositories -->
        <li class="flow-step" :class="{ 'flow-step-idle': !selectedInstallationId }">
          <div class="flow-marker"><span>2</span></div>
          <div class="flow-body">
            <h2 class="flow-title">Repository</h2>
            <p v-if="!selectedInstallationId" class="dash-hint">Select an installation first.</p>
            <template v-else>
              <p class="dash-hint">Selecting a repository loads its open pull requests.</p>
              <p v-if="repoPending" class="dash-loading">Loading repositories&hellip;</p>
              <div v-else-if="repositories.length" class="chip-row">
                <button
                  v-for="repo in repositories"
                  :key="repo.githubRepositoryId"
                  type="button"
                  class="pick"
                  :class="{ 'pick-active': selectedGithubRepoId === repo.githubRepositoryId }"
                  :disabled="repoSelectPending && selectedGithubRepoId === repo.githubRepositoryId"
                  @click="selectRepository(repo)"
                >
                  <span class="pick-name">
                    <span class="pick-owner">{{ repo.owner }}/</span>{{ repo.name }}
                  </span>
                  <span v-if="repo.isPrivate" class="chip">private</span>
                  <span
                    v-if="repoSelectPending && selectedGithubRepoId === repo.githubRepositoryId"
                    class="pick-spin"
                  >opening&hellip;</span>
                </button>
              </div>
              <p v-else class="dash-hint">No repositories are accessible through this installation.</p>
              <p v-if="repoError" class="notice notice-err" role="alert">{{ repoError }}</p>
            </template>
          </div>
        </li>

        <!-- Step 3: pull requests -->
        <li
          class="flow-step flow-step-last"
          :class="{ 'flow-step-idle': !selectedGithubRepoId }"
        >
          <div class="flow-marker"><span>3</span></div>
          <div class="flow-body">
            <h2 class="flow-title">Pull request</h2>
            <p v-if="!selectedGithubRepoId" class="dash-hint">Select a repository first.</p>
            <template v-else-if="!repoSelectPending">
              <p v-if="pullsPending" class="dash-loading">Loading pull requests&hellip;</p>
              <ul v-else-if="pulls.length" class="pr-list">
                <li v-for="pr in pulls" :key="pr.number" class="pr-row">
                  <div class="pr-info">
                    <div class="pr-line">
                      <span class="pr-num">#{{ pr.number }}</span>
                      <span class="pr-title">{{ pr.title }}</span>
                    </div>
                    <div class="pr-sub">
                      <span v-if="pr.authorLogin">{{ pr.authorLogin }}</span>
                      <span class="pr-sha">{{ pr.headSha.slice(0, 7) }}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="btn btn-primary pr-run"
                    :disabled="analyzingPr !== null"
                    @click="runAnalysis(pr.number)"
                  >
                    {{ analyzingPr === pr.number ? 'Analyzing\u2026' : 'Run analysis' }}
                  </button>
                </li>
              </ul>
              <p v-else-if="selectedRepositoryId" class="dash-hint">
                No open pull requests found for this repository.
              </p>
            </template>
          </div>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
.dash-head {
  margin-bottom: 1.5rem;
}
.dash-title {
  font-size: var(--step3);
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0.35rem 0 0.5rem;
}
.dash-sub {
  color: var(--c-ink-soft);
  max-width: 46ch;
  margin: 0;
}
.dash-loading,
.dash-hint {
  color: var(--c-ink-faint);
  font-size: 0.9rem;
  margin: 0.35rem 0;
}

/* Empty state */
.dash-empty {
  padding: 1.75rem;
  margin-top: 0.5rem;
}
.dash-empty-title {
  font-size: var(--step2);
  margin: 0.35rem 0 0.5rem;
}
.dash-empty-body {
  color: var(--c-ink-soft);
  max-width: 52ch;
  margin: 0 0 1.1rem;
}
.dash-empty-cta {
  text-decoration: none;
}

/* Numbered pipeline */
.flow {
  list-style: none;
  margin: 0;
  padding: 0;
}
.flow-step {
  display: grid;
  grid-template-columns: 2rem 1fr;
  gap: 1rem;
  position: relative;
  padding-bottom: 1.75rem;
}
/* Connector line runs through the markers, stopping at the last step. */
.flow-step:not(.flow-step-last)::before {
  content: "";
  position: absolute;
  left: 0.97rem;
  top: 2rem;
  bottom: 0;
  width: 2px;
  background: var(--c-border);
}
.flow-marker {
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--c-surface);
  border: 1px solid var(--c-border-strong);
  color: var(--c-ink-soft);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  z-index: 1;
}
.flow-title {
  font-size: var(--step1);
  margin: 0.2rem 0 0.6rem;
}
.flow-step-idle .flow-marker {
  color: var(--c-ink-faint);
}
.flow-step-idle .flow-title {
  color: var(--c-ink-faint);
}

/* Selectable chips (installations + repositories) */
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.pick {
  font: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--c-surface);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.7rem;
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}
.pick:hover:not(:disabled) {
  border-color: var(--c-accent);
}
.pick:disabled {
  cursor: default;
  opacity: 0.6;
}
.pick-active {
  border-color: var(--c-accent);
  background: var(--c-accent-tint);
  box-shadow: inset 0 0 0 1px var(--c-accent);
}
.pick-name {
  font-weight: 500;
}
.pick-owner {
  color: var(--c-ink-faint);
  font-weight: 400;
}
.pick-spin {
  font-size: var(--step-1);
  color: var(--c-ink-faint);
}

/* Pull-request list */
.pr-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--c-surface);
}
.pr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0.9rem;
  flex-wrap: wrap;
}
.pr-row + .pr-row {
  border-top: 1px solid var(--c-border);
}
.pr-info {
  min-width: 0;
}
.pr-line {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.pr-num {
  font-family: var(--font-mono);
  color: var(--c-ink-faint);
  font-size: 0.85rem;
}
.pr-title {
  font-weight: 500;
}
.pr-sub {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  margin-top: 0.2rem;
  color: var(--c-ink-faint);
  font-size: var(--step-1);
}
.pr-sha {
  font-family: var(--font-mono);
}
.pr-run {
  flex-shrink: 0;
}
</style>
