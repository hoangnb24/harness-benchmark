import type { ScriptedCheckRunner } from './DeclarativeFunctionalProbe';

export function defaultScriptedFunctionalRunners(): Record<string, ScriptedCheckRunner> {
  return {
    auth_user_isolation,
    folder_sharing_permissions_flow,
  };
}

const auth_user_isolation: ScriptedCheckRunner = async (definition, context) => {
  const suffix = uniqueSuffix();
  const first = await registerAndLogin(context.baseUrl, `isolation-a-${suffix}@bench.test`);
  if (!first.ok) {
    return fail(definition.name, first.actual);
  }
  const second = await registerAndLogin(context.baseUrl, `isolation-b-${suffix}@bench.test`);
  if (!second.ok) {
    return fail(definition.name, second.actual);
  }

  const title = `Isolation Bookmark ${suffix}`;
  const created = await requestJson(context.baseUrl, '/bookmarks', {
    method: 'POST',
    token: first.token,
    body: { url: `https://isolation-${suffix}.example.com`, title },
  });
  if (created.status !== 201) {
    return fail(definition.name, `create_owner_bookmark:${created.status}`);
  }

  const listed = await requestJson(context.baseUrl, '/bookmarks', {
    method: 'GET',
    token: second.token,
  });
  if (listed.status !== 200) {
    return fail(definition.name, `list_second_user:${listed.status}`);
  }

  return {
    name: definition.name,
    pass: !JSON.stringify(listed.body).includes(title),
    expected: 'second user cannot see first user bookmark',
    actual: JSON.stringify(listed.body).includes(title) ? 'bookmark leaked' : 'isolated',
  };
};

const folder_sharing_permissions_flow: ScriptedCheckRunner = async (definition, context) => {
  const suffix = uniqueSuffix();
  const owner = await registerAndLogin(context.baseUrl, `share-owner-${suffix}@bench.test`);
  if (!owner.ok) {
    return fail(definition.name, owner.actual);
  }
  const reader = await registerAndLogin(context.baseUrl, `share-reader-${suffix}@bench.test`);
  if (!reader.ok) {
    return fail(definition.name, reader.actual);
  }
  const outsider = await registerAndLogin(context.baseUrl, `share-outsider-${suffix}@bench.test`);
  if (!outsider.ok) {
    return fail(definition.name, outsider.actual);
  }

  const folder = await requestJson(context.baseUrl, '/folders', {
    method: 'POST',
    token: owner.token,
    body: { name: `Shared ${suffix}` },
  });
  if (folder.status !== 201 || !hasNumberId(folder.body)) {
    return fail(definition.name, `create_folder:${folder.status}`);
  }

  const bookmark = await requestJson(context.baseUrl, '/bookmarks', {
    method: 'POST',
    token: owner.token,
    body: {
      url: `https://shared-${suffix}.example.com`,
      title: `Shared ${suffix}`,
      folder_id: folder.body.id,
    },
  });
  if (bookmark.status !== 201) {
    return fail(definition.name, `create_folder_bookmark:${bookmark.status}`);
  }

  const outsiderShare = await requestJson(context.baseUrl, `/folders/${folder.body.id}/share`, {
    method: 'POST',
    token: outsider.token,
    body: { email: reader.email },
  });
  if (![403, 404].includes(outsiderShare.status)) {
    return fail(definition.name, `outsider_share_denied:${outsiderShare.status}`);
  }

  const share = await requestJson(context.baseUrl, `/folders/${folder.body.id}/share`, {
    method: 'POST',
    token: owner.token,
    body: { email: reader.email },
  });
  if (share.status !== 201) {
    return fail(definition.name, `owner_share:${share.status}`);
  }

  const sharedList = await requestJson(context.baseUrl, '/shared/folders', {
    method: 'GET',
    token: reader.token,
  });
  if (sharedList.status !== 200 || !Array.isArray(sharedList.body)) {
    return fail(definition.name, `shared_list:${sharedList.status}`);
  }

  const sharedRead = await requestJson(context.baseUrl, `/folders/${folder.body.id}`, {
    method: 'GET',
    token: reader.token,
  });
  if (sharedRead.status !== 200) {
    return fail(definition.name, `shared_read:${sharedRead.status}`);
  }

  const sharedWrite = await requestJson(context.baseUrl, '/bookmarks', {
    method: 'POST',
    token: reader.token,
    body: {
      url: `https://shared-write-${suffix}.example.com`,
      title: `Shared Write ${suffix}`,
      folder_id: folder.body.id,
    },
  });
  if (sharedWrite.status !== 403) {
    return fail(definition.name, `shared_write_denied:${sharedWrite.status}`);
  }

  const outsiderRead = await requestJson(context.baseUrl, `/folders/${folder.body.id}`, {
    method: 'GET',
    token: outsider.token,
  });
  if (![403, 404].includes(outsiderRead.status)) {
    return fail(definition.name, `outsider_read_denied:${outsiderRead.status}`);
  }

  const revoke = await requestJson(context.baseUrl, `/folders/${folder.body.id}/share/${reader.id}`, {
    method: 'DELETE',
    token: owner.token,
  });
  if (revoke.status !== 204) {
    return fail(definition.name, `revoke:${revoke.status}`);
  }

  const revokedRead = await requestJson(context.baseUrl, `/folders/${folder.body.id}`, {
    method: 'GET',
    token: reader.token,
  });
  if (![403, 404].includes(revokedRead.status)) {
    return fail(definition.name, `revoked_read_denied:${revokedRead.status}`);
  }

  return { name: definition.name, pass: true, expected: 'folder sharing flow', actual: 'passed' };
};

async function registerAndLogin(
  baseUrl: string,
  email: string,
): Promise<{ ok: true; id: number; email: string; token: string } | { ok: false; actual: string }> {
  const password = 'benchmark123';
  const registered = await requestJson(baseUrl, '/auth/register', {
    method: 'POST',
    body: { email, password },
  });
  if (registered.status !== 201 || !hasNumberId(registered.body)) {
    return { ok: false, actual: `register:${registered.status}` };
  }

  const login = await requestJson(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (login.status !== 200 || !hasToken(login.body)) {
    return { ok: false, actual: `login:${login.status}` };
  }

  return { ok: true, id: registered.body.id, email, token: login.body.token };
}

async function requestJson(
  baseUrl: string,
  path: string,
  input: { method: string; token?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.token) {
    headers.Authorization = `Bearer ${input.token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: input.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });

  const text = await response.text();
  return { status: response.status, body: parseJson(text) };
}

function parseJson(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function hasNumberId(value: unknown): value is { id: number } {
  return Boolean(value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number');
}

function hasToken(value: unknown): value is { token: string } {
  return Boolean(
    value && typeof value === 'object' && typeof (value as { token?: unknown }).token === 'string',
  );
}

function fail(name: string, actual: string) {
  return { name, pass: false, expected: 'scripted flow passes', actual };
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
