<script setup lang="ts">
// Protected dashboard. Gated by the `auth` middleware so anonymous users are
// redirected to /login (Milestone 1 acceptance criteria). Handles loading and
// empty states.
//
// FEAT-002 will populate connected installations and selectable repositories
// here; for now the dashboard renders the empty state with a seam for the
// GitHub App connect flow.
definePageMeta({
  middleware: 'auth',
})

const { user, loading } = useAuth()

// Placeholder for connected installations. FEAT-002 replaces this with a fetch
// from /api/github/installations.
const installations = ref<Array<{ id: string; accountLogin: string }>>([])
const hasInstallations = computed(() => installations.value.length > 0)
</script>

<template>
  <section class="dashboard">
    <h1>Dashboard</h1>

    <p v-if="loading" class="dashboard-loading">Loading your account...</p>

    <template v-else>
      <p v-if="user" class="dashboard-welcome">
        Signed in as {{ user.email }}.
      </p>

      <div v-if="!hasInstallations" class="dashboard-empty">
        <h2>No GitHub App connected yet</h2>
        <p>
          Connect a read-only GitHub App installation to select a pull request
          for analysis. Connecting installations is added in a later milestone.
        </p>
      </div>

      <ul v-else class="dashboard-installations">
        <li v-for="inst in installations" :key="inst.id">
          {{ inst.accountLogin }}
        </li>
      </ul>
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
.dashboard-installations {
  margin-top: 1.5rem;
  padding-left: 1.25rem;
}
</style>
