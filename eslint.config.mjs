import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next*/**', 'apps/dashboard/public/**', '**/next-env.d.ts'] },
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: [
      '**/*geograph*.ts',
      '**/*geograph*.tsx',
      'packages/database/src/client-ip.ts',
      'packages/database/src/geolocation.ts',
    ],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
);
