<script setup lang="ts">
// Login page. Sends a magic-link email via Supabase auth. If a user is already
// signed in, they are sent to the dashboard.
const { user, refresh, signInWithEmail } = useAuth()

const email = ref('')
const status = ref<'idle' | 'sending' | 'sent' | 'error'>('idle')
const errorMessage = ref<string | null>(null)

onMounted(async () => {
  await refresh()
  if (user.value) {
    await navigateTo('/dashboard')
  }
})

async function onSubmit() {
  errorMessage.value = null
  status.value = 'sending'
  const { error } = await signInWithEmail(email.value.trim())
  if (error) {
    status.value = 'error'
    errorMessage.value = error.message
    return
  }
  status.value = 'sent'
}
</script>

<template>
  <section class="login">
    <div class="panel login-card">
      <p class="eyebrow">PR Evidence Pack</p>
      <h1 class="login-title">Sign in</h1>
      <p class="login-lead">
        Enter your email and we will send you a magic sign-in link.
      </p>

      <form class="login-form" @submit.prevent="onSubmit">
        <label for="email">Email</label>
        <input
          id="email"
          v-model="email"
          type="email"
          required
          autocomplete="email"
          placeholder="you@example.com"
        >
        <button type="submit" class="btn btn-primary login-submit" :disabled="status === 'sending'">
          {{ status === 'sending' ? 'Sending\u2026' : 'Send magic link' }}
        </button>
      </form>

      <p v-if="status === 'sent'" class="notice notice-ok login-msg" role="status">
        Check your inbox for a sign-in link.
      </p>
      <p v-if="status === 'error'" class="notice notice-err login-msg" role="alert">
        {{ errorMessage }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.login {
  max-width: 420px;
  margin: 3rem auto;
}
.login-card {
  padding: 1.75rem;
}
.login-title {
  font-size: var(--step2);
  margin: 0.35rem 0 0.4rem;
}
.login-lead {
  color: var(--c-ink-soft);
  margin: 0;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 1.25rem;
}
.login-form label {
  font-size: var(--step-1);
  font-weight: 600;
  color: var(--c-ink-soft);
}
.login-form input {
  font: inherit;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
}
.login-form input:focus {
  outline: none;
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-tint);
}
.login-submit {
  margin-top: 0.6rem;
}
.login-msg {
  margin-top: 1rem;
}
</style>
