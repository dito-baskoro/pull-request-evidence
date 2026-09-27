<script setup lang="ts">
// Evidence citation link (plan sections 8, 10; Milestone 5/6).
//
// Renders a single cited evidence span as a clickable GitHub commit permalink
// that opens the exact evidenced lines. The permalink is built SERVER-SIDE from
// the immutable commit SHA (see server/utils/github/permalink.ts); this
// component only displays it. The excerpt is shown read-only so a reviewer can
// preview the source without leaving the page.

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

const props = defineProps<{ evidence: EvidenceSpanView }>()

const lineLabel = computed(() => {
  const { startLine, endLine } = props.evidence
  if (startLine == null) return ''
  if (endLine == null || endLine === startLine) return `L${startLine}`
  return `L${startLine}-L${endLine}`
})
</script>

<template>
  <div class="evidence-link">
    <div class="evidence-head">
      <span class="evidence-key">{{ evidence.evidenceKey }}</span>
      <code v-if="evidence.filePath" class="evidence-path">{{ evidence.filePath }}</code>
      <span class="evidence-loc">{{ evidence.side }} {{ lineLabel }}</span>
      <a
        v-if="evidence.permalink"
        class="evidence-permalink"
        :href="evidence.permalink"
        target="_blank"
        rel="noopener noreferrer"
      >
        View exact lines on GitHub
      </a>
      <span v-else class="evidence-permalink-missing">permalink unavailable</span>
    </div>
    <pre class="evidence-excerpt"><code>{{ evidence.excerpt }}</code></pre>
  </div>
</template>

<style scoped>
.evidence-link {
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  margin: 0.4rem 0;
  background: #fafafa;
}
.evidence-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}
.evidence-key {
  font-family: monospace;
  font-weight: 600;
}
.evidence-path {
  font-size: 0.85rem;
}
.evidence-loc {
  color: #777;
  font-size: 0.8rem;
}
.evidence-permalink {
  margin-left: auto;
  font-size: 0.85rem;
}
.evidence-permalink-missing {
  margin-left: auto;
  font-size: 0.8rem;
  color: #999;
}
.evidence-excerpt {
  margin: 0.4rem 0 0;
  padding: 0.5rem;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.8rem;
  line-height: 1.35;
}
</style>
