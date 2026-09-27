<script setup lang="ts">
// Protected dashboard (Milestone 1/2). Lists the connected installations the
// user owns and, for a selected installation, the repositories reachable
// through it. Selecting a repository navigates to the pull-request picker.
definePageMeta({
  middleware: 'auth',
})

const { user, loading } = useAuth()

const { data: installData, pending: installPending } = await useFetch('/api/github/installations')
const installations = computed(() => installData.value?.installations ?? [])
const hasInstallations = computed(() => installations.value.length > 0)

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

const config = useRuntimeConfig()
const installUrl = computed(() =>
  config.public.githubAppSlug
    ? `https://github.com/apps/${config.public.githubAppSlug}/installations/new`
    : null,
)
</script>

<template>
  <section class="dashboard">
    <h1>Dashboard</h1>

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
