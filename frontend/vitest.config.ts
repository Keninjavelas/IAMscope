import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const pkg = (name: string, entry: string): string =>
  path.resolve(__dirname, '..', 'packages', name, 'src', entry);

/** Aliases mirror vite.config.ts - see the comment there. */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@iamscope\/types$/, replacement: pkg('types', 'index.ts') },
      { find: /^@iamscope\/schemas$/, replacement: pkg('schemas', 'index.ts') },
      { find: /^@iamscope\/tokens$/, replacement: pkg('tokens', 'index.ts') },
      { find: /^@iamscope\/tokens\/scales$/, replacement: pkg('tokens', 'scales.ts') },
      { find: '@/', replacement: `${path.resolve(__dirname, 'src')}/` },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    css: false,
    restoreMocks: true,
  },
});
