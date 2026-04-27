import { ImageService } from '../../image/ImageService';
import { FilesService } from '../../session/FilesService';
import { MemoryService } from '../../session/MemoryService';
import { SessionService } from '../../session/SessionService';
import { GeneratePageRequest } from '../types';

export interface PageGenContext {
    getTargetVersion: () => number | undefined;
    ensureNextVersion: (sessionId: string) => Promise<number>;
}

export function createPageGenTools(
    imageService: ImageService,
    filesService: FilesService,
    sessionService: SessionService,
    memoryService: MemoryService
): (
    request: GeneratePageRequest,
    context: PageGenContext
) => any[] {
    return (
        request: GeneratePageRequest,
        context: PageGenContext
    ) => {
        const { ensureNextVersion, getTargetVersion } = context;

        const tools: any[] = [
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
                }: {
                    file: 'index.html' | 'styles.css' | 'script.js';
                    summary: string;
                }) => {
                    const version = getTargetVersion() ?? request.currentVersion;
                    const content = filesService.readVersionFile(request.sessionId, version, file);
                    if (content !== undefined) return content;

                    // Fallback to initial files if not found
                    const { EMPTY_FILES } = await import('../../session/FilesService');
                    const emptyContent = EMPTY_FILES[file];
                    if (emptyContent !== undefined) return emptyContent;

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
                }: {
                    file: 'index.html' | 'styles.css' | 'script.js';
                    oldString: string;
                    newString: string;
                    summary: string;
                }) => {
                    // Logic for Workflow:
                    // 1. If editing code files, we MUST ensure a new version exists.
                    //    This matches the FIRST code edit in this turn.

                    let nextVersion = await ensureNextVersion(request.sessionId);

                    let content = filesService.readVersionFile(request.sessionId, nextVersion, file);

                    if (content === undefined) {
                        const { EMPTY_FILES } = await import('../../session/FilesService');
                        content = EMPTY_FILES[file];
                    }

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
                    filesService.writeVersionFile(request.sessionId, nextVersion, file, newContent);


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
                execute: async (_args: { summary?: string }) => {
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
                execute: async (_args: { summary: string }) => {
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
                execute: async ({ filename }: { filename: string; summary: string }) => {
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
                execute: async ({ description }: { description: string; summary: string }) => {
                    try {
                        const nextVersion = await ensureNextVersion(request.sessionId);
                        const filename = await imageService.generateAndSave(request.sessionId, description, nextVersion, undefined, request.abortSignal);
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
                execute: async ({ filename, description }: { filename: string; description: string; summary: string }) => {
                    try {
                        const nextVersion = await ensureNextVersion(request.sessionId);
                        // Use currentVersion as source, nextVersion as target
                        const savedFilename = await imageService.editAndSave(request.sessionId, filename, description, request.currentVersion, nextVersion, request.abortSignal);
                        return `Image edited successfully: ${savedFilename}`;
                    } catch (error: any) {
                        return `Failed to edit image: ${error.message}`;
                    }
                }
            },
            {
                name: 'read_memory_file',
                description: 'Read a memory file to recall technical decisions, state, or user preferences.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', enum: ['preferences.md', 'state.md', 'decisions.md'], description: 'The memory file to read.' },
                        summary: { type: 'string', description: 'Explain why you are reading this memory file.' }
                    },
                    required: ['filename', 'summary']
                },
                execute: async ({ filename }: { filename: string; summary: string }) => {
                    try {
                        const version = getTargetVersion() ?? request.currentVersion;
                        const content = memoryService.readMemoryFile(request.sessionId, version, filename);
                        return content || '(File is empty)';
                    } catch (error: any) {
                        return `Failed to read memory file: ${error.message}`;
                    }
                }
            },
            {
                name: 'edit_memory_file',
                description: 'Edit a memory file by replacing an exact string match. Use this instead of update_memory_file to add new lines or modify existing lines without rewriting the whole file.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', enum: ['preferences.md', 'state.md', 'decisions.md'], description: 'The memory file to edit.' },
                        oldString: { type: 'string', description: 'The exact string to replace. Use empty string "" to append to the end of the file.' },
                        newString: { type: 'string', description: 'The new string to replace it with (or to append).' },
                        summary: { type: 'string', description: 'Explain why you are editing this memory file.' }
                    },
                    required: ['filename', 'oldString', 'newString', 'summary']
                },
                execute: async ({ filename, oldString, newString }: { filename: string; oldString: string; newString: string; summary: string }) => {
                    try {
                        const version = getTargetVersion() ?? request.currentVersion;
                        let content = memoryService.readMemoryFile(request.sessionId, version, filename) || '';

                        if (oldString === '') {
                            content = content.trim() + (content ? '\n\n' : '') + newString;
                        } else {
                            let targetString = oldString;
                            if (!content.includes(targetString)) {
                                if (content.includes(targetString.trim())) {
                                    targetString = targetString.trim();
                                } else {
                                    const normalizedContent = content.replace(/\r\n/g, '\n');
                                    const normalizedTarget = targetString.replace(/\r\n/g, '\n');
                                    if (normalizedContent.includes(normalizedTarget)) {
                                        content = normalizedContent;
                                        targetString = normalizedTarget;
                                    } else if (normalizedContent.includes(normalizedTarget.trim())) {
                                        content = normalizedContent;
                                        targetString = normalizedTarget.trim();
                                    } else {
                                        return `Error: oldString not found in ${filename}`;
                                    }
                                }
                            }

                            if (content.split(targetString).length > 2) {
                                return `Error: oldString found multiple times in ${filename}. Provide more unique context.`;
                            }

                            content = content.replace(targetString, newString);
                        }

                        const nextVersion = await ensureNextVersion(request.sessionId);
                        memoryService.updateMemoryFile(request.sessionId, nextVersion, filename, content);
                        return `Successfully edited memory file: ${filename}`;
                    } catch (error: any) {
                        return `Failed to edit memory file: ${error.message}`;
                    }
                }
            },
            {
                name: 'update_memory_file',
                description: 'Update a memory file to persist new technical decisions, state changes, or user preferences for future turns.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', enum: ['preferences.md', 'state.md', 'decisions.md'], description: 'The memory file to update.' },
                        content: { type: 'string', description: 'The FULL updated content of the memory file. You MUST preserve all previous historical information and integrate your new updates. DO NOT aggressively summarize or delete old context (files can safely be up to 200 lines long).' },
                        summary: { type: 'string', description: 'Explain why you are updating this memory file.' }
                    },
                    required: ['filename', 'content', 'summary']
                },
                execute: async ({ filename, content }: { filename: string; content: string; summary: string }) => {
                    try {
                        const nextVersion = await ensureNextVersion(request.sessionId);
                        memoryService.updateMemoryFile(request.sessionId, nextVersion, filename, content);
                        return `Successfully updated memory file: ${filename}`;
                    } catch (error: any) {
                        return `Failed to update memory file: ${error.message}`;
                    }
                }
            }
        ];

        if (request.allowVariants) {
            tools.push({
                name: 'generate_variant',
                description: 'Generate a variant of the page in a new session. This session inherits all previous conversation context. The instruction must be written as a natural follow-up message in the chat, NOT as a standalone prompt.',
                parameters: {
                    type: 'object',
                    properties: {
                        instruction: { type: 'string', description: 'The exact text of the simulated user message asking for the variant (e.g., "Now make the background dark", "Try using a sweet candy pastel palette"). Do NOT write a completely new standalone prompt.' },
                        summary: { type: 'string', description: 'Explain why you are generating this variant.' }
                    },
                    required: ['instruction', 'summary']
                },
                execute: async (args: {
                    instruction: string;
                    summary: string;
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
