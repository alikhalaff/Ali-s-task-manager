import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { quasar, transformAssetUrls } from '@quasar/vite-plugin';

export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls } }), quasar()],
  server: { proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } } },
});
