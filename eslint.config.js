// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Module boundaries (Design Review contract):
 * 1. `firebase/ai` may be imported only inside src/ai.
 * 2. src/ui may import only src/ai/index.ts and src/firebase/index.ts from the rest of src,
 *    and may not use the Firebase SDK directly.
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

/**
 * A file at src/ui/<depth dirs>/x.ts leaves src/ui with (depth + 1) "../" segments.
 * Whatever it reaches that way must be ai/index or firebase/index (with or without the extension,
 * or the bare folder). Longer "../" chains that leave src are caught by the same pattern.
 * @param {number} depth
 */
function uiBoundary(depth) {
  const up = '\\.\\./'.repeat(depth + 1);
  return {
    files: [`src/ui/${'*/'.repeat(depth)}*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            FIREBASE_AI,
            UI_SDK,
            {
              regex: `^${up}(?!(?:ai|firebase)(?:/index(?:\\.ts)?)?$)`,
              message:
                'src/ui may import only src/ai/index.ts and src/firebase/index.ts from outside src/ui.',
            },
          ],
        },
      ],
    },
  };
}

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
    },
  },
  {
    files: ['src/ai/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  ...[0, 1, 2, 3, 4, 5].map(uiBoundary),
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
  },
);
