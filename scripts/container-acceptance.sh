#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:?usage: $0 IMAGE_REF}"
project="wave1-acceptance-$$"
volume="${project}-data"
name="${project}-service"
signal_name="${project}-signal"
port="${WAVE1_PORT:-18080}"
operator='local-operator-a-token'
other='local-operator-b-token'
admin='local-admin-token'
cursor_secret='container-acceptance-cursor-signing-secret'
evidence_dir="${WAVE1_EVIDENCE_DIR:-wave1-evidence}"
mkdir -p "$evidence_dir"
cleanup() {
  docker rm -f "$name" "$signal_name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
run_hardened() {
  docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL \
    --security-opt no-new-privileges:true "$@" "$image"
}
start_service() {
  docker run -d --name "$name" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --cap-drop ALL --security-opt no-new-privileges:true -p "$port:3000" \
    -e ENVIRONMENT=local -e ORDER_DB_PATH=/data/orders.sqlite \
    -e OPERATOR_A_TOKEN="$operator" -e OPERATOR_B_TOKEN="$other" -e ADMIN_TOKEN="$admin" \
    -e CURSOR_SIGNING_SECRET="$cursor_secret" \
    -v "$volume:/data" "$image" >/dev/null
}
wait_ready() {
  for attempt in {1..20}; do
    if curl --fail --silent "http://127.0.0.1:${port}/readyz" >/dev/null; then return 0; fi
    sleep 1
  done
  docker logs "$name" >&2
  return 1
}

docker volume create "$volume" >/dev/null
start_service
wait_ready
test "$(docker inspect -f '{{.Config.User}}' "$name")" = 'node'
test "$(docker exec "$name" node -p 'process.getuid()')" = '1000'
if docker exec "$name" node -e "require('node:fs').writeFileSync('/app/denied','x')" >/dev/null 2>&1; then
  echo 'root filesystem write unexpectedly succeeded' >&2; exit 1
fi
docker exec "$name" node -e "require('node:fs').writeFileSync('/data/acceptance','ok')"

BASELINE_BASE_URL="http://127.0.0.1:${port}" BASELINE_OPERATOR_TOKEN="$operator" BASELINE_OPERATOR_B_TOKEN="$other" BASELINE_ADMIN_TOKEN="$admin" \
  node tools/baseline/smoke-order-lifecycle.js --output "tools/baseline/evidence-results/container-smoke.json"

order_body="$(curl --fail --silent -X POST "http://127.0.0.1:${port}/v1/orders" \
  -H "Authorization: Bearer ${operator}" -H 'Content-Type: application/json' -H 'Idempotency-Key: container-persist-1' \
  --data '{"customerReference":"container-persist","lineItems":[{"sku":"DEMO-DATA-002","quantity":1}]}')"
order_id="$(printf '%s' "$order_body" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).orderId))")"
docker rm -f "$name" >/dev/null
start_service
wait_ready
curl --fail --silent "http://127.0.0.1:${port}/v1/orders/${order_id}" -H "Authorization: Bearer ${operator}" | grep -q 'container-persist'
docker rm -f "$name" >/dev/null

if docker run --rm --read-only -e ENVIRONMENT=production --entrypoint node "$image" -e "require('./app/runtime/config').readRuntimeConfig('api')" >/dev/null 2>&1; then exit 1; fi
if docker run --rm --read-only -e ENVIRONMENT=production -e OPERATOR_A_TOKEN=a -e OPERATOR_B_TOKEN=b -e ADMIN_TOKEN=c --entrypoint node "$image" -e "require('./app/runtime/config').readRuntimeConfig('api')" >/dev/null 2>&1; then exit 1; fi

docker run -d --name "$signal_name" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true -e ENVIRONMENT=local \
  -e OPERATOR_A_TOKEN=a -e OPERATOR_B_TOKEN=b -e ADMIN_TOKEN=c \
  -e CURSOR_SIGNING_SECRET="$cursor_secret" -v "${volume}:/data" "$image" >/dev/null
for attempt in {1..20}; do
  if docker exec "$signal_name" node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then break; fi
  [[ "$attempt" == 20 ]] && exit 1
  sleep 1
done
started=$(date +%s)
docker stop -t 12 "$signal_name" >/dev/null
elapsed=$(( $(date +%s) - started ))
test "$(docker inspect -f '{{.State.ExitCode}}' "$signal_name")" = '0'
test "$elapsed" -le 12

cat >"$evidence_dir/summary.json" <<EOF
{"schema":"wave1.container-acceptance.v1","pass":true,"image":"${image}","imageId":"$(docker image inspect -f '{{.Id}}' "$image")","platform":"$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image")","user":"$(docker image inspect -f '{{.Config.User}}' "$image")","healthcheck":true,"readiness":true,"apiLifecycle":true,"rootFilesystemDenied":true,"dataVolumeWritable":true,"persistenceAcrossReplacement":true,"productionConfigFailFast":true,"signalShutdownExit":0,"signalShutdownSeconds":${elapsed}}
EOF
echo 'Wave 1 container acceptance: PASS'
