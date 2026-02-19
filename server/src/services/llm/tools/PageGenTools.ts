import { ImageService } from '../../image/ImageService';
import { FilesService } from '../../session/FilesService';
import { SessionService } from '../../session/SessionService';
import { GeneratePageRequest, SessionFiles, LlmTool } from '../types';

export interface PageGenContext {
    currentFiles: SessionFiles;
    ensureNextVersion: (sessionId: string) => Promise<number>;
}

export function createPageGenTools(
    imageService: ImageService,
    filesService: FilesService,
    sessionService: SessionService
): (
    request: GeneratePageRequest,
    context: PageGenContext
) => LlmTool[] {
    return (
        request: GeneratePageRequest,
        context: PageGenContext
    ) => {
        const { currentFiles, ensureNextVersion } = context;

        const tools: LlmTool[] = [
            {
                name: 'read_file',
                description: 'Read the content of a file. Use this to understand current code before editing.',
                parameters: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', enum: ['index.html', 'styles.css', 'script.js'], description: 'The file to read' },
                        summary: { type: 'string', description: 'Explain why you need to read this file.' }
                    },
                    required: ['file', 'summary']
                },
                execute: async ({
                    file,
                    summary,
                }: {
                    file: 'index.html' | 'styles.css' | 'script.js';
                    summary: string;
                }) => {
                    const content = currentFiles[file];
                    if (content !== undefined) return content;
                    return 'File not found';
                }
            },
            {
                name: 'edit_file',
                description: 'Edit a file by replacing exact string match.',
                parameters: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', enum: ['index.html', 'styles.css', 'script.js'], description: 'The file to edit' },
                        oldString: { type: 'string', description: 'The exact string to replace.' },
                        newString: { type: 'string', description: 'The new string to replace it with.' },
                        summary: { type: 'string', description: 'Explain why you are making this edit.' }
                    },
                    required: ['file', 'oldString', 'newString', 'summary']
                },
                execute: async ({
                    file,
                    oldString,
                    newString,
                    summary,
                }: {
                    file: 'index.html' | 'styles.css' | 'script.js';
                    oldString: string;
                    newString: string;
                    summary: string;
                }) => {
                    // Logic for Workflow:
                    // 1. If editing code files, we MUST ensure a new version exists.
                    //    This matches the FIRST code edit in this turn.

                    await ensureNextVersion(request.sessionId);

                    let content = currentFiles[file] || '';
                    if (!content && (file === 'styles.css' || file === 'script.js')) {
                        // Allow empty css/js if undefined
                        content = '';
                    } else if (content === undefined) {
                        return `Error: File ${file} not found.`;
                    }

                    let targetString = oldString;
                    if (!content.includes(targetString)) {
                        // Try flexible matching for trailing/leading whitespace
                        if (content.includes(targetString.trim())) {
                            targetString = targetString.trim();
                        } else {
                            // Try normalizing newlines (CRLF vs LF)
                            const normalizedContent = content.replace(
                                /\r\n/g,
                                '\n',
                            );
                            const normalizedTarget = targetString.replace(
                                /\r\n/g,
                                '\n',
                            );
                            if (normalizedContent.includes(normalizedTarget)) {
                                content = normalizedContent;
                                targetString = normalizedTarget;
                            } else if (
                                normalizedContent.includes(
                                    normalizedTarget.trim(),
                                )
                            ) {
                                content = normalizedContent;
                                targetString = normalizedTarget.trim();
                            } else {
                                return `Error: oldString not found in ${file}`;
                            }
                        }
                    }

                    if (content.split(targetString).length > 2)
                        return `Error: oldString found multiple times in ${file}. Provide more unique context.`;

                    const newContent = content.replace(targetString, newString);
                    currentFiles[file] = newContent;


                    return `Successfully updated ${file}`;
                }
            },
            {
                name: 'update_subject',
                description: 'Update the subject/topic of the session.',
                parameters: {
                    type: 'object',
                    properties: {
                        subject: { type: 'string', description: 'The new subject (3-5 words).' }
                    },
                    required: ['subject']
                },
                execute: async ({ subject }: { subject: string }) => {
                    await sessionService.updateMetadata(request.sessionId, { subject });
                    if (request.onPatch) {
                        request.onPatch({ subject });
                    }
                    return `Session subject updated to: "${subject}"`;
                },
                // No ensureNextVersion needed here, uses sessionService directly
            },
            {
                name: 'read_subject',
                description: 'Read the current subject/topic of the session.',
                parameters: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string', description: 'Explain why you are checking the subject/topic.' }
                    },
                    required: ['summary']
                },
                execute: async ({ summary }: { summary?: string }) => {
                    const currentSubject = request.subject || '...';
                    return `Current Session Subject: "${currentSubject}"`;
                },
            },
            {
                name: 'list_images',
                description: 'List available UNUSED images in the current session.',
                parameters: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string', description: 'Explain why you are listing images.' }
                    },
                    required: ['summary']
                },
                execute: async ({ summary }: { summary: string }) => {
                    try {
                        const images = await imageService.listImages(request.sessionId, request.currentVersion);
                        const unusedImages = images.filter((img) => !img.isUsed && img.description && img.description.trim() !== '');

                        if (unusedImages.length === 0) {
                            return 'No unused images found in this session.';
                        }
                        return JSON.stringify(unusedImages.map((img) => ({
                            filename: img.filename,
                            description: img.description,
                            width: img.width,
                            height: img.height,
                            model: img.model
                        })));
                    } catch (error: any) {
                        return `Failed to list images: ${error.message}`;
                    }
                }
            },
            {
                name: 'image_info',
                description: 'Get details about a specific image.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', description: 'The filename of the image.' },
                        summary: { type: 'string', description: 'Explain why you are requesting info.' }
                    },
                    required: ['filename', 'summary']
                },
                execute: async ({ filename, summary }: { filename: string; summary: string }) => {
                    try {
                        const info = await imageService.getImageInfo(request.sessionId, request.currentVersion, filename);
                        if (!info) {
                            return `Image not found: ${filename}`;
                        }
                        return JSON.stringify({
                            filename: info.filename,
                            description: info.description,
                            width: info.width,
                            height: info.height,
                            model: info.model
                        });
                    } catch (error: any) {
                        return `Failed to get image info: ${error.message}`;
                    }
                }
            },
            {
                name: 'generate_image',
                description: 'Generate an image based on a description.',
                parameters: {
                    type: 'object',
                    properties: {
                        description: { type: 'string', description: 'Detailed description of the image.' },
                        summary: { type: 'string', description: 'Explain why you are generating this image.' }
                    },
                    required: ['description', 'summary']
                },
                execute: async ({ description, summary }: { description: string; summary: string }) => {
                    try {
                        const nextVersion = await ensureNextVersion(request.sessionId);
                        const filename = await imageService.generateAndSave(request.sessionId, description, nextVersion, undefined, request.abortSignal, request.trackRequestTokenUsage);
                        return `Image generated successfully: ${filename}`;
                    } catch (error: any) {
                        return `Failed to generate image: ${error.message}`;
                    }
                }
            },
            {
                name: 'edit_image',
                description: 'Edit an existing image based on a description.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', description: 'The filename of the image to edit.' },
                        description: { type: 'string', description: 'The instruction for editing the image.' },
                        summary: { type: 'string', description: 'Explain why you are editing this image.' }
                    },
                    required: ['filename', 'description', 'summary']
                },
                execute: async ({ filename, description, summary }: { filename: string; description: string; summary: string }) => {
                    try {
                        const nextVersion = await ensureNextVersion(request.sessionId);
                        // Use currentVersion as source, nextVersion as target
                        const savedFilename = await imageService.editAndSave(request.sessionId, filename, description, request.currentVersion, nextVersion, request.abortSignal, request.trackRequestTokenUsage);
                        return `Image edited successfully: ${savedFilename}`;
                    } catch (error: any) {
                        return `Failed to edit image: ${error.message}`;
                    }
                }
            }
        ];

        if (request.allowVariants) {
            tools.push({
                name: 'generate_variant',
                description: 'Generate A SINGLE variant of the page.',
                parameters: {
                    type: 'object',
                    properties: {
                        instruction: { type: 'string', description: 'Specific, actionable instruction for this variant.' }
                    },
                    required: ['instruction']
                },
                execute: async (args: {
                    instruction: string;
                }) => {
                    if (request.onVariantRequest) {
                        return await request.onVariantRequest(args.instruction);
                    }
                    return 'Variant generation not supported in this context.';
                }
            });
        }

        return tools;
    };
}
