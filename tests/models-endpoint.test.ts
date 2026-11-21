import { expect, test } from 'bun:test'
import { Context } from 'hono'
import db from '../src/db'
import { ModelsEndpoint } from '../src/providers/models'
import { createTestDatabase } from './helpers/sqlite-d1'

test('model listing accepts a query key and exposes only accessible combos', async () => {
    const fixture = createTestDatabase()
    try {
        await db.initialize(fixture.context)
        await fixture.database.prepare('INSERT INTO api_token (key, value) VALUES (?, ?)')
            .bind('test-key', JSON.stringify({ total_quota: -1, channel_keys: ['allowed'] })).run()
        const config = { enabled: true, models: [{ name: 'provider-model', id: 'upstream-model' }] }
        for (const key of ['allowed', 'restricted']) {
            await fixture.database.prepare('INSERT INTO channel_config (key, value) VALUES (?, ?)')
                .bind(key, JSON.stringify(config)).run()
        }
        for (const [name, channel] of [['combo-visible', 'allowed'], ['combo-restricted', 'restricted']]) {
            await fixture.database.prepare('INSERT INTO model_combo (model_name, model_id, provider_models) VALUES (?, ?, ?)')
                .bind(name, name, JSON.stringify([{ channel_key: channel, model_id: 'upstream-model' }])).run()
        }
        const context = new Context<HonoCustomType>(new Request('https://example.test/v1/models?key=test-key'), { env: fixture.context.env })
        const response = await new ModelsEndpoint().handle(context)
        const body = await response.json() as { data: { id: string }[] }
        expect(body.data.map((model) => model.id)).toEqual(['combo-visible'])

        const headerContext = new Context<HonoCustomType>(new Request('https://example.test/v1/models?key=wrong', {
            headers: { Authorization: 'Bearer test-key' },
        }), { env: fixture.context.env })
        const headerResponse = await new ModelsEndpoint().handle(headerContext)
        expect((await headerResponse.json() as { data: { id: string }[] }).data.map((model) => model.id)).toEqual(['combo-visible'])

        const invalidContext = new Context<HonoCustomType>(new Request('https://example.test/v1/models?key=wrong'), { env: fixture.context.env })
        expect((await new ModelsEndpoint().handle(invalidContext)).status).toBe(401)
    } finally {
        fixture.close()
    }
})
