import { defineStore } from 'pinia';
import { ref } from 'vue';
import { errorMessage } from '@/services/http';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

let nextId = 1;

export const useToasts = defineStore('toasts', () => {
  const items = ref<Toast[]>([]);

  function push(kind: Toast['kind'], text: string, ms = kind === 'error' ? 7000 : 4000) {
    const id = nextId++;
    items.value.push({ id, kind, text });
    setTimeout(() => dismiss(id), ms);
  }
  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id);
  }

  return {
    items,
    dismiss,
    info: (t: string) => push('info', t),
    success: (t: string) => push('success', t),
    error: (err: unknown) => push('error', errorMessage(err)),
  };
});
