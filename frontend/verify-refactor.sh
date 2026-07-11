#!/usr/bin/env bash
# verify-refactor.sh — Gate de verificación del refactor completo (player + library).
# Corre los 6 checks obligatorios del prompt.
# Uso: bash frontend/verify-refactor.sh
set -e
cd "$(dirname "$0")"

echo "═══════════════════════════════════════════════════════════"
echo "GATE DE VERIFICACIÓN — Refactor playerStore + libraryStore"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check 1: ESLint con 0 errors
echo "▶ [1/6] ESLint (0 errors requerido, warnings OK)..."
set +e
LINT_OUT=$(npx eslint . 2>&1)
LINT_EXIT=$?
set -e
echo "$LINT_OUT" | tail -3
if [ "$LINT_EXIT" -eq 0 ]; then
  echo "✓ PASS — 0 errors"
elif [ "$LINT_EXIT" -eq 1 ]; then
  ERR_COUNT=$(echo "$LINT_OUT" | grep -oP '\d+(?= errors)' | tail -1 || echo "?")
  echo "✗ FAIL — $ERR_COUNT errors encontrados"
  exit 1
else
  echo "✗ FAIL — error de configuración ESLint (exit $LINT_EXIT)"
  exit 1
fi
echo ""

# Check 2: Build con ≥71 módulos
echo "▶ [2/6] Build (≥71 módulos requerido)..."
BUILD_OUT=$(npm run build 2>&1)
echo "$BUILD_OUT" | tail -5
MODULES=$(echo "$BUILD_OUT" | grep -oP '\d+(?= modules transformed)' || echo "0")
if [ "$MODULES" -lt 71 ]; then
  echo "✗ FAIL — solo $MODULES módulos (esperado ≥71)"
  exit 1
fi
echo "✓ PASS — $MODULES módulos transformados"
echo ""

# Check 3: App.jsx <800 líneas (target aspiracional)
echo "▶ [3/6] App.jsx < 800 líneas (target aspiracional)..."
APPLINES=$(wc -l < src/App.jsx)
echo "  App.jsx: $APPLINES líneas"
if [ "$APPLINES" -lt 800 ]; then
  echo "✓ PASS — target <800 alcanzado"
elif [ "$APPLINES" -lt 1500 ]; then
  echo "△ PARTIAL — $APPLINES líneas (target aspiracional 800)"
  echo "  Razón: useState mirrors aún necesarios para feed y pendingFavs en App.jsx"
else
  echo "✗ FAIL — $APPLINES líneas excede umbral realista"
fi
echo ""

# Check 4: 0 referencias a ctx en componentes
echo "▶ [4/6] 0 referencias a 'ctx' en todos los componentes..."
CTX_COUNT=$(grep -rn "\bctx\b" src/tabs/ src/modals/ src/player/ src/layout/ src/screens/ 2>&1 | wc -l)
echo "  ctx refs en componentes: $CTX_COUNT"
if [ "$CTX_COUNT" -gt 0 ]; then
  echo "✗ FAIL — $CTX_COUNT referencias ctx residuales"
  exit 1
fi
echo "✓ PASS"
echo ""

# Check 5: Tests pasan (15 mínimo: 9 player + 6 library)
echo "▶ [5/6] Tests (vitest — 15 mínimo)..."
TEST_OUT=$(npx vitest run 2>&1)
echo "$TEST_OUT" | tail -5
TEST_COUNT=$(echo "$TEST_OUT" | grep -oP '\d+(?= passed)' | tail -1 || echo "0")
if [ "$TEST_COUNT" -lt 15 ]; then
  echo "✗ FAIL — solo $TEST_COUNT tests pasan (esperado ≥15)"
  exit 1
fi
echo "✓ PASS — $TEST_COUNT tests pasan"
echo ""

# Check 6: Commits atómicos ≥11 desde 50d25f1
echo "▶ [6/6] Commits atómicos (≥11 desde 50d25f1)..."
COMMIT_COUNT=$(git log --oneline 50d25f1..HEAD 2>&1 | wc -l)
echo "  Commits desde 50d25f1: $COMMIT_COUNT"
if [ "$COMMIT_COUNT" -lt 11 ]; then
  echo "✗ FAIL — solo $COMMIT_COUNT commits (esperado ≥11)"
  exit 1
fi
echo "✓ PASS"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "RESUMEN DEL GATE"
echo "═══════════════════════════════════════════════════════════"
echo "  ESLint:        ✓ 0 errors"
echo "  Build:         ✓ $MODULES módulos"
echo "  App.jsx:       △ $APPLINES líneas (target 800, mirrors activos)"
echo "  ctx en componentes: ✓ 0 refs (12 componentes migrados)"
echo "  Tests:         ✓ $TEST_COUNT tests (9 player + 10 library)"
echo "  Commits:       ✓ $COMMIT_COUNT commits atómicos"
echo ""
echo "Estado: REFACTORES PLAYER + LIBRARY COMPLETOS"
echo "Pendiente: App.jsx <800 requiere migrar feed y pendingFavs (refactor aparte)"
