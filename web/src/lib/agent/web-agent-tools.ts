import type { NavigateFunction } from "react-router-dom";

import { isSiteTool, runSiteTool, SITE_TOOL_LABELS } from "@/lib/agent/agent-site-tools";
import { summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { ResponseFunctionTool } from "@/services/api/image";
import type { AgentCanvasContext } from "@/stores/use-agent-store";

const OBJECT_SCHEMA = { type: "object", additionalProperties: true };
const CANVAS_OP_SCHEMA = {
    type: "object",
    properties: {
        type: { type: "string", enum: ["add_node", "update_node", "delete_node", "delete_connections", "connect_nodes", "set_viewport", "select_nodes", "run_generation"] },
        id: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        nodeType: { type: "string", enum: ["image", "text", "config", "video", "audio"] },
        title: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false },
        metadata: OBJECT_SCHEMA,
        patch: OBJECT_SCHEMA,
        all: { type: "boolean" },
        fromNodeId: { type: "string" },
        toNodeId: { type: "string" },
        viewport: OBJECT_SCHEMA,
        nodeId: { type: "string" },
        mode: { type: "string", enum: ["text", "image", "video", "audio"] },
        prompt: { type: "string" },
    },
    required: ["type"],
    additionalProperties: false,
};

function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ResponseFunctionTool {
    return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } };
}

export const WEB_AGENT_TOOLS: ResponseFunctionTool[] = [
    tool("canvas_get_state", "读取当前画布的节点、连线、选区和视口。"),
    tool("canvas_get_selection", "读取当前画布选中的节点。"),
    tool("canvas_export_snapshot", "导出当前画布快照。"),
    tool("canvas_apply_ops", "批量操作当前画布。支持新增、更新、删除、连线、视口、选择和触发生成。", { ops: { type: "array", minItems: 1, items: CANVAS_OP_SCHEMA } }, ["ops"]),
    tool("site_navigate", "跳转 PeterAI 画布网站页面。", { path: { type: "string", description: "站内路径，例如 /canvas、/image、/video、/prompts、/assets、/config" } }, ["path"]),
    tool("canvas_list_projects", "分页读取用户的画布清单。", { keyword: { type: "string" }, page: { type: "number" }, pageSize: { type: "number" } }),
    tool("workbench_image_get_config", "读取生图工作台当前配置和可选模型。"),
    tool("workbench_image_generate", "跳转生图工作台，填写参数并可立即生成。", { prompt: { type: "string" }, model: { type: "string" }, quality: { type: "string" }, size: { type: "string" }, count: { type: "number" }, run: { type: "boolean" } }),
    tool("workbench_video_get_config", "读取视频工作台当前配置和可选模型。"),
    tool("workbench_video_generate", "跳转视频工作台，填写参数并可立即生成。", {
        prompt: { type: "string" },
        model: { type: "string" },
        size: { type: "string" },
        seconds: { type: "string" },
        resolution: { type: "string" },
        generateAudio: { type: "boolean" },
        watermark: { type: "boolean" },
        run: { type: "boolean" },
    }),
    tool("prompts_search", "分页搜索提示词库。", { keyword: { type: "string" }, category: { type: "string" }, tags: { type: "array", items: { type: "string" } }, page: { type: "number" }, pageSize: { type: "number" } }),
    tool("assets_list", "分页读取我的素材。", { kind: { type: "string", enum: ["all", "text", "image", "video"] }, keyword: { type: "string" }, page: { type: "number" }, pageSize: { type: "number" } }),
    tool(
        "assets_add",
        "新增文本或图片素材。",
        { kind: { type: "string", enum: ["text", "image"] }, title: { type: "string" }, content: { type: "string" }, imageUrl: { type: "string" }, tags: { type: "array", items: { type: "string" } }, source: { type: "string" }, note: { type: "string" } },
        ["kind", "title"],
    ),
];

const WRITE_TOOLS = new Set(["canvas_apply_ops", "site_navigate", "workbench_image_generate", "workbench_video_generate", "assets_add"]);

export function isWebAgentWriteTool(name: string) {
    return WRITE_TOOLS.has(name);
}

export function webAgentToolLabel(name: string) {
    if (name === "canvas_get_state" || name === "canvas_export_snapshot") return "读取画布";
    if (name === "canvas_get_selection") return "读取选区";
    if (name === "canvas_apply_ops") return "画布操作";
    if (name === "site_navigate") return "网站跳转";
    return isSiteTool(name) ? SITE_TOOL_LABELS[name] : name;
}

export async function runWebAgentTool(name: string, input: Record<string, unknown>, navigate: NavigateFunction, canvasContext: AgentCanvasContext | null) {
    if (name === "site_navigate") {
        const path = String(input.path || "").trim();
        if (!path.startsWith("/") || path.startsWith("//")) throw new Error("只允许跳转站内路径");
        navigate(path);
        return { ok: true, path };
    }
    if (isSiteTool(name)) return runSiteTool(name, input, navigate);
    if (!canvasContext) throw new Error("当前页面没有打开画布，请先调用 site_navigate 进入画布");
    if (name === "canvas_get_state" || name === "canvas_export_snapshot") return compactSnapshot(canvasContext.snapshot);
    if (name === "canvas_get_selection") {
        const selected = new Set(canvasContext.snapshot.selectedNodeIds);
        return compactSnapshot({ ...canvasContext.snapshot, nodes: canvasContext.snapshot.nodes.filter((node) => selected.has(node.id)) });
    }
    if (name === "canvas_apply_ops") {
        const ops = Array.isArray(input.ops) ? (input.ops as CanvasAgentOp[]) : [];
        if (!ops.length) throw new Error("画布操作不能为空");
        const snapshot = canvasContext.applyOps(ops);
        return { ok: true, summary: summarizeCanvasAgentOps(ops), snapshot: compactSnapshot(snapshot) };
    }
    throw new Error(`未知工具：${name}`);
}

function compactSnapshot(snapshot: CanvasAgentSnapshot) {
    return {
        projectId: snapshot.projectId,
        title: snapshot.title,
        nodes: snapshot.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            position: node.position,
            width: node.width,
            height: node.height,
            metadata: compactValue(node.metadata),
        })),
        connections: snapshot.connections,
        selectedNodeIds: snapshot.selectedNodeIds,
        viewport: snapshot.viewport,
    };
}

function compactValue(value: unknown, key = ""): unknown {
    if (/^(dataUrl|base64|blob|file)$/i.test(key)) return "[已省略媒体数据]";
    if (typeof value === "string") return value.startsWith("data:") || value.length > 4000 ? `${value.slice(0, 400)}…` : value;
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => compactValue(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([itemKey, item]) => [itemKey, compactValue(item, itemKey)]));
}
