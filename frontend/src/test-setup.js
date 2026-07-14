// Setup para vitest + jsdom: mockear APIs de browser que jsdom no implementa.

// localStorage (jsdom lo tiene pero a veces no persiste entre archivos)
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

// matchMedia (no implementado en jsdom)
if (!globalThis.matchMedia) {
  globalThis.matchMedia = (q) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// URL.createObjectURL (no implementado en jsdom)
if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = (blob) => `blob:mock-${Math.random().toString(36).slice(2)}`;
  globalThis.URL.revokeObjectURL = () => {};
}

// IntersectionObserver (algunos componentes lo usan)
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}
