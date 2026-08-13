import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { envSchema, EnvConfig, validateEnv } from './config.schema';
import { APP_CONFIG } from './config.token';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (configService: ConfigService): EnvConfig => {
        const raw = {
          NODE_ENV: configService.get('NODE_ENV'),
          PORT: configService.get('PORT'),
          REDIS_URL: configService.get('REDIS_URL'),
          DA_BASE_URL: configService.get('DA_BASE_URL'),
          DA_USERNAME: configService.get('DA_USERNAME'),
          DA_PASSWORD: configService.get('DA_PASSWORD'),
          DA_TEST_MODE: configService.get('DA_TEST_MODE'),
          CACHE_TTL_SECONDS: configService.get('CACHE_TTL_SECONDS'),
          CACHE_STALE_SECONDS: configService.get('CACHE_STALE_SECONDS'),
          LOG_LEVEL: configService.get('LOG_LEVEL'),
          OTEL_EXPORTER_OTLP_ENDPOINT: configService.get('OTEL_EXPORTER_OTLP_ENDPOINT'),
          ALIAS_CONFIDENCE_THRESHOLD: configService.get('ALIAS_CONFIDENCE_THRESHOLD'),
        };
        return envSchema.parse(raw);
      },
      inject: [ConfigService],
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
