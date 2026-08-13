import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from 'src/shared/errors/all-exceptions.filter';
import {
  UpstreamUnavailableException,
  UpstreamRateLimitedException,
  InvalidEntityException,
  QueryTooBroadException,
} from 'src/shared/errors/domain.errors';

describe('AllExceptionsFilter Unit Tests', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: {
    status: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
  };
  let mockRequest: {
    headers: Record<string, string>;
  };
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };
    mockRequest = {
      headers: {
        'x-request-id': 'test-req-id-123',
      },
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;
  });

  it('should map UpstreamUnavailableException to 503 response', () => {
    const error = new UpstreamUnavailableException();
    filter.catch(error, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(503);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        code: 'upstream_unavailable',
        message: 'The upstream legal search provider is currently unavailable',
        requestId: 'test-req-id-123',
      },
    });
  });

  it('should map UpstreamRateLimitedException with retryAfter header and body', () => {
    const error = new UpstreamRateLimitedException('Rate limited', 30);
    filter.catch(error, mockHost);

    expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    expect(mockResponse.status).toHaveBeenCalledWith(429);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        code: 'upstream_rate_limited',
        message: 'Rate limited',
        requestId: 'test-req-id-123',
        retryAfter: 30,
      },
    });
  });

  it('should map InvalidEntityException to 422 response', () => {
    const error = new InvalidEntityException('Missing name candidate');
    filter.catch(error, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(422);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        code: 'invalid_entity',
        message: 'Missing name candidate',
        requestId: 'test-req-id-123',
      },
    });
  });

  it('should map QueryTooBroadException to 400 response', () => {
    const error = new QueryTooBroadException();
    filter.catch(error, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        code: 'query_too_broad',
        message: 'The query produced too many results and could not be narrowed further',
        requestId: 'test-req-id-123',
      },
    });
  });

  it('should handle generic HttpException without leaking raw stack trace', () => {
    const error = new HttpException('Bad Request parameters', HttpStatus.BAD_REQUEST);
    filter.catch(error, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        code: 'bad_request',
        message: 'Bad Request parameters',
        requestId: 'test-req-id-123',
      },
    });
  });

  it('should map unexpected unhandled errors to safe 500 internal response', () => {
    const error = new Error('Sensitive DB failure secret_key=12345');
    filter.catch(error, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        code: 'internal',
        message: 'An internal server error occurred',
        requestId: 'test-req-id-123',
      },
    });
  });
});
