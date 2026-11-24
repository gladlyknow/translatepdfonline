import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const config = [
  {
    ignores: [
      '.next/**',
      '.open-next/**',
      '.source/**',
      '.wrangler/**',
      'node_modules/**',
      'tmp/**',
      'tranlate_tmp/**',
      'src/core/db_bak/**',
      'public/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/triple-slash-reference': 'off',
      'prefer-const': 'warn',
    },
  },
];

export default config;
