import { Service, Inject } from 'typedi';
import { GeneratePageRequest, GeneratePageResult, LlmClient, LlmConfig, SummarizeHistoryRequest } from './types';
import { OpenaiRawClient } from './OpenaiRawClient';
import { ImageService } from '../image/ImageService';
import { FilesService } from '../session/FilesService';
import { SessionService } from '../session/SessionService';
import { LlmProvider } from '../../types/chat';
import { buildPageGenPrompt } from './prompts/PageGenPrompt';
import { createPageGenTools, PageGenContext } from './tools/PageGenTools';
import { getHistorySummaryPrompt, getHistorySummaryUserInstruction } from './prompts/HistorySummaryPrompt';
import { HtmlPlanPrompt } from './prompts/HtmlPlanPrompt';
import { HtmlExecutionPrompt } from './prompts/HtmlExecutionPrompt';
import { createHtmlConversionTools } from './tools/HtmlConversionTools';

@Service()
export class LlmFactory {
    @Inject()
    private imageService!: ImageService;

    @Inject()
    private filesService!: FilesService;

    @Inject()
    private sessionService!: SessionService;

    getPageGenClient(provider: LlmProvider = 'openai'): LlmClient<GeneratePageRequest, GeneratePageResult> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);

        // Closure to manage targetVersion state for this client instance
        // In the original BaseLlmClient, targetVersion was an instance property.
        // Here we need to capture it in the context builder or separate closure?
        // Since getPageGenClient returns a NEW client instance specific to a request? 
        // No, typically factories return a client that might be reused?
        // But OpenaiRawClient is a class. 
        // The `ensureNextVersion` needs to be stateful PER REQUEST if possible, or per session?
        // In BaseLlmClient, it was per INSTANCE of the client.
        // If the client is instantiated per request, it works.
        // If the client is singleton, this breaks.
        // Old LlmFactory.getClient didn't cache. It created `new OpenaiRawClient`.
        // So we are safe to assume new instance.

        let targetVersion: number | undefined;

        const ensureNextVersion = async (sessionId: string): Promise<number> => {
            if (targetVersion === undefined) {
                const metadata = await this.sessionService.getMetadata(sessionId);
                const currentVersion = metadata?.currentVersion || 0;
                targetVersion = await this.filesService.initNextVersion(sessionId, currentVersion);
            }
            return targetVersion;
        };

        const config: LlmConfig<GeneratePageRequest, PageGenContext, GeneratePageResult> = {
            systemPrompt: buildPageGenPrompt,
            buildContext: async (request) => {
                return {
                    currentFiles: request.files,
                    ensureNextVersion: ensureNextVersion
                };
            },
            tools: createPageGenTools(this.imageService, this.filesService, this.sessionService),
            processOutput: async (output, messages, context) => {
                return {
                    summary: output,
                    files: context.currentFiles, // Tools modify this in place
                    newMessages: messages,
                    targetVersion: targetVersion // captured from closure
                };
            },
            userMessage: (request) => {
                let userContent: any = request.fastMode ? `No plan\n${request.instructions}` : request.instructions;
                if (request.attachment) {
                    userContent = [
                        { type: 'text', text: userContent },
                        { type: 'image_url', image_url: { url: request.attachment.dataUrl } }
                    ];
                }
                return userContent;
            }
        };

        return new OpenaiRawClient(
            config,
            litellmUrl,
            litellmKey,
            modelId
        );
    }

    getHistoryClient(provider: LlmProvider = 'openai'): LlmClient<SummarizeHistoryRequest, string> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);

        const config: LlmConfig<SummarizeHistoryRequest, any, string> = {
            systemPrompt: (request) => getHistorySummaryPrompt(request.previousSummary),
            // No tools for history summary
            processOutput: async (output) => output,
            userMessage: () => getHistorySummaryUserInstruction()
        };

        return new OpenaiRawClient(
            config,
            litellmUrl,
            litellmKey,
            modelId
        );
    }

    getHtmlPlanClient(workingDirectory: string, taskId: string, provider: LlmProvider = 'openai'): LlmClient<any, string> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);

        const config: LlmConfig<any, any, string> = {
            systemPrompt: () => HtmlPlanPrompt,
            buildContext: async (request: any) => ({ workingDirectory, taskId, abortController: request.abortController }),
            // Give planner only basic analyze and add_tasks tools
            tools: (req, ctx) => createHtmlConversionTools()(req, ctx).filter(t =>
                ['list_files', 'add_jobs'].includes(t.name)
            ),
            processOutput: async (output) => output,
            userMessage: (request) => request.instruction || 'Analyze and create an optimization plan.'
        };

        return new OpenaiRawClient(
            config,
            litellmUrl,
            litellmKey,
            modelId
        );
    }

    getHtmlExecutionClient(workingDirectory: string, taskId: string, currentTask: string, provider: LlmProvider = 'openai'): LlmClient<any, string> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);

        const config: LlmConfig<any, any, string> = {
            systemPrompt: () => HtmlExecutionPrompt,
            buildContext: async (request: any) => ({ workingDirectory, taskId, abortController: request.abortController }),
            // Give execution agent all tools except add_tasks
            tools: (req, ctx) => createHtmlConversionTools()(req, ctx).filter(t => t.name !== 'add_jobs'),
            processOutput: async (output) => output,
            userMessage: () => `Execute this task: ${currentTask}`
        };

        return new OpenaiRawClient(
            config,
            litellmUrl,
            litellmKey,
            modelId
        );
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
