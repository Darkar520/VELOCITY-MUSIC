import { describe, it, expect } from 'vitest';
import { shouldSkipFeedRegen } from '../feed/feedSig.js';

describe('shouldSkipFeedRegen', () => {
  it('mismo sig → true (no regenerar)', () => {
    expect(shouldSkipFeedRegen({ completedSig: 'abc', nextSig: 'abc' })).toBe(true);
  });
  it('sig diferente → false (regenerar)', () => {
    expect(shouldSkipFeedRegen({ completedSig: 'abc', nextSig: 'xyz' })).toBe(false);
  });
  it('nextSig vacío → false (regenerar)', () => {
    expect(shouldSkipFeedRegen({ completedSig: 'abc', nextSig: '' })).toBe(false);
  });
  it('completedSig vacío → false (regenerar)', () => {
    expect(shouldSkipFeedRegen({ completedSig: '', nextSig: 'abc' })).toBe(false);
  });
  it('ambos vacíos → false', () => {
    expect(shouldSkipFeedRegen({ completedSig: '', nextSig: '' })).toBe(false);
  });
});
