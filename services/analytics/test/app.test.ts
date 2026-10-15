import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { setup } from './fixtures.js';

function app() {
  const ctx = setup();
  const verifier = { verify: vi.fn(async (h: string | undefined) => {
    if (h !== 'Bearer good') throw new Error('private token error');
  }) };
  return { ...ctx, verifier, app: buildApp({ ...ctx.deps, verifier }) };
}
const request = { method: 'POST' as const, url: '/tasks/export', headers: { authorization: 'Bearer good' } };
describe('analytics worker HTTP boundary', () => {
  it('checks OIDC before reading any source records or publishing', async () => {
    const ctx = app();
    const cursor = vi.spyOn(ctx.source, 'cursor');
    expect((await ctx.app.inject({ url: '/health' })).statusCode).toBe(200);
    const res = await ctx.app.inject({ ...request, headers: {} });
    expect(res.statusCode).toBe(403);
    expect(cursor).not.toHaveBeenCalled();
    expect(ctx.events).toHaveLength(0);
    expect(res.body).not.toContain('private');
    await ctx.app.close();
  });
  it('returns aggregate counts, never source data', async () => {
    const ctx = app();
    const res = await ctx.app.inject(request);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ scanned: 1, published: 1, unchanged: 0, excluded: 0, invalid: 0, failed: 0, caughtUp: true });
    expect(ctx.verifier.verify).toHaveBeenCalledWith('Bearer good');
    await ctx.app.close();
  });
  it.each(['source', 'publish'] as const)('returns a retryable, sanitized response for a %s outage', async (failure) => {
    const ctx = app();
    if (failure === 'source') vi.spyOn(ctx.source, 'page').mockRejectedValue(new Error('private source text'));
    else vi.spyOn(ctx.deps.publisher, 'publish').mockRejectedValue(new Error('private Pub/Sub payload'));
    const res = await ctx.app.inject(request);
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('private');
    expect(ctx.source.savedCursor).toBeNull();
    await ctx.app.close();
  });
});
