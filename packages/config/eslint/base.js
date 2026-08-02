import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Shared flat config. Apps extend this and add their own framework plugins. */
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // §11: no `any` without a comment justifying it. The rule flags every
      // one; the justification goes in an eslint-disable-next-line comment,
      // which is exactly the audit trail we want.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // FFmpeg args are arrays, never strings. Backstop for §11.
      'no-restricted-globals': ['error', { name: 'exec', message: 'Use spawn with an argv array.' }],
    },
  },
);
