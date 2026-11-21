export type RouteId = "chat-completions" | "messages" | "responses" | "audio-speech" | "images-generations" | "images-edits" | "audio-transcriptions" | "audio-translations" | "rerank"

type RoutePolicy = {
    allowedTypes: ChannelType[] | null
}

const CHAT_COMPLETIONS_CHANNEL_TYPES: ChannelType[] = [
    "openai",
    "azure-openai",
    "gemini",
]

const MESSAGES_CHANNEL_TYPES: ChannelType[] = [
    "claude",
    "claude-to-openai",
]

const ROUTE_POLICIES: Record<RouteId, RoutePolicy> = {
    "chat-completions": { allowedTypes: CHAT_COMPLETIONS_CHANNEL_TYPES },
    "messages":         { allowedTypes: MESSAGES_CHANNEL_TYPES },
    "responses":        { allowedTypes: ["openai-responses", "azure-openai-responses"] },
    "audio-speech":     { allowedTypes: ["openai-audio", "azure-openai-audio"] },
    "images-generations": { allowedTypes: ["openai", "azure-openai"] },
    "images-edits": { allowedTypes: ["openai", "azure-openai"] },
    "audio-transcriptions": { allowedTypes: ["openai", "azure-openai", "openai-audio", "azure-openai-audio"] },
    "audio-translations": { allowedTypes: ["openai", "azure-openai", "openai-audio", "azure-openai-audio"] },
    "rerank": { allowedTypes: ["openai", "azure-openai"] },
}

export const resolveRouteId = (pathname: string): RouteId | null => {
    if (pathname.endsWith("/chat/completions")) return "chat-completions"
    if (pathname.endsWith("/messages")) return "messages"
    if (pathname.endsWith("/responses")) return "responses"
    if (pathname.endsWith("/audio/speech")) return "audio-speech"
    if (pathname.endsWith("/images/generations")) return "images-generations"
    if (pathname.endsWith("/images/edits")) return "images-edits"
    if (pathname.endsWith("/audio/transcriptions")) return "audio-transcriptions"
    if (pathname.endsWith("/audio/translations")) return "audio-translations"
    if (pathname.endsWith("/rerank")) return "rerank"
    return null
}

export const getRoutePolicy = (routeId: RouteId): RoutePolicy => {
    return ROUTE_POLICIES[routeId]
}
