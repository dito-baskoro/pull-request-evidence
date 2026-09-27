<script setup lang="ts">
// Deterministic change-map view (plan sections 4 and 9; Milestone 4).
//
// Renders category counts, the per-file disposition (with a VISIBLE reason for
// every exclusion), and candidate source<->test associations. Candidate
// associations are explicitly labelled as hints, NOT proof of coverage, per the
// plan's requirement that the UI never claims a candidate association proves
// coverage.
import type { DeterministicChangeMap } from '~/server/utils/analysis/change-map'
import type { FileClass } from '~/types/analysis'

const props = defineProps<{ changeMap: DeterministicChangeMap }>()

const CLASS_LABELS: Record<FileClass, string> = {
  production_source: 'Production source',
  test: 'Test',
  migration: 'Database migration',
  configuration: 'Configuration',
  dependency_manifest: 'Dependency manifest',
  lockfile: 'Lockfile',
  documentation: 'Documentation',
  generated: 'Generated',
  binary_unsupported: 'Binary / unsupported',
}

const totals = computed(() =>
  Object.entries(props.changeMap.totalsByClass).map(([cls, stats]) => ({
    cls: cls as FileClass,
    label: CLASS_LABELS[cls as FileClass],
    ...stats!,
  })),
)

const excluded = computed(() =>
  props.changeMap.entries.filter((e) => e.disposition !== 'included'),
)
</script>

<template>
  <section class="change-map">
    <h2>Change map</h2>
    <p class="change-map-note">
      Generated deterministically, without any AI model.
    </p>

    <h3>Files by category</h3>
    <table class="change-map-table">
      <thead>
        <tr>
          <th>Category</th>
          <th>Files</th>
          <th>Additions</th>
          <th>Deletions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in totals" :key="row.cls">
          <td>{{ row.label }}</td>
          <td>{{ row.files }}</td>
          <td class="add">+{{ row.additions }}</td>
          <td class="del">-{{ row.deletions }}</td>
        </tr>
      </tbody>
    </table>

    <template v-if="excluded.length">
      <h3>Excluded or summarized files</h3>
      <p class="change-map-note">
        These files are not sent verbatim to analysis. The reason is shown for
        each so the decision is inspectable.
      </p>
      <ul class="change-map-exclusions">
        <li v-for="entry in excluded" :key="entry.path">
          <code>{{ entry.path }}</code>
          <span class="disposition">{{ entry.disposition }}</span>
          <span class="reason">{{ entry.dispositionReason }}</span>
        </li>
      </ul>
    </template>

    <h3>Candidate source-to-test associations</h3>
    <p class="change-map-caveat">
      These are heuristic candidates only. A candidate association does
      <strong>not</strong> prove the source is tested or covered.
    </p>
    <ul v-if="changeMap.candidateTestAssociations.length" class="change-map-assoc">
      <li v-for="assoc in changeMap.candidateTestAssociations" :key="assoc.sourcePath + assoc.testPath">
        <code>{{ assoc.sourcePath }}</code>
        <span class="assoc-arrow">candidate match</span>
        <code>{{ assoc.testPath }}</code>
        <span class="reason">{{ assoc.reason }}</span>
      </li>
    </ul>
    <p v-else class="change-map-note">
      No candidate test associations were found in the analyzed context. This is
      not a statement that the changed source is untested.
    </p>
  </section>
</template>

<style scoped>
.change-map {
  margin-top: 1rem;
}
.change-map-note {
  color: #666;
  font-size: 0.9rem;
}
.change-map-caveat {
  color: #8a5a00;
  background: #fff8e6;
  border: 1px solid #f0d68a;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-size: 0.9rem;
}
.change-map-table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5rem 0 1rem;
}
.change-map-table th,
.change-map-table td {
  border: 1px solid #e5e5e5;
  padding: 0.35rem 0.6rem;
  text-align: left;
}
.add { color: #157f3b; }
.del { color: #b3261e; }
.change-map-exclusions,
.change-map-assoc {
  list-style: none;
  padding: 0;
}
.change-map-exclusions li,
.change-map-assoc li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  padding: 0.35rem 0;
  border-bottom: 1px solid #f0f0f0;
}
.disposition {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #555;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0 0.35rem;
}
.assoc-arrow {
  font-size: 0.8rem;
  color: #555;
}
.reason {
  color: #777;
  font-size: 0.85rem;
}
</style>
