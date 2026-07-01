// @ts-check
/**
 * Anti-gaming test-lint gate for the coverage grind (Phase 0.3).
 *
 * A narrow, jest-only ESLint flat config applied to test files across all four
 * packages. It enforces exactly two rules as errors so the coverage effort
 * cannot be gamed with tests that execute lines but assert nothing:
 *
 *   - jest/expect-expect        — every test must contain at least one assertion
 *   - jest/no-standalone-expect — assertions must live inside a test block
 *
 * This is DELIBERATELY separate from eslint.config.base.mjs (the dormant
 * TYPESCRIPT-STYLE-GUIDE guardrail, REMEDIATION Phase 1). Keeping it standalone
 * means the coverage gate can ship without turning on the wider style rules.
 *
 * Run via `npm run lint:tests`.
 */
import tseslint from 'typescript-eslint';
import jest from 'eslint-plugin-jest';

export default tseslint.config({
  files: ['packages/*/tests/**/*.{ts,js}', 'packages/*/test/**/*.{ts,js}'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { sourceType: 'module' },
  },
  plugins: { jest },
  rules: {
    'jest/expect-expect': 'error',
    'jest/no-standalone-expect': 'error',
  },
});
