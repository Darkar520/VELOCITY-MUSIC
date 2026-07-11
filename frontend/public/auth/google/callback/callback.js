// Google OAuth callback — redirect flow (no popup).
// Servido desde Cloudflare Pages (siempre disponible aunque el backend caiga).
// POST /api/auth/google sí va al backend; reintentamos si hay 502/timeout.
(async function () {
  var params = new URLSearchParams(location.hash.slice(1));
  var idToken = params.get('credential') || params.get('id_token');
  var error = params.get('error');

  function goErr(msg) {
    window.location.replace('/#google_auth_error=' + encodeURIComponent(msg || 'error'));
  }

  if (error) { goErr(error); return; }
  if (!idToken) { goErr('no_token'); return; }

  // Mostrar estado simple mientras reintenta
  try {
    var el = document.getElementById('msg');
    if (el) el.textContent = 'Conectando con Velocity…';
  } catch (e) {}

  async function postGoogle(attempt) {
    var controller = new AbortController();
    var t = setTimeout(function () { controller.abort(); }, 20000);
    try {
      var res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: idToken }),
        signal: controller.signal,
      });
      clearTimeout(t);
      var body = await res.json().catch(function () { return {}; });
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

  var lastErr = null;
  for (var i = 1; i <= 4; i++) {
    try {
      if (i > 1) {
        try {
          var el2 = document.getElementById('msg');
          if (el2) el2.textContent = 'Reintentando conexión (' + i + '/4)…';
        } catch (e2) {}
        await new Promise(function (r) { setTimeout(r, 800 * i); });
      }
      var data = await postGoogle(i);
      if (data && data.token) {
        localStorage.setItem('velocity.token', data.token);
        if (data.email) localStorage.setItem('velocity.email', data.email);
        if (data.displayName) localStorage.setItem('velocity.name', data.displayName);
      }
      window.location.replace('/');
      return;
    } catch (e) {
      lastErr = e;
      // Reintentar solo si parece backend/túnel caído
      var st = e && e.status;
      var msg = (e && e.message) || '';
      var retryable = st === 502 || st === 503 || st === 504 || /abort|network|Failed to fetch|HTTP 502|HTTP 503/i.test(msg);
      if (!retryable) break;
    }
  }
  goErr((lastErr && lastErr.message) || 'No se pudo completar el login con Google');
})();
