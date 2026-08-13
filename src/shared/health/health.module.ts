import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController, ReadinessStateService } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [ReadinessStateService],
  exports: [ReadinessStateService],
})
export class HealthModule {}
