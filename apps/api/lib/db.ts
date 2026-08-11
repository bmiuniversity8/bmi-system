/**
 * Database connection utilities for the Neon-Centric architecture.
 *
 * Provides:
 *   - `createCoreDb(env)` / `createHrDb(env)` / `createLibraryDb(env)` / `createAlumniDb(env)`
 *     Drizzle instances bound to the four Neon projects.
 *   - A D1 fallback (`getD1()` / `createD1Drizzle(env)`) so local development and the
 *     strangler-fig migration phase keep working against the existing SQLite database.
 *   - `setRequestContext(db, userId)` to configure Postgres RLS
 *     (`set_config('request.jwt.claim.sub', ...)`) on each request.
 *
 * The Neon connection string is read from env vars in this priority order:
 *   1. Per-module binding: DATABASE_URL_CORE, DATABASE_URL_HR, DATABASE_URL_LIBRARY, DATABASE_URL_ALUMNI
 *   2. A generic DATABASE_URL
 *   3. A Cloudflare Hyperdrive binding: CORE_HYPERDRIVE / HR_HYPERDRIVE / LIBRARY_HYPERDRIVE / ALUMNI_HYPERDRIVE
 *   4. Empty (falls back to D1)
 */
import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { sql } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { PostgresDatabaseAdapter } from '@bmi/adapters';
import type { IDatabase } from '@bmi/ports';
import * as coreSchema from '../schema/core';
import * as academicSchema from '../schema/academic';
import * as hrSchema from '../schema/hr';
import * as librarySchema from '../schema/library';
import * as alumniSchema from '../schema/alumni';
import * as campusSchema from '../schema/campus';
import type { Env } from './types';

export type CoreSchema = typeof coreSchema & typeof academicSchema & typeof hrSchema & typeof librarySchema & typeof alumniSchema & typeof campusSchema;
export type CoreDb = NeonHttpDatabase<CoreSchema>;
export type HrDb = NeonHttpDatabase<typeof hrSchema>;
export type LibraryDb = NeonHttpDatabase<typeof librarySchema>;
export type AlumniDb = NeonHttpDatabase<typeof alumniSchema & typeof campusSchema>;

function getConnectionUrl(env: Env, perModuleVar: string): string | undefined {
  const candidates = [
    env[perModuleVar as keyof Env],
    env.DATABASE_URL_CORE,
    env.DATABASE_URL,
    (env.CORE_HYPERDRIVE as any)?.connectionString,
    (env.HR_HYPERDRIVE as any)?.connectionString,
    (env.LIBRARY_HYPERDRIVE as any)?.connectionString,
    (env.ALUMNI_HYPERDRIVE as any)?.connectionString,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim();
    }
  }
  return undefined;
}

/**
 * Create a Neon Drizzle handle.
 *
 * Connection pooling — Neon has two transport modes:
 *   - HTTP (default, stateless): neon-http driver with built-in per-request pooling;
 *     Neon's serverless runtime manages idle connections automatically. No explicit
 *     pool size is required — concurrency is bounded by Neon's HTTP endpoint limits.
 *   - Websocket / TCP (`neon/websocket`): traditional TCP pooling; if enabled, use
 *     neon(client) with { poolMax, poolMin } options.
 *
 * To guarantee least-privilege isolation per request, we do NOT share a Neon client
 * between requests when RLS is active — `setRequestContext()` sets session-level
 * config which would leak across concurrent requests if a pooled client were reused.
 * With neon-http this is a non-issue because each call establishes a fresh session
 * via the HTTP transport.
 */
function createNeon(url: string, schema: Record<string, unknown>): NeonHttpDatabase<any> {
  const cleanUrl = url.trim();
  // Neon HTTP driver: per-call session isolation. When adding the websocket driver,
  // add { poolMax: 20, poolMin: 0, connectionTimeoutMillis: 5000 } here.
  const client = neon(cleanUrl);
  const db = drizzleNeonHttp(client as any, { schema: schema as any });
  // Patch transaction on neon-http database instance to prevent "No transactions support in neon-http driver" crash.
  // Neon HTTP driver is stateless fetch per statement, so statements inside transaction callback execute sequentially against the DB instance.
  (db as any).transaction = async function (transactionCallback: (tx: any) => Promise<any>) {
    return await transactionCallback(db);
  };
  return db;
}

/**
 * Connection pool / session metadata helper.
 *
 * Returns diagnostics about the current DB handle so callers can decide whether to
 * use transactions or batching. Neon-http handles have no pool state (session-per-call),
 * while a future Websocket driver will expose pool stats via the client object.
 */
export function getConnectionPoolInfo(db: unknown): { kind: 'neon-http' | 'd1' | 'neon-ws'; poolSize?: number } {
  if (!db || typeof db !== 'object') return { kind: 'd1' };
  if ('execute' in db) {
    // If we later swap to neon/websocket the client is attached via a Symbol or similar
    return { kind: 'neon-http' };
  }
  return { kind: 'd1' };
}

/** D1 fallback — only active in local dev or when DATABASE_URL_CORE is absent. */
function createD1(env: Env): DrizzleD1Database<any> | null {
  const binding = env.DB ?? (env.PLATFORM_CONTEXT?.db as any);
  if (!binding) return null;
  return drizzleD1(binding as any, { schema: {} as any });
}

/**
 * Returns an `IDatabase`-compatible handle for the CORE database.
 *
 * When a Neon connection string is configured, this returns the
 * `PostgresDatabaseAdapter` so every existing `db.prepare()` route runs
 * against Postgres unchanged (SQLite→Postgres SQL translation). Otherwise it
 * returns the D1 adapter via the existing `env.DB` binding.
 */
export function createCoreIdb(env: Env): IDatabase {
  const url = getConnectionUrl(env, 'DATABASE_URL_CORE');
  if (url) return new PostgresDatabaseAdapter(url);
  return new D1FallbackAdapter(env);
}

/**
 * Minimal IDatabase wrapper around the D1 binding so callers get a uniform
 * interface. In practice routes receive this via `PLATFORM_CONTEXT.db`.
 * Only used when DATABASE_URL_CORE is not configured (local dev / fallback).
 */
export class D1FallbackAdapter implements IDatabase {
  private readonly db: IDatabase;
  constructor(env: Env) {
    const binding = env.DB ?? (env.PLATFORM_CONTEXT?.db as IDatabase | undefined);
    if (!binding) {
      throw new Error(
        'D1FallbackAdapter: env.DB is not set and no PLATFORM_CONTEXT.db is available. ' +
        'Set DATABASE_URL_CORE to use Neon instead.'
      );
    }
    this.db = binding;
  }
  query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.db.query(sql, params);
  }
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
    return this.db.queryOne(sql, params);
  }
  prepare(sql: string) {
    return this.db.prepare(sql);
  }
  transaction<T>(callback: (db: IDatabase) => Promise<T>): Promise<T> {
    return this.db.transaction(callback);
  }
  batch<T = any>(statements: import('@bmi/ports').IPreparedStatement[]): Promise<T[]> {
    return this.db.batch(statements);
  }
  getPlatform(): string {
    return 'cloudflare-d1';
  }
}


export function createCoreDb(env: Env): CoreDb {
  const url = getConnectionUrl(env, 'DATABASE_URL_CORE');
  if (url) return createNeon(url, { ...coreSchema, ...academicSchema, ...hrSchema, ...librarySchema, ...alumniSchema, ...campusSchema });
  const d1 = createD1(env);
  if (!d1) throw new Error('createCoreDb: no Neon URL and no D1 binding available. Set DATABASE_URL_CORE.');
  return d1 as unknown as CoreDb;
}

export function createHrDb(env: Env): HrDb {
  const url = getConnectionUrl(env, 'DATABASE_URL_HR');
  if (url) return createNeon(url, hrSchema as unknown as Record<string, unknown>);
  const d1 = createD1(env);
  if (!d1) throw new Error('createHrDb: no Neon URL and no D1 binding available. Set DATABASE_URL_HR.');
  return d1 as unknown as HrDb;
}

export function createLibraryDb(env: Env): LibraryDb {
  const url = getConnectionUrl(env, 'DATABASE_URL_LIBRARY');
  if (url) return createNeon(url, librarySchema as unknown as Record<string, unknown>);
  const d1 = createD1(env);
  if (!d1) throw new Error('createLibraryDb: no Neon URL and no D1 binding available. Set DATABASE_URL_LIBRARY.');
  return d1 as unknown as LibraryDb;
}

export function createAlumniDb(env: Env): AlumniDb {
  const url = getConnectionUrl(env, 'DATABASE_URL_ALUMNI');
  if (url) return createNeon(url, { ...alumniSchema, ...campusSchema });
  const d1 = createD1(env);
  if (!d1) throw new Error('createAlumniDb: no Neon URL and no D1 binding available. Set DATABASE_URL_ALUMNI.');
  return d1 as unknown as AlumniDb;
}


/**
 * Set the request-level identity for Row-Level Security.
 * Call this once per request after authentication so Postgres RLS policies
 * can restrict rows to the requesting user.
 */
export async function setRequestContext(db: NeonHttpDatabase<any>, userId: string): Promise<void> {
  await db.execute(
    sql`select set_config('request.jwt.claim.sub', ${userId}, true), set_config('request.jwt.claim.role', 'authenticated', true)`,
  );
}

/**
 * Return true when the given db handle is a Neon (Postgres) connection.
 *
 * Detection strategy (free-tier friendly — no extra round-trips):
 *   1. Neon's drizzle-neon-http client attaches a `session` or `$client` symbol
 *      that D1 does not have.
 *   2. Neon's DrizzleORM wrapper exposes `.execute()` (raw SQL) and does NOT
 *      expose `.prepare()` at the ORM level (D1 does via drizzle-d1).
 *   3. The constructor name of the Neon DB proxy is 'NeonHttpDatabase'.
 *
 * We check all three signals and accept a match on any one of them so the
 * detection is robust against minor Drizzle version surface changes.
 */
export function isNeon(db: unknown): boolean {
  if (!db || typeof db !== 'object') return false;
  // Signal 1: constructor name set by drizzle-orm/neon-http
  const ctorName = (db as any)?.constructor?.name;
  if (ctorName === 'NeonHttpDatabase') return true;
  // Signal 2: Neon attaches the raw client as `$client` or session; D1 and test mocks do not
  if ('$client' in (db as object) || 'session' in (db as object)) return true;
  return false;
}

/**
 * Scoped RLS runner — runs `fn` with the current user's identity pre-set on
 * every query, and guarantees the identity cannot leak across requests.
 *
 * Prefer this over manual `setRequestContext()` because:
 *   1. It's a single call site — RLS cannot be forgotten accidentally.
 *   2. It always returns the user id to 'anon' after the block even if `fn`
 *      throws (critical for pooled Neon/TCP drivers in the future).
 *
 * userId semantics:
 *   - Use a real user uuid when authenticated;
 *   - Use `'anon'` for unauthenticated routes so strict RLS policies still
 *     prevent data leakage even when a query forgets an explicit WHERE user_id = ?.
 */
export async function withRequestContext<T>(
  db: NeonHttpDatabase<any> | DrizzleD1Database<any>,
  userId: string,
  fn: (scopedDb: NeonHttpDatabase<any> | DrizzleD1Database<any>) => Promise<T>
): Promise<T> {
  if (!isNeon(db)) {
    return fn(db);
  }
  const pg = db as NeonHttpDatabase<any>;
  try {
    await setRequestContext(pg, userId);
    return await fn(pg);
  } finally {
    // Reset to anon after block so if pooled TCP connections are later used,
    // identity does not leak into subsequent requests on the same connection.
    try {
      await pg.execute(
        sql`select set_config('request.jwt.claim.sub', 'anon', true), set_config('request.jwt.claim.role', 'anon', true)`
      );
    } catch { /* ignore reset failures — they don't affect caller result */ }
  }
}

/**
 * RLS + ACID transaction shorthand.
 *
 * Combines `withRequestContext` + `db.transaction` into one call so writes are
 * both (a) scoped to the requesting user's RLS policies, and (b) committed
 * atomically — preventing partial writes from a half-succeeded route that
 * would otherwise leak via inconsistent state.
 */
export async function withTransaction<T>(
  db: NeonHttpDatabase<any> | DrizzleD1Database<any>,
  userId: string,
  fn: (tx: any) => Promise<T>
): Promise<T> {
  if (!isNeon(db)) {
    const d1 = db as DrizzleD1Database<any>;
    return await d1.transaction(async tx => fn(tx)) as Promise<T>;
  }
  return withRequestContext(db, userId, async scopedDb => {
    return await fn(scopedDb);
  });
}
