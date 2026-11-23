import crypto from 'node:crypto';

export const ALLOWED_TABLES = [
  'company_details',
  'units',
  'categories',
  'products',
  'customers',
  'purchases',
  'invoices',
  'invoice_items',
] as const;

export type TableName = (typeof ALLOWED_TABLES)[number];

export const ALLOWED_RPCS = [
  'delete_invoice_by_id',
  'delete_purchase_safely',
  'get_combined_report',
  'get_combined_report_count',
  'export_combined_report',
] as const;

export type RpcName = (typeof ALLOWED_RPCS)[number];

const ALLOWED_AUX_FILES = new Set(['data/_auth.json', 'data/_meta.json']);

export type FilterClause =
  | { type: 'eq' | 'neq' | 'lte' | 'gte' | 'lt' | 'gt' | 'ilike'; column: string; value: unknown }
  | { type: 'or'; expression: string };

export interface QueryPayload {
  table: TableName;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  select?: string;
  selectOptions?: { count?: 'exact'; head?: boolean };
  filters?: FilterClause[];
  order?: { column: string; ascending?: boolean }[];
  range?: { from: number; to: number };
  limit?: number;
  single?: boolean;
  data?: unknown;
  onConflict?: string;
}

export interface DbResponse<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

interface CacheEntry {
  rows: Record<string, any>[];
  sha: string | null;
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000;

export function getGitHubConfig() {
  const token = (process.env.GITHUB_TOKEN || '').trim();
  const owner = (process.env.GITHUB_OWNER || 'Imtiaz9800').trim();
  const repo = (process.env.GITHUB_REPO || 'BTC-db').trim();
  const branch = (process.env.GITHUB_BRANCH || 'main').trim();
  return { token, owner, repo, branch };
}

export function isGitHubConfigured(): boolean {
  const { token, owner, repo } = getGitHubConfig();
  return Boolean(token && owner && repo);
}

function assertTable(table: string): asserts table is TableName {
  if (!ALLOWED_TABLES.includes(table as TableName)) {
    throw new Error(`Invalid table: ${table}`);
  }
}

function assertRpc(name: string): asserts name is RpcName {
  if (!ALLOWED_RPCS.includes(name as RpcName)) {
    throw new Error(`Invalid RPC: ${name}`);
  }
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'biotechcentre-app',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

class GitHubDatabase {
  private cache = new Map<TableName, CacheEntry>();
  private writeChain: Promise<unknown> = Promise.resolve();
  private lastSyncedAt: string | null = null;

  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(task, task);
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private ensureConfigured() {
    const cfg = getGitHubConfig();
    if (!cfg.token) {
      throw new Error(
        'GitHub database is not configured. Set GITHUB_TOKEN in AI Studio Settings -> Secrets.'
      );
    }
    return cfg;
  }

  private async fetchRawFile(filePath: string): Promise<{ content: string; sha: string } | null> {
    const { token, owner, repo, branch } = this.ensureConfigured();
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

    const res = await fetch(url, { headers: buildHeaders(token) });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`GitHub read failed for ${filePath} (${res.status}): ${errBody || res.statusText}`);
    }

    const json = (await res.json()) as { sha: string; content?: string; encoding?: string; size?: number };
    if (json.content && json.encoding === 'base64') {
      return {
        content: Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8'),
        sha: json.sha,
      };
    }

    // Files > 1 MB return empty content in Contents API; fall back to Git Blobs API.
    const blobUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(json.sha)}`;
    const blobRes = await fetch(blobUrl, { headers: buildHeaders(token) });
    if (!blobRes.ok) {
      throw new Error(`GitHub blob read failed for ${filePath} (${blobRes.status})`);
    }
    const blobJson = (await blobRes.json()) as { content: string; encoding: string };
    const decoded =
      blobJson.encoding === 'base64'
        ? Buffer.from(blobJson.content.replace(/\n/g, ''), 'base64').toString('utf8')
        : blobJson.content;
    return { content: decoded, sha: json.sha };
  }

  private async putRawFile(
    filePath: string,
    contentStr: string,
    message: string,
    expectedSha?: string | null
  ): Promise<string> {
    const { token, owner, repo, branch } = this.ensureConfigured();
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
    const headers = buildHeaders(token);

    let sha = expectedSha ?? null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!sha) {
        const existing = await this.fetchRawFile(filePath);
        sha = existing?.sha ?? null;
      }

      const payload: Record<string, string> = {
        message,
        content: Buffer.from(contentStr, 'utf8').toString('base64'),
        branch,
      };
      if (sha) {
        payload.sha = sha;
      }

      const res = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = (await res.json()) as { content: { sha: string } };
        this.lastSyncedAt = new Date().toISOString();
        return result.content.sha;
      }

      if (res.status === 409 && attempt < 2) {
        sha = null;
        continue;
      }

      const errText = await res.text().catch(() => '');
      throw new Error(`GitHub write failed for ${filePath} (${res.status}): ${errText || res.statusText}`);
    }

    throw new Error(`GitHub write failed for ${filePath} after retries.`);
  }

  public async readAuxFile<T>(filePath: string): Promise<T | null> {
    if (!ALLOWED_AUX_FILES.has(filePath)) {
      throw new Error('Unauthorized auxiliary file path');
    }
    if (!isGitHubConfigured()) return null;
    const raw = await this.fetchRawFile(filePath);
    if (!raw) return null;
    return JSON.parse(raw.content) as T;
  }

  public async writeAuxFile(filePath: string, data: unknown, message: string): Promise<void> {
    if (!ALLOWED_AUX_FILES.has(filePath)) {
      throw new Error('Unauthorized auxiliary file path');
    }
    await this.enqueueWrite(async () => {
      await this.putRawFile(filePath, JSON.stringify(data, null, 2), message);
    });
  }

  public async loadTable(table: TableName, forceRefresh = false): Promise<Record<string, any>[]> {
    assertTable(table);
    const cached = this.cache.get(table);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.rows.map((r) => ({ ...r }));
    }

    const raw = await this.fetchRawFile(`data/${table}.json`);
    const rows = raw ? (JSON.parse(raw.content) as Record<string, any>[]) : [];
    this.cache.set(table, {
      rows,
      sha: raw?.sha ?? null,
      fetchedAt: Date.now(),
    });
    this.lastSyncedAt = new Date().toISOString();
    return rows.map((r) => ({ ...r }));
  }

  private async saveTable(
    table: TableName,
    rows: Record<string, any>[],
    message: string
  ): Promise<void> {
    assertTable(table);
    const cached = this.cache.get(table);
    const newSha = await this.putRawFile(
      `data/${table}.json`,
      JSON.stringify(rows, null, 2),
      message,
      cached?.sha ?? null
    );
    this.cache.set(table, {
      rows: rows.map((r) => ({ ...r })),
      sha: newSha,
      fetchedAt: Date.now(),
    });
  }

  public async syncAll(): Promise<{
    owner: string;
    repo: string;
    branch: string;
    configured: boolean;
    lastSyncedAt: string | null;
    counts: Record<string, number>;
  }> {
    const { owner, repo, branch } = getGitHubConfig();
    if (!isGitHubConfigured()) {
      return {
        owner,
        repo,
        branch,
        configured: false,
        lastSyncedAt: this.lastSyncedAt,
        counts: {},
      };
    }

    const entries = await Promise.all(
      ALLOWED_TABLES.map(async (table) => {
        const rows = await this.loadTable(table, true);
        return [table, rows.length] as const;
      })
    );

    return {
      owner,
      repo,
      branch,
      configured: true,
      lastSyncedAt: this.lastSyncedAt,
      counts: Object.fromEntries(entries),
    };
  }

  public async getStatus() {
    const { owner, repo, branch } = getGitHubConfig();
    if (!isGitHubConfigured()) {
      return {
        owner,
        repo,
        branch,
        configured: false,
        lastSyncedAt: this.lastSyncedAt,
        counts: {} as Record<string, number>,
      };
    }
    const entries = await Promise.all(
      ALLOWED_TABLES.map(async (table) => {
        const rows = await this.loadTable(table, false);
        return [table, rows.length] as const;
      })
    );
    return {
      owner,
      repo,
      branch,
      configured: true,
      lastSyncedAt: this.lastSyncedAt,
      counts: Object.fromEntries(entries),
    };
  }

  // --- Relation enrichment for Supabase-compatible select strings ---
  private async enrichRows(
    table: TableName,
    rows: Record<string, any>[],
    selectStr?: string
  ): Promise<Record<string, any>[]> {
    if (!selectStr || !selectStr.includes('(')) {
      return rows;
    }

    const s = selectStr;

    if (table === 'products') {
      const needUnits = /units\s*\(/i.test(s);
      const needCategories = /categories\s*\(/i.test(s);
      const [units, categories] = await Promise.all([
        needUnits ? this.loadTable('units') : Promise.resolve([]),
        needCategories ? this.loadTable('categories') : Promise.resolve([]),
      ]);
      const unitMap = new Map(units.map((u) => [u.id, u]));
      const catMap = new Map(categories.map((c) => [c.id, c]));

      return rows.map((row) => {
        const enriched = { ...row };
        if (needUnits) {
          const u = row.unit_id ? unitMap.get(row.unit_id) : null;
          enriched.units = u ? { abbreviation: u.abbreviation, name: u.name } : null;
        }
        if (needCategories) {
          const c = row.category_id ? catMap.get(row.category_id) : null;
          enriched.categories = c ? { name: c.name, icon_name: c.icon_name } : null;
        }
        return enriched;
      });
    }

    if (table === 'purchases') {
      const needProducts = /products(!inner)?\s*\(/i.test(s);
      const innerProducts = /products!inner\s*\(/i.test(s);
      if (needProducts) {
        const products = await this.loadTable('products');
        const prodMap = new Map(products.map((p) => [p.id, p]));
        const mapped = rows.map((row) => {
          const p = row.product_id ? prodMap.get(row.product_id) : null;
          return {
            ...row,
            products: p
              ? {
                  name: p.name,
                  unit_price: p.unit_price,
                  hsn_code: p.hsn_code,
                  tax_rate: p.tax_rate,
                }
              : null,
          };
        });
        return innerProducts ? mapped.filter((r) => r.products !== null) : mapped;
      }
    }

    if (table === 'invoices') {
      const needCustomers = /customers\s*\(/i.test(s);
      const needItems = /invoice_items\s*\(/i.test(s);
      const [customers, allItems, products, units] = await Promise.all([
        needCustomers ? this.loadTable('customers') : Promise.resolve([]),
        needItems ? this.loadTable('invoice_items') : Promise.resolve([]),
        needItems ? this.loadTable('products') : Promise.resolve([]),
        needItems ? this.loadTable('units') : Promise.resolve([]),
      ]);
      const customerMap = new Map(customers.map((c) => [c.id, c]));
      const prodMap = new Map(products.map((p) => [p.id, p]));
      const unitMap = new Map(units.map((u) => [u.id, u]));

      const itemsByInvoice = new Map<string, Record<string, any>[]>();
      if (needItems) {
        for (const item of allItems) {
          const p = item.product_id ? prodMap.get(item.product_id) : null;
          const u = p?.unit_id ? unitMap.get(p.unit_id) : null;
          const fullItem = {
            ...item,
            products: p
              ? {
                  name: p.name,
                  hsn_code: p.hsn_code ?? null,
                  unit_price: p.unit_price,
                  tax_rate: p.tax_rate,
                  units: u ? { abbreviation: u.abbreviation } : null,
                }
              : null,
          };
          const list = itemsByInvoice.get(item.invoice_id) || [];
          list.push(fullItem);
          itemsByInvoice.set(item.invoice_id, list);
        }
      }

      return rows.map((row) => {
        const enriched = { ...row };
        if (needCustomers) {
          const c = row.customer_id ? customerMap.get(row.customer_id) : null;
          enriched.customers = c ? { ...c } : null;
        }
        if (needItems) {
          enriched.invoice_items = itemsByInvoice.get(row.id) || [];
        }
        return enriched;
      });
    }

    if (table === 'invoice_items') {
      const needInvoices = /invoices(!inner)?\s*\(/i.test(s);
      const innerInvoices = /invoices!inner\s*\(/i.test(s);
      if (needInvoices) {
        const [invoices, customers] = await Promise.all([
          this.loadTable('invoices'),
          this.loadTable('customers'),
        ]);
        const invMap = new Map(invoices.map((inv) => [inv.id, inv]));
        const custMap = new Map(customers.map((c) => [c.id, c]));
        const mapped = rows.map((row) => {
          const inv = row.invoice_id ? invMap.get(row.invoice_id) : null;
          const cust = inv?.customer_id ? custMap.get(inv.customer_id) : null;
          return {
            ...row,
            invoices: inv
              ? {
                  invoice_number: inv.invoice_number,
                  invoice_date: inv.invoice_date,
                  customers: cust ? { name: cust.name } : null,
                }
              : null,
          };
        });
        return innerInvoices ? mapped.filter((r) => r.invoices !== null) : mapped;
      }
    }

    return rows;
  }

  private getNestedValue(row: Record<string, any>, columnPath: string): unknown {
    if (!columnPath.includes('.')) {
      return row[columnPath];
    }
    const parts = columnPath.split('.');
    let current: any = row;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  }

  private matchesIlike(val: unknown, pattern: string): boolean {
    if (val == null) return false;
    const str = String(val).toLowerCase();
    const pat = String(pattern).slice(0, 200).replace(/%+/g, '%').toLowerCase();
    const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp(`^${escaped}$`, 'i').test(str);
  }

  private matchesFilter(row: Record<string, any>, filter: FilterClause): boolean {
    if (filter.type === 'or') {
      const conditions = filter.expression.split(',').map((s) => s.trim()).filter(Boolean);
      return conditions.some((cond) => {
        const match = cond.match(/^([a-zA-Z0-9_.]+)\.(eq|neq|ilike|lte|gte|lt|gt)\.(.*)$/);
        if (!match) return false;
        const [, col, op, rawVal] = match;
        return this.matchesFilter(row, {
          type: op as 'eq' | 'neq' | 'ilike' | 'lte' | 'gte' | 'lt' | 'gt',
          column: col,
          value: rawVal,
        });
      });
    }

    const val = this.getNestedValue(row, filter.column);
    switch (filter.type) {
      case 'eq':
        return val === filter.value || String(val) === String(filter.value);
      case 'neq':
        return val !== filter.value && String(val) !== String(filter.value);
      case 'lte':
        return Number(val) <= Number(filter.value);
      case 'gte':
        return Number(val) >= Number(filter.value);
      case 'lt':
        return Number(val) < Number(filter.value);
      case 'gt':
        return Number(val) > Number(filter.value);
      case 'ilike':
        return this.matchesIlike(val, String(filter.value));
      default:
        return true;
    }
  }

  private applyFilters(rows: Record<string, any>[], filters?: FilterClause[]) {
    if (!filters || filters.length === 0) return rows;
    return rows.filter((row) => filters.every((f) => this.matchesFilter(row, f)));
  }

  private applyOrders(
    rows: Record<string, any>[],
    orders?: { column: string; ascending?: boolean }[]
  ) {
    if (!orders || orders.length === 0) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      for (const ord of orders) {
        const dir = ord.ascending === false ? -1 : 1;
        const va = a[ord.column];
        const vb = b[ord.column];
        if (va == null && vb == null) continue;
        if (va == null) return 1 * dir;
        if (vb == null) return -1 * dir;
        if (typeof va === 'number' && typeof vb === 'number') {
          if (va !== vb) return (va - vb) * dir;
        } else {
          const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
          if (cmp !== 0) return cmp * dir;
        }
      }
      return 0;
    });
    return copy;
  }

  private async adjustProductStock(deltas: Map<string, number>): Promise<void> {
    const nonZero = Array.from(deltas.entries()).filter(([, delta]) => delta !== 0);
    if (nonZero.length === 0) return;

    const products = await this.loadTable('products', true);
    let changed = false;
    for (const [productId, delta] of nonZero) {
      const prod = products.find((p) => p.id === productId);
      if (prod) {
        prod.stock_quantity = Number(prod.stock_quantity || 0) + delta;
        changed = true;
      }
    }
    if (changed) {
      await this.saveTable('products', products, 'Auto-adjust product stock quantity');
    }
  }

  public async executeQuery(payload: QueryPayload): Promise<DbResponse> {
    assertTable(payload.table);

    if (payload.action === 'select') {
      const rawRows = await this.loadTable(payload.table);
      const enriched = await this.enrichRows(payload.table, rawRows, payload.select);
      const filtered = this.applyFilters(enriched, payload.filters);
      const totalCount = filtered.length;

      if (payload.selectOptions?.head) {
        return {
          data: null,
          error: null,
          count: payload.selectOptions?.count === 'exact' ? totalCount : null,
        };
      }

      let result = this.applyOrders(filtered, payload.order);
      if (payload.range) {
        result = result.slice(payload.range.from, payload.range.to + 1);
      } else if (typeof payload.limit === 'number') {
        result = result.slice(0, payload.limit);
      }

      if (payload.single) {
        if (result.length === 0) {
          return {
            data: null,
            error: { message: 'Row not found', code: 'PGRST116' },
            count: 0,
          };
        }
        return { data: result[0], error: null, count: totalCount };
      }

      return {
        data: result,
        error: null,
        count: payload.selectOptions?.count === 'exact' ? totalCount : null,
      };
    }

    return this.enqueueWrite(async () => {
      const rows = await this.loadTable(payload.table, true);

      if (payload.action === 'insert') {
        const inputRows = Array.isArray(payload.data) ? payload.data : [payload.data];
        const now = new Date().toISOString();
        const inserted: Record<string, any>[] = inputRows.map((item: any) => {
          const record: Record<string, any> = {
            ...item,
            id: item?.id ?? (payload.table === 'company_details' ? 1 : crypto.randomUUID()),
            created_at: item?.created_at ?? now,
          };
          if (payload.table === 'products') {
            record.stock_quantity = Number(record.stock_quantity ?? 0);
            record.unit_price = Number(record.unit_price ?? 0);
            record.tax_rate = Number(record.tax_rate ?? 0);
          }
          if (payload.table === 'purchases') {
            record.quantity = Number(record.quantity ?? 0);
          }
          if (payload.table === 'invoice_items') {
            record.quantity = Number(record.quantity ?? 0);
            record.unit_price = Number(record.unit_price ?? 0);
            record.tax_rate = Number(record.tax_rate ?? 0);
          }
          if (payload.table === 'invoices') {
            record.total_amount = Number(record.total_amount ?? 0);
          }
          return record;
        });

        const updatedRows = [...rows, ...inserted];
        await this.saveTable(
          payload.table,
          updatedRows,
          `Insert ${inserted.length} row(s) into ${payload.table}`
        );

        // Stock triggers matching original Supabase triggers
        if (payload.table === 'purchases') {
          const deltas = new Map<string, number>();
          for (const rec of inserted) {
            if (rec.product_id) {
              deltas.set(rec.product_id, (deltas.get(rec.product_id) || 0) + Number(rec.quantity || 0));
            }
          }
          await this.adjustProductStock(deltas);
        } else if (payload.table === 'invoice_items') {
          const deltas = new Map<string, number>();
          for (const rec of inserted) {
            if (rec.product_id) {
              deltas.set(rec.product_id, (deltas.get(rec.product_id) || 0) - Number(rec.quantity || 0));
            }
          }
          await this.adjustProductStock(deltas);
        }

        const out = payload.single ? inserted[0] ?? null : inserted;
        return { data: out, error: null };
      }

      if (payload.action === 'update') {
        const patch = (payload.data || {}) as Record<string, any>;
        const matched: Record<string, any>[] = [];
        const stockDeltas = new Map<string, number>();

        const nextRows = rows.map((row) => {
          if (!this.applyFilters([row], payload.filters).length) {
            return row;
          }
          const updated = { ...row, ...patch };
          if (payload.table === 'purchases') {
            const oldProd = row.product_id;
            const newProd = updated.product_id;
            const oldQty = Number(row.quantity || 0);
            const newQty = Number(updated.quantity || 0);
            if (oldProd) stockDeltas.set(oldProd, (stockDeltas.get(oldProd) || 0) - oldQty);
            if (newProd) stockDeltas.set(newProd, (stockDeltas.get(newProd) || 0) + newQty);
          } else if (payload.table === 'invoice_items') {
            const oldProd = row.product_id;
            const newProd = updated.product_id;
            const oldQty = Number(row.quantity || 0);
            const newQty = Number(updated.quantity || 0);
            if (oldProd) stockDeltas.set(oldProd, (stockDeltas.get(oldProd) || 0) + oldQty);
            if (newProd) stockDeltas.set(newProd, (stockDeltas.get(newProd) || 0) - newQty);
          }
          matched.push(updated);
          return updated;
        });

        await this.saveTable(
          payload.table,
          nextRows,
          `Update ${matched.length} row(s) in ${payload.table}`
        );

        if (stockDeltas.size > 0) {
          await this.adjustProductStock(stockDeltas);
        }

        const out = payload.single ? matched[0] ?? null : matched;
        return { data: out, error: null };
      }

      if (payload.action === 'upsert') {
        const conflictKey = payload.onConflict || 'id';
        const inputRows = Array.isArray(payload.data) ? payload.data : [payload.data];
        const now = new Date().toISOString();
        const nextRows = [...rows];
        const upserted: Record<string, any>[] = [];

        for (const item of inputRows as Record<string, any>[]) {
          const idx = nextRows.findIndex(
            (r) => r[conflictKey] != null && String(r[conflictKey]) === String(item[conflictKey])
          );
          if (idx >= 0) {
            nextRows[idx] = { ...nextRows[idx], ...item };
            upserted.push(nextRows[idx]);
          } else {
            const created = {
              ...item,
              id: item.id ?? (payload.table === 'company_details' ? 1 : crypto.randomUUID()),
              created_at: item.created_at ?? now,
            };
            nextRows.push(created);
            upserted.push(created);
          }
        }

        await this.saveTable(payload.table, nextRows, `Upsert ${upserted.length} row(s) in ${payload.table}`);
        const out = payload.single ? upserted[0] ?? null : upserted;
        return { data: out, error: null };
      }

      if (payload.action === 'delete') {
        const deleted: Record<string, any>[] = [];
        const remaining: Record<string, any>[] = [];

        for (const row of rows) {
          if (this.applyFilters([row], payload.filters).length > 0) {
            deleted.push(row);
          } else {
            remaining.push(row);
          }
        }

        await this.saveTable(
          payload.table,
          remaining,
          `Delete ${deleted.length} row(s) from ${payload.table}`
        );

        if (payload.table === 'purchases') {
          const deltas = new Map<string, number>();
          for (const rec of deleted) {
            if (rec.product_id) {
              deltas.set(rec.product_id, (deltas.get(rec.product_id) || 0) - Number(rec.quantity || 0));
            }
          }
          await this.adjustProductStock(deltas);
        } else if (payload.table === 'invoice_items') {
          const deltas = new Map<string, number>();
          for (const rec of deleted) {
            if (rec.product_id) {
              deltas.set(rec.product_id, (deltas.get(rec.product_id) || 0) + Number(rec.quantity || 0));
            }
          }
          await this.adjustProductStock(deltas);
        }

        return { data: deleted, error: null };
      }

      throw new Error(`Unsupported action: ${payload.action}`);
    });
  }

  private async buildCombinedReport(params: {
    p_start_date?: string;
    p_end_date?: string;
    p_transaction_type?: string;
  }) {
    const startDate = params.p_start_date || '';
    const endDate = params.p_end_date || '';
    const txType = (params.p_transaction_type || 'all').toLowerCase();

    const [products, purchases, invoices, invoiceItems] = await Promise.all([
      this.loadTable('products'),
      this.loadTable('purchases'),
      this.loadTable('invoices'),
      this.loadTable('invoice_items'),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const invoiceMap = new Map(invoices.map((inv) => [inv.id, inv]));

    const combined: {
      transaction_id: string;
      transaction_date: string;
      transaction_type: 'Sale' | 'Purchase';
      reference_number: string;
      product_name: string;
      quantity_change: number;
    }[] = [];

    if (txType === 'all' || txType === 'purchase') {
      for (const pur of purchases) {
        const d = String(pur.purchase_date || '').slice(0, 10);
        if (startDate && d < startDate) continue;
        if (endDate && d > endDate) continue;
        const prod = productMap.get(pur.product_id);
        combined.push({
          transaction_id: `purchase-${pur.id}`,
          transaction_date: pur.purchase_date,
          transaction_type: 'Purchase',
          reference_number: pur.reference_invoice || '',
          product_name: prod?.name || 'Unknown Product',
          quantity_change: Math.abs(Number(pur.quantity || 0)),
        });
      }
    }

    if (txType === 'all' || txType === 'sale') {
      for (const item of invoiceItems) {
        const inv = invoiceMap.get(item.invoice_id);
        if (!inv) continue;
        const d = String(inv.invoice_date || '').slice(0, 10);
        if (startDate && d < startDate) continue;
        if (endDate && d > endDate) continue;
        const prod = productMap.get(item.product_id);
        combined.push({
          transaction_id: `sale-${item.id}`,
          transaction_date: inv.invoice_date,
          transaction_type: 'Sale',
          reference_number: inv.invoice_number || '',
          product_name: prod?.name || 'Unknown Product',
          quantity_change: -Math.abs(Number(item.quantity || 0)),
        });
      }
    }

    combined.sort((a, b) => {
      const cmp = String(b.transaction_date).localeCompare(String(a.transaction_date));
      if (cmp !== 0) return cmp;
      return b.transaction_id.localeCompare(a.transaction_id);
    });

    return combined;
  }

  public async executeRpc(name: RpcName, params: Record<string, any> = {}): Promise<DbResponse> {
    assertRpc(name);

    if (name === 'get_combined_report') {
      const all = await this.buildCombinedReport(params);
      const offset = Number(params.p_offset || 0);
      const limit = Number(params.p_limit || 15);
      return { data: all.slice(offset, offset + limit), error: null };
    }

    if (name === 'get_combined_report_count') {
      const all = await this.buildCombinedReport(params);
      return { data: all.length, error: null };
    }

    if (name === 'export_combined_report') {
      const all = await this.buildCombinedReport(params);
      return { data: all, error: null };
    }

    if (name === 'delete_invoice_by_id') {
      const invoiceId = String(params.p_invoice_id || '');
      if (!invoiceId) {
        return { data: null, error: { message: 'p_invoice_id is required' } };
      }

      return this.enqueueWrite(async () => {
        const [invoices, items] = await Promise.all([
          this.loadTable('invoices', true),
          this.loadTable('invoice_items', true),
        ]);

        const invoiceExists = invoices.some((inv) => inv.id === invoiceId);
        if (!invoiceExists) {
          return { data: null, error: { message: 'Invoice not found' } };
        }

        const removedItems = items.filter((it) => it.invoice_id === invoiceId);
        const remainingItems = items.filter((it) => it.invoice_id !== invoiceId);
        const remainingInvoices = invoices.filter((inv) => inv.id !== invoiceId);

        const deltas = new Map<string, number>();
        for (const it of removedItems) {
          if (it.product_id) {
            deltas.set(it.product_id, (deltas.get(it.product_id) || 0) + Number(it.quantity || 0));
          }
        }

        await this.saveTable('invoice_items', remainingItems, `Delete items for invoice ${invoiceId}`);
        await this.saveTable('invoices', remainingInvoices, `Delete invoice ${invoiceId}`);
        await this.adjustProductStock(deltas);

        return { data: { deleted: true }, error: null };
      });
    }

    if (name === 'delete_purchase_safely') {
      const purchaseId = String(params.p_purchase_id || '');
      if (!purchaseId) {
        return { data: null, error: { message: 'p_purchase_id is required' } };
      }

      return this.enqueueWrite(async () => {
        const purchases = await this.loadTable('purchases', true);
        const target = purchases.find((p) => p.id === purchaseId);
        if (!target) {
          return { data: null, error: { message: 'Purchase record not found' } };
        }

        const remaining = purchases.filter((p) => p.id !== purchaseId);
        await this.saveTable('purchases', remaining, `Delete purchase ${purchaseId}`);

        if (target.product_id) {
          const deltas = new Map<string, number>([[target.product_id, -Number(target.quantity || 0)]]);
          await this.adjustProductStock(deltas);
        }

        return { data: { deleted: true }, error: null };
      });
    }

    throw new Error(`Unhandled RPC: ${name}`);
  }
}

export const githubDb = new GitHubDatabase();
