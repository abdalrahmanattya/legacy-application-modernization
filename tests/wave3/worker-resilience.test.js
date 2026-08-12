const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FaultQueue,
  FaultArtifactStore,
} = require("../../app/testing/fault-adapters");
const { createReportWorker } = require("../../app/report-worker");

const jobId = "550e8400-e29b-41d4-a716-446655440000";
const message = {
  reportJobId: jobId,
  correlationId: "wave3-fault",
  traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
};

function repositoryFixture() {
  const state = { status: "QUEUED", attempts: 0, result: null };
  return {
    state,
    async claimReportJob(requested) {
      if (requested !== jobId || state.status !== "QUEUED") return null;
      state.status = "RUNNING";
      state.attempts += 1;
      return { jobId, format: "json", filters: {} };
    },
    async report() {
      return [];
    },
    async completeReportJob(_jobId, result) {
      state.status = "SUCCEEDED";
      state.result = result;
    },
    async releaseReportJob() {
      state.status = "QUEUED";
    },
    async extendReportJobLease() {},
  };
}

test("duplicate delivery is acknowledged after one durable completion", async () => {
  const queue = new FaultQueue();
  const repository = repositoryFixture();
  const artifacts = new FaultArtifactStore();
  await queue.send(message);
  queue.duplicate();
  const worker = createReportWorker({
    repository,
    queue,
    artifactStore: artifacts,
  });
  assert.equal(await worker.runOnce(), true);
  assert.equal(await worker.runOnce(), false);
  assert.equal(repository.state.attempts, 1);
  assert.equal(queue.available.length, 0);
  assert.equal(queue.inflight.size, 0);
});

test("crash after artifact upload safely retries and overwrites the deterministic key", async () => {
  const queue = new FaultQueue();
  const repository = repositoryFixture();
  const artifacts = new FaultArtifactStore();
  artifacts.failAfterPut = true;
  await queue.send(message);
  const worker = createReportWorker({
    repository,
    queue,
    artifactStore: artifacts,
  });
  await assert.rejects(worker.runOnce(), /post-upload crash/);
  assert.equal(repository.state.status, "QUEUED");
  assert.equal(artifacts.artifacts.size, 1);
  artifacts.failAfterPut = false;
  assert.equal(await worker.runOnce(), true);
  assert.equal(repository.state.status, "SUCCEEDED");
  assert.equal(repository.state.attempts, 2);
  assert.equal(artifacts.artifacts.size, 1);
});

test("visibility expiry redelivers a pre-ack crash and poison reaches local DLQ model", async () => {
  const queue = new FaultQueue({ maxReceiveCount: 2 });
  await queue.send(message);
  assert.ok(await queue.receive());
  queue.expireVisibility();
  const redelivery = await queue.receive();
  assert.equal(redelivery.receiveCount, 2);
  queue.expireVisibility();
  assert.equal(await queue.receive(), null);
  assert.equal(queue.deadLetters.length, 1);
  assert.equal(queue.deadLetters[0].body.reportJobId, jobId);
});
