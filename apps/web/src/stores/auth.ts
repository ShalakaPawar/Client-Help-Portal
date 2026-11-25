import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { Role, type LoginResponse, type UserDto } from '@chp/shared';
import { http, tokenStore } from '@/services/http';
import { connectSocket, disconnectSocket } from '@/services/socket';

const USER_KEY = 'chp.user';

export const useAuth = defineStore('auth', () => {
  const user = ref<UserDto | null>(readUser());
  const token = ref<string | null>(tokenStore.get());

  const isLoggedIn = computed(() => !!user.value && !!token.value);
  const isClient = computed(() => user.value?.role === Role.CLIENT);
  const isConsultant = computed(() => user.value?.role === Role.CONSULTANT);
  const isAdmin = computed(() => user.value?.role === Role.ADMIN);
  const homeRoute = computed(() => (isAdmin.value ? '/admin' : isConsultant.value ? '/consultant' : '/client'));

  async function login(email: string, password: string) {
    startSession(await http.post<LoginResponse>('/auth/login', { email, password }));
  }

  /** Client self-signup; logs the new client in. */
  async function signup(name: string, email: string, password: string) {
    startSession(await http.post<LoginResponse>('/auth/signup', { name, email, password }));
  }

  /** Re-read the user (e.g. an admin may have assigned a consultant since login). */
  async function refreshMe() {
    const me = await http.get<UserDto>('/auth/me');
    user.value = me;
    sessionStorage.setItem(USER_KEY, JSON.stringify(me));
    return me;
  }

  function startSession(res: LoginResponse) {
    tokenStore.set(res.accessToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(res.user));
    token.value = res.accessToken;
    user.value = res.user;
    connectSocket(res.accessToken);
  }

  function logout() {
    tokenStore.clear();
    sessionStorage.removeItem(USER_KEY);
    token.value = null;
    user.value = null;
    disconnectSocket();
  }

  /** After a page refresh: reconnect the socket with the token kept in this tab. */
  function resume() {
    if (token.value) connectSocket(token.value);
  }

  return { user, token, isLoggedIn, isClient, isConsultant, isAdmin, homeRoute, login, signup, refreshMe, logout, resume };
});

function readUser(): UserDto | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserDto) : null;
  } catch {
    return null;
  }
}
