import { expect, test } from 'bun:test'
import { Context } from 'hono'
import { executeWithFallbackChannels } from '../src/providers/shared/upstream-retry'
import app from '../src/index'
import db from '../src/db'
import { createTestDatabase } from './helpers/sqlite-d1'

test('forwards multipart files and mapped model to an upstream channel', async () => {
    const form = new FormData()
    form.append('model', 'public-name')
    form.append('prompt', 'replace the sky')
    form.append('image', new File(['image bytes'], 'input.png', { type: 'image/png' }))
    const request = new Request('https://gateway.test/v1/images/edits', { method: 'POST', body: form })
    const context = new Context<HonoCustomType>(request, { env: {} as HonoCustomType['Bindings'] })
    const candidate = {
        key: 'channel',
        config: { name: 'channel', type: 'openai', endpoint: 'https://upstream.test', api_key: 'secret', auto_retry: false } as ChannelConfig,
        mapping: { name: 'public-name', id: 'upstream-model' },
    }
    const usages: Usage[] = []
    const originalFetch = globalThis.fetch
    try {
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const upstream = input as Request
            expect(upstream.headers.get('content-type')).toContain('multipart/form-data; boundary=')
            const body = await upstream.formData()
            expect(body.get('model')).toBe('upstream-model')
            expect(body.get('prompt')).toBe('replace the sky')
            expect(await (body.get('image') as File).text()).toBe('image bytes')
            return Response.json({ data: [] })
        }) as typeof fetch
        const response = await executeWithFallbackChannels(context, [candidate], candidate, form,
            async (usage) => { usages.push(usage) }, () => {}, { retryCount: 0 }, () => {})
        expect(response.status).toBe(200)
        expect(usages).toHaveLength(1)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('image edit route accepts multipart through the worker', async () => {
    const fixture = createTestDatabase()
    const originalFetch = globalThis.fetch
    try {
        await db.initialize(fixture.context)
        await fixture.database.prepare('INSERT INTO channel_config (key, value) VALUES (?, ?)').bind('channel', JSON.stringify({
            name: 'channel', type: 'openai', endpoint: 'https://upstream.test', api_key: 'secret',
            models: [{ name: 'public-name', id: 'upstream-model' }], auto_retry: false,
        })).run()
        await fixture.database.prepare('INSERT INTO api_token (key, value) VALUES (?, ?)').bind('token', JSON.stringify({ total_quota: -1 })).run()
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const body = await (input as Request).formData()
            expect(body.get('model')).toBe('upstream-model')
            return Response.json({ data: [] })
        }) as typeof fetch
        const form = new FormData()
        form.append('model', 'public-name')
        form.append('image', new File(['image bytes'], 'input.png', { type: 'image/png' }))
        const response = await app.request('/v1/images/edits', {
            method: 'POST', headers: { authorization: 'Bearer token' }, body: form,
        }, { DB: fixture.database } as unknown as CloudflareBindings)
        expect(response.status).toBe(200)
    } finally {
        globalThis.fetch = originalFetch
        fixture.close()
    }
})
