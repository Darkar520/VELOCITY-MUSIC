// ESLint (flat config) del BACKEND — Node/ESM.
//
// Objetivo: detectar errores reales (variables no definidas, imports huérfanos,
// promesas mal usadas) SIN discutir estilo. `app.js` tiene 1400+ líneas y nunca
// había pasado por un linter; CI corre `npm run lint:errors` (solo errores).
//
// El frontend tiene su propia configuración (React) en frontend/eslint.config.js;
// aquí se ignora esa carpeta y todo lo generado.

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'frontend/**',   // config propia (React)
      'public/**',     // build generado
      'bin/**',        // binarios descargados en runtime
      'data/**',
      'data-test/**',
      'data-staging/**',
      'scratch/**',
      'tools/**',
      'cloudflare-worker/**', // entorno Workers, no Node
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        fetch: 'readonly',        // global en Node ≥ 18
        AbortController: 'readonly',
      },
    },
    rules: {
      // Errores que sí importan en este código.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',      // `catch (err) {}` vacío es un patrón usado aquí
        ignoreRestSiblings: true,  // `const { a, b, ...resto } = x` para excluir campos
      }],
      'no-undef': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      // Ruido de estilo: desactivado a propósito (esto no es un formateador).
      'no-empty': 'off',          // `try {} catch {}` deliberado en varios sitios
      // Neutral en comportamiento: un escape de más en una regex no cambia lo que
      // hace. Desactivado para no forzar cambios arriesgados en regex ya probadas.
      'no-useless-escape': 'off',
    },
  },

  {
    // Archivos CommonJS (PM2 ecosystem, etc.): __dirname/require son globales.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  {
    // Los tests usan el runner nativo de Node. Se conserva `no-undef` (atrapa
    // typos reales) pero se relaja el ruido propio del andamiaje de pruebas:
    // variables destructuradas sin usar y patrones de simulación (`'literal' && …`).
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-constant-binary-expression': 'off',
    },
  },
];
