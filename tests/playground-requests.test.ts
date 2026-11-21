import { expect, test } from 'bun:test'
import { buildPlaygroundBody, buildPlaygroundCurl } from '../frontend/src/lib/playground-requests'

test('builds a request with the selected model and rejects non-object JSON', () => {
    expect(buildPlaygroundBody('{"prompt":"draw"}', 'model-a')).toEqual({ prompt: 'draw', model: 'model-a' })
    expect(() => buildPlaygroundBody('[]', 'model-a')).toThrow()
})

test('generates a shell-safe curl with file fields and channel selection', () => {
    const curl = buildPlaygroundCurl('https://example.test', '/v1/images/edits', "sk-a'b", 'channel', { model: 'image', prompt: "it's art" }, [{ field: 'image', name: 'image' }])
    expect(curl).toContain("'Authorization: Bearer sk-a'\\''b'")
    expect(curl).toContain("'x-channel-key: channel'")
    expect(curl).toContain("'prompt=it'\\''s art'")
    expect(curl).toContain("'image=@image'")
})
