import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/tasks' },
    { path: '/login', component: () => import('./pages/AuthPage.vue') },
    { path: '/register', component: () => import('./pages/AuthPage.vue') },
    {
      path: '/tasks',
      component: () => import('./pages/TasksPage.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', component: () => import('./pages/NotFoundPage.vue') },
  ],
});
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.initialized) await auth.restore();
  if (to.meta.requiresAuth && !auth.user) return '/login';
  if (auth.user && ['/login', '/register'].includes(to.path)) return '/tasks';
});
