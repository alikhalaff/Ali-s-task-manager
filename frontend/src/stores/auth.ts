import { ref } from 'vue';
import { defineStore } from 'pinia';
import { api, errorInfo, hasCsrfToken, setCsrfToken } from '../api';
import type { User } from '../types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const initialized = ref(false);
  const connectionError = ref('');
  let restoring: Promise<void> | null = null;
  function restore() {
    if (restoring) return restoring;
    restoring = (async () => {
      try {
        const { data } = await api.get<{ user: User | null; csrfToken: string }>('/auth/session');
        user.value = data.user;
        setCsrfToken(data.csrfToken);
        connectionError.value = '';
      } catch (error) {
        connectionError.value = errorInfo(error).message;
      } finally {
        initialized.value = true;
        restoring = null;
      }
    })();
    return restoring;
  }
  async function authenticate(
    mode: 'login' | 'register',
    input: { email: string; password: string; name?: string },
  ) {
    if (!hasCsrfToken()) await restore();
    if (!hasCsrfToken()) throw new Error('Session unavailable');
    const { data } = await api.post<{ user: User; csrfToken: string }>(`/auth/${mode}`, input);
    user.value = data.user;
    connectionError.value = '';
    setCsrfToken(data.csrfToken);
  }
  async function logout() {
    await api.post('/auth/logout');
    user.value = null;
    setCsrfToken('');
    initialized.value = false;
  }
  function expire() {
    user.value = null;
    setCsrfToken('');
    initialized.value = false;
  }
  return { user, initialized, connectionError, restore, authenticate, logout, expire };
});
