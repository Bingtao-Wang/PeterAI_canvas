import { describe, expect, it } from "vitest";

import { buildPeterGrokVideoPayload, videoResultUrl, videoTaskId } from "@/services/api/video";
import { defaultConfig } from "@/stores/use-config-store";

describe("PeterAI Grok video adapter", () => {
    it("uses the real Sub2API Grok JSON contract", () => {
        expect(
            buildPeterGrokVideoPayload(
                { ...defaultConfig, videoSeconds: "6", vquality: "720" },
                "peter-8::grok-imagine-video-1.5",
                "海边日落",
                "data:image/png;base64,AAAA",
            ),
        ).toEqual({
            model: "grok-imagine-video-1.5",
            prompt: "海边日落",
            duration: 6,
            resolution: "720p",
            image: { image_url: "data:image/png;base64,AAAA" },
        });
    });

    it("accepts xAI request_id and nested video URL responses", () => {
        expect(videoTaskId({ request_id: "video-request-1" })).toBe("video-request-1");
        expect(videoResultUrl({ status: "done", video: { url: "https://cdn.example/video.mp4" } })).toBe("https://cdn.example/video.mp4");
    });
});
