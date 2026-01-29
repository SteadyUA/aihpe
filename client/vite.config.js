import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const basePath = env.APP_BASE_PATH || '/';

  return {
    plugins: [react()],
    base: basePath.endsWith('/') ? basePath : `${basePath}/`,
    server: {
      host: true,
      proxy: {
        [`${basePath === '/' ? '' : basePath}/api`]: {
          target: 'http://localhost:5000',
          changeOrigin: true,
          secure: false,
        }
      }
    }
  }
})
