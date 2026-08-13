import { Module } from '@nestjs/common';
import { DocketAlarmModule } from '../docket-alarm/docket-alarm.module';
import { QueryPlanner } from './query-planner/query-planner';
import { FanoutService } from './alias-fanout/fanout.service';

@Module({
  imports: [DocketAlarmModule],
  providers: [QueryPlanner, FanoutService],
  exports: [QueryPlanner, FanoutService],
})
export class LegalResultsModule {}
