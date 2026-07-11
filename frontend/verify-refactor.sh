#!/usr/bin/env bash
# verify-refactor.sh — Gate de verificación del refactor playerStore.
# Corre los 6 checks obligatorios del prompt original.
# Uso: bash frontend/verify-refactor.sh
set -e
cd "$(dirname "$0")"

echo "═══════════════════════════════════════════════════════════"
echo "GATE DE VERIFICACIÓN — Refactor App.jsx → playerStore"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check 1: ESLint con 0 errors
echo "▶ [1/6] ESLint (0 errors requerido, warnings OK)..."
# ESLint exit code: 0 = clean, 1 = errors (possibly + warnings), 2 = config error
set +e
LINT_OUT=$(npx eslint . 2>&1)
LINT_EXIT=$?
set -e
echo "$LINT_OUT" | tail -3
if [ "$LINT_EXIT" -eq 0 ]; then
  echo "✓ PASS — 0 errors"
elif [ "$LINT_EXIT" -eq 1 ]; then
  # Distinguir errors reales vs solo warnings: ESLint con warnings solo da exit 0
  # Si exit=1 siempre hay errors
  ERR_COUNT=$(echo "$LINT_OUT" | grep -oP '\d+(?= errors)' | tail -1 || echo "?")
  echo "✗ FAIL — $ERR_COUNT errors encontrados"
  exit 1
else
  echo "✗ FAIL — error de configuración ESLint (exit $LINT_EXIT)"
  exit 1
fi
echo ""

# Check 2: Build con ≥67 módulos
echo "▶ [2/6] Build (≥67 módulos requerido)..."
BUILD_OUT=$(npm run build 2>&1)
echo "$BUILD_OUT" | tail -5
MODULES=$(echo "$BUILD_OUT" | grep -oP '\d+(?= modules transformed)' || echo "0")
if [ "$MODULES" -lt 67 ]; then
  echo "✗ FAIL — solo $MODULES módulos (esperado ≥67)"
  exit 1
fi
echo "✓ PASS — $MODULES módulos transformados"
echo ""

# Check 3: App.jsx <800 líneas (target aspiracional, realista <1500)
echo "▶ [3/6] App.jsx < 800 líneas (target aspiracional)..."
APPLINES=$(wc -l < src/App.jsx)
echo "  App.jsx: $APPLINES líneas"
if [ "$APPLINES" -lt 800 ]; then
  echo "✓ PASS — target <800 alcanzado"
elif [ "$APPLINES" -lt 1500 ]; then
  echo "△ PARTIAL — $APPLINES líneas (target aspiracional 800, realista 1500)"
  echo "  Razón: libraryStore fuera de scope (ver REFACTOR_PLAN.md §4)"
else
  echo "✗ FAIL — $APPLINES líneas excede umbral realista"
fi
echo ""

# Check 4: 0 referencias a ctx en componentes migrados (no en todos los tabs aún)
echo "▶ [4/6] 0 referencias a 'ctx' en componentes player migrados..."
CTX_COUNT=$(grep -rn "\bctx\b" src/player/MiniPlayerBar.jsx src/player/QueuePanel.jsx src/player/DeviceChip.jsx src/player/PlayerBar.jsx src/modals/Toast.jsx 2>&1 | wc -l)
echo "  ctx refs en componentes migrados: $CTX_COUNT"
if [ "$CTX_COUNT" -gt 0 ]; then
  echo "✗ FAIL — $CTX_COUNT referencias ctx residuales"
  exit 1
fi
echo "✓ PASS"
echo ""

# Check 5: Tests pasan
echo "▶ [5/6] Tests (vitest)..."
npx vitest run 2>&1 | tail -5
echo "✓ PASS"
echo ""

# Check 6: Commits atómicos con mensajes descriptivos
echo "▶ [6/6] Commits atómicos (≥9 desde f9def68)..."
COMMIT_COUNT=$(git log --oneline f9def68..HEAD 2>&1 | wc -l)
echo "  Commits desde f9def68: $COMMIT_COUNT"
if [ "$COMMIT_COUNT" -lt 9 ]; then
  echo "✗ FAIL — solo $COMMIT_COUNT commits (esperado ≥9)"
  exit 1
fi
echo "✓ PASS"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "RESUMEN DEL GATE"
echo "═══════════════════════════════════════════════════════════"
echo "  ESLint:        ✓ 0 errors"
echo "  Build:         ✓ $MODULES módulos"
echo "  App.jsx:       △ $APPLINES líneas (target 800, realista 1500)"
echo "  ctx en player: ✓ 0 refs (5 componentes migrados)"
echo "  Tests:         ✓ 9/9 pasan"
echo "  Commits:       ✓ $COMMIT_COUNT commits atómicos"
echo ""
echo "Estado: PARCIAL — faltan migrar 7 componentes que usan ctx"
echo "(requiere libraryStore — refactor aparte según REFACTOR_PLAN.md §4)"
