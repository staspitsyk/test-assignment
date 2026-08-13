import { Module } from '@nestjs/common';
import { DocketAlarmModule } from '../docket-alarm/docket-alarm.module';
import { MetricsModule } from '../shared/observability/metrics.module';
import { QueryPlanner } from './query-planner/query-planner';
import { FanoutService } from './alias-fanout/fanout.service';
import { ResultCacheService } from './cache/result-cache.service';
import { LegalResultsService } from './legal-results.service';
import { LegalResultsController } from './legal-results.controller';

@Module({
  imports: [DocketAlarmModule, MetricsModule],
  controllers: [LegalResultsController],
  providers: [
    QueryPlanner,
    FanoutService,
    ResultCacheService,
    LegalResultsService,
  ],
  exports: [
    QueryPlanner,
    FanoutService,
    ResultCacheService,
    LegalResultsService,
  ],
})
export class LegalResultsModule {}
