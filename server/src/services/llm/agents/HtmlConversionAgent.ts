import { Service } from 'typedi';
import { OpenaiRawClient } from '../core/OpenaiRawClient';
import { LlmMessage, LlmRequest, LlmRole } from '../core/types';
import { LlmProvider } from '../../../types/chat';
import { HtmlPlanPrompt } from '../prompts/HtmlPlanPrompt';
import { HtmlExecutionPrompt } from '../prompts/HtmlExecutionPrompt';
import { createHtmlConversionTools } from '../tools/HtmlConversionTools';

export interface HtmlPlanRequest {
    workingDirectory: string;
    taskId: string;
    instruction?: string;
    abortSignal?: AbortSignal;
}

export interface HtmlExecutionRequest {
    workingDirectory: string;
    taskId: string;
    currentTask: string;
    instruction?: string;
    abortSignal?: AbortSignal;
}

@Service()
export class HtmlConversionAgent {

    public async plan(provider: LlmProvider, request: HtmlPlanRequest): Promise<string> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);
        const client = new OpenaiRawClient(litellmUrl, litellmKey, modelId);
        
        const systemPrompt = HtmlPlanPrompt;
        
        const messages: LlmMessage[] = [
            { role: LlmRole.SYSTEM, content: systemPrompt },
            { role: LlmRole.USER, content: request.instruction || 'Analyze the working directory and create a granular optimization plan using add_jobs.' }
        ];

        const context = {
            workingDirectory: request.workingDirectory,
            taskId: request.taskId,
        };

        const allTools = createHtmlConversionTools()(request as any, context);
        const planTools = allTools.filter(t => ['list_files', 'add_jobs'].includes(t.name));

        const llmReq: LlmRequest = {
            messages,
            tools: planTools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
                execute: (args) => t.execute(args, context)
            })),
            abortSignal: request.abortSignal
        };

        const result = await client.generate(llmReq);
        
        return result.text;
    }

    public async executeTask(provider: LlmProvider, request: HtmlExecutionRequest): Promise<string> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);
        const client = new OpenaiRawClient(litellmUrl, litellmKey, modelId);
        
        const systemPrompt = HtmlExecutionPrompt;
        
        const messages: LlmMessage[] = [
            { role: LlmRole.SYSTEM, content: systemPrompt },
            { role: LlmRole.USER, content: `Execute this task: ${request.currentTask}\n\n${request.instruction || 'Execute the job.'}` }
        ];

        const context = {
            workingDirectory: request.workingDirectory,
            taskId: request.taskId,
        };

        const allTools = createHtmlConversionTools()(request as any, context);
        const execTools = allTools.filter(t => t.name !== 'add_jobs');

        const llmReq: LlmRequest = {
            messages,
            tools: execTools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
                execute: (args) => t.execute(args, context)
            })),
            abortSignal: request.abortSignal,
            maxSteps: 100
        };

        const result = await client.generate(llmReq);
        
        return result.text;
    }

    private getConfig(provider: LlmProvider) {
        let modelId = '';
        if (provider === 'google') {
            modelId = process.env.GEMINI_MODEL || '';
        } else {
            modelId = process.env.OPENAI_MODEL || '';
        }

        if (!modelId) {
            throw new Error(`Model ID not configured for provider ${provider}`);
        }

        const litellmUrl = process.env.LITELLM_API_URL;
        const litellmKey = process.env.LITELLM_API_KEY;

        if (!litellmUrl || !litellmKey) {
            throw new Error('LITELLM_API_URL and LITELLM_API_KEY must be set');
        }

        return { modelId, litellmUrl, litellmKey };
    }
}
