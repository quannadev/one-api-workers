export type ModelComboEntry = {
    channel_key: string;
    model_id: string;
};

export type ModelCombo = {
    model_name: string;
    model_id: string;
    provider_models: string;
    enabled: number;
    round_robin_cursor: number;
};

export const findComboModelMapping = (config: ChannelConfig, modelId: string): ChannelModelMapping | null => {
    const exact = config.models?.find((model) => model.id.toLowerCase() === modelId.toLowerCase());
    if (exact) return exact.enabled === false ? null : exact;
    return findChannelModelMapping(config, modelId);
};

export const getComboBillingModel = async (
    c: Context<HonoCustomType>,
    comboId: string,
    mapping: ChannelModelMapping,
    config: ChannelConfig,
    globalPricing?: Record<string, ModelPricing> | null,
): Promise<string> => {
    const comboPrice = await TokenUtils.getPricing(c, comboId, config, globalPricing);
    return comboPrice ? comboId : mapping.name;
};

export const parseModelComboEntries = (raw: string): ModelComboEntry[] => {
    try {
        const value: unknown = JSON.parse(raw);
        if (!Array.isArray(value)) return [];

        return value.flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const candidate = entry as Record<string, unknown>;
            const channelKey = typeof candidate.channel_key === "string"
                ? candidate.channel_key
                : typeof candidate.provider_name === "string"
                    ? candidate.provider_name
                    : "";
            const modelId = typeof candidate.model_id === "string" ? candidate.model_id : "";
            return channelKey.trim() && modelId.trim()
                ? [{ channel_key: channelKey.trim(), model_id: modelId.trim() }]
                : [];
        });
    } catch {
        return [];
    }
};

export const rotateModelComboEntries = <T>(entries: T[], startIndex: number): T[] => {
    if (entries.length === 0) return [];
    const offset = ((startIndex % entries.length) + entries.length) % entries.length;
    return entries.slice(offset).concat(entries.slice(0, offset));
};

export const claimModelComboStartIndex = async (
    db: D1Database,
    modelId: string,
    entryCount: number,
): Promise<number | null> => {
    if (entryCount < 1) return null;

    const row = await db.prepare(
        `UPDATE model_combo
         SET round_robin_cursor = (round_robin_cursor + 1) % ?
         WHERE model_id = ? AND enabled = 1
         RETURNING ((round_robin_cursor + ? - 1) % ?) AS start_index`
    ).bind(entryCount, modelId, entryCount, entryCount).first<{ start_index: number }>();

    return row ? Number(row.start_index) : null;
};
import { Context } from "hono";
import { TokenUtils } from "./admin/token_utils";
import { findChannelModelMapping } from "./utils";

