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

export function readTextRange(
    content: string,
    startLine?: number,
    endLine?: number
): string {
    if (!content) return '';

    const lines = content.split(/\r?\n/);
    const start = startLine ? Math.max(1, startLine) : 1;
    const end = endLine ? Math.min(lines.length, endLine) : lines.length;

    if (start > end) {
        throw new Error(`startLine (${start}) cannot be greater than endLine (${end})`);
    }

    const slicedLines = lines.slice(start - 1, end);
    return slicedLines.map((line, index) => `${start + index}: ${line}`).join('\n');
}

export interface TextEditParams {
    content: string;
    startLine: number;
    endLine: number;
    expectedContent: string;
    newContent: string;
}

export function editTextRange(params: TextEditParams): string {
    const { content, startLine, endLine, expectedContent, newContent } = params;

    const sanitizeContent = (text: string) => text.replace(/^\s*\d+[:|]\s?/gm, '');
    let targetString = sanitizeContent(expectedContent);
    const replacementString = sanitizeContent(newContent);

    const lines = content.split(/\r?\n/);

    if (startLine > lines.length && targetString !== '') {
        throw new Error(`Cannot edit starting at line ${startLine}. The file currently has only ${lines.length} lines.`);
    }

    const start = Math.max(1, startLine);
    let end = Math.min(lines.length, Math.max(start, endLine));

    if (targetString !== '') {
        const expectedLinesCount = targetString.split(/\r?\n/).length;
        if (end - start + 1 < expectedLinesCount) {
            end = Math.min(lines.length, start + expectedLinesCount - 1);
        }
    }

    let slice = lines.slice(start - 1, end).join('\n');

    if (targetString === '') {
        slice = replacementString;
    } else {
        if (!slice.includes(targetString)) {
            if (slice.includes(targetString.trim())) {
                targetString = targetString.trim();
            } else {
                const normalizedSlice = slice.replace(/\r\n/g, '\n');
                const normalizedTarget = targetString.replace(/\r\n/g, '\n');
                if (normalizedSlice.includes(normalizedTarget)) {
                    targetString = normalizedTarget;
                    slice = normalizedSlice;
                } else if (normalizedSlice.includes(normalizedTarget.trim())) {
                    targetString = normalizedTarget.trim();
                    slice = normalizedSlice;
                } else {
                    const errorMsg = `expectedContent not found in line range ${start}-${end}. The file may have been modified or you provided incorrect content with mismatched whitespace.\n` +
                        `--- You Expected ---\n${targetString}\n` +
                        `--- Actual Content in File (Lines ${start}-${end}) ---\n${slice}\n` +
                        `Please correct your expectedContent or adjust the line range.`;
                    console.log(`\n[DEBUG multi_edit_file] ` + errorMsg);
                    throw new Error(errorMsg);
                }
            }
        }

        if (slice.split(targetString).length > 2) {
            throw new Error(`expectedContent found multiple times between lines ${start} and ${end}. Provide a narrower range or more unique expectedContent.`);
        }

        slice = slice.replace(targetString, replacementString);
    }

    const replacedSliceLines = slice.split('\n');
    lines.splice(start - 1, end - start + 1, ...replacedSliceLines);

    return lines.join('\n');
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
                name: 'list_text_files',
                description: 'Get a summary of all project text files and memory files, including their line counts and byte sizes. Use this to orient yourself and plan chunked reads for large files.',
                parameters: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string', description: 'Explain why you are listing text files.' }
                    },
                    required: ['summary']
                },
                execute: async ({ summary: _summary }: { summary: string }) => {
                    try {
                        const version = getTargetVersion() ?? request.currentVersion;
                        const stats: any = { project_files: {}, memory_files: {} };

                        const projectFiles = ['index.html', 'styles.css', 'script.js'];
                        for (const file of projectFiles) {
                            const content = filesService.readVersionFile(request.sessionId, version, file) || '';
                            stats.project_files[file] = { 
                                lines: content ? (content.match(/\n/g) || []).length + 1 : 0, 
                                bytes: Buffer.byteLength(content, 'utf8') 
                            };
                        }

                        const memoryFiles = ['preferences.md', 'state.md', 'about.md'];
                        for (const file of memoryFiles) {
                            const content = memoryService.readMemoryFile(request.sessionId, version, file) || '';
                            stats.memory_files[file] = { 
                                lines: content ? (content.match(/\n/g) || []).length + 1 : 0, 
                                bytes: Buffer.byteLength(content, 'utf8') 
                            };
                        }

                        return JSON.stringify(stats, null, 2);
                    } catch (error: any) {
                        return `Failed to list text files: ${error.message}`;
                    }
                }
            },
            {
                name: 'read_text_file',
                description: 'Read the content of a text file. If the file is large, you can specify startLine and endLine to read a specific section. Returns the content with line numbers prepended.',
                parameters: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', enum: ['index.html', 'styles.css', 'script.js'], description: 'The file to read' },
                        startLine: { type: 'number', description: 'The starting line number to read (1-indexed). Optional.' },
                        endLine: { type: 'number', description: 'The ending line number to read (1-indexed). Optional.' },
                        summary: { type: 'string', description: 'Explain why you need to read this file.' }
                    },
                    required: ['file', 'summary']
                },
                execute: async ({
                    file,
                    startLine,
                    endLine,
                }: {
                    file: 'index.html' | 'styles.css' | 'script.js';
                    startLine?: number;
                    endLine?: number;
                    summary: string;
                }) => {
                    const version = getTargetVersion() ?? request.currentVersion;
                    let content = filesService.readVersionFile(request.sessionId, version, file);
                    
                    if (content === undefined) {
                        return 'File not found';
                    }

                    try {
                        return readTextRange(content, startLine, endLine);
                    } catch (e: any) {
                        return `Error: ${e.message}`;
                    }
                }
            },
            {
                name: 'edit_text_file',
                description: 'Edit a text file by replacing a specific block of code within a specified line range. Always use read_text_file first to check line numbers. expectedContent should not include the line numbers prepended by read_text_file.',
                parameters: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', enum: ['index.html', 'styles.css', 'script.js'], description: 'The file to edit' },
                        startLine: { type: 'number', description: 'The starting line number of the block to replace (1-indexed).' },
                        endLine: { type: 'number', description: 'The ending line number of the block to replace (1-indexed).' },
                        expectedContent: { type: 'string', description: 'The exact string to replace within the line range.' },
                        newContent: { type: 'string', description: 'The new string to replace it with.' },
                        summary: { type: 'string', description: 'Explain why you are making this edit.' }
                    },
                    required: ['file', 'startLine', 'endLine', 'expectedContent', 'newContent', 'summary']
                },
                execute: async ({
                    file,
                    startLine,
                    endLine,
                    expectedContent,
                    newContent,
                }: {
                    file: 'index.html' | 'styles.css' | 'script.js';
                    startLine: number;
                    endLine: number;
                    expectedContent: string;
                    newContent: string;
                    summary: string;
                }) => {
                    let nextVersion = await ensureNextVersion(request.sessionId);

                    let content = filesService.readVersionFile(request.sessionId, nextVersion, file);

                    if (content === undefined) {
                        content = '';
                    }

                    try {
                        const updatedContent = editTextRange({
                            content, startLine, endLine, expectedContent, newContent
                        });
                        
                        filesService.writeVersionFile(request.sessionId, nextVersion, file, updatedContent);

                        return `Successfully updated ${file} between lines ${Math.max(1, startLine)} and ${Math.min(updatedContent.split(/\r?\n/).length, Math.max(1, endLine))}`;
                    } catch (e: any) {
                        return `Error: ${e.message}`;
                    }
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
                name: 'list_resource_files',
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
                name: 'read_resource_info',
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
                name: 'generate_resource_image',
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
                name: 'edit_resource_image',
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
                description: 'Read a memory file to recall technical decisions, state, or user preferences. If the file is large, you can specify startLine and endLine to read a specific section. Returns the content with line numbers prepended.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', enum: ['preferences.md', 'state.md', 'about.md'], description: 'The memory file to read.' },
                        startLine: { type: 'number', description: 'The starting line number to read (1-indexed). Optional.' },
                        endLine: { type: 'number', description: 'The ending line number to read (1-indexed). Optional.' },
                        summary: { type: 'string', description: 'Explain why you are reading this memory file.' }
                    },
                    required: ['filename', 'summary']
                },
                execute: async ({ filename, startLine, endLine }: { filename: string; startLine?: number; endLine?: number; summary: string }) => {
                    try {
                        const version = getTargetVersion() ?? request.currentVersion;
                        const content = memoryService.readMemoryFile(request.sessionId, version, filename) || '';
                        return readTextRange(content, startLine, endLine) || '(File is empty)';
                    } catch (error: any) {
                        return `Failed to read memory file: ${error.message}`;
                    }
                }
            },
            {
                name: 'edit_memory_file',
                description: 'Edit a memory file by replacing a specific block of text within a specified line range. Always use read_memory_file first to check line numbers. expectedContent should not include the line numbers prepended by read_memory_file. Use this instead of update_memory_file to add new lines or modify existing lines without rewriting the whole file.',
                parameters: {
                    type: 'object',
                    properties: {
                        filename: { type: 'string', enum: ['preferences.md', 'state.md', 'about.md'], description: 'The memory file to edit.' },
                        startLine: { type: 'number', description: 'The starting line number of the block to replace (1-indexed).' },
                        endLine: { type: 'number', description: 'The ending line number of the block to replace (1-indexed).' },
                        expectedContent: { type: 'string', description: 'The exact string to replace within the line range. Leave empty ("") if you want to blindly replace the lines between startLine and endLine without text matching.' },
                        newContent: { type: 'string', description: 'The new string to replace it with.' },
                        summary: { type: 'string', description: 'Explain why you are editing this memory file.' }
                    },
                    required: ['filename', 'startLine', 'endLine', 'expectedContent', 'newContent', 'summary']
                },
                execute: async ({ filename, startLine, endLine, expectedContent, newContent }: { filename: string; startLine: number; endLine: number; expectedContent: string; newContent: string; summary: string }) => {
                    try {
                        const version = getTargetVersion() ?? request.currentVersion;
                        const content = memoryService.readMemoryFile(request.sessionId, version, filename) || '';

                        const updatedContent = editTextRange({
                            content, startLine, endLine, expectedContent, newContent
                        });

                        const nextVersion = await ensureNextVersion(request.sessionId);
                        memoryService.updateMemoryFile(request.sessionId, nextVersion, filename, updatedContent);
                        return `Successfully updated ${filename} between lines ${Math.max(1, startLine)} and ${Math.min(updatedContent.split(/\r?\n/).length, Math.max(1, endLine))}`;
                    } catch (error: any) {
                        return `Failed to edit memory file: ${error.message}`;
                    }
                }
            },

            {
                name: 'save_clipboard_text',
                description: 'Use this tool to save formatting, color schemes, or specific state nuances the user asks you to remember or copy. TIP: Instead of saving raw code, just save the file names and line numbers (e.g., "header layout is in index.html lines 15-40"). This allows you to easily pull the exact code later using read_clipboard_file. This information will be saved to the clipboard and can be used in other sessions.',
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
                name: 'read_clipboard_text',
                description: 'Use this tool to read the text description from the clipboard.',
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

                        let responseText = `--- CLIPBOARD DESCRIPTION ---\n${activeRecord.description}\n`;

                        if (activeRecord.sessionId && activeRecord.version !== undefined) {
                            responseText += `\n--- ORIGIN PROJECT FILES SCALE ---\n`;
                            const projectFiles = ['index.html', 'styles.css', 'script.js'];
                            const stats: any = {};
                            for (const file of projectFiles) {
                                const content = filesService.readVersionFile(activeRecord.sessionId, activeRecord.version, file) || '';
                                stats[file] = {
                                    lines: content ? (content.match(/\n/g) || []).length + 1 : 0,
                                    bytes: Buffer.byteLength(content, 'utf8')
                                };
                            }
                            responseText += JSON.stringify(stats, null, 2);
                        }

                        return responseText;
                    } catch (error: any) {
                        return `Failed to read clipboard: ${error.message}`;
                    }
                }
            },
            {
                name: 'list_clipboard_resource_files',
                description: 'Use this tool to get a list of resource files (images, videos, fonts) associated with the active clipboard record. Returns filename, size, and mime-type.',
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

                        const resources = await resourceService.listResources(activeRecord.sessionId, activeRecord.version);
                        if (resources.length === 0) return 'No resource files found for the clipboard session context.';

                        const fileInfos = resources.map(res => {
                            const filePath = filesService.resolveVersionFilePath(activeRecord.sessionId!, activeRecord.version!, res.filename);
                            const fs = require('fs');
                            let size = 0;
                            try {
                                size = fs.statSync(filePath).size;
                            } catch (e) { }

                            return { 
                                filename: res.filename, 
                                size, 
                                mimeType: res.mimetype 
                            };
                        });

                        return JSON.stringify(fileInfos, null, 2);
                    } catch (error: any) {
                        return `Failed to list clipboard files: ${error.message}`;
                    }
                }
            },
            {
                name: 'read_clipboard_text_file',
                description: 'Use this tool to read the contents of a specific project text file from the active clipboard context. If the file is large, you can specify startLine and endLine to read a specific section. Returns the content with line numbers prepended.',
                parameters: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', enum: ['index.html', 'styles.css', 'script.js'], description: 'The file to read' },
                        startLine: { type: 'number', description: 'The starting line number to read (1-indexed). Optional.' },
                        endLine: { type: 'number', description: 'The ending line number to read (1-indexed). Optional.' },
                        summary: { type: 'string', description: 'A short, user-facing summary of this action (e.g. "Reading [file] from the clipboard").' }
                    },
                    required: ['file', 'summary']
                },
                execute: async ({ file, startLine, endLine, summary: _summary }: { file: 'index.html' | 'styles.css' | 'script.js'; startLine?: number; endLine?: number; summary: string }) => {
                    try {
                        const filename = file;
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

                        const resourceInfo = await resourceService.getResourceInfo(activeRecord.sessionId, activeRecord.version, filename);
                        if (resourceInfo) {
                            return `Error: ${filename} is a binary resource file and cannot be read as text. Use the copy_clipboard_resource_files tool to copy it into the current session.`;
                        }

                        const content = filesService.readVersionFile(activeRecord.sessionId, activeRecord.version, filename);
                        if (content === undefined) return `File ${filename} not found or is empty in the clipboard context.`;

                        return readTextRange(content, startLine, endLine);
                    } catch (error: any) {
                        return `Failed to read clipboard file: ${error.message}`;
                    }
                }
            },
            {
                name: 'copy_clipboard_resource_files',
                description: 'Use this tool to copy one or more resource files (images, videos, fonts) from the active clipboard context into the current session. Do NOT use this for code files (index.html, styles.css, script.js).',
                parameters: {
                    type: 'object',
                    properties: {
                        filenames: { type: 'array', items: { type: 'string' }, description: 'The names of the files to copy from the clipboard' },
                        summary: { type: 'string', description: 'A short, user-facing summary of this action.' }
                    },
                    required: ['filenames', 'summary']
                },
                execute: async ({ filenames, summary: _summary }: { filenames: string[]; summary: string }) => {
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

                        const nextVersion = await ensureNextVersion(request.sessionId);
                        const copied: string[] = [];
                        const errors: string[] = [];

                        for (const filename of filenames) {
                            if (['index.html', 'styles.css', 'script.js'].includes(filename)) {
                                errors.push(`File ${filename} is a project text file. Copying it directly is dangerous. Use read_clipboard_text_file and edit_text_file to precisely port code instead.`);
                                continue;
                            }

                            if (!filesService.versionFileExists(activeRecord.sessionId, activeRecord.version, filename)) {
                                errors.push(`File ${filename} not found`);
                                continue;
                            }

                            const resourceInfo = await resourceService.getResourceInfo(activeRecord.sessionId, activeRecord.version, filename);
                            const isResource = !!resourceInfo;

                            try {
                                if (isResource) {
                                    await resourceService.copyResource(activeRecord.sessionId, activeRecord.version, request.sessionId, nextVersion, filename);
                                } else {
                                    const content = filesService.readVersionFileBuffer(activeRecord.sessionId, activeRecord.version, filename);
                                    if (content) {
                                        filesService.writeVersionFile(request.sessionId, nextVersion, filename, content);
                                    }
                                }
                                copied.push(filename);
                            } catch (err: any) {
                                errors.push(`Failed to copy ${filename}: ${err.message}`);
                            }
                        }

                        let resultMessage = `Successfully copied ${copied.length} files.`;
                        if (errors.length > 0) {
                            resultMessage += ` Errors: ${errors.join('; ')}`;
                        }
                        return resultMessage;
                    } catch (error: any) {
                        return `Failed to copy clipboard files: ${error.message}`;
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
