<script setup lang="ts">
// Root application shell. Pages render inside the default layout via NuxtPage.
// Auth session is refreshed once on mount so the layout can reflect sign-in
// state immediately.
const { refresh } = useAuth()

onMounted(() => {
  refresh()
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
