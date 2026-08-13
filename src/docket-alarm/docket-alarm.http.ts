import { Injectable, Logger, OnModuleDestroy, Provider } from '@nestjs/common';
import { Agent, Dispatcher } from 'undici';

export const UNDICI_DISPATCHER = Symbol('UNDICI_DISPATCHER');

/**
 * Owns the single undici Agent used for every DA HTTP call. Configured for
 * high-throughput outbound: keep-alive, connection pool, aggressive timeouts,
 * body-size cap so a runaway upstream response cannot OOM us.
 *
 * On module destroy (graceful shutdown) the Agent is closed so keep-alive
 * sockets don't linger past the drain window.
 */
@Injectable()
export class DocketAlarmDispatcher implements OnModuleDestroy {
  private readonly logger = new Logger(DocketAlarmDispatcher.name);
  public readonly agent: Agent;

  constructor() {
    this.agent = new Agent({
      connections: 100,
      keepAliveTimeout: 10_000,
      headersTimeout: 5_000,
      bodyTimeout: 15_000,
      maxResponseSize: 8_000_000,
    });
  }

  public async onModuleDestroy(): Promise<void> {
    this.logger.log({ event: 'undici_agent_closing' });
    try {
      await this.agent.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn({ event: 'undici_agent_close_failed', error: msg });
    }
  }
}

export const undiciDispatcherProvider: Provider = {
  provide: UNDICI_DISPATCHER,
  useFactory: (holder: DocketAlarmDispatcher): Dispatcher => holder.agent,
  inject: [DocketAlarmDispatcher],
};
