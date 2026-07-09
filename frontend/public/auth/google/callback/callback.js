// Google OAuth callback — flujo de redirect completo (sin popup).
//
// Este script se ejecuta en la página /auth/google/callback/ después de que
// Google redirige al usuario de vuelta con el credential en el hash fragment.
//
// Flujo:
//   1. App.jsx redirige la ventana PRINCIPAL a Google (no abre popup).
//   2. Google autentica al usuario y redirige aquí con #credential=...
//   3. Este script extrae el credential, lo envía al backend (/api/auth/google),
//      guarda el JWT en localStorage y redirige a la app.
//
// Ventajas sobre el flujo de popup:
//   - No depende de window.opener (que Brave/Safari bloquean cross-origin).
//   - No necesita postMessage entre ventanas.
//   - Funciona en móviles (donde los popups son problemáticos).
//   - Es el flujo recomendado por Google para OAuth 2.0 implicit.
(async function () {
  // Google Identity Services (GIS) envía el JWT en `credential`.
  // El formato OAuth 2.0 clásico usaba `id_token`. Aceptamos ambos.
  var params = new URLSearchParams(location.hash.slice(1));
  var idToken = params.get('credential') || params.get('id_token');

  // Si Google devolvió un error, redirigir a login con el mensaje.
  var error = params.get('error');
  if (error) {
    window.location.replace('/#google_auth_error=' + encodeURIComponent(error));
    return;
  }

  if (!idToken) {
    window.location.replace('/#google_auth_error=no_token');
    return;
  }

  try {
    var res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: idToken }),
    });
    if (!res.ok) {
      var errBody = await res.json().catch(function () { return {}; });
      throw new Error(errBody.error || ('HTTP ' + res.status));
    }
    var data = await res.json();
    if (data.token) {
      // Mismo key que usa api.js (velocity.token) para que la app lo encuentre.
      localStorage.setItem('velocity.token', data.token);
    }
    // Redirigir a la app. El token ya está en localStorage; la app lo leerá al montar.
    window.location.replace('/');
  } catch (e) {
    window.location.replace('/#google_auth_error=' + encodeURIComponent(e.message));
  }
})();
