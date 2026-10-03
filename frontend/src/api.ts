import axios from 'axios';
import type { FieldErrors } from './types';

let csrfToken = '';
let onSessionExpired: (() => void) | undefined;
export const api = axios.create({ baseURL: '/api', timeout: 15000, withCredentials: true });
export function setCsrfToken(token: string) {
  csrfToken = token;
}
export function hasCsrfToken() {
  return Boolean(csrfToken);
}
export function handleSessionExpired(callback: () => void) {
  onSessionExpired = callback;
}
api.interceptors.request.use((request) => {
  if (!['get', 'head', 'options'].includes(request.method ?? 'get'))
    request.headers.set('X-CSRF-Token', csrfToken);
  return request;
});
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      error.response.data?.code === 'UNAUTHENTICATED'
    )
      onSessionExpired?.();
    return Promise.reject(error);
  },
);
export function errorInfo(error: unknown): { message: string; details: FieldErrors } {
  if (axios.isAxiosError(error)) {
    if (!error.response)
      return { message: 'We couldn’t connect. Check your connection and try again.', details: {} };
    return {
      message: error.response.data?.message ?? 'Something went wrong. Please try again.',
      details: error.response.data?.details ?? {},
    };
  }
  return { message: 'Something went wrong. Please try again.', details: {} };
}
