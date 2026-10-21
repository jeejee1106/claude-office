import { DEFAULT_PORT, PATHS } from '@claude-office/shared'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const target = `http://127.0.0.1:${process.env.CLAUDE_OFFICE_PORT ?? DEFAULT_PORT}`

export default defineConfig({
  plugins: [react()],
  // PixiJS 가 앱 번들 대부분을 차지한다(로컬 전용 도구라 분할 이득이 작다)
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: {
      [PATHS.ws]: { target, ws: true },
      [PATHS.events]: target,
      '/api': target,
      [PATHS.health]: target,
    },
  },
})
