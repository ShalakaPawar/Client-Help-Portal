import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { HelpRequestDto } from '@chp/shared';
import { http } from '@/services/http';
import { onSocket, onSocketReconnect } from '@/services/socket';

/** Help requests visible to the current user, kept live by socket events. */
export const useRequests = defineStore('requests', () => {
  const items = ref<HelpRequestDto[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  /** ids that just arrived via socket (briefly highlighted on the consultant dashboard) */
  const fresh = ref(new Set<string>());

  async function load() {
    loading.value = true;
    try {
      items.value = await http.get<HelpRequestDto[]>('/requests');
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  function upsert(r: HelpRequestDto) {
    const i = items.value.findIndex((x) => x.id === r.id);
    if (i >= 0) items.value.splice(i, 1, r);
    else items.value.unshift(r);
  }

  async function create(title: string, description: string) {
    const r = await http.post<HelpRequestDto>('/requests', { title, description });
    upsert(r);
    return r;
  }

  async function cancel(id: string) {
    upsert(await http.post<HelpRequestDto>(`/requests/${id}/cancel`));
  }
  async function resolve(id: string) {
    upsert(await http.post<HelpRequestDto>(`/requests/${id}/resolve`));
  }
  async function reopen(id: string) {
    upsert(await http.post<HelpRequestDto>(`/requests/${id}/reopen`));
  }

  onSocket('request:created', (r) => {
    upsert(r);
    fresh.value.add(r.id);
    setTimeout(() => fresh.value.delete(r.id), 6000);
  });
  onSocket('request:updated', (r) => upsert(r));
  onSocketReconnect(() => {
    if (loaded.value) void load();
  });

  function reset() {
    items.value = [];
    loaded.value = false;
  }

  return { items, loading, fresh, load, create, cancel, resolve, reopen, reset };
});
