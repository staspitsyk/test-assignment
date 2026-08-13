import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AppConfigModule } from './config/config.module';
import { RedisModule } from './shared/redis/redis.module';
import { LoggerSharedModule } from './shared/logger/logger.module';
import { HealthModule } from './shared/health/health.module';
import { MetricsModule } from './shared/observability/metrics.module';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';
import { DocketAlarmModule } from './docket-alarm/docket-alarm.module';
import { LegalResultsModule } from './legal-results/legal-results.module';

@Module({
  imports: [
    AppConfigModule,
    RedisModule,
    LoggerSharedModule,
    HealthModule,
    MetricsModule,
    DocketAlarmModule,
    LegalResultsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (cls: ClsService) => new AllExceptionsFilter(cls),
      inject: [ClsService],
    },
  ],
})
export class AppModule {}
