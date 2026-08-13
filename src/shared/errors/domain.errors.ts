export abstract class DomainException extends Error {
  public abstract readonly code: string;
  public abstract readonly status: number;
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = this.constructor.name;
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UpstreamUnavailableException extends DomainException {
  public readonly code = 'upstream_unavailable';
  public readonly status = 503;

  constructor(
    message = 'The upstream legal search provider is currently unavailable',
    retryAfter?: number,
  ) {
    super(message, retryAfter);
  }
}

export class UpstreamRateLimitedException extends DomainException {
  public readonly code = 'upstream_rate_limited';
  public readonly status = 429;

  constructor(
    message = 'Rate limit exceeded for upstream search service',
    retryAfter?: number,
  ) {
    super(message, retryAfter);
  }
}

export class QueryTooBroadException extends DomainException {
  public readonly code = 'query_too_broad';
  public readonly status = 400;

  constructor(
    message = 'The query produced too many results and could not be narrowed further',
  ) {
    super(message);
  }
}

export class InvalidEntityException extends DomainException {
  public readonly code = 'invalid_entity';
  public readonly status = 422;

  constructor(
    message = 'Invalid entity structure or missing search candidates',
  ) {
    super(message);
  }
}

export class UpstreamAuthFailedException extends DomainException {
  public readonly code = 'upstream_auth_failed';
  public readonly status = 502;

  constructor(
    message = 'Authentication with upstream legal search provider failed',
  ) {
    super(message);
  }
}

