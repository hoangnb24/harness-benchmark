export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface FunctionalCheckManifest {
  version: 1;
  checks: FunctionalCheckDefinition[];
}

export type FunctionalCheckDefinition = HttpCheckDefinition | ScriptedCheckDefinition;

export interface HttpCheckDefinition {
  name: string;
  kind?: 'http';
  request: {
    method: HttpMethod;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    capture?: Record<string, string>;
  };
  expect: {
    status?: number;
    statusOneOf?: number[];
    bodyContains?: string;
    json?: JsonExpectation[];
  };
}

export interface ScriptedCheckDefinition {
  name: string;
  kind: 'scripted';
  script: string;
}

export interface JsonExpectation {
  path: string;
  exists?: boolean;
  type?: 'array' | 'object' | 'string' | 'number' | 'boolean' | 'null';
  equals?: unknown;
}

export interface FunctionalCheckResult {
  name: string;
  pass: boolean;
  expected?: number | string;
  actual?: number | string;
  skipped?: boolean;
}
