<script setup lang="ts">
// Default authenticated layout: a wordmark that doubles as a home link, the
// signed-in identity, and a sign-out control that only appears when a user is
// signed in. Colors and spacing come from the global tokens in assets/css.
const { user, signOut } = useAuth()
</script>

<template>
  <div class="shell">
    <header class="shell-header">
      <NuxtLink to="/dashboard" class="brand">
        <span class="brand-mark" aria-hidden="true">PR</span>
        <span class="brand-name">Evidence&nbsp;Pack</span>
      </NuxtLink>

      <nav v-if="user" class="shell-nav">
        <span class="shell-user">{{ user.email }}</span>
        <button type="button" class="btn" @click="signOut">Sign out</button>
      </nav>
    </header>

    <main class="shell-main">
      <slot />
    </main>

    <footer class="shell-footer">
      <span>Read-only pull-request review evidence.</span>
      <span class="shell-footer-dot" aria-hidden="true">&middot;</span>
      <span>Every claim links to an immutable commit.</span>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.shell-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 1.5rem;
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  position: sticky;
  top: 0;
  z-index: 10;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  text-decoration: none;
  color: var(--c-ink);
}
.brand-mark {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.02em;
  color: #fff;
  background: var(--c-accent);
  border-radius: var(--radius-sm);
  padding: 0.28rem 0.42rem;
  line-height: 1;
}
.brand-name {
  font-weight: 600;
  letter-spacing: -0.01em;
}
.shell-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}
.shell-user {
  color: var(--c-ink-soft);
  font-size: 0.88rem;
  font-family: var(--font-mono);
}
.shell-main {
  flex: 1;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1.5rem 3rem;
}
.shell-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
  padding: 1.25rem 1.5rem;
  border-top: 1px solid var(--c-border);
  color: var(--c-ink-faint);
  font-size: var(--step-1);
}
.shell-footer-dot {
  color: var(--c-border-strong);
}
@media (max-width: 520px) {
  .shell-user {
    display: none;
  }
}
</style>
