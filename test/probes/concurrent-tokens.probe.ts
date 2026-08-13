import { fetch } from 'undici';

export interface ProbeResult {
  probe: string;
  success: boolean;
  skipped?: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

export async function runConcurrentTokensProbe(): Promise<ProbeResult> {
  const username = process.env.DA_USERNAME;
  const password = process.env.DA_PASSWORD;
  const baseUrl = process.env.DA_BASE_URL || 'https://www.docketalarm.com/api/v1.1';

  if (!username || !password) {
    return {
      probe: 'concurrent_tokens',
      success: true,
      skipped: true,
      message: 'DA_USERNAME or DA_PASSWORD not provided in environment; skipping real API call.',
    };
  }

  try {
    const loginUrl = `${baseUrl}/login/`;
    
    // Login 1
    const body1 = new URLSearchParams({ username, password });
    const res1 = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body1.toString(),
    });
    const data1 = (await res1.json()) as { success?: boolean; login_token?: string; error?: string };

    if (!data1.success || !data1.login_token) {
      return {
        probe: 'concurrent_tokens',
        success: false,
        message: `Login 1 failed: ${data1.error || 'Unknown error'}`,
      };
    }

    const token1 = data1.login_token;

    // Login 2
    const body2 = new URLSearchParams({ username, password });
    const res2 = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body2.toString(),
    });
    const data2 = (await res2.json()) as { success?: boolean; login_token?: string; error?: string };

    if (!data2.success || !data2.login_token) {
      return {
        probe: 'concurrent_tokens',
        success: false,
        message: `Login 2 failed: ${data2.error || 'Unknown error'}`,
      };
    }

    const token2 = data2.login_token;

    // Test token 1 validity after token 2 generated
    const searchUrl = `${baseUrl}/search/?q=party:(name:%22Smith%22)&limit=1`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    
    const searchData = (await searchRes.json()) as { success?: boolean; error?: string };
    const token1Active = searchRes.status === 200 && searchData.success !== false;

    return {
      probe: 'concurrent_tokens',
      success: true,
      data: {
        token1: `${token1.substring(0, 8)}...`,
        token2: `${token2.substring(0, 8)}...`,
        token1ActiveAfterToken2Issued: token1Active,
        searchStatusWithToken1: searchRes.status,
        searchResponseBody: searchData,
      },
    };
  } catch (err) {
    return {
      probe: 'concurrent_tokens',
      success: false,
      message: `Exception during concurrent tokens probe: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
