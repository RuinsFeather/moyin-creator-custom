module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'release', 'out', 'node_modules', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    // ===== React / Refresh =====
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],

    // ===== 历史代码降噪：以下规则是大量历史问题的来源 =====
    // 这些规则反映代码风格/严格度而非真实 Bug，统一降级为 warn，避免阻塞构建。
    // 新写代码鼓励逐步规范，存量代码可以容忍。
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        args: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    'react-hooks/exhaustive-deps': 'warn',
    'no-useless-escape': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'prefer-const': 'warn',
    'no-case-declarations': 'warn',
    '@typescript-eslint/no-var-requires': 'warn',
    '@typescript-eslint/ban-types': 'warn',
    'no-irregular-whitespace': 'warn',

    // ===== 真实危险问题：保持为 error =====
    'react-hooks/rules-of-hooks': 'error',
    '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
  },
}
