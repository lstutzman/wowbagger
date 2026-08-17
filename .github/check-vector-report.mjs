// Reads an implementation-runner report from standard input and refuses unless
// it is native evidence that passed on this platform.
//
// `spec/run-adapter-implementation.js` reports its verdict in the JSON `status`
// member and exits 0 whether that verdict is `pass` or `fail`, so a CI step that
// only checked the exit code would report success on a failing run. It also
// stamps the report with the platform it ran on, and that stamp is the whole
// point of a native job: evidence for one platform is not evidence for another.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const failures = report.cases?.filter((entry) => entry.status !== 'pass') ?? [];
const problems = [];
if (report.status !== 'pass') {
  problems.push(`status is ${report.status}, not pass`);
  for (const entry of failures) problems.push(`  case ${entry.case} ${entry.status}`);
}
if (report.evidence_platform !== process.platform) {
  problems.push(`evidence_platform is ${report.evidence_platform}, not ${process.platform}`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(1);
}

const assertions = report.cases.reduce((total, entry) => total + entry.executed_assertions.length, 0);
process.stdout.write(
  `native ${report.evidence_platform} evidence: pass, ${report.cases.length} cases, ${assertions} assertions\n`,
);
