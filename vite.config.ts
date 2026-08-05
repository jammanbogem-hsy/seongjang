import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@firebase/') || id.includes('/node_modules/firebase/')) {
            return 'firebase'
          }
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
  plugins: [react()],
  server: { host: '127.0.0.1' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
