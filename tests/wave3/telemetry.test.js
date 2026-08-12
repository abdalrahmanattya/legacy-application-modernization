const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} = require("@opentelemetry/sdk-trace-base");
const {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} = require("@opentelemetry/sdk-metrics");
const { createTelemetry } = require("../../app/observability/telemetry");

test("telemetry preserves remote trace context and bounded metric dimensions", async () => {
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  const metricExporter = new InMemoryMetricExporter();
  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });
  const meterProvider = new MeterProvider({ readers: [reader] });
  const telemetry = createTelemetry({
    tracer: tracerProvider.getTracer("wave3-test"),
    meter: meterProvider.getMeter("wave3-test"),
  });
  const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
  const span = telemetry.startHttp({
    method: "GET",
    route: "GET /v1/orders/{orderId}",
    traceparent,
  });
  telemetry.endHttp(span, {
    method: "GET",
    route: "GET /v1/orders/{orderId}",
    status: 200,
    durationMs: 12,
    outcome: "success",
  });
  const report = telemetry.startReport({ traceparent });
  telemetry.endReport(report, "success");
  await tracerProvider.forceFlush();
  await meterProvider.forceFlush();
  const spans = spanExporter.getFinishedSpans();
  assert.equal(spans.length, 2);
  assert.equal(spans[0].spanContext().traceId, traceparent.split("-")[1]);
  assert.equal(spans[1].spanContext().traceId, traceparent.split("-")[1]);
  const serializedMetrics = JSON.stringify(metricExporter.getMetrics());
  assert.match(serializedMetrics, /http\.server\.request\.count/);
  assert.match(serializedMetrics, /report\.worker\.job\.count/);
  assert.doesNotMatch(
    serializedMetrics,
    /0123456789abcdef0123456789abcdef|correlationId|customerReference|550e8400/,
  );
  await meterProvider.shutdown();
  await tracerProvider.shutdown();
});
