import { describe, expect, it } from "vitest";

import { normalizePeterImageRequestSize } from "@/peter/image-size";

describe("normalizePeterImageRequestSize", () => {
    it("maps GPT image requests to supported fixed sizes", () => {
        expect(normalizePeterImageRequestSize("gpt-image-2", "3840x2160")).toBe("1536x1024");
        expect(normalizePeterImageRequestSize("gpt-image-2", "2160x3840")).toBe("1024x1536");
        expect(normalizePeterImageRequestSize("gpt-image-2", "2048x2048")).toBe("1024x1024");
    });

    it("does not rewrite unknown compatible models", () => {
        expect(normalizePeterImageRequestSize("custom-image-model", "2048x1152")).toBe("2048x1152");
    });
});
