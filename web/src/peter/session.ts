import { resetStorageScope, setStorageUserId } from "@/peter/storage-scope";

export type PeterPriceTier = "1K" | "2K" | "4K";
export type PeterCapability = "image" | "video" | "text" | "audio";

export type PeterManagedChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: "openai";
    models: string[];
    source: "peterai";
    keyId: number;
    groupId: number;
    capabilities: Record<PeterCapability, string[]>;
    pricesByModel?: Record<string, Partial<Record<PeterPriceTier, number | null>>>;
};

export type PeterSession = {
    token: string;
    user: { id: number; username?: string; email?: string; display_name?: string };
    srcHost: string;
    embedded: boolean;
    theme?: "light" | "dark";
    lang?: string;
    channels: PeterManagedChannel[];
};

type Envelope<T> = { code?: number; message?: string; data?: T } | T;
type ApiKeyItem = {
    id: number;
    key: string;
    name: string;
    status: string;
    group_id?: number | null;
    group?: { id?: number; name?: string; platform?: string } | null;
    quota?: number;
    quota_used?: number;
    expires_at?: string | null;
};
type ImageOption = {
    id: number;
    key: string;
    name: string;
    group_id: number;
    group_name: string;
    models: string[];
    prices_by_model?: Record<string, Partial<Record<PeterPriceTier, number | null>>>;
};

const SESSION_KEY = "peterai-canvas:peter-session:v1";
const DEFAULT_ALLOWED_ORIGINS = [
    "https://api.peterai.cc.cd",
    "https://api.peteraix.com",
    "http://127.0.0.1:18080",
    "http://localhost:18080",
];

let currentSession: PeterSession | null = null;

export async function bootstrapPeterSession(): Promise<PeterSession> {
    const params = new URLSearchParams(window.location.search);
    const queryToken = params.get("token")?.trim() || "";
    const querySrcHost = normalizeOrigin(params.get("src_host") || "");
    const embedded = params.get("ui_mode") === "embedded" && window.self !== window.top;
    const theme: PeterSession["theme"] = params.get("theme") === "dark" ? "dark" : params.get("theme") === "light" ? "light" : undefined;
    const lang = params.get("lang")?.trim() || undefined;
    const recovered = readStoredSession();
    const token = queryToken || recovered?.token || "";
    const srcHost = queryToken ? querySrcHost : querySrcHost || recovered?.srcHost || "";

    cleanSensitiveQuery(params);
    if (!token) {
        clearPeterSession();
        throw new Error("请先登录 PeterAI，再从侧边栏进入 PeterAI 画布");
    }
    if (!allowedOrigins().has(srcHost)) {
        clearPeterSession();
        throw new Error("PeterAI 来源地址不受信任");
    }

    try {
        const user = await fetchEnvelope<PeterSession["user"]>("/peter-api/api/v1/auth/me", token);
        if (!Number.isInteger(Number(user.id)) || Number(user.id) <= 0) throw new Error("PeterAI 用户信息无效");
        setStorageUserId(user.id);
        const sessionBase: Omit<PeterSession, "channels"> = { token, user: { ...user, id: Number(user.id) }, srcHost, embedded, theme, lang };
        writeStoredSession(sessionBase);
        const channels = await loadManagedChannels(token);
        const session: PeterSession = { ...sessionBase, channels };
        currentSession = session;
        return session;
    } catch (error) {
        if (isUnauthorized(error)) clearPeterSession();
        throw error;
    }
}

export function getPeterSession() {
    return currentSession;
}

export function getPeterManagedChannels() {
    return currentSession?.channels || [];
}

export function clearPeterSession() {
    const hadSession = Boolean(currentSession);
    currentSession?.channels.forEach((channel) => {
        channel.apiKey = "";
    });
    currentSession = null;
    resetStorageScope();
    try {
        window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
        // sessionStorage can be unavailable in hardened browsers.
    }
    if (hadSession) window.dispatchEvent(new CustomEvent("peterai:session-invalid"));
}

async function loadManagedChannels(token: string): Promise<PeterManagedChannel[]> {
    const [keyPage, imagePayload, availableChannels] = await Promise.all([
        fetchEnvelope<{ items?: ApiKeyItem[] } | ApiKeyItem[]>("/peter-api/api/v1/keys?status=active&page=1&page_size=500", token),
        fetchEnvelope<{ keys?: ImageOption[] }>("/peter-api/api/v1/user/image-generation/options", token),
        fetchEnvelope<Array<{ platforms?: Array<{ platform?: string; groups?: Array<{ id?: number }>; supported_models?: Array<{ name?: string }> }> }>>("/peter-api/api/v1/channels/available", token).catch((error) => {
            if (isUnauthorized(error)) throw error;
            return [];
        }),
    ]);
    const keys = (Array.isArray(keyPage) ? keyPage : keyPage.items || []).filter(isUsableKey);
    const imageOptions = imagePayload.keys || [];
    const imageByKey = new Map(imageOptions.map((item) => [Number(item.id), item]));
    const supportedByGroup = supportedModelsByGroup(availableChannels);
    const channels = await mapWithConcurrency<ApiKeyItem, PeterManagedChannel | null>(keys, 4, async (key) => {
        const groupId = Number(key.group_id || key.group?.id || 0);
        if (!groupId || !key.key?.trim()) return null;
        const fetchedModels: string[] = await fetchModels(key.key).catch(() => []);
        const imageOption = imageByKey.get(Number(key.id));
        const imageModels = unique((imageOption?.models || []).filter((model) => fetchedModels.includes(model)));
        const groupMetadata = supportedByGroup.get(groupId);
        const intersected = groupMetadata ? fetchedModels.filter((model) => groupMetadata.models.has(model) && !imageModels.includes(model)) : [];
        const videoModels = intersected.filter(isVideoModel);
        const audioModels = intersected.filter(isAudioModel);
        const textModels = intersected.filter((model) => !videoModels.includes(model) && !audioModels.includes(model) && isTextModel(model));
        const visibleModels = unique([...imageModels, ...intersected]);
        if (!visibleModels.length) return null;
        return {
            id: `peter-${key.id}`,
            name: `${key.name || `Key ${key.id}`} · ${key.group?.name || imageOption?.group_name || `分组 ${groupId}`}`,
            baseUrl: `${window.location.origin}/peter-api`,
            apiKey: key.key,
            apiFormat: "openai" as const,
            models: visibleModels,
            source: "peterai" as const,
            keyId: Number(key.id),
            groupId,
            capabilities: { image: imageModels, video: videoModels, audio: audioModels, text: textModels },
            pricesByModel: imageOption?.prices_by_model,
        };
    });
    return channels.filter((channel): channel is PeterManagedChannel => channel !== null);
}

async function fetchModels(apiKey: string) {
    const response = await fetch("/peter-api/v1/models", {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
    });
    if (!response.ok) throw new Error(`模型加载失败（${response.status}）`);
    const payload = (await response.json()) as { data?: Array<{ id?: string }>; error?: { message?: string } };
    if (payload.error?.message) throw new Error(payload.error.message);
    return unique((payload.data || []).map((item) => item.id || "").filter(Boolean));
}

async function fetchEnvelope<T>(path: string, token: string): Promise<T> {
    const response = await fetch(path, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        cache: "no-store",
    });
    if (!response.ok) {
        const error = new Error(response.status === 401 ? "PeterAI 登录已失效，请重新登录" : `PeterAI 接口请求失败（${response.status}）`);
        (error as Error & { status?: number }).status = response.status;
        throw error;
    }
    const payload = (await response.json()) as Envelope<T>;
    if (payload && typeof payload === "object" && "code" in payload) {
        const envelope = payload as { code?: number; message?: string; data?: T };
        if (envelope.code !== undefined && envelope.code !== 0) throw new Error(envelope.message || "PeterAI 接口请求失败");
        return envelope.data as T;
    }
    return payload as T;
}

function cleanSensitiveQuery(params: URLSearchParams) {
    ["token", "user_id", "src_url", "apiKey", "apikey", "api_key"].forEach((key) => params.delete(key));
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

function allowedOrigins() {
    const configured = String(import.meta.env.VITE_PETERAI_ALLOWED_ORIGINS || "")
        .split(",")
        .map(normalizeOrigin)
        .filter(Boolean);
    return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function normalizeOrigin(value: string) {
    try {
        return new URL(value).origin;
    } catch {
        return "";
    }
}

function readStoredSession(): { token: string; userId: number; srcHost: string } | null {
    try {
        const value = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null") as { token?: string; userId?: number; srcHost?: string } | null;
        if (!value?.token || !value.userId || !value.srcHost || jwtExpired(value.token)) return null;
        return { token: value.token, userId: value.userId, srcHost: value.srcHost };
    } catch {
        return null;
    }
}

function writeStoredSession(session: { token: string; user: { id: number }; srcHost: string }) {
    try {
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: session.token, userId: session.user.id, srcHost: session.srcHost }));
    } catch {
        // A reload will require reopening the PeterAI menu when storage is unavailable.
    }
}

function jwtExpired(token: string) {
    try {
        const encoded = token.split(".")[1];
        if (!encoded) return false;
        const payload = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
        return Boolean(payload.exp && payload.exp * 1000 <= Date.now());
    } catch {
        return false;
    }
}

function isUnauthorized(error: unknown) {
    return error instanceof Error && ((error as Error & { status?: number }).status === 401 || error.message.includes("登录已失效"));
}

function isUsableKey(key: ApiKeyItem) {
    if (key.status !== "active" || !key.key?.trim()) return false;
    if (key.expires_at && Date.parse(key.expires_at) <= Date.now()) return false;
    return !(Number(key.quota || 0) > 0 && Number(key.quota_used || 0) >= Number(key.quota));
}

function supportedModelsByGroup(channels: Array<{ platforms?: Array<{ platform?: string; groups?: Array<{ id?: number }>; supported_models?: Array<{ name?: string }> }> }>) {
    const result = new Map<number, { models: Set<string>; platform: string }>();
    channels.forEach((channel) =>
        (channel.platforms || []).forEach((platform) => {
            const models = unique((platform.supported_models || []).map((item) => item.name || "").filter(Boolean));
            (platform.groups || []).forEach((group) => {
                if (!group.id) return;
                const metadata = result.get(group.id) || { models: new Set<string>(), platform: platform.platform || "" };
                models.forEach((model) => metadata.models.add(model));
                result.set(group.id, metadata);
            });
        }),
    );
    return result;
}

function isVideoModel(model: string) {
    const value = model.toLowerCase();
    return ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"].some((part) => value.includes(part));
}

function isAudioModel(model: string) {
    const value = model.toLowerCase();
    return ["audio", "tts", "speech", "voice", "music", "sound"].some((part) => value.includes(part));
}

function isTextModel(model: string) {
    const value = model.toLowerCase();
    if (isVideoModel(model) || isAudioModel(model) || ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"].some((part) => value.includes(part))) return false;
    return ["gpt-", "chatgpt-", "claude-", "gemini-", "deepseek-", "qwen", "glm-", "grok-", "mistral", "mixtral", "llama", "command-", "doubao", "kimi", "moonshot", "yi-", "o1", "o3", "o4"].some((part) => value.startsWith(part) || value.includes(`/${part}`));
}

function unique(values: string[]) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
    const output = new Array<R>(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (next < items.length) {
                const index = next++;
                output[index] = await mapper(items[index]);
            }
        }),
    );
    return output;
}
