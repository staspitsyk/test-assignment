import { runConcurrentTokensProbe } from './concurrent-tokens.probe';
import { runRateLimitProbe } from './rate-limit.probe';
import { runErrorTaxonomyProbe } from './error-taxonomy.probe';

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('--- Starting DocketAlarm Empirical Probe Suite ---\n');

  const concurrentTokensResult = await runConcurrentTokensProbe();
  const rateLimitResult = await runRateLimitProbe();
  const errorTaxonomyResult = await runErrorTaxonomyProbe();

  const fullReport = {
    timestamp: new Date().toISOString(),
    probes: [concurrentTokensResult, rateLimitResult, errorTaxonomyResult],
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(fullReport, null, 2));
  // eslint-disable-next-line no-console
  console.log('\n--- Probe Suite Completed ---');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Probe suite execution failed:', err);
  process.exit(1);
});
