<script setup lang="ts">
// Landing route. Redirects to the dashboard; the auth middleware there bounces
// anonymous users to /login.
onMounted(() => {
  navigateTo('/dashboard')
})
</script>

<template>
  <section>
    <p>Redirecting...</p>
  </section>
</template>
