// Google OAuth callback — extrae el credential/id_token del hash fragment
// y lo envía a la ventana opener vía postMessage.
//
// Vive en un archivo externo (no inline) para cumplir con la CSP estricta
// (script-src 'self') que aplica el backend a todas las respuestas HTML.
// Un script inline sería bloqueado por la CSP.
(function () {
  // Google Identity Services (GIS) envía el JWT en el parámetro `credential`.
  // El formato OAuth 2.0 clásico usaba `id_token`, pero Google lo deprecó
  // en favor de GIS. Aceptamos ambos por compatibilidad con cualquier
  // configuración de Google Cloud Console.
  var params = new URLSearchParams(location.hash.slice(1));
  var idToken = params.get('credential') || params.get('id_token');
  if (idToken && window.opener) {
    window.opener.postMessage({ idToken: idToken }, location.origin);
  }
  window.close();
})();
