import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: '.',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Use forks pool to avoid ONNX file-lock contention on Windows
    // when multiple test files load onnxruntime-node concurrently
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/lib/cortex/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
