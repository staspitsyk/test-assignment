// IMPORTANT: OTel bootstrap must run before any of the modules we want auto-instrumentation
// to patch (undici / ioredis / pino / http / express). Keeping this as the very first import
// ensures the NodeSDK.start() side-effect fires before those libraries are required.
import './shared/observability/otel';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/config.token';
import { ReadinessStateService } from './shared/health/health.controller';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.use(helmet());

  app.useGlobalPipes(new ZodValidationPipe());

  const readinessState = app.get(ReadinessStateService);

  app.enableShutdownHooks();

  let isShuttingDown = false;
  const handleShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.log({
      event: 'shutdown_initiated',
      signal,
      message: 'Flipping readiness state to false (HTTP 503)',
    });
    readinessState.setReady(false);

    logger.log({
      event: 'shutdown_lb_propagation_wait',
      seconds: 5,
      message: 'Waiting 5s for load balancer propagation window',
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));

    logger.log({
      event: 'shutdown_draining',
      message: 'Closing HTTP server and draining in-flight requests (max 25s)',
    });

    const closeAppPromise = app.close();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Shutdown drain timeout of 25s reached')),
        25_000,
      ),
    );

    try {
      await Promise.race([closeAppPromise, timeoutPromise]);
      logger.log({
        event: 'shutdown_clean_exit',
        message: 'Application gracefully shut down cleanly',
      });
      process.exit(0);
    } catch (err) {
      logger.error({
        event: 'shutdown_error',
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => {
    void handleShutdown('SIGTERM');
  });

  process.once('SIGINT', () => {
    void handleShutdown('SIGINT');
  });

  await app.listen(config.PORT);
  logger.log({
    event: 'application_started',
    port: config.PORT,
    environment: config.NODE_ENV,
  });
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during application bootstrap:', err);
  process.exit(1);
});
