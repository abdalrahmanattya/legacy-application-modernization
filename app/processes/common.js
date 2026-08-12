const delay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

function logger(processName, event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "order-reference-service",
      process: processName,
      event,
      ...fields,
    })}\n`,
  );
}

function installShutdown(processName, stop, timeoutSeconds = 25) {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    logger(processName, "process.draining");
    const timer = setTimeout(() => process.exit(1), timeoutSeconds * 1000);
    timer.unref();
    Promise.resolve(stop())
      .then(() => {
        clearTimeout(timer);
        process.exit(0);
      })
      .catch(() => process.exit(1));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return () => stopping;
}

module.exports = { delay, logger, installShutdown };
