import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { getApiKeyFromHeaders, fetchTokenData, fetchChannelsForToken } from "./shared/auth";
import { getJsonSetting } from "../utils";
import { normalizeChannelConfig } from "../channel-config";
import { TokenUtils } from "../admin/token_utils";
import { CONSTANTS } from "../constants";
import { findComboModelMapping, getComboBillingModel, parseModelComboEntries } from "../model-combos";

export class ModelsEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['OpenAI Proxy'],
        summary: 'List available models',
        request: {
            query: z.object({ key: z.string().optional() }),
            headers: z.object({
                'Authorization': z.string().optional().describe("Token for authentication (OpenAI format)"),
                'x-api-key': z.string().optional().describe("API key for authentication (Claude format)"),
            }),
        },
        responses: {
            200: {
                description: 'List of available models',
                content: {
                    'application/json': {
                        schema: z.object({
                            object: z.string(),
                            data: z.array(z.object({
                                id: z.string(),
                                object: z.string(),
                                created: z.number(),
                                owned_by: z.string(),
                            })),
                        }),
                    },
                },
            },
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const apiKey = getApiKeyFromHeaders(c) || c.req.query('key')?.trim();
        if (!apiKey) {
            return c.json({ object: "list", data: [] });
        }

        const tokenInfo = await fetchTokenData(c, apiKey);
        if (!tokenInfo) {
            return c.text("Invalid API key", 401);
        }

        const channelsResult = await fetchChannelsForToken(c, tokenInfo.tokenData);

        if (!channelsResult || !channelsResult.results || channelsResult.results.length === 0) {
            return c.json({
                object: "list",
                data: [],
            });
        }

        const modelsSet = new Set<string>();
        const hasRemainingQuota = TokenUtils.hasRemainingQuota(tokenInfo.tokenData.total_quota, tokenInfo.usage);
        // 一次性读取全局定价，避免循环内对每个模型重复查询
        const globalPricing = hasRemainingQuota
            ? null
            : await getJsonSetting<Record<string, ModelPricing>>(c, CONSTANTS.MODEL_PRICING_KEY);

        const comboRows = await c.env.DB.prepare(
            `SELECT model_id, provider_models FROM model_combo WHERE enabled = 1 ORDER BY model_id`
        ).all<{ model_id: string; provider_models: string }>();
        const allowedChannels = new Map(
            (channelsResult.results || []).flatMap((row): [string, ChannelConfig][] => {
                try {
                    const config = normalizeChannelConfig(JSON.parse(row.value) as ChannelConfig);
                    return config.enabled ? [[row.key, config]] : [];
                } catch {
                    return [];
                }
            })
        );
        for (const combo of comboRows.results || []) {
            for (const entry of parseModelComboEntries(combo.provider_models)) {
                const config = allowedChannels.get(entry.channel_key);
                if (!config) continue;
                const mapping = findComboModelMapping(config, entry.model_id);
                if (!mapping) continue;
                if (!hasRemainingQuota) {
                    const billingModel = await getComboBillingModel(c, combo.model_id, mapping, config, globalPricing);
                    if (await TokenUtils.modelRequiresPaidQuota(c, billingModel, config, globalPricing)) continue;
                }
                modelsSet.add(combo.model_id);
                break;
            }
        }

        const models = Array.from(modelsSet).sort().map((modelId) => ({
            id: modelId,
            object: "model" as const,
            created: 1700000000,
            owned_by: "system",
        }));

        return c.json({
            object: "list",
            data: models,
        });
    }
}
