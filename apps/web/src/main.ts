import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { setUnauthenticatedHandler } from './services/http';
import { useAuth } from './stores/auth';
import { useCallStore } from './stores/call';
import { useToasts } from './stores/toasts';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

const auth = useAuth();
const toasts = useToasts();

// Expired or invalid session anywhere -> back to login.
setUnauthenticatedHandler(() => {
  if (!auth.isLoggedIn) return;
  auth.logout();
  toasts.info('Please log in again.');
  void router.push('/login');
});

// Last-resort handler: show the error instead of failing silently.
app.config.errorHandler = (err) => {
  console.error(err);
  toasts.error(err);
};

async function start() {
  // Rejoin after a page refresh: this tab is still logged in (sessionStorage),
  // so reconnect the socket and return to a live call if there is one.
  if (auth.isLoggedIn) {
    auth.resume();
    try {
      const call = await useCallStore().fetchActive();
      const here = window.location.pathname;
      const inCall = call && (call.status === 'ACTIVE' || auth.isConsultant);
      if (call && inCall && !here.startsWith('/call/')) await router.replace(`/call/${call.id}`);
    } catch {
      /* the router guard / 401 handler deals with a dead session */
    }
  }
  app.mount('#app');
}

void start();
