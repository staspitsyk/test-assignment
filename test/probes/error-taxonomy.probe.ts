import { fetch } from 'undici';
import { ProbeResult } from './concurrent-tokens.probe';

export async function runErrorTaxonomyProbe(): Promise<ProbeResult> {
  const baseUrl = process.env.DA_BASE_URL || 'https://www.docketalarm.com/api/v1.1';

  try {
    const errorScenarios: Array<{ name: string; action: () => Promise<unknown> }> = [
      {
        name: 'invalid_credentials',
        action: async () => {
          const res = await fetch(`${baseUrl}/login/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              username: 'invalid_user_probe',
              password: 'invalid_password_probe',
            }).toString(),
          });
          const body = await res.json();
          return { status: res.status, body };
        },
      },
      {
        name: 'invalid_token',
        action: async () => {
          const res = await fetch(`${baseUrl}/search/?q=party:(name:%22Test%22)&limit=1`, {
            headers: { Authorization: 'Bearer INVALID_TOKEN_PROBE_12345' },
          });
          const body = await res.json();
          return { status: res.status, body };
        },
      },
      {
        name: 'malformed_query_syntax',
        action: async () => {
          const res = await fetch(`${baseUrl}/search/?q=party:((((invalid_syntax&limit=1`, {
            headers: { Authorization: 'Bearer INVALID_TOKEN_PROBE_12345' },
          });
          const body = await res.json();
          return { status: res.status, body };
        },
      },
    ];

    const capturedTaxonomy: Record<string, unknown> = {};

    for (const scenario of errorScenarios) {
      try {
        const result = await scenario.action();
        capturedTaxonomy[scenario.name] = result;
      } catch (err) {
        capturedTaxonomy[scenario.name] = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return {
      probe: 'error_taxonomy',
      success: true,
      data: capturedTaxonomy,
    };
  } catch (err) {
    return {
      probe: 'error_taxonomy',
      success: false,
      message: `Exception during error taxonomy probe: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
