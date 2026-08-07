"""Break each guard, confirm a test goes red, restore it.

A guard nothing proves is a guard nobody knows works. Every mutation below
disables one guard by forcing it true; the suite MUST fail. If it stays green,
that guard has no coverage regardless of how many tests exist.
"""
import shutil, subprocess, sys, os

os.chdir('/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/compressed-skipping-dongarra')
TARGET = 'src/mutation.js'
BACKUP = '/tmp/mutation-pass-backup.js'

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
     "          [],\n        );"),
    ('unsafeYamlMutation refusal (transition)',
     '          mutationFields,\n        );',
     '          [],\n        );'),
    ('no-op patch refusal',
     '        if (!patchChangesData(lockedTarget.data, request.patch)) {',
     '        if (false && !patchChangesData(lockedTarget.data, request.patch)) {'),
    ('create controlled-member refusal',
     "    'killed', 'archived', 'decisions', 'body', 'priority', 'number',",
     "    'killed', 'archived', 'decisions', 'body',"),
]

shutil.copy(TARGET, BACKUP)
original = open(TARGET).read()
results = []

try:
    for label, needle, replacement in MUTATIONS:
        count = original.count(needle)
        if count != 1:
            results.append((label, f'SKIPPED — anchor matched {count} sites'))
            continue
        open(TARGET, 'w').write(original.replace(needle, replacement))
        run = subprocess.run(['node', '--test'] + __import__('glob').glob('test/*.test.js'),
                             capture_output=True, text=True,
                             env={**os.environ, 'TMPDIR': '/tmp'})
        failed = '\nℹ fail 0\n' not in run.stdout
        results.append((label, 'caught' if failed else 'NOT CAUGHT — no test covers this guard'))
        open(TARGET, 'w').write(original)
finally:
    shutil.copy(BACKUP, TARGET)

print(f'{"guard":<48} verdict')
print('-' * 78)
for label, verdict in results:
    mark = 'OK ' if verdict == 'caught' else '!! '
    print(f'{mark}{label:<45} {verdict}')
sys.exit(0 if all(v == 'caught' for _, v in results) else 1)
