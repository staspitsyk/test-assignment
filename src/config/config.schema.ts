import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z
    .string()
    .refine((v) => /^rediss?:\/\//.test(v), {
      message: 'REDIS_URL must be a redis:// or rediss:// URL',
    })
    .default('redis://localhost:6379'),
  DA_BASE_URL: z.string().url().default('https://www.docketalarm.com/api/v1.1'),
  DA_USERNAME: z.string().min(1, 'DA_USERNAME is required'),
  DA_PASSWORD: z.string().min(1, 'DA_PASSWORD is required'),
  DA_TEST_MODE: z.coerce.boolean().default(false),
  CACHE_TTL_SECONDS: z.coerce.number().default(1800),
  CACHE_STALE_SECONDS: z.coerce.number().default(300),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  ALIAS_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
}).refine((cfg) => cfg.CACHE_STALE_SECONDS <= cfg.CACHE_TTL_SECONDS, {
  message: 'CACHE_STALE_SECONDS must be <= CACHE_TTL_SECONDS',
  path: ['CACHE_STALE_SECONDS'],
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(
      `[ConfigModule] Invalid environment variables:\n${JSON.stringify(formatted, null, 2)}`,
    );
  }
  return result.data;
}
