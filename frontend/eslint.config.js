// ESLint flat config — reglas estrictas para prevenir imports faltantes y misuse de hooks.
// Motivo: el split anterior de App.jsx rompió la app 4 veces por imports perdidos.
// Esta config los pesca en CI/local antes de que lleguen a producción.
import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', '../public/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: '18.3' },
    },
    rules: {
      // === Reglas duras (errors) — pesca bugs reales ===
      'no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react/no-deprecated': 'error',
      'react/no-direct-mutation-state': 'error',
      'react/no-unknown-property': 'error',

      // === Reglas de estilo (warnings — no bloquean) ===
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-empty': 'off',                    // catch blocks vacíos son intencionales
      'no-useless-assignment': 'off',       // false positives en variables let con ternarios
      'no-useless-escape': 'off',           // regex legacy
      'preserve-caught-error': 'off',       // regla nueva de ESLint 10, muy ruidosa
      'react/react-in-jsx-scope': 'off',    // Vite + jsx-runtime automático
      'react/prop-types': 'off',            // Sin PropTypes en este proyecto
      'react/display-name': 'off',
    },
  },
];
