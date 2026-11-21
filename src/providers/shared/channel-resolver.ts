import { Context } from "hono"
import { getApiKeyFromHeaders, fetchTokenData, fetchChannelsForToken } from "./auth"
import { RouteId, getRoutePolicy } from "./route-policy"
import { findChannelModelMapping, getJsonSetting } from "../../utils"
import { CONSTANTS } from "../../constants"
import { TokenUtils } from "../../admin/token_utils"
import { normalizeChannelConfig } from "../../channel-config"
import { claimModelComboStartIndex, findComboModelMapping, getComboBillingModel, parseModelComboEntries, rotateModelComboEntries } from "../../model-combos"
import {
    buildUsageRequestMetadata,
    hashTokenKey,
    writeUsageFailureEvent,
    writeUsageSuccessEvent,
} from "../../analytics/usage-logger"

export type ResolvedChannelCandidate = {
    key: string
    config: ChannelConfig
    mapping: ChannelModelMapping
    billingModel?: string
}

export type ChannelResolution = {
    channels: ResolvedChannelCandidate[]
    initialChannel: ResolvedChannelCandidate
    requestBody: any
    saveUsage: (usage: Usage) => Promise<void>
    logFailure: (errorCode: string, errorSummary?: string) => void
    trackingState: RequestTrackingState
    setActiveChannel: (channel: ResolvedChannelCandidate) => void
    fallbackOrder: "priority" | "round_robin"
}

export const pickHighestPriorityChannel = (
    channels: ResolvedChannelCandidate[]
): ResolvedChannelCandidate => {
    const maxWeight = channels.reduce((highest, current) => {
        return Math.max(highest, current.config.weight ?? 0);
    }, 0);
    const highestPriorityChannels = channels.filter((channel) => {
        return (channel.config.weight ?? 0) === maxWeight;
    });
    const randomIndex = Math.floor(Math.random() * highestPriorityChannels.length);
    return highestPriorityChannels[randomIndex];
}

export const resolveChannel = async (
    c: Context<HonoCustomType>,
    routeId: RouteId
): Promise<ChannelResolution | Response> => {
    const apiKey = getApiKeyFromHeaders(c);
    if (!apiKey) {
        return c.text("Authorization header or x-api-key not found", 401);
    }

    const tokenInfo = await fetchTokenData(c, apiKey);
    if (!tokenInfo) {
        return c.text("Invalid API key", 401);
    }

    const { tokenData, usage } = tokenInfo;

    const channelsResult = await fetchChannelsForToken(c, tokenData);

    if (!channelsResult.results || channelsResult.results.length === 0) {
        return c.text("No available channels for this token", 401);
    }

    let requestBody: any;
    try {
        requestBody = c.req.header("content-type")?.startsWith("multipart/form-data")
            ? await c.req.formData()
            : await c.req.json();
    } catch (error) {
        return c.text("Invalid JSON body", 400);
    }
    const requestedModel = requestBody instanceof FormData ? requestBody.get("model") : requestBody?.model;
    if (typeof requestedModel !== "string" || !requestedModel) {
        return c.text("Model is required", 400);
    }

    const policy = getRoutePolicy(routeId);
    const allowedTypes = policy.allowedTypes;

    let availableChannels: ResolvedChannelCandidate[] = [];
    let hasDisabledMatchingChannel = false;
    let fallbackOrder: ChannelResolution["fallbackOrder"] = "priority";

    const comboRow = await c.env.DB.prepare(
        `SELECT model_id, provider_models
         FROM model_combo WHERE model_id = ? AND enabled = 1`
    ).bind(requestedModel).first<{ model_id: string; provider_models: string }>();

    if (comboRow) {
        const entries = parseModelComboEntries(comboRow.provider_models);
        if (entries.length === 0) {
            return c.text(`Model combo has no provider models: ${requestedModel}`, 503);
        }
        const startIndex = await claimModelComboStartIndex(c.env.DB, requestedModel, entries.length);
        if (startIndex === null) {
            return c.text(`Model combo is unavailable: ${requestedModel}`, 503);
        }

        const rowsByKey = new Map((channelsResult.results || []).map((row) => [row.key, row]));
        for (const entry of rotateModelComboEntries(entries, startIndex)) {
            const row = rowsByKey.get(entry.channel_key);
            if (!row) continue;

            const config = (() => {
                try {
                    return normalizeChannelConfig(JSON.parse(row.value) as ChannelConfig);
                } catch {
                    return null;
                }
            })();
            if (!config) continue;
            if (allowedTypes && (!config.type || !allowedTypes.includes(config.type))) continue;
            if (!config.enabled) {
                hasDisabledMatchingChannel = true;
                continue;
            }

            const sourceMapping = findComboModelMapping(config, entry.model_id);
            if (!sourceMapping) continue;
            const mapping: ChannelModelMapping = {
                ...(sourceMapping || {}),
                id: entry.model_id,
                name: requestedModel,
                enabled: true,
            };
            const billingModel = await getComboBillingModel(c, requestedModel, sourceMapping, config);
            availableChannels.push({ key: row.key, config, mapping, billingModel });
        }
        if (availableChannels.length === 0) {
            return c.text(`No enabled channels available for model combo: ${requestedModel}`, 503);
        }
        fallbackOrder = "round_robin";
    }

    if (!comboRow) for (const row of channelsResult.results) {
        const config = (() => {
            try {
                return normalizeChannelConfig(JSON.parse(row.value) as ChannelConfig);
            } catch {
                return null;
            }
        })();
        if (!config) {
            console.error(`Invalid channel config for key: ${row.key}`);
            continue;
        }

        if (allowedTypes && (!config.type || !allowedTypes.includes(config.type))) {
            continue;
        }

        const mapping = findChannelModelMapping(config, requestedModel);
        if (!mapping) {
            continue;
        }

        if (!config.enabled) {
            hasDisabledMatchingChannel = true;
            continue;
        }

        availableChannels.push({
            key: row.key,
            config: config,
            mapping,
        });
    }

    if (availableChannels.length === 0) {
        if (hasDisabledMatchingChannel) {
            return c.text(`No enabled channels available for model: ${requestedModel}. Please enable a channel first.`, 503);
        }
        return c.text(`Model not supported: ${requestedModel}. Please configure models.`, 400);
    }

    const requestedChannelKey = c.req.raw.headers.get('x-channel-key')?.trim();
    if (requestedChannelKey) {
        const hasTokenAccessToChannel = channelsResult.results.some((row) => row.key === requestedChannelKey);
        if (!hasTokenAccessToChannel) {
            return c.text(`Token is not allowed to use channel: ${requestedChannelKey}`, 403);
        }

        const selectedChannel = availableChannels.find((channel) => channel.key === requestedChannelKey);
        if (!selectedChannel) {
            return c.text(`Channel does not support this route or model: ${requestedChannelKey}`, 400);
        }

        availableChannels = [selectedChannel];
    }

    if (!TokenUtils.hasRemainingQuota(tokenData.total_quota, usage)) {
        // 一次性读取全局定价，避免对每个渠道重复查询
        const globalPricing = await getJsonSetting<Record<string, ModelPricing>>(c, CONSTANTS.MODEL_PRICING_KEY);
        const freeChannels = await Promise.all(
            availableChannels.map(async (channel) => ({
                channel,
                requiresPaidQuota: await TokenUtils.modelRequiresPaidQuota(c, channel.billingModel || requestedModel, channel.config, globalPricing),
            }))
        );

        availableChannels = freeChannels
            .filter((item) => !item.requiresPaidQuota)
            .map((item) => item.channel);

        if (availableChannels.length === 0) {
            return c.text("Quota exceeded for paid models", 402);
        }
    }

    const selectedChannel = fallbackOrder === "round_robin"
        ? availableChannels[0]
        : pickHighestPriorityChannel(availableChannels);
    const trackingState: RequestTrackingState = {
        retryCount: 0,
    };
    const requestStartedAt = Date.now();
    const tokenHash = await hashTokenKey(apiKey);
    const tokenName = tokenData.name?.trim() || "未命名令牌";
    const requestMetadata = buildUsageRequestMetadata(c);
    const usageContext = {
        routeId,
        tokenHash,
        tokenName,
        channelKey: selectedChannel.key,
        providerType: selectedChannel.config.type || "unknown",
        requestedModel,
        upstreamModel: selectedChannel.mapping.id,
        streamMode: requestBody.stream ? "stream" as const : "sync" as const,
        requestId: requestMetadata.requestId,
        traceId: requestMetadata.traceId,
        clientIp: requestMetadata.clientIp,
        userAgent: requestMetadata.userAgent,
        country: requestMetadata.country,
        region: requestMetadata.region,
        city: requestMetadata.city,
        colo: requestMetadata.colo,
        timezone: requestMetadata.timezone,
        startedAt: requestStartedAt,
        trackingState,
    };
    let usageLogState: "idle" | "processing" | "done" = "idle";
    let activeChannel = selectedChannel;

    const setActiveChannel = (channel: ResolvedChannelCandidate) => {
        activeChannel = channel;
        usageContext.channelKey = channel.key;
        usageContext.providerType = channel.config.type || "unknown";
        usageContext.upstreamModel = channel.mapping.id;
    };

    const saveUsage = async (usage: Usage) => {
        if (usageLogState !== "idle") {
            return;
        }

        usageLogState = "processing";
        try {
            const costResult = await TokenUtils.processUsage(
                c,
                apiKey,
                activeChannel.billingModel || requestedModel,
                activeChannel.key,
                activeChannel.config,
                usage
            );

            if (costResult.quotaExceeded) {
                writeUsageFailureEvent(c, usageContext, {
                    errorCode: "quota_exceeded",
                    errorSummary: `Usage charge rejected: token quota exceeded (cost: ${costResult.totalCost})`,
                });
            } else {
                writeUsageSuccessEvent(c, usageContext, usage, costResult);
            }
            usageLogState = "done";
        } catch (error) {
            usageLogState = "idle";
            console.error('Error processing usage:', error);
        }
    };

    const logFailure = (errorCode: string, errorSummary?: string) => {
        if (usageLogState === "done") {
            return;
        }

        writeUsageFailureEvent(c, usageContext, { errorCode, errorSummary });
    };

    return {
        channels: availableChannels,
        initialChannel: selectedChannel,
        requestBody,
        saveUsage,
        logFailure,
        trackingState,
        setActiveChannel,
        fallbackOrder,
    };
}
