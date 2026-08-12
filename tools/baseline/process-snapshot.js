const { parseArgs, writeResult } = require('./common');
const { execFileSync } = require('node:child_process');
const args = parseArgs(process.argv.slice(2));
function snapshot() {
  try { return execFileSync('ps', ['-axo', 'pid,ppid,%cpu,%mem,rss,etime,command'], { encoding: 'utf8' }).trim().split('\n').slice(0, 101); }
  catch (error) { return { unavailable: error.message }; }
}
const result = { schema: 'wave0.characterization.v1', kind: 'process-resource-snapshot', capturedAt: new Date().toISOString(), rows: snapshot(), note: 'Host-level snapshot only; no production resource claim.' };
const file = writeResult(`process-${Date.now()}.json`, result, args.output); console.log(JSON.stringify({ ...result, output: file }, null, 2));
