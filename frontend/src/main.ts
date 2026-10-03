import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { Quasar, Notify, Dialog } from 'quasar';
import '@quasar/extras/material-icons/material-icons.css';
import 'quasar/src/css/index.sass';
import './style.css';
import App from './App.vue';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import { handleSessionExpired } from './api';

const app = createApp(App);
app.use(createPinia());
app.use(Quasar, {
  plugins: { Notify, Dialog },
  config: {
    brand: {
      primary: '#6458e8',
      secondary: '#272b45',
      positive: '#26866a',
      negative: '#c44955',
      warning: '#b87a25',
    },
    notify: { position: 'bottom-right', timeout: 3500 },
  },
});
handleSessionExpired(() => {
  useAuthStore().expire();
  void router.replace('/login');
});
app.use(router);
app.mount('#app');
