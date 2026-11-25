import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '@/stores/auth';
import LoginView from '@/views/LoginView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // "/" needs its own route: otherwise it matches the catch-all below, which redirects to "/" again (endless loop).
    { path: '/', redirect: () => (useAuth().isLoggedIn ? useAuth().homeRoute : '/login') },
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/signup', component: () => import('@/views/SignupView.vue'), meta: { public: true } },
    { path: '/admin', component: () => import('@/views/AdminView.vue'), meta: { role: 'ADMIN' } },
    { path: '/client', component: () => import('@/views/ClientDashboard.vue'), meta: { role: 'CLIENT' } },
    { path: '/consultant', component: () => import('@/views/ConsultantDashboard.vue'), meta: { role: 'CONSULTANT' } },
    // Admins manage accounts only: no calls or history.
    { path: '/call/:id', component: () => import('@/views/CallRoomView.vue'), meta: { roles: ['CLIENT', 'CONSULTANT'] } },
    { path: '/history', component: () => import('@/views/HistoryView.vue'), meta: { roles: ['CLIENT', 'CONSULTANT'] } },
    { path: '/history/:id', component: () => import('@/views/HistoryDetailView.vue'), meta: { roles: ['CLIENT', 'CONSULTANT'] } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const auth = useAuth();
  if (to.meta.public) return auth.isLoggedIn ? auth.homeRoute : true;
  if (!auth.isLoggedIn) return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} };
  if (to.meta.role && to.meta.role !== auth.user?.role) return auth.homeRoute;
  const roles = to.meta.roles as string[] | undefined;
  if (roles && !roles.includes(auth.user?.role ?? '')) return auth.homeRoute;
  return true;
});
