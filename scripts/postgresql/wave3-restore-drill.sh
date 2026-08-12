#!/usr/bin/env bash
set -Eeuo pipefail

name="wave3-restore-$$"
volume="wave3-restore-volume-$$"
output="${WAVE3_EVIDENCE_OUTPUT:-.evidence-results/postgresql-restore.json}"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$volume" >/dev/null
docker run -d --name "$name" -e POSTGRES_PASSWORD=wave3-local-only -e POSTGRES_DB=orders -v "$volume:/var/lib/postgresql/data" postgres:17 >/dev/null
for _ in $(seq 1 30); do docker exec "$name" pg_isready -U postgres -d orders >/dev/null 2>&1 && break; sleep 1; done
docker exec "$name" pg_isready -U postgres -d orders >/dev/null
docker exec "$name" psql -U postgres -d orders -v ON_ERROR_STOP=1 -c "CREATE TABLE restore_probe (id integer PRIMARY KEY, marker text NOT NULL); INSERT INTO restore_probe VALUES (1, 'wave3-restore');" >/dev/null
started=$(( $(date +%s) * 1000 ))
docker exec "$name" pg_dump -U postgres -d orders --format=custom --file=/tmp/wave3.dump >/dev/null
docker exec "$name" createdb -U postgres restored >/dev/null
docker exec "$name" pg_restore -U postgres -d restored --clean --if-exists /tmp/wave3.dump >/dev/null
marker=$(docker exec "$name" psql -U postgres -d restored -Atc 'SELECT marker FROM restore_probe WHERE id=1')
finished=$(( $(date +%s) * 1000 ))
[[ "$marker" == "wave3-restore" ]]
mkdir -p "$(dirname "$output")"
cat >"$output" <<EOF
{"schema":"wave3.postgresql-restore.v1","database":"PostgreSQL 17 disposable container","integrity":true,"marker":"$marker","rtoMs":$((finished-started)),"rpoAssumption":"explicit dump point; zero uncommitted transactions assumed","pass":true}
EOF
cat "$output"
