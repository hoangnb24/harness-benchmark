import type { HttpClient } from './DeclarativeFunctionalProbe';

export class FetchHttpClient implements HttpClient {
  async request(input: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }): Promise<{ status: number; body: string }> {
    const response = await fetch(input.url, {
      method: input.method,
      headers: {
        'Content-Type': 'application/json',
        ...input.headers,
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });

    return {
      status: response.status,
      body: await response.text(),
    };
  }
}
