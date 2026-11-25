<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuth } from '@/stores/auth';
import { socketConnected } from '@/services/socket';

const auth = useAuth();
const router = useRouter();

function logout() {
  auth.logout();
  void router.push('/login');
}
</script>

<template>
  <header class="border-b border-slate-200 bg-white">
    <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
      <RouterLink :to="auth.homeRoute" class="font-semibold text-indigo-700">Client Help Portal</RouterLink>
      <nav class="flex gap-4 text-sm text-slate-600">
        <RouterLink :to="auth.homeRoute" class="hover:text-slate-900" exact-active-class="text-slate-900 font-medium">
          {{ auth.isAdmin ? 'Admin' : 'Dashboard' }}
        </RouterLink>
        <RouterLink v-if="!auth.isAdmin" to="/history" class="hover:text-slate-900" active-class="text-slate-900 font-medium">History</RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-3 text-sm">
        <span v-if="!socketConnected" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800" title="Live updates paused">
          Reconnecting…
        </span>
        <span class="text-slate-600">
          {{ auth.user?.name }}
          <span class="text-slate-400">· {{ auth.isAdmin ? 'Admin' : auth.isConsultant ? 'Consultant' : 'Client' }}</span>
        </span>
        <button class="btn-secondary py-1.5" @click="logout">Log out</button>
      </div>
    </div>
  </header>
</template>
