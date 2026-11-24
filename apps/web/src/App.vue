<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuth } from '@/stores/auth';
import AppHeader from '@/components/AppHeader.vue';
import ToastHost from '@/components/ToastHost.vue';

const auth = useAuth();
const route = useRoute();
const showHeader = computed(() => auth.isLoggedIn && !route.meta.public);
</script>

<template>
  <AppHeader v-if="showHeader" />
  <main>
    <RouterView :key="route.fullPath" />
  </main>
  <ToastHost />
</template>
