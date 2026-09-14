import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Vendored from the react-bits registry via `shadcn add`. Left byte-for-byte
  // so it stays re-addable; its `any` casts and `let` are the upstream
  // author's, not ours, and editing them would be silently undone by the next
  // registry update.
  {
    files: ['src/components/Aurora.tsx', 'src/components/StarBorder.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'prefer-const': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cloned GitLab repos
    "repos/**",
  ]),
]);

export default eslintConfig;
