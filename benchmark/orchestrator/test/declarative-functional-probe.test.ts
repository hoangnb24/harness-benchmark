import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeclarativeFunctionalProbe, type HttpClient } from '../infrastructure/DeclarativeFunctionalProbe';
import { defaultScriptedFunctionalRunners } from '../infrastructure/ScriptedFunctionalRunners';

describe('DeclarativeFunctionalProbe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs HTTP checks, captures variables, and renders headers', async () => {
    const requests: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }> = [];
    const http: HttpClient = {
      async request(input) {
        requests.push(input);
        if (input.url.endsWith('/auth/login')) {
          return { status: 200, body: JSON.stringify({ token: 'abc123' }) };
        }
        return { status: 201, body: JSON.stringify({ ok: true }) };
      },
    };
    const probe = new DeclarativeFunctionalProbe({ baseUrl: 'http://localhost:3000', http });

    const results = await probe.runDefinitions([
      {
        name: 'login',
        request: {
          method: 'POST',
          path: '/auth/login',
          body: { email: 'bench@test.com', password: 'benchmark123' },
          capture: { token: '.token' },
        },
        expect: { status: 200 },
      },
      {
        name: 'create_with_auth',
        request: {
          method: 'POST',
          path: '/bookmarks',
          headers: { Authorization: 'Bearer {{token}}' },
          body: { url: 'https://example.com', title: 'Authed Bookmark' },
        },
        expect: { status: 201 },
      },
    ]);

    expect(results.map((result) => result.pass)).toEqual([true, true]);
    expect(requests[1].headers.Authorization).toBe('Bearer abc123');
  });

  it('evaluates JSON expectations and status alternatives', async () => {
    const probe = new DeclarativeFunctionalProbe({
      baseUrl: 'http://localhost:3000',
      http: {
        async request() {
          return { status: 200, body: JSON.stringify({ data: [], page: 1 }) };
        },
      },
    });

    const [result] = await probe.runDefinitions([
      {
        name: 'data_is_array',
        request: { method: 'GET', path: '/bookmarks' },
        expect: {
          statusOneOf: [200, 201],
          json: [
            { path: '.data', type: 'array' },
            { path: '.page', exists: true, equals: 1 },
          ],
        },
      },
    ]);

    expect(result).toMatchObject({ name: 'data_is_array', pass: true, expected: '200|201', actual: 200 });
  });

  it('renders captured variables in paths and request bodies', async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const probe = new DeclarativeFunctionalProbe({
      baseUrl: 'http://localhost:3000',
      http: {
        async request(input) {
          requests.push(input);
          if (input.url.endsWith('/tags')) {
            return { status: 201, body: JSON.stringify({ id: 9 }) };
          }
          return { status: 200, body: JSON.stringify({ id: 9 }) };
        },
      },
    });

    const results = await probe.runDefinitions([
      {
        name: 'create_tag',
        request: { method: 'POST', path: '/tags', capture: { tagId: '.id' } },
        expect: { status: 201 },
      },
      {
        name: 'update_tag',
        request: { method: 'PUT', path: '/tags/{{tagId}}', body: { parent: '{{tagId}}' } },
        expect: { status: 200 },
      },
    ]);

    expect(results.map((result) => result.pass)).toEqual([true, true]);
    expect(requests[1]).toMatchObject({
      url: 'http://localhost:3000/tags/9',
      body: { parent: '9' },
    });
  });

  it('fails missing scripted checks explicitly', async () => {
    const probe = new DeclarativeFunctionalProbe({
      baseUrl: 'http://localhost:3000',
      http: {
        async request() {
          throw new Error('not used');
        },
      },
    });

    const [result] = await probe.runDefinitions([
      { name: 'user_isolation', kind: 'scripted', script: 'auth_user_isolation' },
    ]);

    expect(result).toMatchObject({
      name: 'user_isolation',
      pass: false,
      actual: 'missing_script_runner',
    });
  });

  it('runs configured scripted checks', async () => {
    const responses = [
      { status: 201, body: { id: 1, email: 'a@example.com' } },
      { status: 200, body: { token: 'token-a' } },
      { status: 201, body: { id: 2, email: 'b@example.com' } },
      { status: 200, body: { token: 'token-b' } },
      { status: 201, body: { id: 10 } },
      { status: 200, body: { data: [] } },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const response = responses.shift();
        if (!response) {
          throw new Error('unexpected request');
        }
        return {
          status: response.status,
          text: async () => JSON.stringify(response.body),
        };
      }),
    );

    const probe = new DeclarativeFunctionalProbe({
      baseUrl: 'http://localhost:3000',
      http: {
        async request() {
          throw new Error('not used');
        },
      },
      scripted: defaultScriptedFunctionalRunners(),
    });

    const [result] = await probe.runDefinitions([
      { name: 'user_isolation', kind: 'scripted', script: 'auth_user_isolation' },
    ]);

    expect(result).toMatchObject({ name: 'user_isolation', pass: true });
  });
});
