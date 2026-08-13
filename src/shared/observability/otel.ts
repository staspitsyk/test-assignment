/**
 * OpenTelemetry bootstrap.
 *
 * This file MUST be imported before any application/library code that we want
 * OTel auto-instrumentation to patch (undici, ioredis, pino, express, http).
 * In practice: `main.ts` imports this as a side-effect module BEFORE it imports
 * `AppModule` — which is when undici/ioredis are transitively required.
 *
 * If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, this is a no-op — no SDK boot, no
 * exporter, no perf overhead. Useful for local dev and unit tests.
 */
let sdkStarted = false;

export function bootstrapOtel(): void {
  if (sdkStarted) return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  // Lazy-require so this file has zero cost when OTel is disabled.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

  const traceUrl = endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint.replace(/\/$/, '')}/v1/traces`;

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'legal-results-service',
    traceExporter: new OTLPTraceExporter({ url: traceUrl }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // File-system and DNS spans are noisy for a request-driven service; disable by default.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
  sdkStarted = true;

  const shutdown = (): void => {
    sdk
      .shutdown()
      // eslint-disable-next-line no-console
      .catch((err: Error) => console.error('OTel SDK shutdown error:', err.message));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

// Bootstrap side-effect. Importing this module IS the trigger.
bootstrapOtel();
