<script setup lang="ts">
import { ref } from 'vue';
import { router } from './router';
const ready = ref(false);
void router.isReady().finally(() => {
  ready.value = true;
});
</script>

<template>
  <router-view v-if="ready" />
  <div v-else class="boot-loading" role="status" aria-live="polite">
    <q-spinner color="primary" size="34px" />
    <span>Opening your workspace…</span>
  </div>
</template>
