/**
 * Cliente HTTP para la API de Deezer.
 *
 * Uso educativo/testing no comercial. El cliente no registra URLs completas,
 * cuerpos de respuesta ni credenciales potenciales.
 */

const DEFAULT_BASE_URL = 'https://api.deezer.com';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 250;
const USER_AGENT = 'VelocityMusic/1.0 (Educational Use)';

/**
 * Wrapper pequeño y aislado para las llamadas HTTP de Deezer.
 * `fetchImpl` y `logger` son opcionales para permitir pruebas sin red.
 */
export class DeezerHttpClient {
  constructor({
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryAttempts = DEFAULT_RETRY_ATTEMPTS,
    fetchImpl = globalThis.fetch,
    logger = console,
    gatewayUrl = 'https://www.deezer.com/ajax/gw-light.php',
  } = {}) {
    this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = normalizePositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
    this.retryAttempts = normalizeNonNegativeInteger(retryAttempts, DEFAULT_RETRY_ATTEMPTS);
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.logger = logger;
    this.gatewayUrl = gatewayUrl;
  }

  /** Busca pistas por texto. `options` se serializa como query string. */
  async search(query, options = {}) {
    const value = String(query ?? '').trim();
    if (!value) return null;
    return this._request('/search/track', { ...safeOptions(options), q: value });
  }

  /** Obtiene una pista por su identificador Deezer. */
  async getTrack(deezerId) {
    const id = normalizeId(deezerId);
    return id === null ? null : this._request(`/track/${encodeURIComponent(id)}`);
  }

  /** Obtiene la URL de stream para una calidad solicitada. */
  async getStreamUrl(deezerId, quality, arlToken = null) {
    const id = normalizeId(deezerId);
    if (id === null) return null;

    // El endpoint /track/{id}/streams no existe en la API pública de Deezer
    // Intentamos usar la API de gateway si tenemos un token ARL
    if (arlToken) {
      // Intentamos con diferentes métodos de la API de gateway
      const methods = ['song.getData', 'song.getUrl', 'song.getStreamUrl'];
      for (const method of methods) {
        try {
          const response = await this._gatewayRequest(method, { SNG_ID: id }, arlToken);
          if (response && response.results) {
            // Intentamos extraer la URL del stream de la respuesta
            const streamUrl = this._extractStreamUrlFromGatewayResponse(response, quality);
            if (streamUrl) return { stream: streamUrl, format: quality };
          }
        } catch (error) {
          // Continuamos con el siguiente método
          continue;
        }
      }
    }

    // Si llegamos aquí, no pudimos obtener el stream
    // Podríamos intentar obtener el preview de 30s de la API pública como fallback
    const trackData = await this.getTrack(id);
    if (trackData && trackData.preview) {
      this._log('info', 'Usando preview de 30s en lugar de stream completo', `track/${id}`);
      return { stream: trackData.preview, format: 'PREVIEW', isPreview: true };
    }

    return null;
  }

  /** Obtiene metadatos de un álbum. */
  async getAlbum(deezerId) {
    const id = normalizeId(deezerId);
    return id === null ? null : this._request(`/album/${encodeURIComponent(id)}`);
  }

  /** Obtiene metadatos de un artista. */
  async getArtist(deezerId) {
    const id = normalizeId(deezerId);
    return id === null ? null : this._request(`/artist/${encodeURIComponent(id)}`);
  }

  async _request(path, params) {
    if (!this.fetchImpl) {
      this._log('warn', 'fetch no está disponible', path);
      return null;
    }

    let url;
    try {
      url = new URL(path.replace(/^\/+/, ''), `${this.baseUrl}/`);
      appendParams(url.searchParams, params);
    } catch {
      this._log('warn', 'URL de Deezer inválida', path);
      return null;
    }

    for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
          },
          signal: controller.signal,
        });
        clearTimeout(timer);

        const status = Number(response?.status);
        const rateLimited = status === 429;
        const networkServerError = status >= 500 && status <= 599;
        if (rateLimited || networkServerError) {
          if (attempt < this.retryAttempts) {
            await sleep(backoffMs(attempt));
            continue;
          }
          this._log('warn', 'Deezer agotó los reintentos', path, status);
          return null;
        }
        if (status === 404) return null;
        if (response?.ok === false || (Number.isFinite(status) && (status < 200 || status >= 300))) {
          this._log('warn', 'Deezer devolvió un error', path, status);
          return null;
        }
        if (!response || typeof response.json !== 'function') {
          this._log('warn', 'Respuesta de Deezer inválida', path);
          return null;
        }
        return await response.json();
      } catch (error) {
        clearTimeout(timer);
        // Un timeout se devuelve de inmediato: reintentarlo multiplicaría el
        // tiempo de resolución y bloquearía innecesariamente el fallback.
        if (controller.signal.aborted) {
          this._log('warn', 'Timeout de Deezer', path);
          return null;
        }
        if (attempt < this.retryAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        this._log('warn', 'Error de red de Deezer', path, error?.name);
        return null;
      }
    }
    return null;
  }

  /** Solicitud a la API de gateway de Deezer */
  async _gatewayRequest(method, input, arlToken) {
    if (!this.fetchImpl) {
      this._log('warn', 'fetch no está disponible para gateway', method);
      return null;
    }

    for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.gatewayUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Cookie: `arl=${encodeURIComponent(arlToken)}`,
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify({
            method,
            input,
            api_version: '1.0',
            api_token: ''
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const status = Number(response?.status);
        const rateLimited = status === 429;
        const networkServerError = status >= 500 && status <= 599;
        if (rateLimited || networkServerError) {
          if (attempt < this.retryAttempts) {
            await sleep(backoffMs(attempt));
            continue;
          }
          this._log('warn', 'Gateway Deezer agotó los reintentos', method, status);
          return null;
        }
        if (status === 404) return null;
        if (response?.ok === false || (Number.isFinite(status) && (status < 200 || status >= 300))) {
          this._log('warn', 'Gateway Deezer devolvió un error', method, status);
          return null;
        }
        if (!response || typeof response.json !== 'function') {
          this._log('warn', 'Respuesta de gateway Deezer inválida', method);
          return null;
        }
        return await response.json();
      } catch (error) {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          this._log('warn', 'Timeout de gateway Deezer', method);
          return null;
        }
        if (attempt < this.retryAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        this._log('warn', 'Error de red de gateway Deezer', method, error?.name);
        return null;
      }
    }
    return null;
  }

  /** Extrae la URL del stream de una respuesta de la API de gateway */
  _extractStreamUrlFromGatewayResponse(response, quality) {
    if (!response || typeof response !== 'object') return null;

    // Buscamos en diferentes ubicaciones posibles
    const candidates = [
      response.results?.DATA?.MEDIA?.FORMATS,
      response.results?.streamUrl,
      response.results?.stream_url,
      response.results?.url,
      response.results?.link,
      response.results?.DATA?.SNG_ID && `https://cdn.deezer.com/stream/${response.results.DATA.SNG_ID}`,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        // Buscamos el formato solicitado
        for (const format of candidate) {
          if (format.format === quality || format.quality === quality) {
            return format.url || format.media || format.link;
          }
        }
        // Si no encontramos el formato específico, usamos el primero
        const first = candidate[0];
        if (first && (first.url || first.media || first.link)) {
          return first.url || first.media || first.link;
        }
      } else if (typeof candidate === 'string' && candidate.startsWith('http')) {
        return candidate;
      }
    }

    return null;
  }

  _log(level, message, path, detail) {
    const fn = this.logger && typeof this.logger[level] === 'function'
      ? this.logger[level].bind(this.logger)
      : null;
    if (!fn) return;
    // Solo se registran ruta, estado y nombre de error; nunca URL/query/body.
    try { fn(`[DeezerHttpClient] ${message}`, { path, detail }); } catch {}
  }
}

export default DeezerHttpClient;

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id && id !== '[object Object]' ? id : null;
}

function safeOptions(options) {
  return options && typeof options === 'object' && !Array.isArray(options) ? options : {};
}

function appendParams(searchParams, params) {
  if (!params || typeof params !== 'object') return;
  for (const [key, value] of Object.entries(params)) {
    if (!key || value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) searchParams.append(key, String(item));
    } else {
      searchParams.set(key, String(value));
    }
  }
}

function backoffMs(attempt) {
  return BACKOFF_BASE_MS * (2 ** attempt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
