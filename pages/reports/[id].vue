<script setup lang="ts">
// Report view (plan sections 4, 10; Milestone 5/6).
//
// Renders the validated behavioral-change claims for an analysis run: each
// claim's classification badge + confidence and its cited evidence spans as
// clickable GitHub commit permalinks (built from the immutable SHA server-side).
// It also shows an analysis-status / limitations area so partial or failed runs
// are honest about what could not be determined. It never renders "no test
// found" as "untested".
//
// The report id is the analysis run id; this reuses GET /api/analyses/:id which
// now includes reportItems with their evidence spans.
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const reportId = computed(() => String(route.params.id))

const { data, pending, error, refresh } = await useFetch(
  () => `/api/analyses/${reportId.value}`,
)

const behavioralItems = computed(() =>
  (data.value?.reportItems ?? []).filter((i) => i.section === 'behavioral_changes'),
)

const facts = computed(() =>
  behavioralItems.value.filter((i) => i.validationStatus === 'valid'),
)
const unknowns = computed(() =>
  behavioralItems.value.filter((i) => i.validationStatus !== 'valid'),
)

const isFailed = computed(() => data.value?.status === 'failed')
const isComplete = computed(() => data.value?.status === 'complete')
</script>

<template>
  <section class="report">
    <h1>Evidence Pack report</h1>

    <p v-if="pending">Loading report...</p>
    <p v-else-if="error" class="report-error">{{ error.message }}</p>

    <template v-else-if="data">
      <!-- Analysis status + limitations. Always visible so the report is honest
           about coverage and failures. -->
      <div class="report-status">
        <span class="status-pill">{{ data.status }}</span>
        <span v-if="data.coverageStatus" class="coverage">coverage: {{ data.coverageStatus }}</span>
        <span v-if="data.modelId" class="provenance">model: {{ data.modelId }}</span>
        <span v-if="data.workflowVersion" class="provenance">workflow: {{ data.workflowVersion }}</span>
        <button type="button" @click="refresh()">Refresh</button>
      </div>

      <div v-if="isFailed" class="report-limitations report-error">
        <strong>Analysis did not complete.</strong>
        The AI stage failed, so behavioral claims below may be incomplete or
        absent. The deterministic change map and registered evidence remain
        valid.
        <span v-if="data.errorCode"> (code: {{ data.errorCode }})</span>
      </div>
      <div v-else-if="data.coverageStatus && data.coverageStatus !== 'complete'" class="report-limitations">
        <strong>Partial analysis.</strong>
        Only part of the pull request was analyzed. Absence of a claim here does
        not mean a behavior is safe or that changed code is untested; it means no
        matching evidence was found in the analyzed context.
      </div>

      <section class="report-section">
        <h2>Behavioral changes</h2>
        <p class="report-note">
          Each claim is grounded in registered evidence. Observed and inferred
          claims are shown distinctly. Every cited span links to the exact lines
          at the immutable commit SHA.
        </p>

        <template v-if="facts.length">
          <ReportItemCard v-for="item in facts" :key="item.id" :item="item" />
        </template>
        <p v-else-if="isComplete" class="report-note">
          No behavioral-change claims were grounded in validated evidence for
          this run. This is not a statement that the pull request has no
          behavioral impact; it means no matching evidence was found in the
          analyzed context.
        </p>

        <template v-if="unknowns.length">
          <h3>Statements shown as unknown</h3>
          <p class="report-note">
            These statements could not be grounded in validated evidence and are
            therefore not presented as facts.
          </p>
          <ReportItemCard v-for="item in unknowns" :key="item.id" :item="item" />
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.report-status {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.75rem;
}
.status-pill {
  text-transform: uppercase;
  font-size: 0.75rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
}
.coverage,
.provenance {
  color: #666;
  font-size: 0.85rem;
}
.report-error {
  color: #b3261e;
}
.report-limitations {
  border: 1px solid #f0d68a;
  background: #fff8e6;
  color: #7a5600;
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}
.report-limitations.report-error {
  border-color: #f0b3ae;
  background: #fdecea;
  color: #8a1a12;
}
.report-note {
  color: #666;
  font-size: 0.9rem;
}
</style>
