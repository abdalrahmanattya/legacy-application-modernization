const {
  context,
  metrics,
  trace,
  SpanStatusCode,
} = require("@opentelemetry/api");

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

function parentContext(traceparent) {
  const match = String(traceparent || "").match(TRACEPARENT);
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2]))
    return context.active();
  return trace.setSpanContext(context.active(), {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
    traceFlags: Number.parseInt(match[3], 16) & 1,
    isRemote: true,
  });
}

function createTelemetry({
  tracer = trace.getTracer("order-reference-service", "0.1.0"),
  meter = metrics.getMeter("order-reference-service", "0.1.0"),
} = {}) {
  const requests = meter.createCounter("http.server.request.count", {
    unit: "{request}",
  });
  const duration = meter.createHistogram("http.server.request.duration", {
    unit: "ms",
  });
  const jobs = meter.createCounter("report.worker.job.count", {
    unit: "{job}",
  });
  const start = (name, traceparent, attributes) =>
    tracer.startSpan(name, { attributes }, parentContext(traceparent));
  return {
    startHttp({ method, route, traceparent }) {
      return start("http.server.request", traceparent, {
        "http.request.method": method,
        "http.route": route,
      });
    },
    endHttp(span, { method, route, status, durationMs, outcome }) {
      const labels = {
        "http.request.method": method,
        "http.route": route,
        "http.response.status_code": status,
        "error.type": outcome === "success" ? "none" : outcome,
      };
      requests.add(1, labels);
      duration.record(durationMs, labels);
      span.setAttributes(labels);
      span.setStatus({
        code: status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.UNSET,
      });
      span.end();
    },
    startReport({ traceparent }) {
      return start("report.worker.process", traceparent, {
        "messaging.system": "aws_sqs",
        "messaging.operation.type": "process",
      });
    },
    endReport(span, outcome) {
      jobs.add(1, { outcome });
      span.setAttribute("report.outcome", outcome);
      span.setStatus({
        code:
          outcome === "success" ? SpanStatusCode.UNSET : SpanStatusCode.ERROR,
      });
      span.end();
    },
  };
}

module.exports = { createTelemetry, parentContext };
