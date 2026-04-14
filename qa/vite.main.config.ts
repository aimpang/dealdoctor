import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: ['electron', 'playwright', 'node:fs', 'node:path', 'node:os', 'node:child_process', 'fs', 'path', 'os', 'child_process'],
    },
  },
});
