#!/usr/bin/env python3
"""Break each guard, confirm a test goes red, restore it.

A guard nothing proves is a guard nobody knows works. Every mutation below
disables one guard; the suite MUST then fail. If it stays green, that guard has
no coverage regardless of how many tests exist.

Run from the repository root:  python3 scripts/mutation-pass.py
Exits 0 only when every guard is proven.
"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, 'src', 'mutation.js')

# (label, exact source substring, replacement that disables the guard)
MUTATIONS = [
    ('completeDataMatches (successor data equality)',
     'const completeDataMatches = !replacement || (!parsed.error && comparisonInputsPresent',
     'const completeDataMatches = true || (!parsed.error && comparisonInputsPresent'),
    ('unchangedNodesMatch (unpatched node identity)',
     'const unchangedNodesMatch = !replacement || (identityInputsValid',
     'const unchangedNodesMatch = true || (identityInputsValid'),
    ('extensionsMatch (operator extension identity)',
     'const extensionsMatch = !replacement || (identityInputsValid',
     'const extensionsMatch = true || (identityInputsValid'),
    ('unchangedBytesMatch (byte-range preservation)',
     'const unchangedBytesMatch = replacementId === null',
     'const unchangedBytesMatch = true || replacementId === null'),
    # Both branches call unsafeYamlMutation; anchor on each one's own argument
    # so a single ambiguous match cannot silently disable the wrong path.
    ('unsafeYamlMutation refusal (patch)',
     "          [...Object.keys(request.patch), 'updated', 'decisions'],\n        );",
     '          [],\n        );'),
    ('unsafeYamlMutation refusal (transition)',
     '          mutationFields,\n        );',
     '          [],\n        );'),
    ('no-op patch detection',
     '        if (!patchChangesData(lockedTarget.data, request.patch)) {',
     '        if (false && !patchChangesData(lockedTarget.data, request.patch)) {'),
    ('create controlled-member refusal',
     "    'killed', 'archived', 'decisions', 'body', 'priority', 'number',",
     "    'killed', 'archived', 'decisions', 'body',"),
]


def run_suite():
    """Return (passed, assertions_ran).

    A mutation must be caught by an ASSERTION, not by breaking the build. A
    syntax error or a module that fails to load also produces a non-zero exit,
    and scoring that as 'caught' would certify a guard nothing actually tests.
    So we require a summary AND that the reported test total is unchanged from
    the baseline: if the mutation stopped tests from running, that is a broken
    harness, not a proven guard."""
    run = subprocess.run(
        ['node', '--test'] + sorted(glob.glob(os.path.join(ROOT, 'test', '*.test.js'))),
        capture_output=True, text=True, cwd=ROOT,
        env={**os.environ, 'TMPDIR': '/tmp'})
    out = run.stdout
    total = None
    for marker in ('\nℹ tests ', '\n# tests '):
        if marker in out:
            total = out.split(marker, 1)[1].split('\n', 1)[0].strip()
            break
    fails = None
    for marker in ('\nℹ fail ', '\n# fail '):
        if marker in out:
            fails = out.split(marker, 1)[1].split('\n', 1)[0].strip()
            break
    # Both markers are required. A run reporting a total but no fail line has
    # not told us whether anything failed, and guessing would score a guard.
    if total is None or fails is None:
        return (False, None)
    return (fails == '0', total)


def main():
    original = open(TARGET, encoding='utf-8').read()
    handle, backup = tempfile.mkstemp(prefix='mutation-pass-', suffix='.js')
    os.close(handle)
    shutil.copy(TARGET, backup)

    # A red baseline makes every mutation look caught. Refuse to score anything.
    baseline_green, baseline_total = run_suite()
    if baseline_total is None:
        print('The suite produced no summary. Fix the runner before scoring guards.')
        return 2
    if not baseline_green:
        print('The suite is already failing. A red baseline scores every guard as '
              'proven, so nothing is measured until it is green.')
        return 2

    results = []
    try:
        for label, needle, replacement in MUTATIONS:
            count = original.count(needle)
            if count != 1:
                results.append((label, f'ANCHOR DRIFT — matched {count} sites, expected 1'))
                continue
            with open(TARGET, 'w', encoding='utf-8') as target:
                target.write(original.replace(needle, replacement))
            green, total = run_suite()
            if total is None:
                verdict = 'NO SUMMARY — the mutated tree did not run'
            elif green and total != baseline_total:
                # Green but a different total means tests vanished without any
                # failing — the mutation broke the harness rather than tripping
                # a guard. A caught mutation may legitimately lower the total,
                # because a failing subtest can stop its siblings from running.
                verdict = (f'BROKE THE HARNESS — {total} tests ran, baseline {baseline_total}, '
                           'and nothing failed')
            elif green:
                verdict = 'NOT CAUGHT — no test covers this guard'
            else:
                verdict = 'caught'
            results.append((label, verdict))
            with open(TARGET, 'w', encoding='utf-8') as target:
                target.write(original)
    finally:
        # Restore unconditionally, then prove it: an interrupted run must never
        # leave a disabled guard in tracked source. Raise rather than return —
        # a return here would discard whatever exception brought us in.
        shutil.copy(backup, TARGET)
        if open(TARGET, encoding='utf-8').read() != original:
            raise RuntimeError(f'Restore failed. Original source is at {backup}')
        os.unlink(backup)

    print(f'{"guard":<48} verdict')
    print('-' * 78)
    for label, verdict in results:
        print(f'{"OK " if verdict == "caught" else "!! "}{label:<45} {verdict}')
    return 0 if all(verdict == 'caught' for _, verdict in results) else 1


if __name__ == '__main__':
    sys.exit(main())
