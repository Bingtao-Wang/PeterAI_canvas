import { describe, expect, it } from "vitest";

import { getStorageDatabaseName, scopedStorageKey, setStorageUserId } from "@/peter/storage-scope";

describe("PeterAI storage scope", () => {
    it("isolates every persistent key by verified user id", () => {
        setStorageUserId(101);
        expect(getStorageDatabaseName()).toBe("peterai-canvas:101");
        expect(scopedStorageKey("canvas_store")).toBe("peterai-canvas:101:canvas_store");
        setStorageUserId(202);
        expect(getStorageDatabaseName()).toBe("peterai-canvas:202");
        expect(scopedStorageKey("canvas_store")).not.toContain(":101:");
    });
});
