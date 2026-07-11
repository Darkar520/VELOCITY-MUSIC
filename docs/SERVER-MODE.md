# Velocity Music — Modo Servidor (Opción A)

Convierte esta laptop en el host del backend con la máxima estabilidad posible
**sin pagar un VPS**. Luego puedes migrar a la nube (Opción C) cuando quieras.

## Activar (una vez)

### Ideal (Administrador)

1. Clic derecho en PowerShell → **Ejecutar como administrador**
2. Ejecuta:

```powershell
cd "C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC"
powershell -ExecutionPolicy Bypass -File .\scripts\server-mode.ps1
```

### Sin admin (también sirve, menos potente)

```powershell
cd "C:\Users\irisp\OneDrive\Escritorio\VELOCITY MUSIC"
powershell -ExecutionPolicy Bypass -File .\scripts\server-mode.ps1
```

## Qué queda instalado

| Mecanismo | Función |
|-----------|---------|
| `Startup\VelocityMusic.vbs` | Al iniciar sesión lanza el watchdog |
| `watchdog-loop.vbs` | Cada **60 s** ejecuta `ensure-running.ps1` |
| Tarea `VelocityMusicEnsure` | Cada **2 min** (respaldo si muere el bucle) |
| Tarea `VelocityMusicOnLogon` | Ensure al login |
| `CLUSTER=0` / `WEB_CONCURRENCY=1` | Un solo Node (menos RAM) |
| Prioridad **High** | Solo Node de Velocity + Postgres + cloudflared |

## Comprobar que está vivo

```powershell
curl.exe -s http://127.0.0.1:3000/api/status
curl.exe -s http://127.0.0.1:3000/api/health
curl.exe -s https://velocitymusic.uk/api/status
```

Esperado: `operational` y health `db":"green"`.

## Si se cae

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\ensure-running.ps1"
```

## Reglas de oro

1. **No hibernes ni apagues** la laptop mientras haya usuarios.
2. Con gente escuchando: **cierra Photoshop / Chrome pesado**.
3. **Nunca** ejecutes `Get-Process node | Stop-Process -Force` (mata el backend).
4. Deja la sesión de Windows iniciada (el watchdog corre en tu usuario).
5. Enchufada a la corriente.

## Límites honestos

- Windows no “reserva” 4 GB solo para Node sin Hyper-V.
- Si la RAM libre baja de ~1.5 GB, el SO puede matar procesos.
- Esto es un **mini-servidor casero**, no un datacenter. Para 24/7 real sin PC de casa → Opción C (VPS).

## Logs

- `logs\ensure.log` — recuperaciones del watchdog  
- `logs\backend.log` — salida del backend (si se redirige)  
- `logs\guardian.log` — guardián legacy (secundario)

## Siguiente paso (Opción C)

Cuando quieras migrar a VPS, el mismo código funciona; solo cambia dónde corre
Node + Postgres + (opcional) cloudflared, y las cookies de yt-dlp.
