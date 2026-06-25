import type {
  FunctionalCheckDefinition,
  FunctionalCheckResult,
  HttpCheckDefinition,
  JsonExpectation,
  ScriptedCheckDefinition,
} from '../domain/functional-check';
import type { TaskDefinition } from '../domain/task';
import type { FunctionalProbe } from '../ports/FunctionalProbe';
import { FunctionalCheckLoader } from './FunctionalCheckLoader';

export interface HttpClient {
  request(input: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }): Promise<{ status: number; body: string }>;
}

export type ScriptedCheckRunner = (
  definition: ScriptedCheckDefinition,
  context: { baseUrl: string; variables: Record<string, string> },
) => Promise<FunctionalCheckResult>;

export class DeclarativeFunctionalProbe implements FunctionalProbe {
  constructor(
    private readonly options: {
      baseUrl: string;
      http: HttpClient;
      loader?: FunctionalCheckLoader;
      scripted?: Record<string, ScriptedCheckRunner>;
    },
  ) {}

  async run(task: TaskDefinition): Promise<FunctionalCheckResult[]> {
    if (!task.functionalCheckPath) {
      return [];
    }

    const loader = this.options.loader ?? new FunctionalCheckLoader();
    const manifest = await loader.load(task.functionalCheckPath);
    return this.runDefinitions(manifest.checks);
  }

  async runDefinitions(definitions: FunctionalCheckDefinition[]): Promise<FunctionalCheckResult[]> {
    const variables: Record<string, string> = {};
    const results: FunctionalCheckResult[] = [];

    for (const definition of definitions) {
      if (definition.kind === 'scripted') {
        results.push(await this.runScripted(definition, variables));
      } else {
        results.push(await this.runHttp(definition, variables));
      }
    }

    return results;
  }

  private async runScripted(
    definition: ScriptedCheckDefinition,
    variables: Record<string, string>,
  ): Promise<FunctionalCheckResult> {
    const runner = this.options.scripted?.[definition.script];
    if (!runner) {
      return {
        name: definition.name,
        pass: false,
        expected: `script:${definition.script}`,
        actual: 'missing_script_runner',
      };
    }

    return runner(definition, { baseUrl: this.options.baseUrl, variables });
  }

  private async runHttp(
    definition: HttpCheckDefinition,
    variables: Record<string, string>,
  ): Promise<FunctionalCheckResult> {
    const url = `${this.options.baseUrl}${renderTemplate(definition.request.path, variables)}`;
    const response = await this.options.http
      .request({
        method: definition.request.method,
        url,
        headers: renderRecord(definition.request.headers ?? {}, variables),
        body: renderValue(definition.request.body, variables),
      })
      .catch((error: unknown) => undefined);

    if (!response) {
      return {
        name: definition.name,
        pass: false,
        expected: definition.expect.status ?? definition.expect.statusOneOf?.join('|') ?? 200,
        actual: `request failed: ${url}`,
      };
    }

    const expectedStatuses = definition.expect.statusOneOf ?? [definition.expect.status ?? 200];
    const statusPass = expectedStatuses.includes(response.status);
    const bodyPass =
      definition.expect.bodyContains === undefined ||
      response.body.includes(definition.expect.bodyContains);
    const jsonPass = evaluateJsonExpectations(response.body, definition.expect.json ?? []);
    const pass = statusPass && bodyPass && jsonPass.pass;

    if (pass && definition.request.capture) {
      captureVariables(response.body, definition.request.capture, variables);
    }

    return {
      name: definition.name,
      pass,
      expected:
        expectedStatuses.length === 1 ? expectedStatuses[0] : expectedStatuses.join('|'),
      actual: jsonPass.pass ? response.status : `${response.status}; ${jsonPass.reason}`,
    };
  }
}

function renderRecord(record: Record<string, string>, variables: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, renderTemplate(value, variables)]),
  );
}

function renderTemplate(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (_match, name: string) => variables[name] ?? '');
}

function renderValue(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return renderTemplate(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, variables));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderValue(item, variables)]),
    );
  }

  return value;
}

function captureVariables(
  body: string,
  capture: Record<string, string>,
  variables: Record<string, string>,
) {
  const json = parseJson(body);
  for (const [name, selector] of Object.entries(capture)) {
    const value = selectJson(json, selector);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      variables[name] = String(value);
    }
  }
}

function evaluateJsonExpectations(
  body: string,
  expectations: JsonExpectation[],
): { pass: boolean; reason?: string } {
  if (expectations.length === 0) {
    return { pass: true };
  }

  const json = parseJson(body);
  for (const expectation of expectations) {
    const value = selectJson(json, expectation.path);
    if (expectation.exists === true && value === undefined) {
      return { pass: false, reason: `${expectation.path} missing` };
    }

    if (expectation.type && jsonType(value) !== expectation.type) {
      return {
        pass: false,
        reason: `${expectation.path} type ${jsonType(value)} != ${expectation.type}`,
      };
    }

    if ('equals' in expectation && !jsonEquals(value, expectation.equals)) {
      return {
        pass: false,
        reason: `${expectation.path} value ${JSON.stringify(value)} != ${JSON.stringify(expectation.equals)}`,
      };
    }
  }

  return { pass: true };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function selectJson(value: unknown, selector: string): unknown {
  if (!selector.startsWith('.')) {
    throw new Error(`unsupported JSON selector: ${selector}`);
  }

  const keys = selector
    .slice(1)
    .split('.')
    .filter((key) => key.length > 0);
  let current = value as Record<string, unknown> | undefined;
  for (const key of keys) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[key] as Record<string, unknown> | undefined;
  }

  return current;
}

function jsonType(value: unknown): JsonExpectation['type'] | 'undefined' {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value as JsonExpectation['type'];
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
