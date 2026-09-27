<script setup lang="ts">
// Default authenticated layout: app title plus a sign-out control that only
// appears when a user is signed in.
const { user, signOut } = useAuth()
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <NuxtLink to="/dashboard" class="app-title">PR Evidence Pack</NuxtLink>
      <nav class="app-nav">
        <span v-if="user" class="app-user">{{ user.email }}</span>
        <button v-if="user" type="button" class="app-signout" @click="signOut">
          Sign out
        </button>
      </nav>
    </header>

    <main class="app-main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
  color: #1a1a1a;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid #e5e5e5;
}
.app-title {
  font-weight: 600;
  text-decoration: none;
  color: inherit;
}
.app-nav {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.app-user {
  color: #555;
  font-size: 0.9rem;
}
.app-signout {
  cursor: pointer;
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
}
.app-main {
  padding: 1.5rem;
  max-width: 960px;
  margin: 0 auto;
}
</style>
