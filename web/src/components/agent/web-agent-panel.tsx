import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button } from "antd";
import { History, Plus, Settings2, Terminal, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/components/model-picker";
import { AgentChatComposer, AgentChatMessage, AgentPanelTabs, AgentWorkingMessage, type CanvasAgentChatMessage } from "@/components/canvas/canvas-agent-chat-ui";
import { canvasThemes } from "@/lib/canvas-theme";
import { isWebAgentWriteTool, runWebAgentTool, WEB_AGENT_TOOLS, webAgentToolLabel } from "@/lib/agent/web-agent-tools";
import { requestToolResponse, type ResponseInputMessage, type ResponseToolCall } from "@/services/api/image";
import { modelOptionLabel, resolveModelChannel, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

const MAX_TOOL_STEPS = 6;
const WEB_AGENT_PROMPT = `你是 PeterAI 画布内置的网站 Agent，直接使用用户在网页“渠道”中配置的文本模型和 API。
你可以操作当前画布，也可以使用站点工具访问画布列表、生图/视频工作台、提示词和素材。
需要了解画布时先调用 canvas_get_state；需要修改画布时调用 canvas_apply_ops，且只能使用读取结果中真实存在的节点 ID。
canvas_apply_ops 支持 add_node、update_node、delete_node、delete_connections、connect_nodes、set_viewport、select_nodes、run_generation。
需要切换页面时调用 site_navigate。工具返回后必须依据真实结果回答，不得编造执行结果。`;

type WebAgentTab = "setup" | "chat" | "history" | "log";
type WebSession = { id: string; title: string; messages: CanvasAgentChatMessage[]; updatedAt: number };
type ToolExecution = { call: ResponseToolCall; ok: boolean; result: unknown };
type PendingBatch = { id: string; sessionId: string; assistantId: string; messages: ResponseInputMessage[]; toolCalls: ResponseToolCall[]; step: number };
type WebLog = { id: string; time: string; title: string; detail?: unknown };

export function WebAgentPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const confirmTools = useAgentStore((state) => state.confirmTools);
    const canvasContext = useAgentStore((state) => state.canvasContext);
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState<WebAgentTab>("setup");
    const [sessions, setSessions] = useState<WebSession[]>(() => [createSession()]);
    const [activeSessionId, setActiveSessionId] = useState("");
    const [prompt, setPrompt] = useState("");
    const [running, setRunning] = useState(false);
    const [pending, setPending] = useState<PendingBatch | null>(null);
    const [logs, setLogs] = useState<WebLog[]>([]);
    const listRef = useRef<HTMLDivElement>(null);
    const sessionsRef = useRef(sessions);
    const canvasContextRef = useRef(canvasContext);
    const abortRef = useRef<AbortController | null>(null);
    const initialSessionId = sessions[0].id;
    const resolvedSessionId = activeSessionId || initialSessionId;
    const activeSession = sessions.find((item) => item.id === resolvedSessionId) || sessions[0];
    const activeModel = effectiveConfig.textModel || "";
    const activeChannel = activeModel ? resolveModelChannel(effectiveConfig, activeModel) : null;
    const ready = isAiConfigReady({ ...effectiveConfig, model: activeModel }, activeModel);

    useEffect(() => {
        sessionsRef.current = sessions;
    }, [sessions]);
    useEffect(() => {
        canvasContextRef.current = canvasContext;
    }, [canvasContext]);
    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [activeSession?.messages, pending, running]);
    useEffect(() => () => abortRef.current?.abort(), []);

    const sessionSummaries = useMemo(() => sessions.filter((item) => item.messages.length), [sessions]);

    const addLog = (title: string, detail?: unknown) => {
        setLogs((items) => [...items.slice(-99), { id: nanoid(), time: new Date().toLocaleTimeString(), title, detail }]);
    };

    const updateSession = (sessionId: string, updater: (session: WebSession) => WebSession) => {
        setSessions((items) => items.map((item) => (item.id === sessionId ? updater(item) : item)));
    };

    const appendMessage = (sessionId: string, item: CanvasAgentChatMessage) => {
        updateSession(sessionId, (session) => ({
            ...session,
            title: session.messages.length ? session.title : item.text.slice(0, 24) || "新对话",
            messages: [...session.messages, item],
            updatedAt: Date.now(),
        }));
    };

    const upsertMessage = (sessionId: string, item: CanvasAgentChatMessage) => {
        updateSession(sessionId, (session) => {
            const exists = session.messages.some((message) => message.id === item.id);
            return { ...session, messages: exists ? session.messages.map((message) => (message.id === item.id ? { ...message, ...item } : message)) : [...session.messages, item], updatedAt: Date.now() };
        });
    };

    const startNewSession = () => {
        const session = createSession();
        setSessions((items) => [session, ...items]);
        setActiveSessionId(session.id);
        setPending(null);
        setActiveTab("chat");
    };

    const deleteSession = (sessionId: string) => {
        setSessions((items) => {
            const next = items.filter((item) => item.id !== sessionId);
            return next.length ? next : [createSession()];
        });
        if (resolvedSessionId === sessionId) setActiveSessionId("");
    };

    const submit = async () => {
        const text = prompt.trim();
        if (!text || running) return;
        if (!ready) {
            message.warning("请先配置网站 Agent 使用的文本模型");
            openConfigDialog(false, "channels");
            return;
        }
        const sessionId = resolvedSessionId;
        const session = sessionsRef.current.find((item) => item.id === sessionId) || activeSession;
        const assistantId = nanoid();
        const history: ResponseInputMessage[] = (session?.messages || []).filter((item) => item.role === "user" || item.role === "assistant").map((item) => ({ role: item.role as "user" | "assistant", content: item.text }));
        const messages: ResponseInputMessage[] = [{ role: "system", content: WEB_AGENT_PROMPT }, ...history, { role: "user", content: text }];
        appendMessage(sessionId, { id: nanoid(), role: "user", text });
        setPrompt("");
        setActiveTab("chat");
        addLog("发送请求", { model: modelOptionLabel(effectiveConfig, activeModel), channel: activeChannel?.name || "未选择" });
        await runStep(sessionId, assistantId, messages, 1);
    };

    const runStep = async (sessionId: string, assistantId: string, messages: ResponseInputMessage[], step: number) => {
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        let streamed = "";
        try {
            const config = { ...effectiveConfig, model: activeModel, systemPrompt: "" };
            const result = await requestToolResponse(
                config,
                messages,
                WEB_AGENT_TOOLS,
                "auto",
                (text) => {
                    streamed = text;
                    if (text.trim()) upsertMessage(sessionId, { id: assistantId, role: "assistant", text, streamId: assistantId });
                },
                { signal: controller.signal },
            );
            addLog(`模型回复 · 第 ${step} 步`, { content: result.content, tools: result.toolCalls.map((item) => item.function.name) });
            if (!result.toolCalls.length) {
                upsertMessage(sessionId, { id: assistantId, role: "assistant", text: result.content || streamed || "没有返回内容" });
                return;
            }
            const writable = result.toolCalls.filter((item) => isWebAgentWriteTool(item.function.name));
            if (confirmTools && writable.length) {
                const id = nanoid();
                const nextPending = { id, sessionId, assistantId, messages, toolCalls: result.toolCalls, step };
                setPending(nextPending);
                appendMessage(sessionId, { id, role: "tool", title: "确认工具调用", text: result.toolCalls.map((item) => webAgentToolLabel(item.function.name)).join("、"), detail: { status: "pending", toolCalls: result.toolCalls } });
                addLog(
                    "等待工具确认",
                    result.toolCalls.map((item) => item.function.name),
                );
                return;
            }
            await executeAndContinue({ id: "", sessionId, assistantId, messages, toolCalls: result.toolCalls, step });
        } catch (error) {
            if (controller.signal.aborted) {
                upsertMessage(sessionId, { id: assistantId, role: "system", text: "已停止本次请求" });
            } else {
                const text = error instanceof Error ? error.message : "网站 Agent 请求失败";
                appendMessage(sessionId, { id: nanoid(), role: "error", title: "请求失败", text });
                addLog("请求失败", text);
            }
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            setRunning(false);
        }
    };

    const executeAndContinue = async (batch: PendingBatch) => {
        setRunning(true);
        const executions: ToolExecution[] = [];
        for (const call of batch.toolCalls) {
            try {
                const input = parseArguments(call.function.arguments);
                const result = await runWebAgentTool(call.function.name, input, navigate, canvasContextRef.current);
                executions.push({ call, ok: true, result });
            } catch (error) {
                executions.push({ call, ok: false, result: { error: error instanceof Error ? error.message : "工具执行失败" } });
                break;
            }
        }
        const summary = executions.map((item) => `${webAgentToolLabel(item.call.function.name)}${item.ok ? "完成" : "失败"}`).join("，");
        if (batch.id) upsertMessage(batch.sessionId, { id: batch.id, role: "tool", title: "工具执行完成", text: summary, detail: { status: executions.every((item) => item.ok) ? "completed" : "failed", executions } });
        else appendMessage(batch.sessionId, { id: nanoid(), role: "tool", title: "工具执行完成", text: summary, detail: { status: executions.every((item) => item.ok) ? "completed" : "failed", executions } });
        addLog(
            "工具执行结果",
            executions.map((item) => ({ name: item.call.function.name, ok: item.ok, result: item.result })),
        );
        setPending(null);
        const nextMessages: ResponseInputMessage[] = [
            ...batch.messages,
            ...batch.toolCalls.map((call) => ({ type: "function_call" as const, call_id: call.id, name: call.function.name, arguments: call.function.arguments, thoughtSignature: call.thoughtSignature })),
            ...executions.map((item) => ({ role: "tool" as const, tool_call_id: item.call.id, content: JSON.stringify(item.result) })),
        ];
        if (batch.step >= MAX_TOOL_STEPS || executions.some((item) => !item.ok)) {
            upsertMessage(batch.sessionId, { id: batch.assistantId, role: "assistant", text: summary || "工具已执行" });
            setRunning(false);
            return;
        }
        await runStep(batch.sessionId, batch.assistantId, nextMessages, batch.step + 1);
    };

    const rejectPending = () => {
        if (!pending) return;
        upsertMessage(pending.sessionId, { id: pending.id, role: "tool", title: "已拒绝执行", text: "工具调用已取消", detail: { status: "rejected", toolCalls: pending.toolCalls } });
        upsertMessage(pending.sessionId, { id: pending.assistantId, role: "assistant", text: "已按你的要求取消工具调用。" });
        addLog(
            "用户拒绝工具",
            pending.toolCalls.map((item) => item.function.name),
        );
        setPending(null);
    };

    const stop = () => {
        abortRef.current?.abort();
        setRunning(false);
    };

    return (
        <>
            <AgentPanelTabs
                value={activeTab}
                theme={theme}
                items={[
                    { value: "setup", label: "网站配置", icon: <Settings2 className="size-3.5" /> },
                    { value: "chat", label: "对话" },
                    { value: "history", label: "历史", icon: <History className="size-3.5" />, count: sessionSummaries.length },
                    { value: "log", label: "日志", icon: <Terminal className="size-3.5" />, count: logs.length },
                ]}
                onChange={setActiveTab}
                right={
                    activeTab === "chat" ? (
                        <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={startNewSession}>
                            新对话
                        </Button>
                    ) : null
                }
            />
            {activeTab === "setup" ? (
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="space-y-4">
                        <div>
                            <div className="text-base font-semibold">网站 Agent</div>
                            <div className="mt-1 text-sm leading-6" style={{ color: theme.node.muted }}>
                                直接使用“渠道”里的 URL、API Key 和默认文本模型，不需要 Local URL 或 Connect token。
                            </div>
                        </div>
                        <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                            <div className="text-xs" style={{ color: theme.node.muted }}>
                                当前渠道
                            </div>
                            <div className="mt-1 text-sm font-medium">{activeChannel?.name || "尚未选择文本渠道"}</div>
                            <div className="mt-1 break-all text-xs" style={{ color: theme.node.muted }}>
                                {activeChannel?.baseUrl || "请配置包含文本模型的渠道"}
                            </div>
                            <div className="mt-2 text-xs" style={{ color: ready ? "#16a34a" : "#d97706" }}>
                                {ready ? "URL、API Key 与文本模型已就绪" : "尚未配置可用的文本模型或 API Key"}
                            </div>
                        </div>
                        <div>
                            <div className="mb-2 text-xs" style={{ color: theme.node.muted }}>
                                默认文本模型
                            </div>
                            <ModelPicker config={effectiveConfig} value={activeModel} onChange={(value) => updateConfig("textModel", value)} capability="text" fullWidth onMissingConfig={() => openConfigDialog(false, "channels")} />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button type="primary" onClick={() => openConfigDialog(false, "channels")}>
                                配置 URL / API Key
                            </Button>
                            <Button onClick={() => openConfigDialog(false, "models")}>选择文本模型</Button>
                        </div>
                        <div className="rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            PeterAI 托管渠道会自动经当前站点的 /peter-api 调用并按 PeterAI 账户计费；你手工添加的其他 URL/API Key 仍由浏览器直连。
                        </div>
                    </div>
                </div>
            ) : activeTab === "history" ? (
                <div className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                    <div className="flex justify-end">
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} onClick={startNewSession}>
                            新对话
                        </Button>
                    </div>
                    {sessionSummaries.map((session) => (
                        <div key={session.id} className="flex items-center gap-2 rounded-lg border p-2.5" style={{ borderColor: session.id === resolvedSessionId ? theme.node.text : theme.node.stroke }}>
                            <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => {
                                    setActiveSessionId(session.id);
                                    setActiveTab("chat");
                                }}
                            >
                                <div className="truncate text-sm font-medium">{session.title}</div>
                                <div className="mt-1 text-[11px]" style={{ color: theme.node.muted }}>
                                    {new Date(session.updatedAt).toLocaleString()}
                                </div>
                            </button>
                            <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => deleteSession(session.id)} />
                        </div>
                    ))}
                    {!sessionSummaries.length ? (
                        <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>
                            暂无网站 Agent 对话
                        </div>
                    ) : null}
                </div>
            ) : activeTab === "log" ? (
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
                    <div className="mb-3 flex justify-end">
                        <Button size="small" danger type="text" disabled={!logs.length} onClick={() => setLogs([])}>
                            清空日志
                        </Button>
                    </div>
                    <div className="space-y-2">
                        {logs.map((item) => (
                            <details key={item.id} className="rounded-lg border p-2.5 text-xs" style={{ borderColor: theme.node.stroke }}>
                                <summary className="cursor-pointer">
                                    {item.time} · {item.title}
                                </summary>
                                {item.detail !== undefined ? (
                                    <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all" style={{ color: theme.node.muted }}>
                                        {JSON.stringify(item.detail, null, 2)}
                                    </pre>
                                ) : null}
                            </details>
                        ))}
                        {!logs.length ? (
                            <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>
                                暂无运行日志
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : (
                <>
                    <div ref={listRef} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        {(activeSession?.messages || []).map((item) => (
                            <AgentChatMessage key={item.id} item={item} theme={theme} user={user} onRejectTool={rejectPending} onApproveTool={() => pending && void executeAndContinue(pending)} />
                        ))}
                        {running && !pending ? <AgentWorkingMessage theme={theme} /> : null}
                        {!activeSession?.messages.length ? (
                            <div className="flex h-full items-center justify-center text-center text-sm leading-6" style={{ color: theme.node.muted }}>
                                使用网站配置的文本模型
                                <br />
                                询问内容或操作当前画布
                            </div>
                        ) : null}
                    </div>
                    <AgentChatComposer
                        prompt={prompt}
                        disabled={!ready || Boolean(pending)}
                        sending={running}
                        placeholder={ready ? "询问网站 Agent，或让它操作画布" : "请先配置 URL、API Key 和文本模型"}
                        theme={theme}
                        onPromptChange={setPrompt}
                        onSubmit={() => void submit()}
                        onStop={stop}
                        left={
                            <button type="button" className="text-[11px]" style={{ color: theme.node.muted }} onClick={() => openConfigDialog(false, "channels")}>
                                {activeModel ? modelOptionLabel(effectiveConfig, activeModel) : "配置文本模型"}
                            </button>
                        }
                    />
                </>
            )}
        </>
    );
}

function createSession(): WebSession {
    return { id: nanoid(), title: "新对话", messages: [], updatedAt: Date.now() };
}

function parseArguments(value: string) {
    try {
        const parsed = JSON.parse(value || "{}") as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        throw new Error("模型返回的工具参数不是有效 JSON");
    }
}
