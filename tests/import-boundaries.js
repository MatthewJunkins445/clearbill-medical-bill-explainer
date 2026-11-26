import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

// The fictitious files use the normal path-based config and need no TypeScript program.
const eslint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
const deepUi = 'src/ui/a/b/c/d/e/f/g/fixture.ts';

const cases = [
  ['AI can import the SDK', 'src/ai/fixture.ts', "import 'firebase/ai';"],
  ['AI can load the SDK lazily', 'src/ai/fixture.ts', "void import('firebase/ai');"],
  [
    'Firebase cannot statically import AI',
    'src/firebase/fixture.ts',
    "import 'firebase/ai';",
    'no-restricted-imports',
  ],
  [
    'Firebase cannot dynamically import AI',
    'src/firebase/fixture.ts',
    "void import('firebase/ai');",
    'no-restricted-syntax',
  ],
  [
    'Firebase cannot import AI with a template',
    'src/firebase/fixture.ts',
    'void import(`@firebase/ai`);',
    'no-restricted-syntax',
  ],
  [
    'Firebase must use a fixed specifier',
    'src/firebase/fixture.ts',
    "const moduleName = 'firebase/ai'; void import(moduleName);",
    'no-restricted-syntax',
  ],
  [
    'UI cannot directly import Firebase',
    'src/ui/fixture.ts',
    "import 'firebase/app';",
    'no-restricted-imports',
  ],
  [
    'UI cannot dynamically import AI',
    'src/ui/fixture.ts',
    "void import('firebase/ai');",
    'no-restricted-syntax',
  ],
  [
    'UI cannot dynamically import store',
    'src/ui/fixture.ts',
    "void import('../store/index.ts');",
    'clearbill/ui-boundary',
  ],
  [
    'UI cannot re-export store',
    'src/ui/fixture.ts',
    "export * from '../store/index.ts';",
    'clearbill/ui-boundary',
  ],
  [
    'UI cannot import a private AI module',
    'src/ui/fixture.ts',
    "import '/src/ai/private.ts';",
    'clearbill/ui-boundary',
  ],
  [
    'deep UI cannot import store',
    deepUi,
    "import '../../../../../../../../store/index.ts';",
    'clearbill/ui-boundary',
  ],
  ['deep UI can import Firebase entry point', deepUi, "import '../../../../../../../../firebase/index.ts';"],
  ['deep UI can lazily import the AI entry point', deepUi, "void import('../../../../../../../../ai');"],
  ['deep UI can import its own code', deepUi, "import '../../../../../../../app.ts';"],
];

for (const [name, filePath, source, rule] of cases) {
  test(name, async () => {
    const [result] = await eslint.lintText(source, { filePath });
    assert.deepEqual(
      result.messages.map((message) => message.ruleId),
      rule ? [rule] : [],
    );
  });
}
