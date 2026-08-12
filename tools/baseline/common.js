const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = process.env.BASELINE_BASE_URL || 'http://127.0.0.1:3000';
const DEFAULT_OPERATOR_TOKEN = process.env.BASELINE_OPERATOR_TOKEN || 'local-operator-token';
const DEFAULT_OPERATOR_B_TOKEN = process.env.BASELINE_OPERATOR_B_TOKEN || 'local-operator-b-token';
const DEFAULT_ADMIN_TOKEN = process.env.BASELINE_ADMIN_TOKEN || 'local-admin-token';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2).replaceAll('-', '_');
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i += 1; } else args[key] = true;
  }
  return args;
}

function outputPath(name, requested) {
  const root = path.resolve(__dirname, 'evidence-results');
  fs.mkdirSync(root, { recursive: true });
  const candidate = requested ? path.resolve(requested) : path.join(root, name);
  return candidate;
}

function redact(value) {
  if (typeof value === 'string') return value
    .replaceAll(/(authorization\s*:\s*bearer\s+)[^\s,}]+/gi, '$1<redacted>')
    .replaceAll(/(token|password|secret|api[-_]?key)\s*[:=]\s*[^\s,}]+/gi, '$1=<redacted>');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|password|secret|authorization|api[-_]?key/i.test(key) ? '<redacted>' : redact(item)]));
  return value;
}

async function request(baseUrl, route, options = {}) {
  const started = performance.now();
  const response = await fetch(new URL(route, baseUrl), { redirect: 'manual', ...options });
  const elapsedMs = Number((performance.now() - started).toFixed(3));
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, elapsedMs, headers: Object.fromEntries(response.headers), body: redact(body) };
}

function bearer(token, extra = {}) { return { ...extra, authorization: `Bearer ${token}` }; }
function jsonHeaders(token, extra = {}) { return bearer(token, { 'content-type': 'application/json', ...extra }); }
function percentile(values, p) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b); const index = Math.min(ordered.length - 1, Math.ceil((p / 100) * ordered.length) - 1);
  return Number(ordered[index].toFixed(3));
}
function writeResult(name, result, requested) {
  const file = outputPath(name, requested); fs.writeFileSync(file, `${JSON.stringify(redact(result), null, 2)}\n`); return file;
}
function csv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]); const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return `${keys.join(',')}\n${rows.map(row => keys.map(key => quote(row[key])).join(',')).join('\n')}\n`;
}

module.exports = { DEFAULT_BASE_URL, DEFAULT_ADMIN_TOKEN, DEFAULT_OPERATOR_B_TOKEN, DEFAULT_OPERATOR_TOKEN, bearer, csv, jsonHeaders, parseArgs, percentile, redact, request, writeResult };
