import { expect, test } from 'bun:test'
import { getRoutePolicy, resolveRouteId } from '../src/providers/shared/route-policy'

test('routes image, audio, and reranking requests to OpenAI-compatible channels', () => {
    for (const path of ['/v1/images/generations', '/v1/images/edits', '/v1/audio/transcriptions', '/v1/audio/translations', '/v1/rerank']) {
        const route = resolveRouteId(path)
        expect(route).not.toBeNull()
        expect(getRoutePolicy(route!).allowedTypes).toContain('openai')
    }
})
