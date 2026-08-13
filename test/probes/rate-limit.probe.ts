import { fetch } from 'undici';
import { ProbeResult } from './concurrent-tokens.probe';

export async function runRateLimitProbe(): Promise<ProbeResult> {
  const username = process.env.DA_USERNAME;
  const password = process.env.DA_PASSWORD;
  const baseUrl = process.env.DA_BASE_URL || 'https://www.docketalarm.com/api/v1.1';

  if (!username || !password) {
    return {
      probe: 'rate_limit',
      success: true,
      skipped: true,
      message: 'DA_USERNAME or DA_PASSWORD not provided in environment; skipping real API call.',
    };
  }

  try {
    // Authenticate
    const loginRes = await fetch(`${baseUrl}/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }).toString(),
    });
    const loginData = (await loginRes.json()) as { success?: boolean; login_token?: string };

    if (!loginData.success || !loginData.login_token) {
      return {
        probe: 'rate_limit',
        success: false,
        message: 'Authentication failed for rate limit probe.',
      };
    }

    const token = loginData.login_token;

    // Burst 10 requests in rapid succession
    const burstCount = 10;
    const searchUrl = `${baseUrl}/search/?q=party:(name:%22Test%22)&limit=1`;
    const promises = Array.from({ length: burstCount }, (_, i) =>
      fetch(searchUrl, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (res) => {
        const retryAfter = res.headers.get('retry-after');
        const ratelimitLimit = res.headers.get('x-ratelimit-limit');
        const ratelimitRemaining = res.headers.get('x-ratelimit-remaining');
        return {
          requestIndex: i,
          status: res.status,
          retryAfter,
          ratelimitLimit,
          ratelimitRemaining,
        };
      }),
    );

    const results = await Promise.all(promises);
    const has429 = results.some((r) => r.status === 429);

    return {
      probe: 'rate_limit',
      success: true,
      data: {
        burstCount,
        has429Triggered: has429,
        sampleResponses: results,
      },
    };
  } catch (err) {
    return {
      probe: 'rate_limit',
      success: false,
      message: `Exception during rate limit probe: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
