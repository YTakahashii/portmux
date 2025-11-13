import { defineConfig } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
      'eslint.config.mjs',
    ],
  },

  {
    files: ['packages/cli/**/*.ts', 'packages/cli/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './packages/cli/tsconfig.json',
      },
    },
  },
  {
    files: ['packages/core/**/*.ts', 'packages/core/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './packages/core/tsconfig.json',
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  }
);
