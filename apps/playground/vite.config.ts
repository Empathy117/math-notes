import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env['PORT']) || 5180;

// Real AI in the playground: start the dev server with DEEPSEEK_API_KEY (and optionally
// DEEPSEEK_MODEL / DEEPSEEK_BASE_URL) in the environment. The key never reaches the
// browser: the dev server proxies /api/deepseek/* and injects the Authorization header.
const apiKey = process.env['DEEPSEEK_API_KEY'];
const upstream = (process.env['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com').replace(/\/$/, '');
const model = process.env['DEEPSEEK_MODEL'] ?? 'deepseek-flash';

export default defineConfig({
  plugins: [react()],
  define: {
    __AI_PROXY__: JSON.stringify(apiKey ? '/api/deepseek' : ''),
    __AI_MODEL__: JSON.stringify(model),
  },
  server: {
    port,
    strictPort: true,
    proxy: apiKey
      ? {
          '/api/deepseek': {
            target: upstream,
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/api\/deepseek/, ''),
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        }
      : undefined,
  },
});
