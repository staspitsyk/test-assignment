import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;

  public readonly upstreamDurationHistogram: Histogram<string>;
  public readonly upstreamStatusCounter: Counter<string>;
  public readonly cacheHitsCounter: Counter<string>;
  public readonly circuitStateGauge: Gauge<string>;
  public readonly tokenRefreshCounter: Counter<string>;
  public readonly dedupWinsCounter: Counter<string>;
  public readonly narrowingStepsCounter: Counter<string>;
  public readonly aliasFanoutHistogram: Histogram<string>;

  constructor() {
    this.registry = new Registry();

    this.upstreamDurationHistogram = new Histogram({
      name: 'upstream_duration_seconds',
      help: 'Upstream HTTP request latency in seconds',
      labelNames: ['endpoint', 'status'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.upstreamStatusCounter = new Counter({
      name: 'upstream_status_total',
      help: 'Upstream HTTP response status count',
      labelNames: ['endpoint', 'status'],
      registers: [this.registry],
    });

    this.cacheHitsCounter = new Counter({
      name: 'cache_hits_total',
      help: 'Cache hit status count (hit/miss/stale/bypass)',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.circuitStateGauge = new Gauge({
      name: 'circuit_state',
      help: 'Circuit breaker state (0=closed, 1=half, 2=open)',
      labelNames: ['name'],
      registers: [this.registry],
    });

    this.tokenRefreshCounter = new Counter({
      name: 'token_refresh_total',
      help: 'DA Token refresh election outcomes',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.dedupWinsCounter = new Counter({
      name: 'dedup_wins_total',
      help: 'Coalesced request count',
      labelNames: ['scope'],
      registers: [this.registry],
    });

    this.narrowingStepsCounter = new Counter({
      name: 'narrowing_steps_bucket',
      help: 'Query planner narrowing step executed count',
      labelNames: ['ladder_step'],
      registers: [this.registry],
    });

    this.aliasFanoutHistogram = new Histogram({
      name: 'alias_fanout_size',
      help: 'Number of alias candidates fan-out',
      buckets: [1, 2, 3, 5, 10],
      registers: [this.registry],
    });
  }

  public onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry });
  }

  public async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  public getContentType(): string {
    return this.registry.contentType;
  }
}
