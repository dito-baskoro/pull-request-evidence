<script setup lang="ts">
// Report item card (plan sections 4, 7, 10; Milestone 5/6).
//
// Renders a single validated behavioral-change claim: its classification badge,
// confidence, statement, and each cited evidence span as a clickable commit
// permalink (via EvidenceLink). Observed vs inferred are VISUALLY DISTINCT
// (different badge colors). Downgraded items are shown as `unknown` and are
// explicitly NOT presented as facts, with the reason surfaced. This honors the
// rule that unsupported claims never appear as observed/inferred facts and that
// "no matching test evidence" is never rendered as "untested".
import type { ReportItemClassification, ValidationStatus } from '~/types/report'

interface EvidenceSpanView {
  evidenceKey: string
  commitSha: string
  filePath: string | null
  side: string
  startLine: number | null
  endLine: number | null
  excerpt: string
  permalink: string | null
}

interface ReportItemView {
  id: string
  classification: ReportItemClassification | string
  title: string
  statement: string
  confidence: number | null
  validationStatus: ValidationStatus | string
  metadata: Record<string, unknown> | null
  evidence: EvidenceSpanView[]
}

const props = defineProps<{ item: ReportItemView }>()

const CLASS_LABELS: Record<string, string> = {
  observed: 'Observed',
  inferred: 'Inferred',
  potential_risk: 'Potential risk',
  unknown: 'Unknown',
  question: 'Reviewer question',
}

const classLabel = computed(() => CLASS_LABELS[props.item.classification] ?? props.item.classification)

const confidencePct = computed(() => {
  const c = props.item.confidence
  if (c == null) return null
  return Math.round(c * 100)
})

const isDowngraded = computed(() => props.item.validationStatus === 'downgraded')

const downgradeReason = computed(() => {
  const reason = props.item.metadata?.downgradeReason
  if (reason === 'no_evidence_cited') return 'The model cited no evidence for this statement.'
  if (reason === 'no_valid_evidence') return 'None of the cited evidence could be validated against the analyzed commit.'
  return null
})

const userVisible = computed(() => props.item.metadata?.userVisible === true)
</script>

<template>
  <article class="report-item" :class="`class-${item.classification}`">
    <header class="report-item-head">
      <span class="badge" :class="`badge-${item.classification}`">{{ classLabel }}</span>
      <span v-if="userVisible" class="visibility">user-visible</span>
      <span v-else class="visibility internal">internal</span>
      <span v-if="confidencePct !== null" class="confidence">confidence {{ confidencePct }}%</span>
      <span class="component">{{ item.title }}</span>
    </header>

    <p class="statement">{{ item.statement }}</p>

    <p v-if="isDowngraded" class="downgrade-note">
      This statement is shown as <strong>unknown</strong> because it could not be
      grounded in validated evidence. It is not presented as a fact.
      <span v-if="downgradeReason"> {{ downgradeReason }}</span>
    </p>

    <template v-if="item.evidence.length">
      <h4 class="evidence-heading">Evidence</h4>
      <EvidenceLink v-for="ev in item.evidence" :key="ev.evidenceKey" :evidence="ev" />
    </template>
  </article>
</template>

<style scoped>
.report-item {
  border: 1px solid #e2e2e2;
  border-left-width: 4px;
  border-radius: 6px;
  padding: 0.75rem 0.9rem;
  margin: 0.75rem 0;
}
/* Observed vs inferred are visually distinct via the left border + badge. */
.class-observed { border-left-color: #157f3b; }
.class-inferred { border-left-color: #2f6fb0; }
.class-unknown { border-left-color: #9a9a9a; }
.report-item-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}
.badge {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-radius: 4px;
  padding: 0.1rem 0.45rem;
  color: #fff;
}
.badge-observed { background: #157f3b; }
.badge-inferred { background: #2f6fb0; }
.badge-unknown { background: #757575; }
.badge-potential_risk { background: #b3261e; }
.badge-question { background: #6b4fbb; }
.visibility {
  font-size: 0.72rem;
  color: #2f6fb0;
  border: 1px solid #cfe0f0;
  border-radius: 4px;
  padding: 0 0.35rem;
}
.visibility.internal {
  color: #666;
  border-color: #ddd;
}
.confidence {
  font-size: 0.8rem;
  color: #555;
}
.component {
  margin-left: auto;
  font-family: monospace;
  font-size: 0.85rem;
  color: #333;
}
.statement {
  margin: 0.5rem 0;
}
.downgrade-note {
  background: #f4f4f4;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  font-size: 0.85rem;
  color: #555;
}
.evidence-heading {
  margin: 0.6rem 0 0.2rem;
  font-size: 0.85rem;
  color: #444;
}
</style>
