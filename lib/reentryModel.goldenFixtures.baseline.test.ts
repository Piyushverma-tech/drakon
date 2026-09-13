/**
 * Guards against exactly the staleness risk documented in
 * scripts/generate-reentry-golden-fixtures.ts: golden_cases.json getting
 * regenerated from a different reference-source state than its own
 * baselineCommit field claims, or edited by hand, without anyone noticing.
 *
 * This does NOT overwrite the committed fixture. It regenerates into a
 * scratch file (via --out) and diffs that against what's committed,
 * ignoring only the generatedAt timestamp. Any other difference --
 * including a baselineCommit mismatch, a hand-edited value, or a fixture
 * that's simply out of date relative to the current reference source --
 * fails this test.
 *
 * If this fails because you deliberately changed the reference model:
 * regenerate for real (`npx tsx scripts/generate-reentry-golden-fixtures.ts`)
 * and commit the result -- don't edit this test to ignore the diff.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

describe('golden fixture baseline integrity', () => {
  it('golden_cases.json is exactly what the generator produces from the current committed source', () => {
    const committedPath = path.join(
      process.cwd(),
      'fixtures',
      'reentry-model',
      'golden_cases.json'
    );
    const scratchPath = path.join(process.cwd(), '.tmp-golden-cases-ci-check.json');

    try {
      execFileSync(
        'npx',
        [
          'tsx',
          'scripts/generate-reentry-golden-fixtures.ts',
          `--out=${scratchPath}`,
        ],
        { cwd: process.cwd(), stdio: 'pipe' }
      );

      const committed = JSON.parse(readFileSync(committedPath, 'utf-8'));
      const regenerated = JSON.parse(readFileSync(scratchPath, 'utf-8'));

      // Only the timestamp is allowed to differ between two honest runs.
      delete committed.generatedAt;
      delete regenerated.generatedAt;

      expect(regenerated).toEqual(committed);
    } finally {
      try {
        unlinkSync(scratchPath);
      } catch {
        // scratch file may not exist if generation itself failed -- that
        // failure already surfaces via execFileSync throwing above.
      }
    }
  });
});
