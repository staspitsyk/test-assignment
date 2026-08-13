import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/config.token';
import { bootstrapOtel } from './shared/observability/otel';
import { ReadinessStateService } from './shared/health/health.controller';

async function bootstrap(): Promise<void> {
  bootstrapOtel();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  const readinessState = app.get(ReadinessStateService);

  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

  process.on('SIGTERM', () => {
    logger.log({ event: 'sigterm_received', message: 'Flipping readiness to false' });
    readinessState.setReady(false);
  });

  process.on('SIGINT', () => {
    logger.log({ event: 'sigint_received', message: 'Flipping readiness to false' });
    readinessState.setReady(false);
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
