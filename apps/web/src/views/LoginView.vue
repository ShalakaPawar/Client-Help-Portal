<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/services/http';

const auth = useAuth();
const router = useRouter();
const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

async function login() {
  busy.value = true;
  error.value = null;
  try {
    await auth.login(email.value, password.value);
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

      <form class="card space-y-4 p-6" @submit.prevent="login">
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

      <p class="mt-4 text-center text-sm text-slate-600">
        New client?
        <RouterLink to="/signup" class="font-medium text-indigo-600 hover:underline">Create an account</RouterLink>
      </p>
    </div>
  </div>
</template>
