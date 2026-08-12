function createOutboxPublisher({
  repository,
  queue,
  clock = () => new Date(),
}) {
  return {
    async runOnce(limit = 10) {
      const events = await repository.pendingOutbox(limit);
      for (const event of events) {
        await queue.send({
          reportJobId: event.jobId,
          correlationId: event.correlationId,
          ...(event.traceparent ? { traceparent: event.traceparent } : {}),
        });
        await repository.markOutboxPublished(
          event.eventId,
          clock().toISOString(),
        );
      }
      return events.length;
    },
  };
}

module.exports = { createOutboxPublisher };
