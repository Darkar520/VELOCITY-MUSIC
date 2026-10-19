# Reaparición de pausa y posición ajena tras next en notificación

## Alcance y evidencia causal

El usuario confirmó que el síntoma persiste con 3.24/3.25. El sitio público
entregaba 3.25 (`index-B5S0fRR4.js`, SW v96), con la protección A34 incluida.
No se atribuye el reporte a falta de actualización ni a almacenamiento lleno.

Seis regresiones reproducibles fallaron antes de corregir el código:

1. El efecto de sync de App, extraído literalmente, remontó `blob:a` desde
   props atrasadas después de seleccionar b y quitar src. También promovió
   `srcStatus=ready` aunque la nueva fuente seguía resolviéndose.
2. El mismo efecto resucitó `intent=play` después de USER_PAUSE.
3. Props antiguas con playSrc vacío invalidaron una fuente nueva ya preparada.
4. El watchdog oculto emitió PIPELINE_DEAD con posición 145 cuando la nueva
   fuente estaba ready en la máquina pero readyState=0 en el elemento.
5. Repitió ese error con currentSrc aún apuntando al recurso anterior.
6. Dos next antes de actualizar las refs de React volvieron a seleccionar b
   en lugar de avanzar de a a b y de b a la siguiente.

Los casos 4/5 completan la ruta de contaminación de posición: PIPELINE_DEAD
cede el foco y guarda 145 bajo el ID nuevo. A34 solo protegía eventos nativos.
No se ha capturado una traza del Samsung que demuestre cuál de estas carreras
ocurrió en cada episodio del usuario.

## Implementación 3.28 / worker v99

Después de publicar el feed 3.27 se revalidaron los casos 4/5 contra su hook
real: ambos emitieron cuatro PIPELINE_DEAD con posición 145 durante seis
segundos simulados. Los mismos controles pasan en esta rama. Esto confirma
la carrera también durante preparación automática de una pista; sigue sin
identificar qué episodio concreto ocurrió en el Samsung. La rama se actualizó
sobre main sin retirar los cambios del feed.

- `syncAudioElement` lee el store vigente al ejecutar. No monta fuentes ni
  infiere ready/intent desde el render; sigue usando selectPlaySync y runner.
- La restauración offline en pausa monta su blob mediante STREAM_READY.
- Eventos nativos y watchdog comparten `ownsLoadedAudioResource`: ready en
  máquina, metadata disponible, atributo src presente y currentSrc coincidente.
- Visibilidad no publica el reloj de un recurso anterior. La ref de intención
  también se actualiza desde la máquina vigente.
- Next/prev consultan selección/cola actuales del store.
- No se borran ni se descargan de nuevo archivos. No se toca backend/proveedor.

## Pruebas

Validación después de actualizar sobre el feed 3.27: verify, compilación y
lint correctos; 579 pruebas frontend aprobadas. El harness añadió tres finales
automáticos en primer plano y tres con visibilidad oculta simulada. Los seis
pasaron: pista esperada, intent=play, srcStatus=ready, focus=own, blob local,
readyState=4, reloj avanzando y ningún MediaError. Se buscó cerca del final para
acelerar la prueba; no se esperaron seis canciones completas. Evidencia:
test-results/audio-automatic-328.json en el checkout principal.

- Seis regresiones fallan antes y pasan después; dos controles positivos
  evitan convertir sync en un no-op general o reclamar foco tras yield.
- `npm run verify`: 471 tests Node, cero fallos; build de producción correcto.
- Frontend: 573 tests en 52 archivos, cero fallos. Lint frontend correcto.
- Navegador: seis WAV sintéticos distintos de 20 s, almacenados en IndexedDB;
  controlador, eventos del elemento, Media Session, runner y watchdog reales.
  Ocho next mediante el handler registrado, cada uno después de seek a 12 s:
  las ocho pistas estaban reproduciéndose en 0.41–0.45 s y avanzaron hasta
  0.87–0.92 s en la segunda muestra; sin MediaError ni ancla heredada.
- Dos next seguidos seleccionaron la pista esperada y reprodujeron desde cero.
- Control negativo con EXTERNAL_PAUSE inyectado: focus yielded y elemento
  pausado en ambas muestras; no recupera audio oculto después de ceder foco.

La visibilidad oculta se simula en el harness. Los WAV se decodifican en un
navegador real; no se mide salida acústica ni es bloqueo físico de Android.
El evento de interrupción es inyectado, no una llamada real de otra aplicación.

Artefactos locales ignorados:
`test-results/notification-recurrence-20261018/native-result.txt` y
`native-pass.png`. Harness de esta sesión:
`frontend/test-results/notification-recurrence.{html,jsx}`; servir con Vite y
abrir el HTML, pulsar «Probar ocho avances». No requiere cuenta ni modifica
datos de producción; utiliza un origen de prueba y grabaciones sintéticas.

Pendiente: confirmar cinco avances desde la notificación física de
Samsung/Brave después de que Perfil muestre 3.28.
