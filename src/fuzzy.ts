// fzf-style fuzzy subsequence matching.
//
// A match requires every character of `query` to appear in `target`, in
// order, but not necessarily contiguous (a "subsequence" match) — so "blah"
// matches "Implement blah caching" and also "Big Lazy Auth Handler". Score
// rewards matches that are more "fzf-like": consecutive runs, and runs that
// start at a word boundary (after a space, `-`, `_`, or at the very start).

// Deliberately fzf "V1"-style: greedy leftmost matching, not the DP-based
// optimal alignment fzf's "V2" algorithm uses. V2 finds a better-scoring
// match on long strings with repeated substrings (e.g. file paths), at the
// cost of a much less readable O(query x target) table. Our targets are
// short task titles/descriptions where that gap rarely shows up in practice,
// so greedy stays — simpler to read, reason about, and modify. If ranking
// quality ever becomes a real problem, that's the signal to revisit this,
// not before.
const WORD_BOUNDARY_CHARS = new Set([' ', '-', '_', '/', '.']);

/** True if `target[index]` starts a new word (or is the first character). */
function isWordBoundary(target: string, index: number): boolean {
  if (index === 0) return true;
  return WORD_BOUNDARY_CHARS.has(target[index - 1] as string);
}

/**
 * Score how well `query` fuzzy-matches `target`, case-insensitively.
 *
 * Returns 0 if `query` is not a subsequence of `target` (no match) or if
 * `query` is empty. Otherwise returns a positive score — higher is a better
 * match. Only relative ordering between scores is meaningful, not the
 * absolute value.
 */
export function fuzzyScore(query: string, target: string): number {
  if (query.length === 0 || target.length === 0) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let score = 0;
  let targetIndex = 0;
  let consecutiveRun = 0;

  for (let queryIndex = 0; queryIndex < q.length; queryIndex++) {
    const char = q[queryIndex] as string;
    const foundAt = t.indexOf(char, targetIndex);
    if (foundAt === -1) return 0; // not a subsequence — no match

    const gap = foundAt - targetIndex;
    consecutiveRun = gap === 0 ? consecutiveRun + 1 : 1;

    let charScore = 1;
    charScore += Math.min(consecutiveRun - 1, 8) * 3; // reward consecutive runs
    if (isWordBoundary(t, foundAt)) charScore += 5; // reward word-start matches
    charScore -= Math.min(gap, 20) * 0.2; // mild penalty for skipped chars

    score += charScore;
    targetIndex = foundAt + 1;
  }

  // Slight preference for shorter targets when scores would otherwise tie
  // (a query matching a short, focused string is usually more relevant).
  score -= target.length * 0.01;

  return Math.max(score, 0.0001); // any real subsequence match stays > 0
}
