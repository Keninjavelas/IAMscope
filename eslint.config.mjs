// ESLint 9 flat config. Strict TypeScript, no `any`, React hooks rules for the frontend.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

// A plain array rather than `tseslint.config(...)`, which is deprecated in v8. Nothing
// here uses the `extends` sugar that helper exists to normalise.
export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/.vercel/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Explicit projects rather than `projectService: true`. The service only discovers
        // files named `tsconfig.json`, so it could not see the backend suites (excluded by
        // `backend/tsconfig.json`, which must stay emit-clean) or the tooling configs.
        // `allowDefaultProject` is not a substitute: those files are linted without type
        // information, which turns every import into `any` and produces hundreds of
        // false-positive `no-unsafe-*` errors.
        project: [
          'packages/types/tsconfig.json',
          'packages/schemas/tsconfig.json',
          'packages/tokens/tsconfig.json',
          'backend/tsconfig.json',
          'backend/tsconfig.test.json',
          'frontend/tsconfig.json',
          'tsconfig.tools.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/seed.ts', '**/vitest.config.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      // Supertest declares `Response.body` as `any`, so touching a field on it is
      // inherently an unsafe-member-access. Asserting the response shape is exactly what
      // these suites do; keeping the rules on would mean wrapping every single assertion
      // in a cast for no added safety.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  prettier,
];
