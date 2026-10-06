import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cacheAside,
  invalidateCacheKey,
  invalidateCacheKeys,
  invalidateCachePrefix,
  CATALOG_CACHE_NS,
} from '../lib/cache';

describe('KV Cache-Aside Utility', () => {
  let mockKv: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockKv = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('executes fetcher and populates cache on cache miss', async () => {
    const fetcher = vi.fn().mockResolvedValue({ items: ['course1', 'course2'] });

    const result = await cacheAside(mockKv, 'test-key', fetcher, { ttlSeconds: 1800 });

    expect(mockKv.get).toHaveBeenCalledWith('test-key', 'json');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(mockKv.put).toHaveBeenCalledWith(
      'test-key',
      JSON.stringify({ items: ['course1', 'course2'] }),
      { expirationTtl: 1800 }
    );
    expect(result).toEqual({
      data: { items: ['course1', 'course2'] },
      hit: false,
    });
  });

  it('returns cached data directly on cache hit without invoking fetcher', async () => {
    const cachedData = { items: ['cached-course'] };
    mockKv.get.mockResolvedValue(cachedData);
    const fetcher = vi.fn();

    const result = await cacheAside(mockKv, 'test-key', fetcher);

    expect(mockKv.get).toHaveBeenCalledWith('test-key', 'json');
    expect(fetcher).not.toHaveBeenCalled();
    expect(mockKv.put).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: cachedData,
      hit: true,
    });
  });

  it('handles null KV gracefully by bypassing cache', async () => {
    const fetcher = vi.fn().mockResolvedValue('raw-data');

    const result = await cacheAside(null, 'test-key', fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toEqual({
      data: 'raw-data',
      hit: false,
    });
  });

  it('invalidates single cache key', async () => {
    await invalidateCacheKey(mockKv, 'key-to-delete');
    expect(mockKv.delete).toHaveBeenCalledWith('key-to-delete');
  });

  it('invalidates multiple cache keys', async () => {
    await invalidateCacheKeys(mockKv, ['key1', 'key2']);
    expect(mockKv.delete).toHaveBeenCalledWith('key1');
    expect(mockKv.delete).toHaveBeenCalledWith('key2');
  });

  it('exposes a versioned catalog namespace so stale entries can be abandoned', () => {
    expect(CATALOG_CACHE_NS).toMatch(/^catalog:v\d+$/);
    expect(CATALOG_CACHE_NS).not.toBe('catalog');
  });

  describe('invalidateCachePrefix (real Cloudflare KV list API)', () => {
    // Real KV: list({ prefix, cursor? }) -> { keys: [{ name }], list_complete, cursor? }
    function realKv(pages: Array<{ names: string[]; cursor?: string }>) {
      const calls: unknown[] = [];
      let i = 0;
      return {
        calls,
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockImplementation(async (options?: { prefix?: string; cursor?: string }) => {
          calls.push(options?.prefix);
          const page = pages[Math.min(i++, pages.length - 1)];
          return {
            keys: page.names.map((name) => ({ name })),
            list_complete: i >= pages.length,
            cursor: page.cursor,
          };
        }),
      };
    }

    it('deletes every key under the prefix across paginated list results', async () => {
      const kv = realKv([
        { names: ['catalog:v2:programs:p1', 'catalog:v2:programs:p2'], cursor: 'c1' },
        { names: ['catalog:v2:programs:p3'] },
      ]);

      await invalidateCachePrefix(kv, 'catalog:v2:programs');

      expect(kv.list).toHaveBeenCalledWith({ prefix: 'catalog:v2:programs', cursor: undefined, limit: 1000 });
      expect(kv.list).toHaveBeenCalledWith({ prefix: 'catalog:v2:programs', cursor: 'c1', limit: 1000 });
      expect(kv.delete).toHaveBeenCalledWith('catalog:v2:programs:p1');
      expect(kv.delete).toHaveBeenCalledWith('catalog:v2:programs:p2');
      expect(kv.delete).toHaveBeenCalledWith('catalog:v2:programs:p3');
    });

    it('is a safe no-op when kv is null, list is missing, or list throws', async () => {
      await expect(invalidateCachePrefix(null, 'x')).resolves.toBeUndefined();
      await expect(
        invalidateCachePrefix({ delete: vi.fn() } as never, 'x'),
      ).resolves.toBeUndefined();
      const broken = {
        delete: vi.fn(),
        list: vi.fn().mockRejectedValue(new Error('KV down')),
      };
      await expect(invalidateCachePrefix(broken, 'x')).resolves.toBeUndefined();
      expect(broken.delete).not.toHaveBeenCalled();
    });
  });
});
