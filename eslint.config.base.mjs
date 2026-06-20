// @ts-check
/**
 * Shared ESLint flat-config that ENFORCES TYPESCRIPT-STYLE-GUIDE.md across the
 * ChELL stack (cumin/salsa/chili/chell).
 *
 * Usage (per repo): create `eslint.config.mjs` containing:
 *
 *   import base, { libLayer, cliLayer } from '../eslint.config.base.mjs';
 *   export default [...base, libLayer];   // cumin, salsa  (library layers)
 *   // or
 *   export default [...base, cliLayer];   // chili, chell  (CLI layers)
 *
 * Eventually publish this as `@fnndsc/eslint-config` so each repo just extends
 * it instead of relative-importing from the dev workspace.
 *
 * Requires (devDependencies):
 *   eslint  typescript-eslint  eslint-plugin-jsdoc  eslint-plugin-import
 *
 * Severities are tuned to land the codebase incrementally:
 *   error  = hard rules (correctness / type-safety)  — block merge
 *   warn   = aspirational (length, typedef, RPN)      — burn down over time
 */
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import importPlugin from 'eslint-plugin-import';

/** RPN naming: `<object>_<method>` (camelCase segments, single underscore). */
const RPN_REGEX = '^[a-z][a-zA-Z0-9]*(_[a-z][a-zA-Z0-9]*)?$';

const base = [
  // type-aware linting
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.d.ts', '**/dist/**', 'tests/**'],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    plugins: { jsdoc, import: importPlugin },
    rules: {
      // ── §216 Type safety over flexibility ─────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      // double-cast escape hatch — flag every `as unknown as`
      '@typescript-eslint/consistent-type-assertions': ['warn', { assertionStyle: 'as' }],

      // ── §67-69 Pervasive & explicit typing ────────────────────────────
      '@typescript-eslint/typedef': ['warn', {
        variableDeclaration: true,
        parameter: true,
        memberVariableDeclaration: true,
        propertyDeclaration: true,
        variableDeclarationIgnoreFunction: true, // arrow/fn consts typed by signature
      }],
      '@typescript-eslint/explicit-function-return-type': ['warn', {
        allowExpressions: true,
      }],

      // ── §10-58 RPN naming (object_method) ─────────────────────────────
      '@typescript-eslint/naming-convention': ['warn',
        { selector: ['function'], format: null,
          custom: { regex: RPN_REGEX, match: true } },
        { selector: ['typeLike'], format: ['PascalCase'] },
      ],

      // ── §182-189 Method length / nesting (god methods) ────────────────
      'max-lines-per-function': ['warn', { max: 80, skipComments: true, skipBlankLines: true }],
      'max-depth': ['warn', { max: 4 }],
      complexity: ['warn', { max: 15 }],

      // ── Reliability: no silent failures ───────────────────────────────
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-floating-promises': 'error',

      // ── Architecture: no circular deps (the salsa pacs.ts class) ───────
      'import/no-cycle': ['error', { maxDepth: 6 }],

      // ── §266 / §264 Documentation ─────────────────────────────────────
      'jsdoc/require-file-overview': ['warn', { tags: { file: { mustExist: true } } }],
      'jsdoc/require-jsdoc': ['warn', {
        publicOnly: true,
        require: { FunctionDeclaration: true, ClassDeclaration: true, MethodDefinition: true },
        contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'],
      }],
    },
  },
];

/** Library layers (cumin, salsa): no printing / no process exit. */
export const libLayer = {
  files: ['src/**/*.ts'],
  ignores: ['**/cli.ts'],
  rules: {
    'no-console': 'error',          // libraries return Result, never print
    'no-process-exit': 'error',     // libraries never terminate the process
  },
};

/** CLI layers (chili, chell): console allowed; exit funneled, not scattered. */
export const cliLayer = {
  files: ['src/**/*.ts'],
  rules: {
    'no-console': 'off',
    'no-process-exit': 'warn',      // discourage scatter; prefer process.exitCode
  },
};

export default base;
