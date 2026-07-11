import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapPeterSession, clearPeterSession } from "@/peter/session";
import { getStorageDatabaseName } from "@/peter/storage-scope";

afterEach(() => {
    clearPeterSession();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
});

describe("PeterAI bootstrap", () => {
    it("verifies the user, removes the JWT from the URL, and only keeps it in sessionStorage", async () => {
        window.history.replaceState(null, "", "/canvas?mode=recent&token=jwt-secret&src_host=https%3A%2F%2Fapi.peterai.cc.cd&ui_mode=embedded&user_id=999");
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input);
                if (url.includes("/auth/me")) return json({ code: 0, data: { id: 42, username: "peter" } });
                if (url.includes("/keys")) return json({ code: 0, data: { items: [] } });
                if (url.includes("/image-generation/options")) return json({ code: 0, data: { keys: [] } });
                if (url.includes("/channels/available")) return json({ code: 0, data: [] });
                throw new Error(`unexpected request ${url}`);
            }),
        );
        const session = await bootstrapPeterSession();
        expect(session.user.id).toBe(42);
        expect(getStorageDatabaseName()).toBe("peterai-canvas:42");
        expect(window.location.search).not.toContain("token");
        expect(window.location.search).not.toContain("user_id");
        expect(Object.values(window.localStorage)).not.toContain("jwt-secret");
        expect(window.sessionStorage.getItem("peterai-canvas:peter-session:v1")).toContain("jwt-secret");
    });

    it("rejects an untrusted src_host before sending credentials", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        window.history.replaceState(null, "", "/canvas?token=jwt-secret&src_host=https%3A%2F%2Fevil.example");
        await expect(bootstrapPeterSession()).rejects.toThrow("来源地址不受信任");
        expect(fetchMock).not.toHaveBeenCalled();
        expect(window.location.search).not.toContain("token");
    });

    it("does not reuse a recovered origin for a newly supplied token", async () => {
        window.sessionStorage.setItem("peterai-canvas:peter-session:v1", JSON.stringify({ token: "old-token", userId: 1, srcHost: "https://api.peterai.cc.cd" }));
        window.history.replaceState(null, "", "/canvas?token=new-token");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        await expect(bootstrapPeterSession()).rejects.toThrow("来源地址不受信任");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("intersects discovered models with authoritative PeterAI metadata", async () => {
        window.history.replaceState(null, "", "/canvas?token=user-jwt&src_host=https%3A%2F%2Fapi.peterai.cc.cd");
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                if (url.includes("/auth/me")) return json({ code: 0, data: { id: 42 } });
                if (url.includes("/keys"))
                    return json({ code: 0, data: { items: [
                        { id: 1, key: "image-key", name: "Image", status: "active", group_id: 7 },
                        { id: 2, key: "video-key", name: "Video", status: "active", group_id: 8 },
                    ] } });
                if (url.includes("/image-generation/options")) return json({ code: 0, data: { keys: [{ id: 1, key: "image-key", name: "Image", group_id: 7, group_name: "OpenAI", models: ["gpt-image-2"], prices_by_model: { "gpt-image-2": { "1K": 0.1 } } }] } });
                if (url.includes("/channels/available")) return json({ code: 0, data: [{ platforms: [
                    { platform: "openai", groups: [{ id: 7 }], supported_models: [{ name: "gpt-5.5" }, { name: "mystery-model" }, { name: "gpt-4o-mini-tts" }] },
                    { platform: "grok", groups: [{ id: 8 }], supported_models: [{ name: "grok-imagine-video-1.5" }, { name: "grok-4" }] },
                ] }] });
                if (url.includes("/v1/models")) {
                    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
                    return json({ data: authorization === "Bearer image-key"
                        ? [{ id: "gpt-image-2" }, { id: "gpt-5.5" }, { id: "mystery-model" }, { id: "gpt-4o-mini-tts" }]
                        : [{ id: "grok-imagine-video-1.5" }, { id: "grok-4" }] });
                }
                throw new Error(`unexpected request ${url}`);
            }),
        );

        const session = await bootstrapPeterSession();
        expect(session.channels).toHaveLength(2);
        expect(session.channels[0].capabilities).toEqual({ image: ["gpt-image-2"], video: [], audio: [], text: ["gpt-5.5"] });
        expect(session.channels[0].models).not.toContain("mystery-model");
        expect(session.channels[0].models).not.toContain("gpt-4o-mini-tts");
        expect(session.channels[1].capabilities.video).toEqual(["grok-imagine-video-1.5"]);
        expect(session.channels[1].capabilities.text).toEqual(["grok-4"]);
    });

    it("clears recovered credentials and storage scope after a 401", async () => {
        window.sessionStorage.setItem("peterai-canvas:peter-session:v1", JSON.stringify({ token: "forged-token", userId: 42, srcHost: "https://api.peterai.cc.cd" }));
        window.history.replaceState(null, "", "/canvas");
        vi.stubGlobal("fetch", vi.fn(async () => json({ code: 1001, message: "unauthorized" }, 401)));

        await expect(bootstrapPeterSession()).rejects.toThrow("登录已失效");
        expect(window.sessionStorage.getItem("peterai-canvas:peter-session:v1")).toBeNull();
        expect(getStorageDatabaseName()).toBe("peterai-canvas:guest");
    });
});

function json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
