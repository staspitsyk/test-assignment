import { Provider } from '@nestjs/common';
import { Agent, Dispatcher } from 'undici';

export const UNDICI_DISPATCHER = Symbol('UNDICI_DISPATCHER');

export const undiciDispatcherProvider: Provider = {
  provide: UNDICI_DISPATCHER,
  useFactory: (): Dispatcher => {
    return new Agent({
      connections: 100,
      keepAliveTimeout: 10_000,
      headersTimeout: 5_000,
      bodyTimeout: 15_000,
      maxResponseSize: 8_000_000,
    });
  },
};
