import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { DomainException } from './domain.errors';

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryAfter?: number;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly cls?: ClsService) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId =
      this.cls?.getId() ||
      (request.headers['x-request-id'] as string) ||
      (request.headers['x-correlation-id'] as string) ||
      'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal';
    let message = 'An internal server error occurred';
    let retryAfter: number | undefined;

    if (exception instanceof DomainException) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      retryAfter = exception.retryAfter;

      this.logger.warn({
        event: 'domain_exception_handled',
        code,
        status,
        message,
        requestId,
        retryAfter,
      });
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      code =
        status === HttpStatus.UNPROCESSABLE_ENTITY
          ? 'invalid_entity'
          : status === HttpStatus.BAD_REQUEST
            ? 'bad_request'
            : status === HttpStatus.NOT_FOUND
              ? 'not_found'
              : 'http_error';

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        if (Array.isArray(resObj.message)) {
          message = resObj.message.join('; ');
        } else if (typeof resObj.message === 'string') {
          message = resObj.message;
        } else {
          message = exception.message;
        }
      } else {
        message = exception.message;
      }

      this.logger.warn({
        event: 'http_exception_handled',
        status,
        code,
        message,
        requestId,
      });
    } else {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        {
          event: 'unhandled_exception',
          requestId,
          error: err.message,
        },
        err.stack,
      );
    }

    if (retryAfter && retryAfter > 0) {
      response.setHeader('Retry-After', String(retryAfter));
    }

    const payload: ErrorResponseBody = {
      error: {
        code,
        message,
        requestId,
        ...(retryAfter !== undefined ? { retryAfter } : {}),
      },
    };

    response.status(status).json(payload);
  }
}
