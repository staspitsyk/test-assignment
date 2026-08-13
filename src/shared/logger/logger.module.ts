import { Global, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ClsModule, ClsService } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from 'src/config/config.token';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Record<string, any>): string => {
          const headers = req.headers || {};
          return (
            (headers['x-request-id'] as string) ||
            (headers['x-correlation-id'] as string) ||
            randomUUID()
          );
        },
      },
    }),
    PinoLoggerModule.forRootAsync({
      inject: [APP_CONFIG, ClsService],
      useFactory: (config: AppConfig, cls: ClsService) => {
        return {
          pinoHttp: {
            level: config.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
                'password',
                'login_token',
                'token',
                'secret',
                '*.password',
                '*.login_token',
              ],
              censor: '[REDACTED]',
            },
            customProps: () => {
              const requestId = cls.getId();
              return { requestId };
            },
            genReqId: (req: Record<string, any>) => {
              return (
                (req.headers['x-request-id'] as string) ||
                (req.headers['x-correlation-id'] as string) ||
                randomUUID()
              );
            },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerSharedModule {}
