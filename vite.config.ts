/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base so the build works unmodified under any GitHub Pages project path
  // (https://<user>.github.io/<repo>/) without hardcoding the repo name - see
  // docs/deploying-to-github-pages.md. Safe here since this is a single-page app with no
  // client-side routes.
  base: './',
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
