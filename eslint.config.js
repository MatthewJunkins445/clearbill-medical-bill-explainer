// @ts-check
import path from 'node:path';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Module boundaries (Design Review contract):
 * 1. `firebase/ai` may be imported only inside src/ai, statically or with dynamic import().
 * 2. src/ui, at any folder depth, may import only src/ai/index.ts and src/firebase/index.ts from
 *    the rest of src (with or without the extension, or the bare folder), statically or
 *    dynamically, and may not use the Firebase SDK directly.
 */
// Regexes, not gitignore-style groups: a group such as 'firebase/*' also matches relative
// paths like '../firebase/index', which is exactly the import src/ui is allowed to make.
const FIREBASE_AI = {
  regex: '^@?firebase/ai(?:/|$)',
  message: 'firebase/ai may be imported only inside src/ai. Use the src/ai/index.ts entry point.',
};

const UI_SDK = {
  regex: '^(?:firebase|@firebase/[^/]+)(?:/|$)',
  message:
    'src/ui must not use the Firebase SDK directly. Import from src/firebase/index.ts or src/ai/index.ts.',
};

const FIXED_DYNAMIC_IMPORT = {
  selector:
    'ImportExpression:not([source.type="Literal"]):not([source.type="TemplateLiteral"][source.expressions.length=0])',
  message: 'Dynamic import() outside src/ai must use a fixed string so the import boundary can be checked.',
};

/**
 * no-restricted-syntax entries that apply a specifier regex to dynamic import(), for both a
 * string literal and a template literal without expressions. esquery regex literals cannot
 * contain "/", so it is written as \x2F.
 * @param {{ regex: string, message: string }} restriction
 */
function dynamicImport({ regex, message }) {
  const re = regex.replaceAll('/', '\\x2F');
  return [
    { selector: `ImportExpression[source.value=/${re}/]`, message },
    { selector: `ImportExpression[source.quasis.0.value.cooked=/${re}/]`, message },
  ];
}

const SRC_DIR = path.join(import.meta.dirname, 'src');
const UI_DIR = path.join(SRC_DIR, 'ui');
const normalize = (/** @type {string} */ p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const UI_ALLOWED = new Set(
  ['ai', 'ai/index', 'ai/index.ts', 'firebase', 'firebase/index', 'firebase/index.ts'].map((p) =>
    normalize(path.join(SRC_DIR, p)),
  ),
);
const UI_BOUNDARY_MESSAGE = 'src/ui may import only src/ai/index.ts and src/firebase/index.ts from outside src/ui.';

/**
 * Resolves each relative ("./", "../") or root-absolute ("/src/...") specifier against the
 * importing file, so the src/ui allow-list holds at any folder depth. Bare specifiers (packages)
 * are left to no-restricted-imports and no-restricted-syntax.
 * @type {import('eslint').Rule.RuleModule}
 */
const uiBoundary = {
  meta: { type: 'problem', schema: [], docs: { description: UI_BOUNDARY_MESSAGE } },
  create(context) {
    const fileDir = path.dirname(context.physicalFilename);

    /**
     * @param {import('estree').Node} node
     * @param {string} spec
     */
    function check(node, spec) {
      let resolved;
      if (spec.startsWith('.')) resolved = path.resolve(fileDir, spec);
      else if (spec.startsWith('/')) resolved = path.join(import.meta.dirname, spec);
      else return;
      const inUi = path.relative(UI_DIR, resolved);
      if (inUi !== '..' && !inUi.startsWith(`..${path.sep}`) && !path.isAbsolute(inUi)) return;
      if (UI_ALLOWED.has(normalize(resolved))) return;
      context.report({ node, message: `${UI_BOUNDARY_MESSAGE} ('${spec}')` });
    }

    /** @param {import('estree').Node | null | undefined} source */
    function checkSource(source) {
      if (source?.type === 'Literal' && typeof source.value === 'string') check(source, source.value);
    }

    return {
      ImportDeclaration: (node) => checkSource(node.source),
      ExportNamedDeclaration: (node) => checkSource(node.source),
      ExportAllDeclaration: (node) => checkSource(node.source),
      ImportExpression(node) {
        const { source } = node;
        if (source.type === 'Literal') return checkSource(source);
        const quasi = source.type === 'TemplateLiteral' && source.expressions.length === 0 ? source.quasis[0] : undefined;
        if (quasi?.value.cooked != null) check(source, quasi.value.cooked);
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'test-results/', 'playwright-report/', '.firebase/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: [FIREBASE_AI] }],
      'no-restricted-syntax': ['error', FIXED_DYNAMIC_IMPORT, ...dynamicImport(FIREBASE_AI)],
    },
  },
  {
    files: ['src/ai/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    // `**` matches any depth, so there is no folder-depth limit.
    files: ['src/ui/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    plugins: { clearbill: { rules: { 'ui-boundary': uiBoundary } } },
    rules: {
      'no-restricted-imports': ['error', { patterns: [UI_SDK] }],
      'no-restricted-syntax': ['error', FIXED_DYNAMIC_IMPORT, ...dynamicImport(UI_SDK)],
      'clearbill/ui-boundary': 'error',
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node },
    },
  },
);
