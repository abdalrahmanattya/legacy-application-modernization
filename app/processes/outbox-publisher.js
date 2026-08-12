const { createOutboxPublisher } = require("../outbox-publisher");
const { readRuntimeConfig } = require("../runtime/config");
const { createRepository, createQueue } = require("../runtime/factory");
const { delay, logger, installShutdown } = require("./common");

async function runPublisher({ repository, queue, shouldStop, idleMs = 1000 }) {
  const publisher = createOutboxPublisher({ repository, queue });
  while (!shouldStop()) {
    try {
      const count = await publisher.runOnce();
      if (count) logger("outbox-publisher", "outbox.published", { count });
      else await delay(idleMs);
    } catch {
      logger("outbox-publisher", "outbox.publish_failed", {
        errorCode: "dependency_error",
      });
      await delay(idleMs);
    }
  }
}

async function main() {
  const config = readRuntimeConfig("publisher");
  const repository = createRepository(config);
  const queue = createQueue(config);
  await repository.initialize();
  let stopRequested = false;
  let running;
  const stopping = installShutdown("outbox-publisher", async () => {
    stopRequested = true;
    await running;
    queue.destroy();
    await repository.close();
  });
  running = runPublisher({
    repository,
    queue,
    shouldStop: () => stopRequested || stopping(),
  });
  logger("outbox-publisher", "process.started");
  await running;
}

if (require.main === module)
  main().catch(() => {
    logger("outbox-publisher", "process.start_failed", {
      errorCode: "configuration_error",
    });
    process.exitCode = 1;
  });

module.exports = { main, runPublisher };
