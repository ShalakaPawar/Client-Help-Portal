import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '@/stores/auth';
import LoginView from '@/views/LoginView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/client', component: () => import('@/views/ClientDashboard.vue'), meta: { role: 'CLIENT' } },
    { path: '/consultant', component: () => import('@/views/ConsultantDashboard.vue'), meta: { role: 'CONSULTANT' } },
    { path: '/call/:id', component: () => import('@/views/CallRoomView.vue'), meta: { fullBleed: true } },
    { path: '/history', component: () => import('@/views/HistoryView.vue') },
    { path: '/history/:id', component: () => import('@/views/HistoryDetailView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const auth = useAuth();
  if (to.meta.public) return auth.isLoggedIn ? auth.homeRoute : true;
  if (!auth.isLoggedIn) return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} };
  if (to.path === '/') return auth.homeRoute;
  if (to.meta.role && to.meta.role !== auth.user?.role) return auth.homeRoute;
  return true;
});
