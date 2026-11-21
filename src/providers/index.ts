import { Context, Hono } from "hono"
import { fromHono, OpenAPIRoute } from 'chanfana';
import { z } from "zod";

import db from "../db"
import { resolveRouteId } from "./shared/route-policy"
import { resolveChannel } from "./shared/channel-resolver"
import { executeWithFallbackChannels } from "./shared/upstream-retry"
import { ModelsEndpoint } from "./models"

export const api = fromHono(new Hono<HonoCustomType>())

api.use("/v1/*", async (c, next) => {
    await db.ensureReady(c);
    await next();
});

class UnifiedProxyEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['OpenAI Proxy'],
        request: {
            headers: z.object({
                'Authorization': z.string().optional().describe("Token for authentication (OpenAI format)"),
                'x-api-key': z.string().optional().describe("API key for authentication (Claude format)"),
            }),
            body: { content: {
                'application/json': { schema: z.any() },
                'multipart/form-data': { schema: z.object({ model: z.string() }).passthrough() },
            } },
        },
        responses: {
            200: {
                description: 'Successful response',
            },
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const routeId = resolveRouteId(c.req.path)
        if (!routeId) {
            return c.text("Unknown route", 404)
        }

        const result = await resolveChannel(c, routeId)
        if (result instanceof Response) return result

        const { channels, initialChannel, requestBody, saveUsage, logFailure, trackingState, setActiveChannel, fallbackOrder } = result

        return executeWithFallbackChannels(
            c,
            channels,
            initialChannel,
            requestBody,
            saveUsage,
            logFailure,
            trackingState,
            setActiveChannel,
            fallbackOrder,
        )
    }
}

api.post("/v1/chat/completions", UnifiedProxyEndpoint)
api.post("/v1/messages", UnifiedProxyEndpoint)
api.post("/v1/responses", UnifiedProxyEndpoint)
api.post("/v1/audio/speech", UnifiedProxyEndpoint)
api.post("/v1/images/generations", UnifiedProxyEndpoint)
api.post("/v1/images/edits", UnifiedProxyEndpoint)
api.post("/v1/audio/transcriptions", UnifiedProxyEndpoint)
api.post("/v1/audio/translations", UnifiedProxyEndpoint)
api.post("/v1/rerank", UnifiedProxyEndpoint)
api.get("/v1/models", ModelsEndpoint)
