import base from '@editz/config/eslint';

export default [
  ...base,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];
