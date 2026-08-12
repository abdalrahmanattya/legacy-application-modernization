const { DEFAULT_BASE_URL, DEFAULT_OPERATOR_TOKEN, jsonHeaders, parseArgs, request, writeResult } = require('./common');
const { spawn } = require('node:child_process');
const args = parseArgs(process.argv.slice(2));
const baseUrl = args.base_url || DEFAULT_BASE_URL; const token = args.operator_token || DEFAULT_OPERATOR_TOKEN;
async function main() {
  if (!args.restart_command) { const result = { schema: 'wave0.characterization.v1', kind: 'restart-persistence', status: 'blocked', pass: false, reason: 'Provide --restart-command with an explicitly reviewed local restart command; no process is started by default.' }; const file = writeResult(`restart-${Date.now()}.json`, result, args.output); console.log(JSON.stringify({ ...result, output: file }, null, 2)); process.exitCode = 2; return; }
  const key = `restart-${Date.now()}`; const payload = { customerReference: 'wave0-restart', lineItems: [{ sku: 'DEMO-PLATFORM-001', quantity: 1 }] };
  const first = await request(baseUrl, '/v1/orders', { method: 'POST', headers: jsonHeaders(token, { 'idempotency-key': key }), body: JSON.stringify(payload) }); const id = first.body?.orderId;
  const command = spawn(args.restart_command, { shell: true, cwd: args.cwd || process.cwd(), stdio: 'inherit' }); await new Promise((resolve, reject) => { command.on('error', reject); command.on('exit', code => code === 0 ? resolve() : reject(new Error(`restart command exited ${code}`))); });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { const health = await request(baseUrl, '/healthz'); if (health.status === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const after = id ? await request(baseUrl, `/v1/orders/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } }) : null;
  const result = { schema: 'wave0.characterization.v1', kind: 'restart-persistence', baseUrl, beforeStatus: first.status, orderId: id || null, afterStatus: after?.status || null, pass: first.status === 201 && after?.status === 200, note: 'The restart command is caller-supplied and must target only the disposable local baseline.' }; const file = writeResult(`restart-${Date.now()}.json`, result, args.output); console.log(JSON.stringify({ ...result, output: file }, null, 2)); process.exitCode = result.pass ? 0 : 1;
}
main().catch(error => { const result = { schema: 'wave0.characterization.v1', kind: 'restart-persistence', pass: false, error: error.message }; const file = writeResult(`restart-error-${Date.now()}.json`, result, args.output); console.error(JSON.stringify({ ...result, output: file })); process.exitCode = 1; });
