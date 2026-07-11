import { describe, expect, it } from "vitest";

import { runImageTask, runWithConcurrency } from "@/peter/concurrency";

describe("runWithConcurrency", () => {
    it("never runs more than four image tasks at once", async () => {
        let active = 0;
        let maximum = 0;
        const result = await runWithConcurrency(Array.from({ length: 15 }, (_, index) => index), 4, async (value) => {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            active -= 1;
            return value * 2;
        });
        expect(maximum).toBe(4);
        expect(result).toEqual(Array.from({ length: 15 }, (_, index) => index * 2));
    });

    it("shares one four-slot queue across independent image callers", async () => {
        let active = 0;
        let maximum = 0;
        const tasks = Array.from({ length: 12 }, (_, value) =>
            runImageTask(async () => {
                active += 1;
                maximum = Math.max(maximum, active);
                await new Promise((resolve) => setTimeout(resolve, 2));
                active -= 1;
                return value;
            }),
        );
        await expect(Promise.all(tasks)).resolves.toEqual(Array.from({ length: 12 }, (_, index) => index));
        expect(maximum).toBe(4);
    });
});
