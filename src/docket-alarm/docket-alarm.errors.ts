import { Logger } from '@nestjs/common';
import {
  DomainException,
  QueryTooBroadException,
  UpstreamAuthFailedException,
  UpstreamRateLimitedException,
  UpstreamUnavailableException,
} from 'src/shared/errors/domain.errors';
import { DaSearchResponse } from './docket-alarm.types';

export function mapDocketAlarmError(
  statusCode: number,
  rawError?: string | Record<string, unknown> | DaSearchResponse,
  logger?: Logger,
  retryAfterSeconds?: number,
): DomainException {
  let daErrorString = '';

  if (typeof rawError === 'string') {
    daErrorString = rawError;
  } else if (typeof rawError === 'object' && rawError !== null) {
    const errorProp = (rawError as Record<string, unknown>).error;
    const messageProp = (rawError as Record<string, unknown>).message;
    daErrorString =
      typeof errorProp === 'string'
        ? errorProp
        : typeof messageProp === 'string'
          ? messageProp
          : JSON.stringify(rawError);
  }

  if (logger && daErrorString) {
    logger.error({
      event: 'da_upstream_error',
      error: daErrorString,
      statusCode,
    });
  }

  const lowerError = daErrorString.toLowerCase();

  if (
    lowerError.includes('too broad') ||
    lowerError.includes('too many results') ||
    lowerError.includes('narrow your search') ||
    lowerError.includes('query returns more than')
  ) {
    return new QueryTooBroadException();
  }

  if (
    statusCode === 401 ||
    lowerError.includes('invalid token') ||
    lowerError.includes('authentication failed') ||
    lowerError.includes('bad login')
  ) {
    return new UpstreamAuthFailedException();
  }

  if (statusCode === 429 || lowerError.includes('rate limit')) {
    return new UpstreamRateLimitedException(
      'Rate limit exceeded for upstream search service',
      retryAfterSeconds,
    );
  }

  if (statusCode >= 500 && statusCode <= 599) {
    return new UpstreamUnavailableException(
      'The upstream legal search provider is currently unavailable',
      retryAfterSeconds,
    );
  }

  return new UpstreamUnavailableException(
    'The upstream legal search provider is currently unavailable',
    retryAfterSeconds,
  );
}
