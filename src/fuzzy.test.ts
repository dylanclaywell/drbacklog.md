import { describe, expect, it } from 'vitest';

import { fuzzyScore } from './fuzzy.js';

describe('fuzzyScore', () => {
  it('returns 0 for an empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('returns 0 for an empty target', () => {
    expect(fuzzyScore('blah', '')).toBe(0);
  });

  it('returns 0 when query is not a subsequence of target', () => {
    expect(fuzzyScore('xyz', 'Implement blah caching')).toBe(0);
  });

  it('matches a contiguous substring', () => {
    expect(fuzzyScore('blah', 'Implement blah caching')).toBeGreaterThan(0);
  });

  it('matches a scattered subsequence', () => {
    expect(fuzzyScore('ilc', 'Implement blah caching')).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('BLAH', 'implement blah caching')).toBeGreaterThan(0);
    expect(fuzzyScore('blah', 'Implement Blah Caching')).toBeGreaterThan(0);
  });

  it('scores a consecutive run higher than a scattered match of the same length', () => {
    const consecutive = fuzzyScore('auth', 'Auth handler rewrite');
    const scattered = fuzzyScore('auth', 'A user then handles rewrite'); // a-u-t-h scattered
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('scores a word-boundary match higher than a same-length mid-word match', () => {
    const atBoundary = fuzzyScore('log', 'logger init'); // "log" starts "logger"
    const midWord = fuzzyScore('log', 'catalog init'); // "log" mid-word in "catalog"
    expect(atBoundary).toBeGreaterThan(midWord);
  });

  it('scores an exact match highest among candidates containing it', () => {
    const exact = fuzzyScore('login', 'login');
    const withExtra = fuzzyScore('login', 'login page redesign');
    expect(exact).toBeGreaterThan(withExtra);
  });

  it('prefers a shorter target when match quality is otherwise equal', () => {
    const short = fuzzyScore('cache', 'cache');
    const long = fuzzyScore('cache', 'cache' + 'x'.repeat(50));
    expect(short).toBeGreaterThan(long);
  });
});
