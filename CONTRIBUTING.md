# Contributing

This project is an evidence-led modernization effort. Keep changes small,
reviewable, and explicit about what was actually measured.

## Local checks

Use Node 24 (`>=24 <25`) and run:

```sh
npm ci
npm test
npm run test:wave3
npm run lint
npm run format
npm audit --audit-level=high
```

For infrastructure changes, use Terraform 1.15.8 with backend-disabled
initialization and validation for every root, then run the policy, cross-wire,
rendered task-definition, and operations checks. Docker and disposable
PostgreSQL drills are optional local evidence, not cloud evidence.

Never commit credentials, `.env` files, Terraform state/plans, customer data,
generated evidence, or cloud account artifacts. Keep AWS apply disabled unless
the task has explicit cloud approval. Every README or evidence claim must say
whether it is specified, structurally reviewed, locally verified, hosted
verified, or cloud verified.

Pull requests should explain the acceptance criteria, changed evidence, tests
run, and any remaining limitations. Dependabot updates must preserve the Node
24 contract and immutable action pinning.
