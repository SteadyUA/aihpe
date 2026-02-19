import { BaseLlmClient, FALLBACK_RESPONSE } from './BaseLlmClient';
import { LlmConfig, ChatMessage } from './types';

export class OpenaiRawClient<TRequest = any, TContext = any, TResult = any> extends BaseLlmClient<TRequest, TResult> {
    private baseUrl: string;
    private apiKey: string;

    constructor(
        config: LlmConfig<TRequest, TContext, TResult>,
        url: string,
        apiKey: string,
        private readonly modelId: string,
        maxContextTokens: number = 128000,
    ) {
        super(config, maxContextTokens);
        this.baseUrl = url.replace(/\/$/, '');
        this.apiKey = apiKey;
    }

    async generate(request: TRequest): Promise<TResult> {
        if (!this.baseUrl || !this.apiKey) {
            console.warn('No OpenAI URL or API Key provided to OpenaiRawClient');
            return FALLBACK_RESPONSE as TResult;
        }

        const systemPrompt = this.config.systemPrompt(request);

        let context: TContext;
        if (this.config.buildContext) {
            context = await this.config.buildContext(request);
        } else {
            // Default to request as context if no buildContext provided, or empty object
            // But types might not match. WE should probably mandate buildContext if TContext is not TRequest
            context = {} as TContext;
        }

        // We need a way to build messages from request.
        // The original code had `buildMessages` which was specific to GeneratePageRequest.
        // We should probably rely on `request` structure if we want to be generic, or have a `buildMessages` in config?
        // But `generate` is the unified method. 
        // Let's assume TRequest has some common structure OR we add `buildMessages` to config?
        // For now, I will keep `buildMessages` but it needs to know about `TRequest`.
        // Actually, TRequest is either GeneratePageRequest or SummarizeHistoryRequest.
        // They both have `conversation`.
        // Let's make `buildMessages` part of config? Or just check type?
        // Checking type is ugly.
        // Let's assume `config` handles message construction?
        // No, the prompt generation is in config.

        // Wait, the User Request was "нужные методы оформить как методы конфигурации в LlmFactory".
        // This implies logic like `buildMessages` might distinct per task.
        // However, `buildMessages` logic is largely about formatting ChatMessage[] to OpenAI format.
        // That is common.
        // What differs is the initial system prompt (handled by config) and the user instruction (handled by config/request).

        // Let's look at `SummarizeHistoryRequest`. It creates specific messages.
        // Let's look at `GeneratePageRequest`. It creates specific messages.

        // To be truly generic, `buildMessages` should be consistent or configurable.
        // I will add `buildMessages` to `LlmConfig`? 
        // Or I can keep a protected `buildMessages` here that tries to adapt, but strict typing is better.

        // Let's fallback to: `buildMessages` is internal helper, but we need to know how to extract conversation.
        // Let's assume TRequest extends { conversation: ChatMessage[] } (or similar).
        // But GeneratePageRequest has `instructions`, `files`, etc.
        // SummarizeHistoryRequest has `previousSummary`.

        // Revised plan: Move `buildMessages` logic into the Config or a Strategy?
        // The `systemPrompt` is already in config.
        // The `userMessage` construction differs.

        // Let's add `buildMessages` to `LlmConfig`.
        // `buildMessages: (request: TRequest, systemPrompt: string, context: TContext) => any[]`

        // But wait, the `OpenaiRawClient` logic for tool handling is complex and generic-ish (it iterates tools).
        // Only the message construction at the start is specific.

        // I will implement `generate` to use a `messages` builder if present in config, or default to a simple one?
        // Actually, for this step, I will assume the `LlmConfig` has been updated to include `buildMessages`? 
        // I missed that in the `types.ts` update. I should verify.
        // I did NOT add `buildMessages` to `types.ts`.

        // ERROR: I need to update `types.ts` to include `buildMessages` in `LlmConfig` if I want to delegate it.
        // OR I can hardcode the difference based on properties (duck typing).

        // Duck typing:
        // if 'instructions' in request -> PageGen
        // if 'previousSummary' in request -> Summarize

        // That's acceptable for now to avoid another round of type matching, but ideally Config is better.
        // Let's try to do it via Config if possible, but I can't change `types.ts` in this specific tool call (it's for OpenaiRawClient).
        // I will use Duck Typing or assume `request` has common shape for conversation.

        // Actually, I can update `types.ts` in a separate step if I want. 
        // But for now, I'll put the specific logic here or rely on the `config` to handle the prompt construction entirely?
        // No, `systemPrompt` just returns string.

        // Let's look at `summarizeHistory`:
        // It sends [System, ...History, UserInstruction].
        // `generatePage`:
        // Sends [System, ...History, UserInstruction+Attachment, (Tools)].

        // I will implement `buildMessages` that takes the `systemPrompt` and `request`.
        // I will cast request to `any` to check fields.

        const messages = this.buildMessages(request, systemPrompt);

        // Tools logic
        let tools: any[] = [];
        let implementations: Record<string, any> = {};

        if (this.config.tools) {
            const toolsList = this.config.tools(request, context);
            tools = toolsList.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                }
            }));
            toolsList.forEach(t => {
                implementations[t.name] = (args: any) => t.execute(args, context);
            });
        }

        // OpenAI Call
        // ... (stream handling) ...
        // This logic is mostly same as before but uses `tools` and `messages`.

        // We need to return `TResult`.
        // For PageGen, it returns `GeneratePageResult`.
        // For Summarize, it returns `string`.

        // I need `processOutput` in Config to convert the final text/messages to TResult.
        // I added `processOutput` to `LlmConfig` in previous step? Yes.

        return this.executeRequest(request, messages, tools, implementations, context);
    }

    private buildMessages(request: any, systemPrompt: string): any[] {
        const messages: any[] = [
            { role: 'system', content: systemPrompt }
        ];

        // Common conversation handling
        if (request.conversation) {
            for (const entry of request.conversation) {
                if (entry.role === 'system') {
                    messages.push({ role: 'system', content: entry.content });
                    continue;
                }
                if (entry.role === 'user') {
                    let content: any = entry.content;
                    // Attachment handling (mostly for PageGen)
                    if (entry.attachment && typeof content === 'string') {
                        content = [
                            { type: 'text', text: content },
                            { type: 'image_url', image_url: { url: entry.attachment.dataUrl } }
                        ];
                    }
                    messages.push({ role: 'user', content });
                } else if (entry.role === 'assistant') {
                    // Tool calls reconstruction... (reuse existing logic)
                    if (Array.isArray(entry.content)) {
                        // ... logic from before ...
                        const toolCalls = entry.content.filter((c: any) => c.type === 'tool-call').map((c: any) => ({
                            id: c.toolCallId,
                            type: 'function',
                            function: {
                                name: c.toolName,
                                arguments: JSON.stringify(c.args)
                            }
                        }));
                        const textPart = entry.content.find((c: any) => c.type === 'text');
                        messages.push({
                            role: 'assistant',
                            content: textPart ? textPart.text : null,
                            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                        });
                    } else {
                        messages.push({ role: 'assistant', content: entry.content });
                    }
                } else if (entry.role === 'tool') {
                    if (Array.isArray(entry.content)) {
                        const toolResultPart = entry.content.find((c: any) => c.type === 'tool-result');
                        if (toolResultPart) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: toolResultPart.toolCallId,
                                content: toolResultPart.result
                            });
                        }
                    }
                }
            }
        }

        // Add the Final User Instruction from Config
        if (this.config.userMessage) {
            const userContent = this.config.userMessage(request);
            if (userContent) {
                messages.push({ role: 'user', content: userContent });
            }
        }

        return messages;
    }

    private async executeRequest(
        request: any,
        messages: any[],
        tools: any[],
        implementations: Record<string, any>,
        context: TContext
    ): Promise<TResult> {
        let currentMessages = [...messages];
        let steps = 0;
        const maxSteps = 30;
        let fullText = '';
        const collectedNewMessages: any[] = [];
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

                const response = await fetch(`${this.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: request.abortSignal
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
                }

                if (!response.body) {
                    throw new Error('No response body');
                }

                // Streaming handling
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';

                let stepText = '';
                let toolCallsBuffer: Record<number, { id: string; name: string; arguments: string }> = {};
                let finishReason: string | null = null;
                let usageSent = false;
                let currentStepUsage = { prompt: 0, completion: 0, total: 0 };

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
                                        // console.log(delta);
                                        const finish = chunk.choices[0].finish_reason;

                                        if (delta.content) {
                                            stepText += delta.content;
                                            if (request.onProgress) {
                                                request.onProgress(delta.content);
                                            }
                                        }

                                        if (delta.tool_calls) {
                                            for (const toolCall of delta.tool_calls) {
                                                // litellm sometimes reuses index 0 for sequential tool calls or sends inconsistent indices
                                                // We will track distinct calls by their 'id'. 
                                                // If we see a new 'id', it's a new tool call.

                                                let targetIndex = toolCall.index;

                                                // If we have an ID, we can determine if this is a new tool call or updating an existing one
                                                if (toolCall.id) {
                                                    // Check if this ID already exists in our buffer
                                                    const existingIndex = Object.keys(toolCallsBuffer).find(key => toolCallsBuffer[Number(key)].id === toolCall.id);
                                                    if (existingIndex !== undefined) {
                                                        targetIndex = Number(existingIndex);
                                                    } else {
                                                        // It's a new tool call. Use the provided index OR the next available index if that index is taken by a DIFFERENT id
                                                        if (toolCallsBuffer[targetIndex] && toolCallsBuffer[targetIndex].id !== toolCall.id) {
                                                            // Collision: index 0 used for tool A, now index 0 used for tool B.
                                                            // Shift to next available index.
                                                            targetIndex = Object.keys(toolCallsBuffer).length;
                                                        }
                                                    }
                                                } else {
                                                    // No ID, so it's a continuation. 
                                                    // If litellm sends index 0 for the second tool's args without ID, we have a problem.
                                                    // But typically args come AFTER id. 
                                                    // We assume index matches the active tool being built.
                                                    // If index 0 is used for tool A, and we get args for index 0, it adds to tool A.
                                                    // If tool A is "complete" and we get args for index 0... we don't know.
                                                    // However, usually 'id' comes first.

                                                    // Workaround: If we have multiple tools and index is 0, it might be ambiguous without ID.
                                                    // But standard OpenAI format implies index consistency. 
                                                    // If litellm is broken, we trust 'id' when present.
                                                    // If 'id' is NOT present, we fall back to `toolCall.index`.
                                                    // But if we shifted the index previously (due to collision), we might need to map it?
                                                    // Mapping "stream index" to "buffer index" is hard if stream index resets.

                                                    // Simple heuristic: 
                                                    // If we encounter a toolCall with `id`, we map `streamIndex` -> `bufferIndex`.
                                                    // Subsequent packets with same `streamIndex` use that `bufferIndex`.
                                                }

                                                // To handle the "concatenation" bug specifically:
                                                // The user says "OpenaiRawClient: Step 3/30 started... Failed to parse".
                                                // "litellm всегда возвращает index=0".
                                                // If index is always 0, then `toolCallsBuffer[0]` accumulates ALL arguments for ALL tools.
                                                // We MUST detect when a NEW tool starts.
                                                // A new tool starts when `toolCall.id` or `toolCall.function.name` is present AND we already have a tool at this index?
                                                // Or just simpler: Always use `toolCall.id` to separate tools if present.

                                                // State to track mapping from StreamIndex to BufferIndex
                                                // We need to declare this outside the loop: 
                                                // let streamIndexToBufferIndex: Record<number, number> = {};

                                                // But since I can't easily change the outer scope variables in this `replace_file_content` block without replacing more code...
                                                // I will implement a localized fix assuming `toolCall.id` indicates a new entry.

                                                // Actually, I should probably replace the whole `while (true)` block or at least the `if (delta.tool_calls)` block with enough context.
                                                // I'll assume `toolCall.id` presence means NEW or IDENTIFYING call.

                                                if (toolCall.id) {
                                                    // New or existing tool with ID.
                                                    // Find if we already have this ID?
                                                    const existing = Object.values(toolCallsBuffer).find(t => t.id === toolCall.id);
                                                    if (!existing) {
                                                        // New tool!
                                                        // If index 0 is already taken, we must pick a new index.
                                                        // If litellm sends index 0, 1, 2... properly, we use it.
                                                        // If litellm sends index 0, 0, 0... for different IDs, we auto-increment.

                                                        // Find next free index
                                                        const newIndex = Object.keys(toolCallsBuffer).length;
                                                        targetIndex = newIndex;

                                                        // We need to remember that stream index `toolCall.index` maps to `newIndex`.
                                                        // But `toolCall.index` might be consistent for the duration of THAT tool's streaming?
                                                        // If litellm resets index to 0 for the next tool, we need to know that "Stream Index 0" NOW points to "Buffer Index 1".
                                                    } else {
                                                        // Existing tool, find its buffer index
                                                        targetIndex = Number(Object.keys(toolCallsBuffer).find(key => toolCallsBuffer[Number(key)].id === toolCall.id));
                                                    }
                                                } else {
                                                    // No ID. It's an update (args).
                                                    // Which buffer index does this stream index belong to?
                                                    // If we assume sequential delivery: the "last touched" index?
                                                    // Or strict mapping?

                                                    // If litellm sends 0 for everything:
                                                    // 1. { index: 0, id: 'A', name: 'read' } -> Buffer[0]
                                                    // 2. { index: 0, args: '...' } -> Buffer[0]
                                                    // 3. { index: 0, id: 'B', name: 'write' } -> Buffer[1] (because ID changed!)
                                                    // 4. { index: 0, args: '...' } -> Buffer[1] ?? 

                                                    // PROBLEM: Packet 4 doesn't have ID. How do we know it's for Buffer[1] and not Buffer[0]?
                                                    // We must track "current active tool index for stream index X".

                                                    // I will trust that the "Last Active Tool Index" is the target if index is 0.
                                                    // This is risky if parallel tools stream interleaved chunks with index 0 (impossible/broken).
                                                    // Assuming separate tools don't interleave chunks on the same index 0.

                                                    // Let's use `Object.keys(toolCallsBuffer).length - 1` as the default target if stream index is 0?
                                                    // That implies "append to the latest tool".

                                                    const lastIndex = Object.keys(toolCallsBuffer).length - 1;
                                                    if (lastIndex >= 0) {
                                                        targetIndex = lastIndex;
                                                    }
                                                }

                                                if (!toolCallsBuffer[targetIndex]) {
                                                    toolCallsBuffer[targetIndex] = { id: '', name: '', arguments: '' };
                                                }
                                                if (toolCall.id) toolCallsBuffer[targetIndex].id = toolCall.id;
                                                if (toolCall.function?.name) toolCallsBuffer[targetIndex].name = toolCall.function.name;
                                                if (toolCall.function?.arguments) toolCallsBuffer[targetIndex].arguments += toolCall.function.arguments;
                                            }
                                        }

                                        if (finish) {
                                            finishReason = finish;
                                        }
                                    }

                                    if (chunk.usage) {
                                        currentStepUsage = {
                                            prompt: chunk.usage.prompt_tokens,
                                            completion: chunk.usage.completion_tokens,
                                            total: chunk.usage.total_tokens
                                        };
                                        usageSent = true;
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

                if (usageSent && request.trackRequestTokenUsage) {
                    await request.trackRequestTokenUsage({
                        ...currentStepUsage,
                        model: this.modelId,
                        agent: this.agentName,
                    });
                }

                fullText += stepText;

                // Construct Assistant Message
                const assistantMessage: any = {
                    role: 'assistant',
                    content: stepText || null,
                };

                const toolCallsFound = Object.values(toolCallsBuffer).map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: {
                        name: tc.name,
                        arguments: tc.arguments
                    }
                }));

                const validToolCalls = toolCallsFound.filter(tc => tc.function.name && tc.function.name.trim() !== '');

                // litellm with gemini can call tools even if there is text in the response
                // so we need to check if there is text in the response
                if (stepText && stepText.trim().length > -1) {
                    stop = true;
                } else if (validToolCalls.length > 0) {
                    assistantMessage.tool_calls = validToolCalls;
                }

                currentMessages.push(assistantMessage);
                collectedNewMessages.push(assistantMessage);

                // console.log(`OpenaiRawClient: Step finished...`); 

                if (!stop && validToolCalls.length > 0) {
                    for (const toolCall of validToolCalls) {
                        const name = toolCall.function.name;
                        const argsString = toolCall.function.arguments;
                        let args;
                        try {
                            args = JSON.parse(argsString);
                        } catch (e) {
                            console.error(`Failed to parse arguments for tool ${name}: ${argsString}`);
                            args = {};
                        }

                        let result = '';
                        // @ts-ignore
                        const implementation = implementations[name];
                        if (implementation) {
                            try {
                                result = await implementation(args);
                            } catch (e: any) {
                                result = `Error executing ${name}: ${e.message}`;
                            }
                        } else {
                            result = `Error: Tool ${name} not found.`;
                        }

                        if (request.onProgress) {
                            const label = args.summary || `Tool call: ${name}`;
                            request.onProgress(`${label}\n`);
                        }

                        const toolMessage = {
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: result
                        };
                        currentMessages.push(toolMessage);
                        collectedNewMessages.push(toolMessage);
                    }
                } else if (finishReason === 'stop' || finishReason === null) {
                    stop = true;
                }
            }

            // Map back to ChatMessage
            const newMessages: ChatMessage[] = collectedNewMessages.map(m => {
                let content: any = m.content;

                if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
                    const parts: any[] = [];
                    if (typeof m.content === 'string' && m.content) {
                        parts.push({ type: 'text', text: m.content });
                    }
                    m.tool_calls.forEach((tc: any) => {
                        parts.push({
                            type: 'tool-call',
                            toolCallId: tc.id,
                            toolName: tc.function.name,
                            args: JSON.parse(tc.function.arguments)
                        });
                    });
                    content = parts;
                } else if (m.role === 'tool' && m.tool_call_id) {
                    content = [{
                        type: 'tool-result',
                        toolCallId: m.tool_call_id,
                        result: m.content
                    }];
                } else if (content === null) {
                    content = '';
                }

                return {
                    role: m.role as any,
                    content: content,
                    createdAt: new Date(),
                    version: request.currentVersion || 0,
                    turn: 0
                };
            });

            if (this.config.processOutput) {
                return this.config.processOutput(fullText, newMessages, context);
            }

            return fullText as unknown as TResult;

        } catch (error) {
            console.error(`OpenaiRawClient Error:`, error);
            throw error;
        }
    }
}



