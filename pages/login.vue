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
    <h1>Sign in</h1>
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
      <button type="submit" :disabled="status === 'sending'">
        {{ status === 'sending' ? 'Sending...' : 'Send magic link' }}
      </button>
    </form>

    <p v-if="status === 'sent'" class="login-ok">
      Check your inbox for a sign-in link.
    </p>
    <p v-if="status === 'error'" class="login-error">
      {{ errorMessage }}
    </p>
  </section>
</template>

<style scoped>
.login {
  max-width: 380px;
  margin: 3rem auto;
}
.login-lead {
  color: #555;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
}
.login-form input {
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 6px;
}
.login-form button {
  margin-top: 0.5rem;
  padding: 0.5rem;
  border: none;
  border-radius: 6px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
}
.login-form button:disabled {
  opacity: 0.6;
  cursor: default;
}
.login-ok {
  color: #157347;
  margin-top: 1rem;
}
.login-error {
  color: #b02a37;
  margin-top: 1rem;
}
</style>
