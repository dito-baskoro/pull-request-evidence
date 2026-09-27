<script setup lang="ts">
// Analysis view (plan section 4; Milestones 3-4).
//
// Polls /api/analyses/:id for status and renders the deterministic change map
// plus the registered evidence spans with working commit permalinks. Evidence
// links point at the immutable commit SHA.
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const analysisId = computed(() => String(route.params.id))

const { data, pending, error, refresh } = await useFetch(
  () => `/api/analyses/${analysisId.value}`,
)
</script>

<template>
  <section class="analysis">
    <h1>Analysis</h1>

    <p v-if="pending">Loading analysis...</p>
    <p v-else-if="error" class="analysis-error">{{ error.message }}</p>

    <template v-else-if="data">
      <div class="analysis-status">
        <span class="status-pill">{{ data.status }}</span>
        <span v-if="data.coverageStatus" class="coverage">coverage: {{ data.coverageStatus }}</span>
        <button type="button" @click="refresh()">Refresh</button>
        <NuxtLink class="report-link" :to="`/reports/${analysisId}`">View cited report</NuxtLink>
      </div>
      <p v-if="data.errorMessage" class="analysis-error">{{ data.errorMessage }}</p>

      <ChangeMap :change-map="data.changeMap" />

      <h2>Registered evidence</h2>
      <p class="analysis-note">
        Each span was registered with an opaque, stable ID before any AI call
        and links to the immutable commit SHA.
      </p>
      <ul class="evidence-list">
        <li v-for="ev in data.evidence" :key="ev.evidenceKey">
          <span class="evidence-key">{{ ev.evidenceKey }}</span>
          <code>{{ ev.filePath }}</code>
          <span class="evidence-side">{{ ev.side }} L{{ ev.startLine }}-{{ ev.endLine }}</span>
          <a v-if="ev.permalink" :href="ev.permalink" target="_blank" rel="noopener noreferrer">permalink</a>
        </li>
      </ul>
      <p v-if="!data.evidence.length" class="analysis-note">
        No evidence spans were registered for this run.
      </p>
    </template>
  </section>
</template>

<style scoped>
.analysis-status {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.5rem;
}
.status-pill {
  text-transform: uppercase;
  font-size: 0.75rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
}
.coverage {
  color: #666;
  font-size: 0.85rem;
}
.analysis-error {
  color: #b3261e;
}
.analysis-note {
  color: #666;
  font-size: 0.9rem;
}
.evidence-list {
  list-style: none;
  padding: 0;
}
.evidence-list li {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  padding: 0.3rem 0;
  border-bottom: 1px solid #f0f0f0;
  flex-wrap: wrap;
}
.evidence-key {
  font-family: monospace;
  font-weight: 600;
}
.evidence-side {
  color: #777;
  font-size: 0.8rem;
}
</style>
