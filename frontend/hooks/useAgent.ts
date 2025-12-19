"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { HttpAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message as AgUIMessage } from "@ag-ui/client";
import type { Message } from "@/components/chat/CustomMessages";
import type { Subscription } from "rxjs";

interface UseAgentOptions {
    agentUrl?: string;
    threadId?: string;
}

interface AgentState {
    messages: Message[];
    isLoading: boolean;
    error: string | null;
    threadId: string;
    isInitialized: boolean;
    agentState?: Record<string, any>;
}

function getBaseUrl(agentUrl: string): string {
    return agentUrl.replace(/\/agent\/?$/, "");
}

export function useAgent(options: UseAgentOptions = {}) {
    const {
        agentUrl = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8123/agent",
        threadId: initialThreadId,
    } = options;

    const [state, setState] = useState<AgentState>({
        messages: [],
        isLoading: false,
        error: null,
        threadId: initialThreadId || crypto.randomUUID(),
        isInitialized: false,
        agentState: {},
    });

    const agentRef = useRef<HttpAgent | null>(null);
    const subscriptionRef = useRef<Subscription | null>(null);
    const baseUrl = getBaseUrl(agentUrl);

    const getAgent = useCallback(() => {
        if (!agentRef.current) {
            agentRef.current = new HttpAgent({ url: agentUrl });
        }
        return agentRef.current;
    }, [agentUrl]);

    useEffect(() => {
        if (state.threadId && !state.isInitialized) {
            const fetchThreadState = async () => {
                try {
                    const response = await fetch(`${baseUrl}/threads/${state.threadId}/state`);
                    if (!response.ok) {
                        setState(prev => ({ ...prev, isInitialized: true }));
                        return;
                    }
                    const data = await response.json();
                    if (data.exists && data.messages && data.messages.length > 0) {
                        // 1. First pass: Collect tool results by tool_call_id
                        const toolResultsMap = new Map<string, string>();
                        data.messages.forEach((msg: any) => {
                            if (msg.role === 'tool' && msg.tool_call_id) {
                                const content = typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content;
                                toolResultsMap.set(msg.tool_call_id, content);
                            }
                        });

                        // 2. Second pass: Create messages with properly normalized toolCalls
                        const messages: Message[] = data.messages.map((msg: any) => {
                            let role: 'user' | 'assistant' | 'system' | 'tool' = 'user';
                            if (msg.role === "human") role = "user";
                            else if (msg.role === "ai" || msg.role === "assistant") role = "assistant";
                            else if (["user", "assistant", "system", "tool"].includes(msg.role)) role = msg.role;

                            // Normalize toolCalls from raw backend format to our ToolCall interface
                            let normalizedToolCalls = undefined;
                            const rawToolCalls = msg.tool_calls || msg.toolCalls;
                            if (rawToolCalls && Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
                                normalizedToolCalls = rawToolCalls.map((tc: any) => {
                                    const toolCallId = tc.id;
                                    const result = toolResultsMap.get(toolCallId);
                                    // Handle both direct properties and function.* properties
                                    const toolName = tc.name || tc.function?.name;
                                    let toolArgs = tc.args || tc.function?.arguments;
                                    // Parse arguments if it's a string
                                    if (typeof toolArgs === 'string') {
                                        try {
                                            toolArgs = JSON.parse(toolArgs);
                                        } catch {
                                            // Keep as string if parsing fails
                                        }
                                    }
                                    return {
                                        id: toolCallId,
                                        name: toolName,
                                        args: toolArgs || {},
                                        result: result,
                                        status: 'complete' as const, // Historical calls are always complete
                                    };
                                });
                            }

                            return {
                                id: msg.id || crypto.randomUUID(),
                                role,
                                content: msg.content || "",
                                toolCallId: msg.tool_call_id || msg.toolCallId,
                                toolName: msg.name || msg.toolName,
                                toolCalls: normalizedToolCalls,
                            };
                        });

                        setState(prev => ({
                            ...prev,
                            messages,
                            isInitialized: true,
                            agentState: data.values || {},
                        }));
                    } else {
                        setState(prev => ({ ...prev, isInitialized: true }));
                    }
                } catch (err) {
                    console.error("Failed to restore session:", err);
                    setState(prev => ({ ...prev, isInitialized: true }));
                }
            };
            fetchThreadState();
        }
    }, [state.threadId, state.isInitialized, baseUrl]);

    const handleEvent = useCallback((event: BaseEvent) => {
        switch (event.type) {
            case EventType.TEXT_MESSAGE_START:
                if ('messageId' in event && 'role' in event) {
                    const startEvent = event as unknown as { messageId: string, role: string };
                    setState(prev => {
                        if (prev.messages.some(m => m.id === startEvent.messageId)) return prev;
                        return {
                            ...prev,
                            messages: [
                                ...prev.messages,
                                {
                                    id: startEvent.messageId,
                                    role: (startEvent.role === 'ai' || startEvent.role === 'assistant') ? 'assistant' : (startEvent.role as any),
                                    content: "",
                                },
                            ],
                        };
                    });
                }
                break;

            case EventType.TEXT_MESSAGE_CONTENT:
                if ('delta' in event && 'messageId' in event) {
                    const contentEvent = event as unknown as { delta: string, messageId: string };
                    setState(prev => ({
                        ...prev,
                        messages: prev.messages.map(msg =>
                            msg.id === contentEvent.messageId
                                ? { ...msg, content: msg.content + contentEvent.delta }
                                : msg
                        ),
                    }));
                }
                break;

            case EventType.TOOL_CALL_START:
                if ('toolCallId' in event && 'toolCallName' in event) {
                    const startEvent = event as any;
                    const parentId = startEvent.parentMessageId;
                    setState(prev => {
                        // Find the target message: either the specified parent or the last assistant message
                        let targetIdx = -1;
                        if (parentId) {
                            targetIdx = prev.messages.findIndex(m => m.id === parentId);
                        } else {
                            // Find the last assistant message
                            for (let i = prev.messages.length - 1; i >= 0; i--) {
                                if (prev.messages[i].role === 'assistant') {
                                    targetIdx = i;
                                    break;
                                }
                            }
                        }

                        if (targetIdx === -1) return prev;

                        const targetMsg = prev.messages[targetIdx];
                        const existingCalls = targetMsg.toolCalls || [];

                        // Don't add duplicate
                        if (existingCalls.some(c => c.id === startEvent.toolCallId)) return prev;

                        const updatedMessages = [...prev.messages];
                        updatedMessages[targetIdx] = {
                            ...targetMsg,
                            toolCalls: [
                                ...existingCalls,
                                {
                                    id: startEvent.toolCallId,
                                    name: startEvent.toolCallName,
                                    args: "",
                                    status: 'executing' as const
                                }
                            ]
                        };

                        return { ...prev, messages: updatedMessages };
                    });
                }
                break;

            case EventType.TOOL_CALL_ARGS:
                if ('toolCallId' in event && 'delta' in event) {
                    const argsEvent = event as any;
                    setState(prev => ({
                        ...prev,
                        messages: prev.messages.map(msg => {
                            if (msg.toolCalls?.some(c => c.id === argsEvent.toolCallId)) {
                                return {
                                    ...msg,
                                    toolCalls: msg.toolCalls.map(c =>
                                        c.id === argsEvent.toolCallId
                                            ? { ...c, args: (typeof c.args === 'string' ? c.args : "") + argsEvent.delta }
                                            : c
                                    )
                                };
                            }
                            return msg;
                        })
                    }));
                }
                break;

            case EventType.TOOL_CALL_END:
                if ('toolCallId' in event) {
                    const endEvent = event as any;
                    setState(prev => ({
                        ...prev,
                        messages: prev.messages.map(msg => {
                            if (msg.toolCalls?.some(c => c.id === endEvent.toolCallId)) {
                                return {
                                    ...msg,
                                    toolCalls: msg.toolCalls.map(c => {
                                        if (c.id === endEvent.toolCallId) {
                                            let parsedArgs = c.args;
                                            try {
                                                if (typeof c.args === 'string' && c.args.trim()) {
                                                    parsedArgs = JSON.parse(c.args);
                                                }
                                            } catch (e) { }
                                            return { ...c, args: parsedArgs, status: 'complete' as const };
                                        }
                                        return c;
                                    })
                                };
                            }
                            return msg;
                        })
                    }));
                }
                break;

            case EventType.TOOL_CALL_RESULT:
                if ('toolCallId' in event) {
                    const resultEvent = event as any;
                    const content = resultEvent.content || resultEvent.result;
                    setState(prev => {
                        const updatedMessages = prev.messages.map(msg => {
                            if (msg.toolCalls?.some(c => c.id === resultEvent.toolCallId)) {
                                return {
                                    ...msg,
                                    toolCalls: msg.toolCalls.map(c =>
                                        c.id === resultEvent.toolCallId
                                            ? { ...c, status: 'complete' as const, result: content }
                                            : c
                                    )
                                };
                            }
                            return msg;
                        });

                        if (!updatedMessages.some(m => m.role === 'tool' && m.toolCallId === resultEvent.toolCallId)) {
                            updatedMessages.push({
                                id: resultEvent.messageId || crypto.randomUUID(),
                                role: 'tool',
                                content: typeof content === 'string' ? content : JSON.stringify(content),
                                toolCallId: resultEvent.toolCallId,
                                toolName: resultEvent.toolName || 'Tool'
                            });
                        }
                        return { ...prev, messages: updatedMessages };
                    });
                }
                break;

            case EventType.MESSAGES_SNAPSHOT:
                if ('messages' in event) {
                    const snapshot = (event as unknown as { messages: AgUIMessage[] }).messages;
                    if (Array.isArray(snapshot) && snapshot.length > 0) {
                        // 1. First pass: Collect tool results by tool_call_id
                        const toolResultsMap = new Map<string, string>();
                        snapshot.forEach((msg: any) => {
                            const rawRole = msg.role as string;
                            if ((rawRole === 'tool') && (msg.tool_call_id || msg.toolCallId)) {
                                const toolCallId = msg.tool_call_id || msg.toolCallId;
                                const content = typeof msg.content === 'string' ? msg.content :
                                    (Array.isArray(msg.content) ? msg.content.map((c: any) => typeof c === 'string' ? c : c.text || "").join("") : JSON.stringify(msg.content));
                                toolResultsMap.set(toolCallId, content);
                            }
                        });

                        // 2. Second pass: Create messages with properly normalized toolCalls
                        const newMessages: Message[] = snapshot.map((msg: any) => {
                            let role: 'user' | 'assistant' | 'system' | 'tool' = 'user';
                            const rawRole = msg.role as string;
                            if (rawRole === 'human') role = 'user';
                            else if (rawRole === 'ai' || rawRole === 'assistant') role = 'assistant';
                            else if (['user', 'assistant', 'system', 'tool'].includes(rawRole)) role = rawRole as any;

                            let contentStr = "";
                            if (typeof msg.content === 'string') contentStr = msg.content;
                            else if (Array.isArray(msg.content)) {
                                contentStr = msg.content.map((c: any) => typeof c === 'string' ? c : c.text || "").join("");
                            }

                            // Normalize toolCalls from raw backend format to our ToolCall interface
                            let normalizedToolCalls = undefined;
                            const rawToolCalls = msg.tool_calls || msg.toolCalls;
                            if (rawToolCalls && Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
                                normalizedToolCalls = rawToolCalls.map((tc: any) => {
                                    const toolCallId = tc.id;
                                    const result = toolResultsMap.get(toolCallId);
                                    // Handle both direct properties and function.* properties
                                    const toolName = tc.name || tc.function?.name;
                                    let toolArgs = tc.args || tc.function?.arguments;
                                    // Parse arguments if it's a string
                                    if (typeof toolArgs === 'string') {
                                        try {
                                            toolArgs = JSON.parse(toolArgs);
                                        } catch {
                                            // Keep as string if parsing fails
                                        }
                                    }
                                    return {
                                        id: toolCallId,
                                        name: toolName,
                                        args: toolArgs || {},
                                        result: result,
                                        status: 'complete' as const, // Snapshot messages are always complete
                                    };
                                });
                            }

                            return {
                                id: msg.id || crypto.randomUUID(),
                                role,
                                content: contentStr,
                                toolCalls: normalizedToolCalls,
                                toolCallId: role === 'tool' ? (msg.tool_call_id || msg.toolCallId || msg.tool?.toolCallId) : undefined,
                                toolName: role === 'tool' ? (msg.name || msg.toolName || msg.tool?.name) : undefined,
                            };
                        });

                        setState(prev => ({ ...prev, messages: newMessages }));
                    }
                }
                break;

            case EventType.STATE_SNAPSHOT:
                if ('state' in event) {
                    setState(prev => ({ ...prev, agentState: (event as any).state }));
                }
                break;

            case EventType.RUN_FINISHED:
                setState(prev => ({ ...prev, isLoading: false }));
                break;

            case EventType.RUN_ERROR:
                setState(prev => ({
                    ...prev,
                    isLoading: false,
                    error: 'error' in event ? String((event as any).error) : 'Agent error'
                }));
                break;
        }
    }, []);

    const sendMessage = useCallback(async (content: string) => {
        if (!content.trim()) return;

        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content,
        };

        setState(prev => ({
            ...prev,
            messages: [...prev.messages, userMessage],
            isLoading: true,
            error: null,
        }));

        try {
            const agent = getAgent();
            const agentMessages: AgUIMessage[] = state.messages.map(msg => {
                const baseMessage: any = {
                    id: msg.id,
                    role: msg.role as any,
                    content: msg.content,
                };
                if (msg.role === 'tool' && msg.toolCallId) {
                    baseMessage.tool = { toolCallId: msg.toolCallId, name: msg.toolName || 'unknown' };
                    baseMessage.tool_call_id = msg.toolCallId;
                    baseMessage.name = msg.toolName;
                }
                if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                    // Transform toolCalls to the format expected by the backend
                    // Backend expects: { id, function: { name, arguments } }
                    baseMessage.toolCalls = msg.toolCalls.map(tc => ({
                        id: tc.id,
                        function: {
                            name: tc.name,
                            arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {})
                        }
                    }));
                }
                return baseMessage;
            });

            agentMessages.push({
                id: userMessage.id,
                role: "user",
                content,
            });

            const observable = agent.run({
                threadId: state.threadId,
                runId: crypto.randomUUID(),
                messages: agentMessages,
                tools: [],
                context: [],
                state: {},
                forwardedProps: {},
            });

            subscriptionRef.current = observable.subscribe({
                next: handleEvent,
                error: (err: Error) => {
                    console.error("Agent stream error:", err);
                    setState(prev => ({ ...prev, isLoading: false, error: err.message }));
                },
                complete: () => setState(prev => ({ ...prev, isLoading: false })),
            });
        } catch (err) {
            console.error("Agent error:", err);
            setState(prev => ({ ...prev, isLoading: false, error: String(err) }));
        }
    }, [getAgent, state.messages, state.threadId, handleEvent]);

    const stopGeneration = useCallback(() => {
        if (subscriptionRef.current) {
            subscriptionRef.current.unsubscribe();
            subscriptionRef.current = null;
        }
        setState(prev => ({ ...prev, isLoading: false }));
    }, []);

    const regenerateLastMessage = useCallback(async () => {
        const lastAssistantIndex = [...state.messages]
            .map((msg, idx) => ({ msg, idx }))
            .reverse()
            .find(item => item.msg.role === "assistant")?.idx;

        if (lastAssistantIndex === undefined) return;

        const messagesWithoutLastAssistant = state.messages.slice(0, lastAssistantIndex);
        if (messagesWithoutLastAssistant.length === 0) return;

        setState(prev => ({
            ...prev,
            messages: messagesWithoutLastAssistant,
            isLoading: true,
            error: null,
        }));

        try {
            const agent = getAgent();
            const agentMessages: AgUIMessage[] = messagesWithoutLastAssistant.map(msg => {
                const baseMessage: any = {
                    id: msg.id,
                    role: msg.role as any,
                    content: msg.content,
                };
                if (msg.role === 'tool' && msg.toolCallId) {
                    baseMessage.tool = { toolCallId: msg.toolCallId, name: msg.toolName || 'unknown' };
                    baseMessage.tool_call_id = msg.toolCallId;
                    baseMessage.name = msg.toolName;
                }
                if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                    // Transform toolCalls to the format expected by the backend
                    baseMessage.toolCalls = msg.toolCalls.map(tc => ({
                        id: tc.id,
                        function: {
                            name: tc.name,
                            arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {})
                        }
                    }));
                }
                return baseMessage;
            });

            const observable = agent.run({
                threadId: state.threadId,
                runId: crypto.randomUUID(),
                messages: agentMessages,
                tools: [],
                context: [],
                state: {},
                forwardedProps: {},
            });

            subscriptionRef.current = observable.subscribe({
                next: handleEvent,
                error: (err: Error) => {
                    console.error("Regen error:", err);
                    setState(prev => ({ ...prev, isLoading: false, error: err.message }));
                },
                complete: () => setState(prev => ({ ...prev, isLoading: false })),
            });
        } catch (err) {
            console.error("Regen error:", err);
            setState(prev => ({ ...prev, isLoading: false, error: String(err) }));
        }
    }, [getAgent, state.messages, state.threadId, handleEvent]);

    const clearMessages = useCallback(() => {
        setState(prev => ({ ...prev, messages: [], error: null }));
    }, []);

    const startNewConversation = useCallback(() => {
        const newThreadId = crypto.randomUUID();
        setState({
            messages: [],
            isLoading: false,
            error: null,
            threadId: newThreadId,
            isInitialized: true,
            agentState: {},
        });
        if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', `/c/${newThreadId}`);
        }
    }, []);

    return {
        ...state,
        sendMessage,
        clearMessages,
        stopGeneration,
        regenerateLastMessage,
        startNewConversation,
    };
}
