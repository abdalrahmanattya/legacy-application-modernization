const service = require("./baseline/service");
const { createTelemetry } = require("./observability/telemetry");

function createReportWorker({
  repository,
  queue,
  artifactStore,
  clock = () => new Date(),
  visibilityTimeoutSeconds = 300,
  heartbeatSeconds = 120,
  logger = () => {},
  telemetry = createTelemetry(),
}) {
  return {
    async runOnce() {
      const message = queue ? await queue.receive() : null;
      if (queue && !message) return false;
      const job = await repository.claimReportJob(
        message?.body.reportJobId,
        visibilityTimeoutSeconds,
      );
      if (!job) {
        await message?.ack();
        return false;
      }
      const context = message?.body || {};
      const reportSpan = telemetry.startReport({
        traceparent: context.traceparent,
      });
      logger({
        event: "report.started",
        reportJobId: job.jobId,
        correlationId: context.correlationId,
        ...(context.traceparent
          ? { traceId: context.traceparent.split("-")[1] }
          : {}),
      });
      let heartbeatError = null;
      const heartbeat = async () => {
        await Promise.all([
          message?.extend(visibilityTimeoutSeconds),
          repository.extendReportJobLease(job.jobId, visibilityTimeoutSeconds),
        ]);
      };
      const heartbeatTimer = setInterval(() => {
        heartbeat().catch((error) => {
          heartbeatError = error;
        });
      }, heartbeatSeconds * 1000);
      heartbeatTimer.unref();
      try {
        await heartbeat();
        const items = await repository.report({ ...job.filters, limit: 1000 });
        const report = {
          generatedAt: clock().toISOString(),
          count: items.length,
          items,
        };
        const artifact =
          job.format === "csv"
            ? { contentType: "text/csv", body: service.csvReport(report) }
            : { contentType: "application/json", body: JSON.stringify(report) };
        const result = artifactStore
          ? await artifactStore.put({
              jobId: job.jobId,
              correlationId: context.correlationId,
              traceparent: context.traceparent,
              ...artifact,
            })
          : artifact;
        if (heartbeatError) throw heartbeatError;
        await repository.completeReportJob(
          job.jobId,
          result,
          clock().toISOString(),
        );
        await message?.ack();
        logger({
          event: "report.completed",
          reportJobId: job.jobId,
          correlationId: context.correlationId,
        });
        telemetry.endReport(reportSpan, "success");
        return true;
      } catch (error) {
        await repository.releaseReportJob(job.jobId, clock().toISOString());
        await message?.nack();
        logger({
          event: "report.failed",
          reportJobId: job.jobId,
          correlationId: context.correlationId,
          errorCode: "dependency_error",
        });
        telemetry.endReport(reportSpan, "failure");
        throw error;
      } finally {
        clearInterval(heartbeatTimer);
      }
    },
  };
}

module.exports = { createReportWorker };
