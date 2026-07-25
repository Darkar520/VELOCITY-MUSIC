import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { DeezerTokenManager } from '../src/extractors/deezerToken.js';

const TEST_AUTH_URL = 'https://test.invalid/deezer-auth';
let caseSequence = 0;

function createDeterministicManager(scope, managerOptions = {}) {
  const credential = `test-only-arl-${scope}-${caseSequence++}`;
  let fetchCalls = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(url, TEST_AUTH_URL);
    assert.equal(options.method, 'POST');
    fetchCalls += 1;
    return {
      ok: true,
      async json() {
        return {
          results: {
            token: `${credential}-session-${fetchCalls}`,
            expiresIn: 3600,
          },
        };
      },
    };
  };

  return {
    credential,
    fetchImpl,
    get fetchCalls() {
      return fetchCalls;
    },
    manager: new DeezerTokenManager({
      arlToken: credential,
      authUrl: TEST_AUTH_URL,
      fetchImpl,
      ...managerOptions,
    }),
  };
}

// **Validates: Requirements 1.12**
test('Property 1: refreshes at or before the configured expiry threshold', () => {
  fc.assert(
    fc.property(
      fc.record({
        expiresIn: fc.integer({ min: 1, max: 3600 }),
        tokenAgeSeconds: fc.integer({ min: 0, max: 7200 }),
        refreshThresholdSeconds: fc.integer({ min: 0, max: 3600 }),
      }),
      ({ expiresIn, tokenAgeSeconds, refreshThresholdSeconds }) => {
        const { manager } = createDeterministicManager('timing', {
          refreshThresholdSeconds,
        });
        const issuedAt = 1_700_000_000_000;
        const now = issuedAt + tokenAgeSeconds * 1000;
        const expiresAt = issuedAt + expiresIn * 1000;
        const expected = now >= expiresAt - refreshThresholdSeconds * 1000;

        const shouldRefresh = manager.shouldRefreshToken(
          { token: 'placeholder-session-token', issuedAt, expiresIn },
          now,
        );

        assert.equal(shouldRefresh, expected);
      },
    ),
  );
});

class AcquireTokenCommand {
  check() {
    return true;
  }

  async run(model, real) {
    const token = await real.manager.getToken();
    if (model.token === null || model.invalidated) {
      assert.equal(token, `${real.credential}-session-${real.fetchCalls}`);
      assert.equal(real.fetchCalls, model.refreshes + 1);
      model.refreshes += 1;
      model.token = token;
      model.invalidated = false;
    } else {
      assert.equal(token, model.token);
      assert.equal(real.fetchCalls, model.refreshes);
    }
  }

  toString() {
    return 'getToken()';
  }
}

class ValidateTokenCommand {
  constructor(kind) {
    this.kind = kind;
  }

  check() {
    return true;
  }

  async run(model, real) {
    const token = this.kind === 'current'
      ? model.token
      : this.kind === 'empty'
        ? ''
        : 'placeholder-wrong-token';
    const expected = this.kind === 'current' && model.token !== null && !model.invalidated;
    assert.equal(await real.manager.validateToken(token), expected);
  }

  toString() {
    return `validateToken(${this.kind})`;
  }
}

class InvalidateTokenCommand {
  check() {
    return true;
  }

  async run(model, real) {
    assert.equal(await real.manager.invalidateToken(), true);
    model.token = null;
    model.invalidated = true;
  }

  toString() {
    return 'invalidateToken()';
  }
}

// **Validates: Requirements 1.12**
test('Property 2: token validation is consistent across generated state transitions', async () => {
  const commandArbitrary = fc.commands([
    fc.constant(new AcquireTokenCommand()),
    fc.constantFrom(
      new ValidateTokenCommand('current'),
      new ValidateTokenCommand('wrong'),
      new ValidateTokenCommand('empty'),
    ),
    fc.constant(new InvalidateTokenCommand()),
  ], { maxCommands: 20 });

  await fc.assert(
    fc.asyncProperty(commandArbitrary, async (commands) => {
      const real = createDeterministicManager('validation');
      await fc.asyncModelRun(
        () => ({
          model: { token: null, invalidated: true, refreshes: 0 },
          real,
        }),
        commands,
      );
    }),
  );
});
class SharedGetTokensCommand {
  constructor(count) {
    this.count = count;
  }

  check() {
    return true;
  }

  async run(model, real) {
    const managers = Array.from({ length: this.count }, (_, index) => (
      index % 2 === 0 ? real.manager : real.peer
    ));
    const tokens = await Promise.all(managers.map((manager) => manager.getToken()));

    assert.equal(new Set(tokens).size, 1);
    if (model.token === null) {
      assert.equal(real.fetchCalls, 1);
      model.token = tokens[0];
      model.refreshes = 1;
    } else {
      assert.equal(tokens[0], model.token);
      assert.equal(real.fetchCalls, model.refreshes);
    }
  }

  toString() {
    return `getToken() x ${this.count}`;
  }
}

// **Validates: Requirements 1.12**
test('Property 3: concurrent getToken calls share one token and refresh request', async () => {
  const commandArbitrary = fc.array(
    fc.integer({ min: 2, max: 12 }).map((count) => new SharedGetTokensCommand(count)),
    { minLength: 1, maxLength: 8 },
  );

  await fc.assert(
    fc.asyncProperty(commandArbitrary, async (commands) => {
      const real = createDeterministicManager('sharing');
      real.peer = new DeezerTokenManager({
        arlToken: real.credential,
        authUrl: TEST_AUTH_URL,
        fetchImpl: real.fetchImpl,
      });
      await fc.asyncModelRun(
        () => ({
          model: { token: null, refreshes: 0 },
          real,
        }),
        commands,
      );
    }),
  );
});

class InvalidateAndRefreshCommand {
  check() {
    return true;
  }

  async run(model, real) {
    let previousToken;
    if (model.token === null) {
      previousToken = await real.manager.getToken();
      assert.equal(real.fetchCalls, model.refreshes + 1);
      model.refreshes += 1;
      model.token = previousToken;
    } else {
      previousToken = await real.manager.getToken();
      assert.equal(previousToken, model.token);
      assert.equal(real.fetchCalls, model.refreshes);
    }

    await real.manager.invalidateToken();
    const refreshedToken = await real.manager.getToken();

    assert.notEqual(refreshedToken, previousToken);
    assert.equal(real.fetchCalls, model.refreshes + 1);
    model.refreshes += 1;
    model.token = refreshedToken;
  }

  toString() {
    return 'invalidateToken(); getToken()';
  }
}

// **Validates: Requirements 1.12**
test('Property 4: invalidation forces a fresh token on the next getToken', async () => {
  const commandArbitrary = fc.array(
    fc.constant(new InvalidateAndRefreshCommand()),
    { minLength: 1, maxLength: 6 },
  );

  await fc.assert(
    fc.asyncProperty(commandArbitrary, async (commands) => {
      const real = createDeterministicManager('invalidation');
      await fc.asyncModelRun(
        () => ({ model: { token: null, refreshes: 0 }, real }),
        commands,
      );
    }),
  );
});
