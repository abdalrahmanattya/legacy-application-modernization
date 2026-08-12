const { parseArgs, writeResult } = require('./common');
const args = parseArgs(process.argv.slice(2));
const experiments = [
  { id: 'db-lock', action: 'Hold a write transaction in a disposable copy, issue one bounded create request, record status/latency, then rollback.', safety: 'Never target a shared or production database; cap hold time at 5 seconds.' },
  { id: 'db-read-only', action: 'Run the disposable SQLite database from a read-only copy and verify readiness/error envelope.', safety: 'Use a temporary directory only; do not chmod the working tree.' },
  { id: 'db-unavailable', action: 'Stop the local storage dependency and verify /readyz returns 503 while /healthz remains 200.', safety: 'Only stop a process started by the test run.' },
  { id: 'process-restart', action: 'Restart the baseline with restart-persistence.js and verify the created order remains retrievable.', safety: 'Require an explicit reviewed --restart-command.' },
];
const result = { schema: 'wave0.characterization.v1', kind: 'failure-experiment-plan', status: 'planned', generatedAt: new Date().toISOString(), experiments, note: 'Plan only; no failure was injected and no measurement is claimed.' };
const file = writeResult(`failure-plan-${Date.now()}.json`, result, args.output); console.log(JSON.stringify({ ...result, output: file }, null, 2));
