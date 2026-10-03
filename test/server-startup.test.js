import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachFatalListenHandler, listenFailureDetails } from '../src/lib/serverStartup.js';

test('EADDRINUSE se clasifica como fallo fatal y explica el puerto', () => {
  const details = listenFailureDetails({ code: 'EADDRINUSE', message: 'listen EADDRINUSE' }, { port: 3000 });
  assert.deepEqual(details, {
    code: 'EADDRINUSE',
    fatal: true,
    message: 'El puerto 3000 ya está en uso por otra instancia.',
  });
});

test('el listener de arranque termina el proceso en vez de dejarlo zombie', () => {
  const server = new EventEmitter();
  const logs = [];
  const exits = [];
  attachFatalListenHandler(server, {
    port: 3000,
    logger: { error: (...args) => logs.push(args) },
    onFatal: (details) => exits.push(details),
  });

  server.emit('error', { code: 'EADDRINUSE', message: 'listen EADDRINUSE: address already in use :::3000' });

  assert.equal(exits.length, 1);
  assert.equal(exits[0].code, 'EADDRINUSE');
  assert.match(logs[0][0], /puerto 3000 ya está en uso/i);
});

test('otros fallos del listener también quedan explícitos y son fatales', () => {
  const details = listenFailureDetails({ code: 'EACCES', message: 'permission denied' }, { port: 3000 });
  assert.equal(details.fatal, true);
  assert.equal(details.code, 'EACCES');
  assert.match(details.message, /permisos/i);
});
