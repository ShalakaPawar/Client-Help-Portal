<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/services/http';

/** Self-signup is for clients only. Consultants are added by an admin. */
const auth = useAuth();
const router = useRouter();
const name = ref('');
const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

async function signup() {
  busy.value = true;
  error.value = null;
  try {
    await auth.signup(name.value, email.value, password.value);
    await router.push('/client');
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
      <h1 class="mb-1 text-center text-2xl font-semibold text-indigo-700">Create a client account</h1>
      <p class="mb-6 text-center text-sm text-slate-500">You'll be connected with a consultant who can help you.</p>

      <form class="card space-y-4 p-6" @submit.prevent="signup">
        <div>
          <label class="label" for="name">Your name</label>
          <input id="name" v-model="name" class="input" autocomplete="name" minlength="2" maxlength="80" required />
        </div>
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
        </div>
        <div>
          <label class="label" for="password">Password</label>
          <input id="password" v-model="password" class="input" type="password" autocomplete="new-password" minlength="8" required />
          <p class="mt-1 text-xs text-slate-400">At least 8 characters.</p>
        </div>
        <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Creating account…' : 'Create account' }}</button>
      </form>

      <p class="mt-4 text-center text-sm text-slate-600">
        Already have an account?
        <RouterLink to="/login" class="font-medium text-indigo-600 hover:underline">Log in</RouterLink>
      </p>
      <p class="mt-2 text-center text-xs text-slate-400">Consultant accounts are created by an admin.</p>
    </div>
  </div>
</template>
