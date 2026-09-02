// fzf-style fuzzy subsequence matching.
//
// A match requires every character of `query` to appear in `target`, in
// order, but not necessarily contiguous (a "subsequence" match) — so "blah"
// matches "Implement blah caching" and also "Big Lazy Auth Handler". Score
// rewards matches that are more "fzf-like": consecutive runs, and runs that
// start at a word boundary (after a space, `-`, `_`, or at the very start).

// Deliberately fzf "V1"-style: greedy matching, not the DP-based optimal
// alignment fzf's "V2" algorithm uses. Full V2 finds the single best-scoring
// match by considering every alignment at once, at the cost of a much less
// readable O(query x target) table. We compromise: try every occurrence of
// the *first* query character as a starting anchor, greedily match the rest
// from there, and keep the best-scoring anchor. That fixes the dominant
// real-world failure mode of pure leftmost-greedy — locking onto a weak
// match because the first character happened to occur early in an unrelated
// word — while staying O(anchors x query length), nowhere near full DP cost.
// It still isn't globally optimal (a bad choice past the first character can
// still lose to a better one), so if ranking quality ever becomes a real
// problem, that's the signal to revisit this properly, not before.
const WORD_BOUNDARY_CHARS = new Set([
  ' ',
  '-',
  '_',
  '/',
  '.',
  '(',
  ')',
  '[',
  ']',
  ',',
  ':',
  ';',
  '"',
  "'",
]);

/** True if `target[index]` starts a new word (or is the first character). */
function isWordBoundary(target: string, index: number): boolean {
  if (index === 0) return true;
  return WORD_BOUNDARY_CHARS.has(target[index - 1] as string);
}

/**
 * Greedily match `query` against `target` starting the first character
 * exactly at `anchor`. Returns the score, or undefined if `query` isn't a
 * subsequence of `target` from that anchor onward.
 */
function scoreFromAnchor(query: string, target: string, anchor: number): number | undefined {
  let score = 0;
  let targetIndex = anchor;
  let consecutiveRun = 0;

  for (let queryIndex = 0; queryIndex < query.length; queryIndex++) {
    const char = query[queryIndex] as string;
    const foundAt = target.indexOf(char, targetIndex);
    if (foundAt === -1) return undefined; // not a subsequence from here — no match

    // The first matched character has nothing before it to be "close to" —
    // penalizing it for where the anchor falls in the string would just
    // reward anchors that happen to sit early in `target`, regardless of
    // match quality from that point on.
    const gap = queryIndex === 0 ? 0 : foundAt - targetIndex;
    consecutiveRun = gap === 0 ? consecutiveRun + 1 : 1;

    let charScore = 1;
    charScore += Math.min(consecutiveRun - 1, 8) * 3; // reward consecutive runs
    if (isWordBoundary(target, foundAt)) charScore += 5; // reward word-start matches
    charScore -= Math.min(gap, 20) * 0.2; // mild penalty for skipped chars

    score += charScore;
    targetIndex = foundAt + 1;
  }

  return score;
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

  let best: number | undefined;
  for (let anchor = t.indexOf(q[0] as string); anchor !== -1; anchor = t.indexOf(q[0] as string, anchor + 1)) {
    const score = scoreFromAnchor(q, t, anchor);
    if (score !== undefined && (best === undefined || score > best)) best = score;
  }
  if (best === undefined) return 0; // not a subsequence anywhere — no match

  // Slight preference for shorter targets when scores would otherwise tie
  // (a query matching a short, focused string is usually more relevant).
  best -= t.length * 0.01;

  return Math.max(best, 0.0001); // any real subsequence match stays > 0
}
