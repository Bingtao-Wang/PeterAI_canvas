import { describe, expect, it } from "vitest";

import { buildApiUrl, defaultConfig, mergeCapabilityModels, sanitizePersistedConfig } from "@/stores/use-config-store";

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

    it("retains a manually classified verified model without adding it to defaults", () => {
        const channels = [{
            id: "peter-1",
            name: "Peter",
            baseUrl: "/peter-api",
            apiKey: "runtime-only",
            apiFormat: "openai" as const,
            models: ["gpt-5.5", "verified-unknown"],
            source: "peterai" as const,
            capabilities: { text: ["gpt-5.5"] },
        }];

        expect(mergeCapabilityModels([], channels, "text")).toEqual(["peter-1::gpt-5.5"]);
        expect(mergeCapabilityModels(["peter-1::verified-unknown"], channels, "text")).toEqual(["peter-1::verified-unknown", "peter-1::gpt-5.5"]);
    });

    it("routes manually entered PeterAI URLs through the same-origin allowlisted proxy", () => {
        expect(buildApiUrl("https://api.peterai.cc.cd/v1", "/models")).toBe("/peter-api/v1/models");
        expect(buildApiUrl("https://api.peteraix.com", "/responses")).toBe("/peter-api/v1/responses");
        expect(buildApiUrl("https://example.com/v1", "/models")).toBe("https://example.com/v1/models");
    });
});
