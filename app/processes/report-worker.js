const { createReportWorker } = require("../report-worker");
const { readRuntimeConfig } = require("../runtime/config");
const {
  createRepository,
  createQueue,
  createArtifactStore,
} = require("../runtime/factory");
const { delay, logger, installShutdown } = require("./common");

async function runWorker({ worker, shouldStop, retryMs = 1000 }) {
  while (!shouldStop()) {
    try {
      const processed = await worker.runOnce();
      if (processed) logger("report-worker", "report.processed");
    } catch {
      logger("report-worker", "report.processing_failed", {
        errorCode: "dependency_error",
      });
      await delay(retryMs);
    }
  }
}

async function main() {
  const config = readRuntimeConfig("worker");
  const repository = createRepository(config);
  const queue = createQueue(config);
  const artifactStore = createArtifactStore(config);
  await repository.initialize();
  const worker = createReportWorker({
    repository,
    queue,
    artifactStore,
    visibilityTimeoutSeconds: config.reportVisibilityTimeoutSeconds,
    heartbeatSeconds: config.reportHeartbeatSeconds,
    logger: ({ event, ...fields }) => logger("report-worker", event, fields),
  });
  let stopRequested = false;
  let running;
  const stopping = installShutdown("report-worker", async () => {
    stopRequested = true;
    await running;
    queue.destroy();
    artifactStore.destroy();
    await repository.close();
  });
  running = runWorker({
    worker,
    shouldStop: () => stopRequested || stopping(),
  });
  logger("report-worker", "process.started");
  await running;
}

if (require.main === module)
  main().catch(() => {
    logger("report-worker", "process.start_failed", {
      errorCode: "configuration_error",
    });
    process.exitCode = 1;
  });

module.exports = { main, runWorker };
