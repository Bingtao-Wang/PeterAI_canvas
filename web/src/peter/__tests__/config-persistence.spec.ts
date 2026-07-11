import { describe, expect, it } from "vitest";

import { defaultConfig, sanitizePersistedConfig } from "@/stores/use-config-store";

describe("PeterAI managed channel persistence", () => {
    it("removes managed API keys while retaining manual third-party keys", () => {
        const persisted = sanitizePersistedConfig({
            ...defaultConfig,
            apiKey: "managed-secret",
            channels: [
                { id: "manual", name: "Manual", baseUrl: "https://example.com/v1", apiKey: "manual-secret", apiFormat: "openai", models: ["custom-model"], source: "manual" },
                { id: "peter-1", name: "Peter", baseUrl: "/peter-api", apiKey: "managed-secret", apiFormat: "openai", models: ["gpt-image-2"], source: "peterai", pricesByModel: { "gpt-image-2": { "1K": 0.1 } } },
            ],
        });

        expect(persisted.apiKey).toBe("");
        expect(persisted.channels[0].apiKey).toBe("manual-secret");
        expect(persisted.channels[1].apiKey).toBe("");
        expect(persisted.channels[1].pricesByModel).toBeUndefined();
        expect(JSON.stringify(persisted)).not.toContain("managed-secret");
    });
});
