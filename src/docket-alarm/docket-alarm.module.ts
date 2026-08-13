import { Module } from '@nestjs/common';
import { AppConfigModule } from 'src/config/config.module';
import { RedisModule } from 'src/shared/redis/redis.module';
import { DocketAlarmDispatcher, undiciDispatcherProvider } from './docket-alarm.http';
import { TokenService } from './docket-alarm.token.service';
import { DocketAlarmLimiter } from './docket-alarm.limiter';
import { DocketAlarmPolicy } from './docket-alarm.policy';
import { DocketAlarmClient } from './docket-alarm.client';

@Module({
  imports: [AppConfigModule, RedisModule],
  providers: [
    DocketAlarmDispatcher,
    undiciDispatcherProvider,
    TokenService,
    DocketAlarmLimiter,
    DocketAlarmPolicy,
    DocketAlarmClient,
  ],
  exports: [DocketAlarmClient],
})
export class DocketAlarmModule {}
