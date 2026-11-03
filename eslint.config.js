import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // data/ is the Hermes container's runtime folder and aset-sumber/ the raw 3D packs; neither is source.
  { ignores: ['dist', 'build', 'node_modules', 'data/**', 'aset-sumber/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: { ...reactHooks.configs.recommended.rules, 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }] },
  },
  { files: ['server/**/*.ts', '**/*.test.ts'], languageOptions: { globals: globals.node } },
)
