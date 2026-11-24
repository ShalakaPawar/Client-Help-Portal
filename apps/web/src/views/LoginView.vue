<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Role } from '@chp/shared';
import { useAuth } from '@/stores/auth';
import { http, errorMessage } from '@/services/http';

const DEMO_PASSWORD = 'Demo1234!';

const auth = useAuth();
const router = useRouter();
const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const demo = ref<{ email: string; name: string; role: Role }[]>([]);

onMounted(async () => {
  try {
    demo.value = await http.get('/auth/demo-accounts');
  } catch {
    /* buttons are a convenience only */
  }
});

async function login(e = email.value, p = password.value) {
  busy.value = true;
  error.value = null;
  try {
    await auth.login(e, p);
    await router.push(auth.homeRoute);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4">
    <div class="w-full max-w-md">
      <h1 class="mb-1 text-center text-2xl font-semibold text-indigo-700">Client Help Portal</h1>
      <p class="mb-6 text-center text-sm text-slate-500">Get help from your consultant over a screen-share call.</p>

      <form class="card space-y-4 p-6" @submit.prevent="login()">
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
        </div>
        <div>
          <label class="label" for="password">Password</label>
          <input id="password" v-model="password" class="input" type="password" autocomplete="current-password" required />
        </div>
        <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Logging in…' : 'Log in' }}</button>
      </form>

      <div v-if="demo.length" class="card mt-4 p-4">
        <p class="mb-3 text-xs font-medium tracking-wide text-slate-500 uppercase">
          Demo accounts · one per browser window
        </p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="d in demo"
            :key="d.email"
            class="btn-secondary justify-start text-left"
            :disabled="busy"
            @click="login(d.email, DEMO_PASSWORD)"
          >
            <span class="flex flex-col items-start">
              <span>{{ d.name }}</span>
              <span class="text-xs text-slate-400">{{ d.role === 'CONSULTANT' ? 'Consultant' : 'Client' }}</span>
            </span>
          </button>
        </div>
        <p class="mt-3 text-xs text-slate-400">Password for all demo accounts: {{ DEMO_PASSWORD }}</p>
      </div>
    </div>
  </div>
</template>
