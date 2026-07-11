/**
 * Helpers del feed de Inicio.
 *
 * Bug histórico: la firma se marcaba al *empezar* la generación. Si el efecto
 * se re-ejecutaba (p. ej. favs/recent llegan del backend tras la 1ª sección
 * "Hecho para ti"), el early-return veía la misma firma + homeRows parcial y
 * abortaba el resto del feed → solo quedaba una fila.
 *
 * Regla: solo se considera "completo" cuando la generación terminó con
 * completedSig === nextSig. Mientras tanto siempre se regenera.
 */

/**
 * @param {{ completedSig: string, nextSig: string }} p
 * @returns {boolean} true = no hay que regenerar
 */
export function shouldSkipFeedRegen({ completedSig, nextSig }) {
  if (!nextSig) return false;
  if (!completedSig) return false;
  return completedSig === nextSig;
}
