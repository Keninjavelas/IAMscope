import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const API_TARGET = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000';

const pkg = (name: string, entry: string): string =>
  path.resolve(__dirname, '..', 'packages', name, 'src', entry);

/**
 * The shared workspace packages are consumed as **TypeScript source** here.
 *
 * They are published as CommonJS for the Express backend, and Rollup cannot
 * reliably statically analyse tsc's `__exportStar` re-export output, which
 * produced "MOTION is not exported by .../tokens/dist/index.js" at build time.
 * Aliasing to source removes the CJS/ESM interop problem entirely, gives HMR
 * across packages, and keeps type resolution identical (the frontend tsconfig
 * still resolves `dist/*.d.ts`, generated from these same files).
 *
 * Note the `@/` alias uses a trailing slash: a bare `'@'` would also swallow
 * `@iamscope/...` specifiers.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@iamscope\/types$/, replacement: pkg('types', 'index.ts') },
      { find: /^@iamscope\/schemas$/, replacement: pkg('schemas', 'index.ts') },
      { find: /^@iamscope\/tokens$/, replacement: pkg('tokens', 'index.ts') },
      { find: /^@iamscope\/tokens\/scales$/, replacement: pkg('tokens', 'scales.ts') },
      { find: /^@iamscope\/tokens\/tokens\.css$/, replacement: pkg('tokens', 'tokens.css') },
      { find: '@/', replacement: `${path.resolve(__dirname, 'src')}/` },
    ],
  },
  server: {
    port: 3000,
    strictPort: true,
    // Same-origin API calls in dev: cookies, CSRF and SSE all behave exactly as
    // they do in production behind the Vercel rewrite.
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        ws: false,
      },
    },
    fs: {
      // The alias above reaches outside `frontend/` into `packages/`.
      allow: [path.resolve(__dirname, '..')],
    },
  },
  preview: {
    port: 3000,
    strictPort: true,
  },
  optimizeDeps: {
    // Linked workspace packages are not pre-bundled by default; force it so the
    // first dev request is not slow.
    include: ['@iamscope/types', '@iamscope/schemas', '@iamscope/tokens'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          graph: ['sigma', 'graphology', 'graphology-layout-forceatlas2'],
          editor: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/language',
            '@codemirror/lang-json',
            '@codemirror/commands',
            '@codemirror/search',
            '@codemirror/autocomplete',
            '@codemirror/lint',
          ],
        },
      },
    },
  },
});
