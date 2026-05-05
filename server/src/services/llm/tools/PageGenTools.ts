import { SessionResourceService } from '../../session/SessionResourceService';
import { FilesService } from '../../session/FilesService';
import { MemoryService } from '../../session/MemoryService';
import { SessionService } from '../../session/SessionService';
import { ProjectService } from '../../ProjectService';
import { ClipboardService } from '../../ClipboardService';
import { GeneratePageRequest } from '../types';

export interface PageGenContext {
    getTargetVersion: () => number | undefined;
    ensureNextVersion: (sessionId: string) => Promise<number>;
}

export function createPageGenTools(
    resourceService: SessionResourceService,
    filesService: FilesService,
    sessionService: SessionService,
    memoryService: MemoryService,
    projectService: ProjectService,
    clipboardService: ClipboardService
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
                    const { EMPTY_FILES } = await import('../../ChatService');
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
                        const { EMPTY_FILES } = await import('../../ChatService');
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
                        subject: { type: 'string', description: 'The new subject (3-5 words).' },
                        summary: { type: 'string', description: 'Explain why you are updating the subject.' }
                    },
                    required: ['subject', 'summary']
                },
                execute: async ({ subject, summary: _summary }: { subject: string; summary: string }) => {
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
                name: 'resource_list',
                description: 'List available resources in the current session. You can filter by resource type. Note: this tool does NOT return the description/contents of the resources. Use resource_info to get the description.',
                parameters: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', enum: ['images', 'videos', 'fonts', 'all'], description: 'Filter by resource type.' },
                        summary: { type: 'string', description: 'Explain why you are listing resources.' }
                    },
                    required: ['type', 'summary']
                },
                execute: async ({ type, summary: _summary }: { type: 'images' | 'videos' | 'fonts' | 'all'; summary: string }) => {
                    try {
                        const resources = await resourceService.listResources(request.sessionId, request.currentVersion);
                        
                        let filtered = resources;
                        if (type === 'images') filtered = filtered.filter(res => res.mimetype?.startsWith('image/'));
                        else if (type === 'videos') filtered = filtered.filter(res => res.mimetype?.startsWith('video/'));
                        else if (type === 'fonts') filtered = filtered.filter(res => res.mimetype?.startsWith('font/'));

                        if (filtered.length === 0) {
                            return `No unused ${type} found in this session.`;
                        }
                        return JSON.stringify(filtered.map((res) => {
                            const base = {
                                filename: res.filename,
                                mimetype: res.mimetype,
                                model: res.model,
                                isUsed: res.isUsed
                            };
                            if (res.mimetype?.startsWith('image/')) {
                                return { ...base, width: res.width, height: res.height, format: res.format };
                            } else if (res.mimetype?.startsWith('video/')) {
                                return { ...base, width: res.width, height: res.height, duration: res.duration, videoCodec: res.videoCodec };
                            } else if (res.mimetype?.startsWith('font/')) {
                                return { ...base, type: res.type, fontFamily: res.fontFamily, style: res.style, glyphCount: res.glyphCount };
                            }
                            return base;
                        }));
                    } catch (error: any) {
                        return `Failed to list resources: ${error.message}`;
                    }
                }
            },
            {
                name: 'resource_info',
                description: 'Get details about a specific resource file (image, video, font). If the description is missing, this tool will automatically generate and save one before returning it.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', description: 'The filename of the resource.' },
                        summary: { type: 'string', description: 'Explain why you are requesting info.' }
                    },
                    required: ['filename', 'summary']
                },
                execute: async ({ filename, summary: _summary }: { filename: string; summary: string }) => {
                    try {
                        const info = await resourceService.getResourceInfo(request.sessionId, request.currentVersion, filename);
                        if (!info) {
                            return `Resource not found: ${filename}`;
                        }
                        if (!info.description || info.description.trim() === '') {
                            const newDescription = await resourceService.describeResource(request.sessionId, request.currentVersion, filename, request.abortSignal);
                            await resourceService.updateResourceDescription(request.sessionId, request.currentVersion, filename, newDescription);
                            info.description = newDescription;
                        }
                        return JSON.stringify(info);
                    } catch (error: any) {
                        return `Failed to get resource info: ${error.message}`;
                    }
                }
            },
            {
                name: 'resource_generate_image',
                description: 'Generate an image based on a description.',
                parameters: {
                    type: 'object',
                    properties: {
                        description: { type: 'string', description: 'Detailed description of the image.' },
                        aspectRatio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'The aspect ratio of the generated image. Default is 1:1.' },
                        summary: { type: 'string', description: 'Explain why you are generating this image.' }
                    },
                    required: ['description', 'summary']
                },
                execute: async ({ description, aspectRatio, summary: _summary }: { description: string; aspectRatio?: string; summary: string }) => {
                    try {
                        const nextVersion = await ensureNextVersion(request.sessionId);
                        const filename = await resourceService.generateAndSaveImage(request.sessionId, description, nextVersion, undefined, request.abortSignal, aspectRatio);
                        return `Image generated successfully: ${filename}`;
                    } catch (error: any) {
                        return `Failed to generate image: ${error.message}`;
                    }
                }
            },
            {
                name: 'resource_edit_image',
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
                execute: async ({ filename, description, summary: _summary }: { filename: string; description: string; summary: string }) => {
                    try {
                        const nextVersion = await ensureNextVersion(request.sessionId);
                        // Use currentVersion as source, nextVersion as target
                        const savedFilename = await resourceService.editAndSaveImage(request.sessionId, filename, description, request.currentVersion, nextVersion, request.abortSignal);
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
                        filename: { type: 'string', enum: ['preferences.md', 'state.md', 'about.md'], description: 'The memory file to read.' },
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
                        filename: { type: 'string', enum: ['preferences.md', 'state.md', 'about.md'], description: 'The memory file to edit.' },
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
                        filename: { type: 'string', enum: ['preferences.md', 'state.md', 'about.md'], description: 'The memory file to update.' },
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
            },
            {
                name: 'save_to_clipboard',
                description: 'Use this tool to save formatting, color schemes, or specific state nuances the user asks you to remember or copy. This information will be saved to the clipboard and can be used in other sessions.',
                parameters: {
                    type: 'object',
                    properties: {
                        description: { type: 'string', description: 'Detailed textual description of what the user wants to save or remember.' },
                        summary: { type: 'string', description: 'A short, user-facing summary of this action (e.g. "Saving styles to clipboard").' }
                    },
                    required: ['description', 'summary']
                },
                execute: async ({ description, summary: _summary }: { description: string; summary: string }) => {
                    try {
                        const metadata = await sessionService.getMetadata(request.sessionId);
                        if (!metadata) return 'Session not found';

                        const project = await projectService.getProject(metadata.projectId);
                        if (!project || project.accountId === undefined || project.accountId === null) {
                            return 'Project or account not found';
                        }

                        const version = getTargetVersion() ?? request.currentVersion;
                        await clipboardService.saveToClipboard(
                            project.accountId,
                            description,
                            metadata.projectId,
                            request.sessionId,
                            version
                        );

                        return 'Successfully saved to clipboard.';
                    } catch (error: any) {
                        return `Failed to save to clipboard: ${error.message}`;
                    }
                }
            },
            {
                name: 'read_clipboard',
                description: 'Use this tool to read the text from clipboard.',
                parameters: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string', description: 'A short, user-facing summary of this action (e.g. "Reading clipboard contents").' }
                    },
                    required: ['summary']
                },
                execute: async ({ summary: _summary }: { summary: string }) => {
                    try {
                        const metadata = await sessionService.getMetadata(request.sessionId);
                        if (!metadata) return 'Session not found';

                        const project = await projectService.getProject(metadata.projectId);
                        if (!project || project.accountId === undefined || project.accountId === null) {
                            return 'Project or account not found';
                        }

                        const activeRecord = await clipboardService.getActive(project.accountId);
                        if (!activeRecord) return 'Clipboard is empty';

                        return activeRecord.description;
                    } catch (error: any) {
                        return `Failed to read clipboard: ${error.message}`;
                    }
                }
            },
            {
                name: 'list_clipboard_files',
                description: 'Use this tool to get a list of files associated with the active clipboard record. Returns filename, size, and mime-type.',
                parameters: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string', description: 'A short, user-facing summary of this action (e.g. "Listing files from the clipboard session").' }
                    },
                    required: ['summary']
                },
                execute: async ({ summary: _summary }: { summary: string }) => {
                    try {
                        const metadata = await sessionService.getMetadata(request.sessionId);
                        if (!metadata) return 'Session not found';

                        const project = await projectService.getProject(metadata.projectId);
                        if (!project || project.accountId === undefined || project.accountId === null) {
                            return 'Project or account not found';
                        }

                        const activeRecord = await clipboardService.getActive(project.accountId);
                        if (!activeRecord) return 'Clipboard is empty';
                        if (!activeRecord.sessionId || activeRecord.version === undefined) {
                            return 'Clipboard does not reference any specific files or session.';
                        }

                        const filenames = filesService.listVersionFiles(activeRecord.sessionId, activeRecord.version);
                        if (filenames.length === 0) return 'No files found for the clipboard session context.';

                        const fileInfos = filenames.map(filename => {
                            const filePath = filesService.resolveVersionFilePath(activeRecord.sessionId!, activeRecord.version!, filename);
                            const fs = require('fs');
                            const path = require('path');
                            let size = 0;
                            try {
                                size = fs.statSync(filePath).size;
                            } catch (e) { }

                            const ext = path.extname(filename).toLowerCase();
                            let mimeType = 'application/octet-stream';
                            if (ext === '.html') mimeType = 'text/html';
                            else if (ext === '.css') mimeType = 'text/css';
                            else if (ext === '.js') mimeType = 'application/javascript';
                            else if (ext === '.json') mimeType = 'application/json';
                            else if (ext === '.png') mimeType = 'image/png';
                            else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
                            else if (ext === '.svg') mimeType = 'image/svg+xml';

                            return { filename, size, mimeType };
                        });

                        return JSON.stringify(fileInfos, null, 2);
                    } catch (error: any) {
                        return `Failed to list clipboard files: ${error.message}`;
                    }
                }
            },
            {
                name: 'read_clipboard_file',
                description: 'Use this tool to read the contents of a specific text file from the active clipboard context. This is ONLY for text files (html, css, js, json, md, etc.). For binary files like images, use the copy_clipboard_file tool instead.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', description: 'The name of the file to read' },
                        summary: { type: 'string', description: 'A short, user-facing summary of this action (e.g. "Reading [filename] from the clipboard").' }
                    },
                    required: ['filename', 'summary']
                },
                execute: async ({ filename, summary: _summary }: { filename: string; summary: string }) => {
                    try {
                        const metadata = await sessionService.getMetadata(request.sessionId);
                        if (!metadata) return 'Session not found';

                        const project = await projectService.getProject(metadata.projectId);
                        if (!project || project.accountId === undefined || project.accountId === null) {
                            return 'Project or account not found';
                        }

                        const activeRecord = await clipboardService.getActive(project.accountId);
                        if (!activeRecord) return 'Clipboard is empty';
                        if (!activeRecord.sessionId || activeRecord.version === undefined) {
                            return 'Clipboard does not reference any specific files or session.';
                        }

                        const ext = require('path').extname(filename).toLowerCase();
                        const binaryExts = ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.mp4', '.webm', '.woff', '.woff2', '.ttf'];
                        if (binaryExts.includes(ext)) {
                            return `Error: ${filename} is a binary file and cannot be read as text. Use the copy_clipboard_file tool to copy it into the current session.`;
                        }

                        const content = filesService.readVersionFile(activeRecord.sessionId, activeRecord.version, filename);
                        if (content === undefined) return `File ${filename} not found or is empty in the clipboard context.`;

                        return content;
                    } catch (error: any) {
                        return `Failed to read clipboard file: ${error.message}`;
                    }
                }
            },
            {
                name: 'copy_clipboard_file',
                description: 'Use this tool to copy a file (such as an image, video, font, or code file) from the active clipboard context into the current session.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', description: 'The name of the file to copy from the clipboard' },
                        summary: { type: 'string', description: 'A short, user-facing summary of this action (e.g. "Copying [filename] from the clipboard").' }
                    },
                    required: ['filename', 'summary']
                },
                execute: async ({ filename, summary: _summary }: { filename: string; summary: string }) => {
                    try {
                        const metadata = await sessionService.getMetadata(request.sessionId);
                        if (!metadata) return 'Session not found';

                        const project = await projectService.getProject(metadata.projectId);
                        if (!project || project.accountId === undefined || project.accountId === null) {
                            return 'Project or account not found';
                        }

                        const activeRecord = await clipboardService.getActive(project.accountId);
                        if (!activeRecord) return 'Clipboard is empty';
                        if (!activeRecord.sessionId || activeRecord.version === undefined) {
                            return 'Clipboard does not reference any specific files or session.';
                        }

                        if (!filesService.versionFileExists(activeRecord.sessionId, activeRecord.version, filename)) {
                            return `File ${filename} not found in the clipboard context.`;
                        }

                        const nextVersion = await ensureNextVersion(request.sessionId);

                        const ext = require('path').extname(filename).toLowerCase();
                        const isResource = ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.mp4', '.webm', '.woff', '.woff2', '.ttf', '.svg'].includes(ext);

                        if (isResource) {
                            await resourceService.copyResource(activeRecord.sessionId, activeRecord.version, request.sessionId, nextVersion, filename);
                        } else {
                            const content = filesService.readVersionFileBuffer(activeRecord.sessionId, activeRecord.version, filename);
                            if (content) {
                                filesService.writeVersionFile(request.sessionId, nextVersion, filename, content);
                            }
                        }

                        return `Successfully copied ${filename} to the current session.`;
                    } catch (error: any) {
                        return `Failed to copy clipboard file: ${error.message}`;
                    }
                }
            }
        ];

        if (request.allowVariants) {
            tools.push({
                name: 'generate_variant',
                description: 'Generate a variant of the page in a new session. Use this tool when the user asks to create or suggest multiple options. NEVER place multiple variants of a component side-by-side in the current code; use this tool to generate separate sessions for each variant instead. This session inherits all previous conversation context. The instruction must be written as a natural follow-up message in the chat, NOT as a standalone prompt.',
                parameters: {
                    type: 'object',
                    properties: {
                        instruction: { type: 'string', description: 'The exact text of the simulated user message asking for the variant (e.g., "Now make the background dark", "Try using a sweet candy pastel palette"). DO NOT mention that it is the "first", "second", or any variant number. Do NOT write a completely new standalone prompt.' },
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
