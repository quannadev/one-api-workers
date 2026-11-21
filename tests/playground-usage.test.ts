import { expect, test } from 'bun:test'
import { checkoutUsageData } from '../src/providers/shared/openai-stream-utils'

test('charges request-priced endpoints without a usage object once', async () => {
    const usages: Usage[] = []
    await checkoutUsageData(async (usage) => { usages.push(usage) }, Response.json({ data: [] }), {}, true)
    expect(usages).toEqual([{ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }])
})

test('normalizes image token usage for existing billing', async () => {
    const usages: Usage[] = []
    await checkoutUsageData(async (usage) => { usages.push(usage) }, Response.json({ usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 } }), {}, true)
    expect(usages[0].prompt_tokens).toBe(12)
    expect(usages[0].completion_tokens).toBe(6)
})
