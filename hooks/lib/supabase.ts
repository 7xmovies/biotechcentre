import { getAuthHeaders, notifyUnauthorized } from './authToken';

type FilterClause =
  | { type: 'eq' | 'neq' | 'lte' | 'gte' | 'lt' | 'gt' | 'ilike'; column: string; value: unknown }
  | { type: 'or'; expression: string };

interface QueryResponse<T = any> {
  data: T;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

async function postJson<T = any>(url: string, body: unknown): Promise<QueryResponse<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      notifyUnauthorized();
      return { data: null as T, error: { message: 'Session expired. Please sign in again.' } };
    }

    const json = await res.json();
    if (!res.ok) {
      return {
        data: null as T,
        error: json?.error || { message: `Request failed (${res.status})` },
      };
    }
    return json as QueryResponse<T>;
  } catch (err) {
    return {
      data: null as T,
      error: { message: err instanceof Error ? err.message : 'Network error' },
    };
  }
}

class GitHubQueryBuilder<T = any> implements PromiseLike<QueryResponse<T>> {
  private table: string;
  private action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private selectClause?: string;
  private selectOptions?: { count?: 'exact'; head?: boolean };
  private filters: FilterClause[] = [];
  private orders: { column: string; ascending?: boolean }[] = [];
  private rangeClause?: { from: number; to: number };
  private limitClause?: number;
  private singleRow = false;
  private payloadData?: unknown;
  private onConflictCol?: string;

  constructor(table: string) {
    this.table = table;
  }

  select(columns = '*', options?: { count?: 'exact'; head?: boolean }) {
    this.selectClause = columns;
    if (options) {
      this.selectOptions = options;
    }
    return this;
  }

  insert(data: unknown) {
    this.action = 'insert';
    this.payloadData = data;
    return this;
  }

  update(data: unknown) {
    this.action = 'update';
    this.payloadData = data;
    return this;
  }

  upsert(data: unknown, options?: { onConflict?: string }) {
    this.action = 'upsert';
    this.payloadData = data;
    this.onConflictCol = options?.onConflict;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ type: 'neq', column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ type: 'lte', column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ type: 'gte', column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ type: 'lt', column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ type: 'gt', column, value });
    return this;
  }

  ilike(column: string, value: string) {
    this.filters.push({ type: 'ilike', column, value });
    return this;
  }

  or(expression: string) {
    this.filters.push({ type: 'or', expression });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  range(from: number, to: number) {
    this.rangeClause = { from, to };
    return this;
  }

  limit(count: number) {
    this.limitClause = count;
    return this;
  }

  single() {
    this.singleRow = true;
    return this;
  }

  private execute(): Promise<QueryResponse<T>> {
    return postJson<T>('/api/db/query', {
      table: this.table,
      action: this.action,
      select: this.selectClause,
      selectOptions: this.selectOptions,
      filters: this.filters,
      order: this.orders,
      range: this.rangeClause,
      limit: this.limitClause,
      single: this.singleRow,
      data: this.payloadData,
      onConflict: this.onConflictCol,
    });
  }

  then<TResult1 = QueryResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export interface GitHubDbStatus {
  owner: string;
  repo: string;
  branch: string;
  configured: boolean;
  lastSyncedAt: string | null;
  counts: Record<string, number>;
}

export async function fetchDbStatus(): Promise<GitHubDbStatus> {
  const res = await fetch('/api/db/status', { headers: getAuthHeaders() });
  if (res.status === 401) {
    notifyUnauthorized();
    throw new Error('Session expired. Please sign in again.');
  }
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error || 'Failed to load GitHub database status');
  }
  return json as GitHubDbStatus;
}

export async function syncDbFromGitHub(): Promise<GitHubDbStatus> {
  const res = await fetch('/api/db/sync', {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (res.status === 401) {
    notifyUnauthorized();
    throw new Error('Session expired. Please sign in again.');
  }
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error || 'Failed to sync from GitHub');
  }
  return json as GitHubDbStatus;
}

// Drop-in query client backed by the server-side GitHub repository database
export const db = {
  from: (table: string) => new GitHubQueryBuilder(table),
  rpc: (name: string, params: Record<string, unknown> = {}) =>
    postJson('/api/db/rpc', { name, params }),
};

// Keep exported name `supabase` for seamless compatibility with existing pages and forms
export const supabase = db;
