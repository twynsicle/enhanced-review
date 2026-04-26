import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'src/components/ui/**',
    // PB-managed: auto-generated JSVM type definitions and migration
    // files using PB's `migrate(...)` global + triple-slash references.
    'pb_data/**',
    'pb_migrations/**',
  ]),
]);

export default eslintConfig;
