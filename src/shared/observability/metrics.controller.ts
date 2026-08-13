import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  public async getMetrics(@Res() res: Response): Promise<void> {
    const contentType = this.metricsService.getContentType();
    const metrics = await this.metricsService.getMetrics();

    res.set('Content-Type', contentType);
    res.send(metrics);
  }
}
