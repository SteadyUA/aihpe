import { Service } from 'typedi';
import { OpenaiRawClient } from '../core/OpenaiRawClient';
import { LlmMessage, LlmRequest, LlmRole } from '../core/types';
import { LlmProvider } from '../../../types/chat';
import { HtmlPlanPrompt } from '../prompts/HtmlPlanPrompt';
import { HtmlExecutionPrompt } from '../prompts/HtmlExecutionPrompt';
import { createOrchestratorTools, createSubagentTools, HtmlConversionContext } from '../tools/HtmlConversionTools';

export interface HtmlOrchestratorRequest {
    workingDirectory: string;
    taskId: string;
    instruction?: string;
    abortSignal?: AbortSignal;
    onPlanUpdated?: () => void;
    onToolCall?: (agentName: 'Orchestrator' | 'Subagent', toolName: string, summary: string) => void;
}

export interface HtmlSubagentRequest {
    workingDirectory: string;
    taskId: string;
    instruction: string;
    targetFiles: string[];
    abortSignal?: AbortSignal;
    onToolCall?: (agentName: 'Orchestrator' | 'Subagent', toolName: string, summary: string) => void;
}

@Service()
export class HtmlConversionAgent {

    public async runOrchestratorLoop(provider: LlmProvider, request: HtmlOrchestratorRequest): Promise<boolean> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);
        const client = new OpenaiRawClient(litellmUrl, litellmKey, modelId);
        
        const systemPrompt = HtmlPlanPrompt;
        
        let messages: LlmMessage[] = [
            { role: LlmRole.SYSTEM, content: systemPrompt },
            { role: LlmRole.USER, content: request.instruction || 'Analyze the directory and create/update the plan in plan.md, then execute it.' }
        ];

        let isFinished = false;

        const onSubagentRun = async (instruction: string, targetFiles: string[]): Promise<string> => {
            const subReq: HtmlSubagentRequest = {
                workingDirectory: request.workingDirectory,
                taskId: request.taskId,
                instruction: instruction,
                targetFiles: targetFiles,
                abortSignal: request.abortSignal,
                onToolCall: request.onToolCall
            };
            return await this.executeSubagentTask(provider, subReq);
        };

        const onFinishImport = () => {
            isFinished = true;
        };

        const context: HtmlConversionContext = {
            workingDirectory: request.workingDirectory,
            taskId: request.taskId,
            onSubagentRun,
            onFinishImport,
            onPlanUpdated: request.onPlanUpdated,
            onToolCall: (agentName, toolName, summary) => {
                if (request.onToolCall) {
                    request.onToolCall(agentName, toolName, summary);
                }
            }
        };

        const tools = createOrchestratorTools()(request as any, context);

        const llmReq: LlmRequest = {
            messages,
            tools: tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
                execute: async (args) => {
                    if (context.onToolCall) {
                        context.onToolCall('Orchestrator', t.name, args.summary || '');
                    }
                    return t.execute(args);
                }
            })),
            abortSignal: request.abortSignal,
            maxSteps: 100
        };

        await client.generate(llmReq);
        return isFinished;
    }

    private async executeSubagentTask(provider: LlmProvider, request: HtmlSubagentRequest): Promise<string> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);
        const client = new OpenaiRawClient(litellmUrl, litellmKey, modelId);
        
        const systemPrompt = HtmlExecutionPrompt;
        
        const messages: LlmMessage[] = [
            { role: LlmRole.SYSTEM, content: systemPrompt },
            { role: LlmRole.USER, content: `Execute this specific instruction:\n\n${request.instruction}\n\nTarget files for this task: ${request.targetFiles.join(', ')}` }
        ];

        let hasReportedSuccess = false;
        let successSummary = '';

        const context: HtmlConversionContext = {
            workingDirectory: request.workingDirectory,
            taskId: request.taskId,
            onSubagentSuccess: (summary: string) => {
                hasReportedSuccess = true;
                successSummary = summary;
            },
            onToolCall: request.onToolCall
        };

        const tools = createSubagentTools()(request as any, context);

        const llmReq: LlmRequest = {
            messages,
            tools: tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
                execute: async (args) => {
                    if (context.onToolCall) {
                        context.onToolCall('Subagent', t.name, args.summary || '');
                    }
                    return t.execute(args);
                }
            })),
            abortSignal: request.abortSignal,
            maxSteps: 30
        };

        await client.generate(llmReq);
        
        if (!hasReportedSuccess) {
            throw new Error('Subagent failed to call report_success. It may have reached the maximum step limit or hallucinated. All changes will be rolled back.');
        }

        return successSummary;
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
