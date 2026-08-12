# Candidate service-level objectives

These are planning targets, not measurements or production commitments. They
become meaningful only after a reproducible workload, environment, and retained
measurement exist.

| Capability                 |           Candidate target | Measurement boundary                                    | Baseline expectation    |
| -------------------------- | -------------------------: | ------------------------------------------------------- | ----------------------- |
| Liveness response          |           99.9% successful | `GET /healthz`, excluding planned local stop            | Establish locally       |
| Readiness response         |           99.5% successful | `GET /readyz` with storage available                    | Establish locally       |
| Catalog/order read latency |               p95 ≤ 300 ms | Local seeded dataset, 100-order cap                     | Measure before Wave 1   |
| Order creation latency     |               p95 ≤ 500 ms | Valid authenticated request, idempotent replay included | Measure before Wave 1   |
| State transition latency   |               p95 ≤ 500 ms | One order, one valid transition                         | Measure before Wave 1   |
| Synchronous report         | p95 ≤ 2 s for ≤ 100 orders | Admin-only, bounded export                              | Treat as baseline limit |
| Recovery point             |                     ≤ 24 h | Local backup procedure                                  | Planned only            |
| Recovery time              |                      ≤ 4 h | Restore into clean local instance                       | Planned only            |

The report target is deliberately not an async-service SLO. Wave 2 must define
job acceptance, queue delay, completion time, download expiry, and failure
replay targets before replacing the synchronous contract.
