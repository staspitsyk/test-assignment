import { z } from 'zod';
import { envSchema } from './config.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');
export type AppConfig = z.infer<typeof envSchema>;
