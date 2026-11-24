import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CallDto } from '@chp/shared';
import { http } from '@/services/http';
import { onSocket, onSocketReconnect } from '@/services/socket';

/** The user's live call (if any): drives the incoming-call banner and rejoin after refresh. */
export const useCallStore = defineStore('call', () => {
  const active = ref<CallDto | null>(null);

  async function fetchActive() {
    const res = await http.get<{ call: CallDto | null }>('/calls/active');
    active.value = res.call;
    return res.call;
  }

  function apply(call: CallDto) {
    if (call.status === 'WAITING' || call.status === 'ACTIVE') active.value = call;
    else if (active.value?.id === call.id) active.value = null;
  }

  onSocket('call:incoming', apply);
  onSocket('call:updated', apply);
  onSocket('call:ended', apply);
  onSocketReconnect(() => void fetchActive().catch(() => undefined));

  function reset() {
    active.value = null;
  }

  return { active, fetchActive, apply, reset };
});
