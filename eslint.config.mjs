import base from './packages/config/eslint/base.js';

/**
 * One lint run for the whole workspace. Every package shares the same config,
 * so splitting it into per-package runs would only add turbo overhead and six
 * more files that say the same thing.
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.pnpm-store/**',
      '**/next-env.d.ts',
      'apps/web/next.config.compiled.js',
    ],
  },
  ...base,
  {
    // Build scripts run in Node, not in a browser or a worker.
    files: ['**/scripts/**/*.mjs', '**/*.config.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
];
