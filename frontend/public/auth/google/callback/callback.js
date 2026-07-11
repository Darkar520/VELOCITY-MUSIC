// Google OAuth callback — redirect flow (no popup).
// Servido desde Cloudflare Pages (siempre disponible aunque el backend caiga).
// POST /api/auth/google sí va al backend; reintentamos si hay 502/timeout.
//
// IMPORTANTE: este archivo se carga con ruta ABSOLUTA
//   /auth/google/callback/callback.js
// para que funcione tanto con /auth/google/callback como /auth/google/callback/
(function () {
  'use strict';

  function setMsg(text) {
    try {
      var el = document.getElementById('msg');
      if (el) el.textContent = text;
    } catch (e) {}
  }

  function goErr(msg) {
    try {
      window.location.replace('/#google_auth_error=' + encodeURIComponent(msg || 'error'));
    } catch (e) {
      setMsg(msg || 'Error de login. Vuelve a la app e intenta de nuevo.');
    }
  }

  function goHome() {
    try {
      window.location.replace('/');
    } catch (e) {
      setMsg('Listo. Abre Velocity Music de nuevo.');
    }
  }

  function readToken() {
    // Implicit flow: token en el hash (#id_token=… o #credential=…)
    var hash = '';
    try { hash = (location.hash || '').replace(/^#/, ''); } catch (e) {}
    var params = new URLSearchParams(hash);
    var idToken = params.get('credential') || params.get('id_token');
    var error = params.get('error');
    // Algunos clientes ponen el token en query (raro, pero barato de soportar)
    if (!idToken && !error) {
      try {
        var q = new URLSearchParams(location.search || '');
        idToken = q.get('credential') || q.get('id_token');
        error = q.get('error');
      } catch (e2) {}
    }
    return { idToken: idToken, error: error };
  }

  function saveSession(data) {
    if (!data || !data.token) {
      throw new Error('El servidor no devolvió sesión.');
    }
    try {
      localStorage.setItem('velocity.token', data.token);
      if (data.email) localStorage.setItem('velocity.email', data.email);
      if (data.displayName) localStorage.setItem('velocity.name', data.displayName);
    } catch (e) {
      // Safari privado / storage bloqueado: sin token no hay sesión.
      throw new Error('No se pudo guardar la sesión (almacenamiento bloqueado). Prueba sin modo privado.');
    }
  }

  async function postGoogle(idToken) {
    var controller = new AbortController();
    var t = setTimeout(function () { controller.abort(); }, 18000);
    try {
      var res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: idToken }),
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      clearTimeout(t);
      var body = {};
      try { body = await res.json(); } catch (e) { body = {}; }
      if (!res.ok) {
        var err = new Error(body.error || ('HTTP ' + res.status));
        err.status = res.status;
        throw err;
      }
      return body;
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  function isRetryable(e) {
    var st = e && e.status;
    var msg = (e && e.message) || '';
    var name = (e && e.name) || '';
    return (
      st === 502 || st === 503 || st === 504 || st === 429 ||
      name === 'AbortError' ||
      /abort|network|Failed to fetch|HTTP 502|HTTP 503|HTTP 504|Load failed|NetworkError/i.test(msg)
    );
  }

  // Safety net: si algo se cuelga (navegador viejo sin AbortController, etc.)
  var hardTimer = setTimeout(function () {
    goErr('El login tardó demasiado. Revisa tu conexión e intenta de nuevo.');
  }, 90000);

  (async function main() {
    try {
      var parsed = readToken();
      if (parsed.error) {
        clearTimeout(hardTimer);
        goErr(parsed.error);
        return;
      }
      if (!parsed.idToken) {
        clearTimeout(hardTimer);
        goErr('no_token');
        return;
      }

      setMsg('Conectando con Velocity…');

      var lastErr = null;
      for (var i = 1; i <= 4; i++) {
        try {
          if (i > 1) {
            setMsg('Reintentando conexión (' + i + '/4)…');
            await new Promise(function (r) { setTimeout(r, 700 * i); });
          }
          var data = await postGoogle(parsed.idToken);
          saveSession(data);
          clearTimeout(hardTimer);
          setMsg('¡Listo! Entrando…');
          goHome();
          return;
        } catch (e) {
          lastErr = e;
          if (!isRetryable(e)) break;
        }
      }
      clearTimeout(hardTimer);
      goErr((lastErr && lastErr.message) || 'No se pudo completar el login con Google');
    } catch (fatal) {
      clearTimeout(hardTimer);
      goErr((fatal && fatal.message) || 'Error inesperado en el login');
    }
  })();
})();
