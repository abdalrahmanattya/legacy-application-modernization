const { DEFAULT_ADMIN_TOKEN, DEFAULT_BASE_URL, DEFAULT_OPERATOR_B_TOKEN, DEFAULT_OPERATOR_TOKEN, bearer, jsonHeaders, parseArgs, request, writeResult } = require('./common');

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.base_url || DEFAULT_BASE_URL;
const operatorToken = args.operator_token || DEFAULT_OPERATOR_TOKEN;
const otherOperatorToken = args.other_operator_token || DEFAULT_OPERATOR_B_TOKEN;
const adminToken = args.admin_token || DEFAULT_ADMIN_TOKEN;
const key = `wave0-${Date.now()}`;
const order = { customerReference: 'wave0-reference', lineItems: [{ sku: 'DEMO-PLATFORM-001', quantity: 1 }] };
const checks = [];
async function check(name, method, route, expected, options = {}) {
  try {
    const result = await request(baseUrl, route, options);
    checks.push({ name, expected, status: result.status, pass: result.status === expected, elapsedMs: result.elapsedMs });
    return result;
  } catch (error) { checks.push({ name, expected, pass: false, error: error.message }); return null; }
}
async function main() {
  const startedAt = new Date().toISOString();
  await check('liveness', 'GET', '/healthz', 200);
  await check('readiness', 'GET', '/readyz', 200);
  await check('seeded catalog', 'GET', '/v1/products', 200);
  const first = await check('create order', 'POST', '/v1/orders', 201, { method: 'POST', headers: jsonHeaders(operatorToken, { 'idempotency-key': key }), body: JSON.stringify(order) });
  const orderId = first?.body?.orderId;
  const replay = await check('idempotent replay', 'POST', '/v1/orders', 200, { method: 'POST', headers: jsonHeaders(operatorToken, { 'idempotency-key': key }), body: JSON.stringify(order) });
  checks.push({ name: 'replay marker', expected: 'true', actual: replay?.headers?.['idempotency-replayed'], pass: replay?.headers?.['idempotency-replayed'] === 'true' });
  const conflict = await check('idempotency conflict', 'POST', '/v1/orders', 409, { method: 'POST', headers: jsonHeaders(operatorToken, { 'idempotency-key': key }), body: JSON.stringify({ ...order, customerReference: 'wave0-conflict' }) });
  checks.push({ name: 'UUID order identifier', pass: Boolean(orderId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) });
  if (orderId) {
    await check('retrieve order', 'GET', `/v1/orders/${encodeURIComponent(orderId)}`, 200, { headers: bearer(operatorToken) });
    await check('operator isolation', 'GET', `/v1/orders/${encodeURIComponent(orderId)}`, 404, { headers: bearer(otherOperatorToken) });
    await check('confirm transition', 'POST', `/v1/orders/${encodeURIComponent(orderId)}`, 200, { method: 'POST', headers: jsonHeaders(operatorToken), body: JSON.stringify({ targetStatus: 'CONFIRMED' }) });
    await check('fulfil transition', 'POST', `/v1/orders/${encodeURIComponent(orderId)}`, 200, { method: 'POST', headers: jsonHeaders(operatorToken), body: JSON.stringify({ targetStatus: 'FULFILLED' }) });
    await check('reject terminal transition', 'POST', `/v1/orders/${encodeURIComponent(orderId)}`, 409, { method: 'POST', headers: jsonHeaders(operatorToken), body: JSON.stringify({ targetStatus: 'CANCELLED' }) });
  }
  await check('bounded principal list', 'GET', '/v1/orders?limit=25', 200, { headers: bearer(operatorToken) });
  await check('admin-only report', 'GET', '/v1/reports/orders?limit=100', 200, { headers: bearer(adminToken, { accept: 'application/json' }) });
  await check('admin CSV report', 'GET', '/v1/reports/orders?limit=100', 200, { headers: bearer(adminToken, { accept: 'text/csv' }) });
  const result = { schema: 'wave0.characterization.v1', kind: 'smoke-order-lifecycle', baseUrl, startedAt, finishedAt: new Date().toISOString(), checks, pass: checks.length > 0 && checks.every(item => item.pass), note: orderId ? 'Executed against the contract-compatible service.' : 'No order ID returned; downstream lifecycle checks were safely skipped.' };
  const file = writeResult(`smoke-${Date.now()}.json`, result, args.output);
  console.log(JSON.stringify({ ...result, output: file }, null, 2));
  process.exitCode = result.pass ? 0 : 1;
}
main().catch(error => { const result = { schema: 'wave0.characterization.v1', kind: 'smoke-order-lifecycle', baseUrl, pass: false, error: error.message }; const file = writeResult(`smoke-error-${Date.now()}.json`, result, args.output); console.error(JSON.stringify({ ...result, output: file })); process.exitCode = 1; });
