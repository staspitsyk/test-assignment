/**
 * OpenTelemetry Bootstrap Shell Placeholder
 * Intended to be imported BEFORE NestJS bootstrap in main.ts
 * when OTLP exporter is enabled.
 */

export function bootstrapOtel(): void {
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!otelEndpoint) {
    return;
  }

  // Placeholder for OpenTelemetry NodeSDK initialization
  // e.g.
  // const sdk = new NodeSDK({ ... });
  // sdk.start();
}
