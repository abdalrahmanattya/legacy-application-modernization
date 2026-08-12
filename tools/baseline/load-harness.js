const { DEFAULT_BASE_URL, parseArgs, percentile, request, writeResult } = require('./common');

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.base_url || DEFAULT_BASE_URL;
const total = Math.min(500, Math.max(1, Number(args.requests || 50))); const concurrency = Math.min(25, Math.max(1, Number(args.concurrency || 5)));
async function main() {
  const routes = ['/healthz', '/readyz', '/v1/products']; const samples = []; let cursor = 0;
  async function worker() { while (true) { const index = cursor++; if (index >= total) return; const route = routes[index % routes.length]; const result = await request(baseUrl, route, route === '/v1/products' ? {} : {}); samples.push({ index, route, status: result.status, elapsedMs: result.elapsedMs }); } }
  const startedAt = new Date().toISOString(); await Promise.all(Array.from({ length: concurrency }, worker));
  const statuses = Object.fromEntries([...new Set(samples.map(item => item.status))].map(status => [status, samples.filter(item => item.status === status).length]));
  const latencies = samples.map(item => item.elapsedMs); const result = { schema: 'wave0.characterization.v1', kind: 'bounded-http-load', baseUrl, startedAt, finishedAt: new Date().toISOString(), requested: total, concurrency, completed: samples.length, statuses, latencyMs: { min: Math.min(...latencies), p50: percentile(latencies, 50), p95: percentile(latencies, 95), p99: percentile(latencies, 99), max: Math.max(...latencies) }, pass: samples.length === total && samples.every(item => item.status >= 200 && item.status < 300), note: 'Candidate SLOs are not production claims; compare only like-for-like local runs.' };
  const file = writeResult(`load-${Date.now()}.json`, { ...result, samples }, args.output); console.log(JSON.stringify({ ...result, output: file }, null, 2)); process.exitCode = result.pass ? 0 : 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
