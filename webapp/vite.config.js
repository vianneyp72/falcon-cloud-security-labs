import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/falcon-sensor-installs/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@content': path.resolve(__dirname, '..'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..'),],
    },
  },
})
