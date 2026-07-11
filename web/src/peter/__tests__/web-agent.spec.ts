import { afterEach, describe, expect, it, vi } from "vitest";

import { runWebAgentTool } from "@/lib/agent/web-agent-tools";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { requestToolResponse } from "@/services/api/image";
import type { AgentCanvasContext } from "@/stores/use-agent-store";
import { defaultConfig, encodeChannelModel } from "@/stores/use-config-store";

afterEach(() => vi.unstubAllGlobals());

describe("website Agent", () => {
    it("routes a PeterAI text model through the same-origin Responses proxy", async () => {
        const fetchMock = vi.fn(async () =>
            sse({
                type: "response.completed",
                response: { output: [{ type: "function_call", call_id: "call-1", name: "canvas_get_state", arguments: "{}" }] },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);
        const channel = { id: "peter-1", name: "PeterAI", baseUrl: "https://api.peterai.cc.cd", apiKey: "runtime-key", apiFormat: "openai" as const, models: ["gpt-5.5"], source: "peterai" as const };

        const result = await requestToolResponse(
            { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "gpt-5.5"), textModel: encodeChannelModel(channel.id, "gpt-5.5") },
            [{ role: "user", content: "读取画布" }],
            [{ type: "function", function: { name: "canvas_get_state", parameters: { type: "object", properties: {} } } }],
        );

        expect(fetchMock).toHaveBeenCalledWith(
            "/peter-api/v1/responses",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({ Authorization: "Bearer runtime-key" }),
            }),
        );
        expect(result.toolCalls[0].function.name).toBe("canvas_get_state");
    });

    it("keeps a manually configured third-party URL as a direct browser request", async () => {
        const fetchMock = vi.fn(async () => sse({ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] } }));
        vi.stubGlobal("fetch", fetchMock);
        const channel = { id: "manual", name: "Manual", baseUrl: "https://llm.example/v1", apiKey: "manual-key", apiFormat: "openai" as const, models: ["custom-text"], source: "manual" as const };

        await requestToolResponse({ ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "custom-text"), textModel: encodeChannelModel(channel.id, "custom-text") }, [{ role: "user", content: "hello" }], []);

        expect(fetchMock).toHaveBeenCalledWith("https://llm.example/v1/responses", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer manual-key" }) }));
    });

    it("executes canvas operations through the live canvas context", async () => {
        const initial: CanvasAgentSnapshot = { projectId: "p1", title: "测试", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
        let snapshot = initial;
        const context: AgentCanvasContext = {
            snapshot,
            canUndo: false,
            undoOps: () => null,
            applyOps: (ops: CanvasAgentOp[] = []) => {
                snapshot = applyCanvasAgentOps(snapshot, ops);
                context.snapshot = snapshot;
                return snapshot;
            },
        };

        const result = await runWebAgentTool("canvas_apply_ops", { ops: [{ type: "add_node", nodeType: "text", title: "Agent 节点", x: 10, y: 20 }] }, vi.fn(), context);

        expect(snapshot.nodes).toHaveLength(1);
        expect(snapshot.nodes[0].title).toBe("Agent 节点");
        expect(result).toMatchObject({ ok: true, summary: "新增节点 1" });
    });
});

function sse(event: unknown) {
    return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
