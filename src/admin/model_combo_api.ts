import { Context } from "hono";
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";
import { ModelComboEntry, parseModelComboEntries } from "../model-combos";

const ModelComboEntrySchema = z.object({
    channel_key: z.string().min(1).optional(),
    provider_name: z.string().min(1).optional(),
    model_id: z.string().min(1),
}).refine((entry) => Boolean(entry.channel_key || entry.provider_name), {
    message: "channel_key or provider_name is required",
});

const ModelComboSchema = z.object({
    model_name: z.string().min(1),
    model_id: z.string().min(1),
    provider_models: z.array(ModelComboEntrySchema).min(1),
    enabled: z.boolean().optional(),
});

const normalizeEntries = (entries: unknown[]): ModelComboEntry[] => entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    const channelKey = typeof value.channel_key === "string"
        ? value.channel_key
        : typeof value.provider_name === "string" ? value.provider_name : "";
    const modelId = typeof value.model_id === "string" ? value.model_id : "";
    return channelKey.trim() && modelId.trim()
        ? [{ channel_key: channelKey.trim(), model_id: modelId.trim() }]
        : [];
});

export class ModelComboGetEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Get model combos",
        responses: { ...CommonSuccessfulResponse(z.array(z.any())), ...CommonErrorResponse },
    };

    async handle(c: Context<HonoCustomType>) {
        const result = await c.env.DB.prepare(
            `SELECT model_name, model_id, provider_models, enabled
             FROM model_combo ORDER BY model_name ASC`
        ).all();

        return {
            success: true,
            data: (result.results || []).map((row) => ({
                model_name: row.model_name,
                model_id: row.model_id,
                provider_models: parseModelComboEntries(String(row.provider_models || "[]")),
                enabled: Number(row.enabled) === 1,
            })),
        };
    }
}

export class ModelComboUpsertEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Create or update a model combo",
        request: {
            body: { content: { "application/json": { schema: ModelComboSchema } } },
        },
        responses: { ...CommonSuccessfulResponse(z.any()), ...CommonErrorResponse },
    };

    async handle(c: Context<HonoCustomType>) {
        const body = await c.req.json<z.infer<typeof ModelComboSchema>>().catch(() => null);
        if (!body) return c.text("Invalid JSON body", 400);

        const modelName = typeof body.model_name === "string" ? body.model_name.trim() : "";
        const modelId = typeof body.model_id === "string" ? body.model_id.trim() : "";
        const entries = Array.isArray(body.provider_models) ? normalizeEntries(body.provider_models) : [];
        if (!modelName || !modelId || entries.length === 0) {
            return c.text("model_name, model_id and provider_models are required", 400);
        }

        await c.env.DB.prepare(
            `INSERT INTO model_combo (model_name, model_id, provider_models, enabled, round_robin_cursor)
             VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(model_name) DO UPDATE SET
                model_id = excluded.model_id,
                provider_models = excluded.provider_models,
                enabled = excluded.enabled,
                round_robin_cursor = 0,
                updated_at = datetime('now')`
        ).bind(modelName, modelId, JSON.stringify(entries), body.enabled === false ? 0 : 1).run();

        return {
            success: true,
            data: { model_name: modelName, model_id: modelId, provider_models: entries, enabled: body.enabled !== false },
        };
    }
}

export class ModelComboDeleteEndpoint extends OpenAPIRoute {
    schema = {
        tags: ["Admin API"],
        summary: "Delete a model combo",
        request: { params: z.object({ modelName: z.string() }) },
        responses: { ...CommonSuccessfulResponse(z.boolean()), ...CommonErrorResponse },
    };

    async handle(c: Context<HonoCustomType>) {
        const modelName = c.req.param("modelName");
        const result = await c.env.DB.prepare("DELETE FROM model_combo WHERE model_name = ?").bind(modelName).run();
        if (!result.meta?.changes) return c.text("Model combo not found", 404);
        return { success: true, data: true };
    }
}
