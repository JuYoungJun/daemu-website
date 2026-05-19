// DAEMU 프론트엔드 lint — 목표: stale ref / unused import / typo 자동 발견.
// CLAUDE.md memory: "Vite 빌드는 syntax만 검출. 변수/함수 삭제 후 stale ref grep 필수."
// 본 룰은 그 grep 부담을 lint 가 대신 잡도록.
//
// 강한 룰 (error): 실제 버그 패턴.
// 약한 룰 (warn): 정돈 — CI 에서 강제 X.
//
// raw HTML/JS (public/, src/*/raw/) 와 admin 큰 파일들은 우선 ignore — 단계적 도입.

module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: 'detect' },
  },
  ignorePatterns: [
    'dist',
    'node_modules',
    'public',
    'src/pages/raw',
    'src/admin/raw',
    'backend-py',
    '_backup-static-*',
    'archive',
  ],
  rules: {
    // 실제 버그 패턴 — error.
    'no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    }],
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-unreachable': 'error',
    'no-redeclare': 'error',
    'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
    'no-implicit-globals': 'error',
    // React Hooks rules — deps 빠뜨림 자주 발생.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // 정돈 — warn (CI 가 break 하지 않음).
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'warn',
    'eqeqeq': ['warn', 'always', { null: 'ignore' }],

    // 보안 정규식 — 의도된 escape / control char 검출. ESLint 기본 룰이
    // false-positive 잡으므로 완화 (no-control-regex off, no-useless-escape warn).
    'no-useless-escape': 'warn',
    'no-control-regex': 'off',

    // React 본문 rules.
    'react/prop-types': 'off',           // PropTypes 사용 안 함 (TS 도입 시 재검토).
    'react/no-unescaped-entities': 'off', // 한국어/영어 따옴표 자주 사용.
    'react/react-in-jsx-scope': 'off',    // Vite + React 17+ 자동 import.
    'react/display-name': 'off',
  },
};
