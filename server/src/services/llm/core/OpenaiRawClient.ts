import { LlmClient, LlmRequest, LlmResult, LlmMessage, LlmRole, ToolAbortError } from './types';

export const FALLBACK_RESPONSE: LlmResult = {
    text: 'API key not configured.'
};

export class OpenaiRawClient implements LlmClient {
    private baseUrl: string;
    private apiKey: string;
    protected agentName: string = 'chat';

    constructor(
        url: string,
        apiKey: string,
        private readonly modelId: string,
    ) {
        this.baseUrl = url.replace(/\/$/, '');
        this.apiKey = apiKey;
    }

    async generate(request: LlmRequest): Promise<LlmResult> {
        if (!this.baseUrl || !this.apiKey) {
            console.warn('No OpenAI URL or API Key provided to OpenaiRawClient');
            return FALLBACK_RESPONSE;
        }

        const messages = this.mapToProviderMessages(request.messages);

        // Tools logic
        let tools: any[] = [];
        let implementations: Record<string, any> = {};

        if (request.tools && request.tools.length > 0) {
            tools = request.tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                }
            }));
            request.tools.forEach(t => {
                implementations[t.name] = t.execute;
            });
        }

        return this.executeRequest(request, messages, tools, implementations);
    }

    private mapToProviderMessages(agnosticMessages: LlmMessage[]): any[] {
        return agnosticMessages.map(msg => {
            const mapped: any = { role: msg.role };

            // Map content. For tool results we assume `content` has string.
            mapped.content = msg.content;

            if (msg.toolCalls && msg.toolCalls.length > 0) {
                mapped.tool_calls = msg.toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.name,
                        arguments: tc.arguments
                    }
                }));
            }

            if (msg.toolCallId) {
                mapped.tool_call_id = msg.toolCallId;
            }

            if (msg.providerData) {
                Object.assign(mapped, msg.providerData);
            }

            return mapped;
        });
    }

    private async executeRequest(
        request: LlmRequest,
        messages: any[],
        tools: any[],
        implementations: Record<string, any>
    ): Promise<LlmResult> {
        let currentMessages = [...messages];
        let steps = 0;
        const maxSteps = request.maxSteps === undefined ? 30 : request.maxSteps;
        let lastAssistantText = '';
        let stop = false;

        try {
            while (steps < maxSteps && !stop) {
                if (request.abortSignal?.aborted) {
                    console.log('OpenaiRawClient: Generation aborted by signal');
                    break;
                }

                steps++;
                console.log(`OpenaiRawClient: Step ${steps}/${maxSteps} started.`);

                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                };

                const body: any = {
                    model: this.modelId,
                    messages: currentMessages,
                    stream: true,
                    stream_options: { include_usage: true }
                };
                if (tools.length > 0) {
                    body.tools = tools;
                }

                const response = await this.fetchWithRetries(`${this.baseUrl}/chat/completions`, headers, body, request.abortSignal);

                const streamState = {
                    stepText: '',
                    toolCallsBuffer: {} as Record<number, { id: string; name: string; arguments: string }>,
                    currentProviderData: {} as Record<string, any>
                };
                let finishReason: string | null = null;
                let currentStepUsage = { prompt: 0, completion: 0, total: 0 };

                await this.processStream(
                    response,
                    (delta) => this.processDelta(delta, request, streamState),
                    (usage) => {
                        currentStepUsage = {
                            prompt: usage.prompt_tokens,
                            completion: usage.completion_tokens,
                            total: usage.total_tokens
                        };
                    },
                    (reason) => { finishReason = reason; }
                );

                if (request.onTokenUsage) {
                    await request.onTokenUsage(
                        this.agentName,
                        this.modelId,
                        currentStepUsage.prompt,
                        currentStepUsage.completion,
                        currentStepUsage.total
                    );
                }

                const validToolCalls = Object.values(streamState.toolCallsBuffer).filter(tc => tc.name && tc.name.trim() !== '');

                const assistantMessageAny: any = {
                    role: LlmRole.ASSISTANT,
                    content: streamState.stepText || null,
                };
                if (Object.keys(streamState.currentProviderData).length > 0) {
                    assistantMessageAny.providerData = streamState.currentProviderData;
                }

                const assistantMessageMapped: LlmMessage = {
                    role: LlmRole.ASSISTANT,
                    content: streamState.stepText || '',
                    providerData: Object.keys(streamState.currentProviderData).length > 0 ? streamState.currentProviderData : undefined
                };

                if (streamState.stepText && streamState.stepText.trim().length > -1) {
                    stop = true;
                } else if (validToolCalls.length > 0) {
                    assistantMessageAny.tool_calls = validToolCalls.map(tc => ({
                        id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments }
                    }));
                    assistantMessageMapped.toolCalls = validToolCalls.map(tc => ({
                        id: tc.id,
                        name: tc.name,
                        arguments: tc.arguments
                    }));
                }

                currentMessages.push(assistantMessageAny);
                lastAssistantText = streamState.stepText || '';

                if (request.onNewMessage) {
                    await request.onNewMessage(assistantMessageMapped);
                }

                if (!stop && validToolCalls.length > 0) {
                    await this.executeTools(validToolCalls, implementations, request, currentMessages);
                } else if (finishReason === 'stop' || finishReason === null) {
                    stop = true;
                }
            }

            return {
                text: lastAssistantText
            };

        } catch (error) {
            console.error(`OpenaiRawClient Error:`, error);
            throw error;
        }
    }

    private async fetchWithRetries(
        url: string,
        headers: any,
        body: any,
        abortSignal?: AbortSignal,
        maxAttempts: number = 10
    ): Promise<Response> {
        let attempt = 0;
        while (attempt < maxAttempts) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: abortSignal
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    if (response.status === 429 || response.status >= 500) {
                        throw new Error(`OpenAI API temporary error: ${response.status} ${response.statusText} - ${errorText}`);
                    }
                    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
                }
                return response;
            } catch (e: any) {
                attempt++;
                if (abortSignal?.aborted || attempt >= maxAttempts || (e.message.includes('OpenAI API error') && !e.message.includes('temporary error'))) {
                    throw e;
                }
                console.warn(`OpenaiRawClient network/API error (attempt ${attempt}/${maxAttempts}): ${e.message}. Retrying in ${attempt * 2}s...`);
                await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            }
        }
        throw new Error('Failed to fetch response after retries');
    }

    private async processStream(
        response: Response,
        onDelta: (delta: any) => void,
        onUsage: (usage: any) => void,
        onFinish: (reason: string) => void
    ): Promise<void> {
        if (!response.body) throw new Error('Response body is null');
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

                    if (trimmedLine.startsWith('data: ')) {
                        try {
                            const jsonStr = trimmedLine.slice(6);
                            const chunk = JSON.parse(jsonStr);

                            if (chunk.choices && chunk.choices.length > 0) {
                                const delta = chunk.choices[0].delta;
                                const finish = chunk.choices[0].finish_reason;
                                if (delta) onDelta(delta);
                                if (finish) onFinish(finish);
                            }

                            if (chunk.usage) {
                                onUsage(chunk.usage);
                            }
                        } catch (e) {
                            console.warn('Error parsing stream line:', trimmedLine, e);
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    private processDelta(
        delta: any,
        request: LlmRequest,
        state: {
            stepText: string;
            currentProviderData: Record<string, any>;
            toolCallsBuffer: Record<number, { id: string; name: string; arguments: string }>;
        }
    ) {
        // DEBUG: uncomment the line below to trace all raw deltas
        // console.log('DEBUG DELTA:', JSON.stringify(delta));

        if (delta.content) {
            state.stepText += delta.content;
            if (request.onChunkContent) {
                request.onChunkContent(delta.content);
            }
        }

        for (const [key, val] of Object.entries(delta)) {
            if (key !== 'content' && key !== 'tool_calls' && key !== 'role' && val !== null && val !== undefined) {
                if (typeof val === 'string') {
                    state.currentProviderData[key] = (state.currentProviderData[key] || '') + val;
                } else {
                    state.currentProviderData[key] = val;
                }
            }
        }

        if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
                let targetIndex = toolCall.index;

                if (targetIndex !== undefined && targetIndex !== null) {
                    const existingBuffer = state.toolCallsBuffer[targetIndex];
                    if (existingBuffer && toolCall.id && existingBuffer.id && existingBuffer.id !== toolCall.id) {
                        const keys = Object.keys(state.toolCallsBuffer).map(Number);
                        targetIndex = keys.length > 0 ? Math.max(...keys) + 1 : 0;
                    }
                } else {
                    if (toolCall.id) {
                        const existingKey = Object.keys(state.toolCallsBuffer).find(key => state.toolCallsBuffer[Number(key)].id === toolCall.id);
                        if (existingKey !== undefined) {
                            targetIndex = Number(existingKey);
                        }
                    }
                    
                    if (targetIndex === undefined) {
                        const keys = Object.keys(state.toolCallsBuffer).map(Number);
                        if (keys.length === 0) {
                            targetIndex = 0;
                        } else {
                            const maxKey = Math.max(...keys);
                            const lastBuffer = state.toolCallsBuffer[maxKey];
                            const idConflict = toolCall.id && lastBuffer.id && lastBuffer.id !== toolCall.id;
                            const nameConflict = toolCall.function?.name && lastBuffer.name && lastBuffer.name !== toolCall.function.name;
                            
                            targetIndex = (idConflict || nameConflict) ? maxKey + 1 : maxKey;
                        }
                    }
                }

                if (!state.toolCallsBuffer[targetIndex]) {
                    state.toolCallsBuffer[targetIndex] = { id: '', name: '', arguments: '' };
                }
                if (toolCall.id) state.toolCallsBuffer[targetIndex].id = toolCall.id;
                if (toolCall.function?.name) state.toolCallsBuffer[targetIndex].name = toolCall.function.name;
                if (toolCall.function?.arguments) state.toolCallsBuffer[targetIndex].arguments += toolCall.function.arguments;
            }
        }
    }

    private async executeTools(
        validToolCalls: { id: string; name: string; arguments: string }[],
        implementations: Record<string, any>,
        request: LlmRequest,
        currentMessages: any[]
    ) {
        for (const toolCall of validToolCalls) {
            const name = toolCall.name;
            const argsString = toolCall.arguments;
            let args;
            try {
                args = JSON.parse(argsString);
            } catch (e) {
                console.error(`Failed to parse arguments for tool ${name}: ${argsString}`);
                args = {};
            }

            let result = '';
            const implementation = implementations[name];
            if (implementation) {
                try {
                    result = await implementation(args);
                } catch (e: any) {
                    if (e instanceof ToolAbortError) {
                        throw e;
                    }
                    result = `Error executing ${name}: ${e.message}`;
                }
            } else {
                result = `Error: Tool ${name} not found.`;
            }

            if (request.onToolCall) {
                request.onToolCall(name, args);
            }

            currentMessages.push({
                role: LlmRole.TOOL,
                tool_call_id: toolCall.id,
                content: result
            });

            const toolMsg: LlmMessage = {
                role: LlmRole.TOOL,
                toolCallId: toolCall.id,
                content: result
            };
            if (request.onNewMessage) {
                await request.onNewMessage(toolMsg);
            }
        }
    }
}
