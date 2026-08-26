import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getToken, setOnUnauthorized, setToken } from '../api.js';

const realFetch = global.fetch;

// Regresiones de jsonOrThrow: un 200 cuyo cuerpo no es JSON (HTML de error del
// CDN/Worker cuando el túnel está caído) antes se convertía en {} y, de ahí,
// en colecciones vacías que el sync trataba como verdad del servidor.
describe('api.jsonOrThrow: cuerpos no-JSON y 401', () => {
  beforeEach(() => {
    localStorage.clear();
    setToken(null);
  });

  afterEach(() => {
    global.fetch = realFetch;
    setOnUnauthorized(null);
    setToken(null);
  });

  it('un 200 con HTML se rechaza y NO dispara logout ni borra el token', async () => {
    setToken('tok-vivo');
    let fired = 0;
    setOnUnauthorized(() => { fired += 1; });
    global.fetch = vi.fn(async () => new Response(
      '<!doctype html><html><body>upstream error</body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    ));

    await expect(api.favorites()).rejects.toMatchObject({ nonJson: true, status: 200 });
    expect(fired).toBe(0);
    expect(getToken()).toBe('tok-vivo');
    expect(localStorage.getItem('velocity.token')).toBe('tok-vivo');
  });

  it('un 200 con JSON válido sigue resolviendo con normalidad', async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ favorites: ['a', 'b'] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    await expect(api.favorites()).resolves.toEqual(['a', 'b']);
  });

  it('un 200 con cuerpo vacío resuelve {} (compatibilidad)', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 200 }));
    await expect(api.status()).resolves.toEqual({});
  });

  it('un 401 auténtico limpia el token y notifica una sola vez por llamada', async () => {
    setToken('tok-muerto');
    let fired = 0;
    setOnUnauthorized(() => { fired += 1; });
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: 'sesión inválida' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(api.favorites()).rejects.toMatchObject({ status: 401 });
    expect(fired).toBe(1);
    expect(getToken()).toBeNull();
    expect(localStorage.getItem('velocity.token')).toBeNull();
  });

  it('un cuerpo de error JSON no-objeto (p. ej. null) no rompe el mensaje', async () => {
    global.fetch = vi.fn(async () => new Response('null', { status: 500 }));
    await expect(api.status()).rejects.toMatchObject({ status: 500 });
  });
});
