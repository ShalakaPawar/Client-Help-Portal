<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AdminClientDto, AdminConsultantDto } from '@chp/shared';
import { http } from '@/services/http';
import { useToasts } from '@/stores/toasts';
import { formatDateTime } from '@/lib/format';

/** Admin: manage consultants and which consultant each client has. No access to calls or history. */
const toasts = useToasts();
const consultants = ref<AdminConsultantDto[]>([]);
const clients = ref<AdminClientDto[]>([]);
const form = ref({ name: '', email: '', password: '' });
const creating = ref(false);

async function load() {
  try {
    [consultants.value, clients.value] = await Promise.all([
      http.get<AdminConsultantDto[]>('/admin/consultants'),
      http.get<AdminClientDto[]>('/admin/clients'),
    ]);
  } catch (err) {
    toasts.error(err);
  }
}

async function createConsultant() {
  creating.value = true;
  try {
    const c = await http.post<AdminConsultantDto>('/admin/consultants', form.value);
    toasts.success(`Consultant ${c.name} added. They can log in with ${c.email}.`);
    form.value = { name: '', email: '', password: '' };
    await load();
  } catch (err) {
    toasts.error(err);
  } finally {
    creating.value = false;
  }
}

async function makeDefault(c: AdminConsultantDto) {
  try {
    consultants.value = await http.post<AdminConsultantDto[]>(`/admin/consultants/${c.id}/default`);
    toasts.success(`New clients will now be assigned to ${c.name}.`);
  } catch (err) {
    toasts.error(err);
  }
}

async function assign(client: AdminClientDto, consultantId: string) {
  try {
    await http.post(`/admin/clients/${client.id}/consultant`, { consultantId: consultantId || null });
    toasts.success(`${client.name} updated.`);
    await load();
  } catch (err) {
    toasts.error(err);
  }
}

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6">
    <div class="grid gap-6 md:grid-cols-5">
      <section class="card p-5 md:col-span-3">
        <h2 class="text-lg font-semibold">Consultants</h2>
        <p class="mt-1 text-sm text-slate-500">New clients who sign up are assigned to the <b>default</b> consultant. You can change it here.</p>
        <table class="mt-4 w-full text-left text-sm">
          <thead class="text-xs text-slate-500 uppercase">
            <tr>
              <th class="py-2 font-medium">Name</th>
              <th class="py-2 font-medium">Email</th>
              <th class="py-2 font-medium">Clients</th>
              <th class="py-2"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="c in consultants" :key="c.id">
              <td class="py-3 font-medium">{{ c.name }}</td>
              <td class="py-3 text-slate-600">{{ c.email }}</td>
              <td class="py-3 text-slate-600">{{ c.clientCount }}</td>
              <td class="py-3 text-right">
                <span v-if="c.isDefault" class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">Default</span>
                <button v-else class="text-xs text-indigo-600 hover:underline" @click="makeDefault(c)">Make default</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <form class="card space-y-3 p-5 md:col-span-2" @submit.prevent="createConsultant">
        <h2 class="text-lg font-semibold">Add a consultant</h2>
        <div>
          <label class="label" for="c-name">Name</label>
          <input id="c-name" v-model="form.name" class="input" minlength="2" maxlength="80" required />
        </div>
        <div>
          <label class="label" for="c-email">Email</label>
          <input id="c-email" v-model="form.email" class="input" type="email" required />
        </div>
        <div>
          <label class="label" for="c-password">Temporary password</label>
          <input id="c-password" v-model="form.password" class="input" type="password" minlength="8" autocomplete="new-password" required />
        </div>
        <button class="btn-primary w-full" :disabled="creating">{{ creating ? 'Adding…' : 'Add consultant' }}</button>
      </form>
    </div>

    <section class="card p-5">
      <h2 class="text-lg font-semibold">Clients</h2>
      <p class="mt-1 text-sm text-slate-500">Change a client's consultant. Their open requests move to the new consultant.</p>
      <table class="mt-4 w-full text-left text-sm">
        <thead class="text-xs text-slate-500 uppercase">
          <tr>
            <th class="py-2 font-medium">Name</th>
            <th class="py-2 font-medium">Email</th>
            <th class="py-2 font-medium">Joined</th>
            <th class="py-2 font-medium">Consultant</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="cl in clients" :key="cl.id">
            <td class="py-3 font-medium">{{ cl.name }}</td>
            <td class="py-3 text-slate-600">{{ cl.email }}</td>
            <td class="py-3 text-slate-600">{{ formatDateTime(cl.createdAt) }}</td>
            <td class="py-3">
              <select
                class="input py-1.5"
                :value="cl.consultant?.id ?? ''"
                :aria-label="`Consultant for ${cl.name}`"
                @change="assign(cl, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">— Not assigned —</option>
                <option v-for="c in consultants" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
