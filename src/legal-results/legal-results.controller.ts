import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { APP_CONFIG, AppConfig } from '../config/config.token';
import { LegalResultsRequestDto } from './dto/request.dto';
import { LegalResultsResponse } from './dto/response.dto';
import { LegalResultsService } from './legal-results.service';

@Controller('api/v1/legal_results')
export class LegalResultsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly legalResultsService: LegalResultsService,
    private readonly cls: ClsService,
  ) {}

  @Post()
  public async getLegalResults(
    @Body() body: LegalResultsRequestDto,
    @Headers('x-cache-bypass') cacheBypassHeader?: string,
    @Headers('x-request-id') requestIdHeader?: string,
  ): Promise<LegalResultsResponse> {
    const isProd = this.config.NODE_ENV === 'production';
    const bypassCache = !isProd && (cacheBypassHeader === 'true' || cacheBypassHeader === '1');

    const requestId =
      requestIdHeader ||
      this.cls.get<string>('requestId') ||
      `req-${Math.random().toString(36).substring(2, 9)}`;

    return this.legalResultsService.getLegalResults(
      body,
      bypassCache,
      requestId,
    );
  }
}
