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
    setupFiles: ['./src/test-setup.ts'],
    // Vitest stubs CSS imports by default, which also empties `?raw` ones - and
    // App.contrast.test.ts reads the real App.css through `?raw` to check the palette's
    // contrast ratios. Processing it costs a few ms and keeps that test reading the stylesheet
    // the app actually ships rather than a copy of the colours kept in sync by hand.
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/test-setup.ts', 'src/test-a11y.ts'],
    },
  },
})
