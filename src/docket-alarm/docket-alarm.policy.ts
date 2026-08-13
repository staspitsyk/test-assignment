import { Injectable, Logger } from '@nestjs/common';
import {
  wrap,
  bulkhead,
  circuitBreaker,
  retry,
  timeout,
  handleWhen,
  ConsecutiveBreaker,
  ExponentialBackoff,
  TimeoutStrategy,
  IPolicy,
} from 'cockatiel';
import {
  UpstreamRateLimitedException,
  UpstreamUnavailableException,
} from 'src/shared/errors/domain.errors';

function isRetryableError(err: unknown): boolean {
  if (
    err instanceof UpstreamUnavailableException ||
    err instanceof UpstreamRateLimitedException
  ) {
    return true;
  }
  if (err instanceof Error) {
    const code = (err as unknown as Record<string, unknown>).code;
    if (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'UND_ERR_SOCKET' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      code === 'UND_ERR_BODY_TIMEOUT' ||
      code === 'UND_ERR_HEADERS_TIMEOUT'
    ) {
      return true;
    }
  }
  return false;
}

@Injectable()
export class DocketAlarmPolicy {
  private readonly logger = new Logger(DocketAlarmPolicy.name);
  private readonly policyPipeline: IPolicy;

  constructor() {
    const timeoutPolicy = timeout(20_000, TimeoutStrategy.Aggressive);

    const retryPolicy = retry(
      handleWhen((err) => isRetryableError(err)),
      {
        maxAttempts: 3,
        backoff: new ExponentialBackoff({
          maxDelay: 5000,
        }),
      },
    );

    const cbPolicy = circuitBreaker(
      handleWhen((err) => isRetryableError(err)),
      {
        halfOpenAfter: 10_000,
        breaker: new ConsecutiveBreaker(5),
      },
    );

    cbPolicy.onBreak(() => {
      this.logger.warn({ event: 'da_circuit_breaker_open' });
    });
    cbPolicy.onReset(() => {
      this.logger.log({ event: 'da_circuit_breaker_closed' });
    });
    cbPolicy.onHalfOpen(() => {
      this.logger.log({ event: 'da_circuit_breaker_half_open' });
    });

    const bulkheadPolicy = bulkhead(20, 100);

    // Policy pipeline wrap order: wrap(bulkhead, breaker, retry, timeout)
    this.policyPipeline = wrap(
      bulkheadPolicy,
      cbPolicy,
      retryPolicy,
      timeoutPolicy,
    );
  }

  public execute<T>(fn: (context: { signal: AbortSignal }) => Promise<T>): Promise<T> {
    return this.policyPipeline.execute(fn);
  }
}
