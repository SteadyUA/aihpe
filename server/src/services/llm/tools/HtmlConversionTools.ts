import { TaskManagerService } from '../../TaskManagerService';
import { Container } from 'typedi';
import * as fs from 'fs/promises';
import * as path from 'path';
import { readTextRange, editTextRange } from './PageGenTools';

export interface HtmlConversionContext {
    workingDirectory: string;
    taskId: string;
    abortController?: AbortController;
}

export function createHtmlConversionTools(): (
    request: any,
    context: HtmlConversionContext
) => any[] {
    return (_request: any, context: HtmlConversionContext) => {
        const { workingDirectory, taskId, abortController } = context;
        const taskManagerService = Container.get(TaskManagerService);

        const resolvePath = (filePath: string) => {
            // Prevent directory traversal
            const resolved = path.resolve(workingDirectory, filePath);
            if (!resolved.startsWith(workingDirectory)) {
                throw new Error('Access denied: Path is outside working directory');
            }
            return resolved;
        };

        return [
            {
                name: 'add_jobs',
                description: 'Add a list of grouped jobs (Steps) to the plan. Jobs within the same step will be executed concurrently.',
                parameters: {
                    type: 'object',
                    properties: {
                        steps: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    stepName: { type: 'string', description: 'Name of the step.' },
                                    concurrentJobs: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                description: { type: 'string', description: 'Full instructions for the execution agent.' },
                                                shortDescription: { type: 'string', description: 'A very concise, single sentence summarizing the job for the human user UI.' }
                                            },
                                            required: ['description', 'shortDescription']
                                        },
                                        description: 'List of jobs to be executed concurrently in this step.'
                                    }
                                },
                                required: ['stepName', 'concurrentJobs']
                            },
                            description: 'List of steps to add.'
                        },
                        summary: { type: 'string', description: 'Reason for adding jobs.' }
                    },
                    required: ['steps', 'summary']
                },
                execute: async ({ steps }: { steps: { stepName: string, concurrentJobs: { description: string, shortDescription: string }[] }[]; summary: string }) => {
                    await taskManagerService.addJobs(taskId, steps);
                    if (abortController) {
                        abortController.abort();
                    }
                    const totalJobs = steps.reduce((sum, step) => sum + step.concurrentJobs.length, 0);
                    return `Added ${steps.length} steps (${totalJobs} jobs) to the plan.\n\nSYSTEM INSTRUCTION: PLAN INITIALIZED. YOU MUST NOW RETURN AN EMPTY RESPONSE (NO TOOLS, NO TEXT) TO YIELD CONTROL TO THE SYSTEM.`;
                }
            },
            {
                name: 'complete_job',
                description: 'Mark a job as completed.',
                parameters: {
                    type: 'object',
                    properties: {
                        job: { type: 'string', description: 'The job description to mark as done.' },
                        summary: { type: 'string', description: 'Reason for completing the job.' }
                    },
                    required: ['job', 'summary']
                },
                execute: async ({ job }: { job: string; summary: string }) => {
                    const success = await taskManagerService.completeJob(taskId, job);
                    if (abortController) {
                        abortController.abort();
                    }
                    if (success) {
                        return `Marked job as completed: ${job}\n\nSYSTEM INSTRUCTION: JOB IS COMPLETE. YOU MUST NOW RETURN AN EMPTY RESPONSE (NO TOOLS, NO TEXT) TO YIELD CONTROL TO THE SYSTEM.`;
                    } else {
                        return `Job not found: ${job}\n\nSYSTEM INSTRUCTION: YIELD CONTROL.`;
                    }
                }
            },

            {
                name: 'list_files',
                description: 'List all files in the working directory recursively.',
                parameters: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string', description: 'Reason for listing files.' }
                    },
                    required: ['summary']
                },
                execute: async (_args: { summary: string }) => {
                    async function getFiles(dir: string): Promise<string[]> {
                        const dirents = await fs.readdir(dir, { withFileTypes: true });
                        const files = await Promise.all(dirents.map((dirent) => {
                            const res = path.resolve(dir, dirent.name);
                            return dirent.isDirectory() ? getFiles(res) : Promise.resolve([res]);
                        }));
                        return Array.prototype.concat(...files);
                    }

                    const getMimeType = async (filePath: string): Promise<string> => {
                        try {
                            const { exec } = require('child_process');
                            const util = require('util');
                            const execAsync = util.promisify(exec);
                            const { stdout } = await execAsync(`file --mime-type -b "${filePath}"`);
                            return stdout.trim();
                        } catch (e) {
                            // Fallback to extension based
                            const ext = path.extname(filePath).toLowerCase();
                            switch (ext) {
                                case '.html': return 'text/html';
                                case '.css': return 'text/css';
                                case '.js': return 'application/javascript';
                                case '.json': return 'application/json';
                                case '.txt': return 'text/plain';
                                case '.png': return 'image/png';
                                case '.jpg': case '.jpeg': return 'image/jpeg';
                                case '.gif': return 'image/gif';
                                case '.svg': return 'image/svg+xml';
                                default: return 'application/octet-stream';
                            }
                        }
                    };

                    try {
                        const files = await getFiles(workingDirectory);
                        const fileList = await Promise.all(files.map(async f => {
                            const relPath = path.relative(workingDirectory, f);
                            const mimeType = await getMimeType(f);
                            const stats = await fs.stat(f);
                            
                            const isText = mimeType.startsWith('text/') || ['application/json', 'application/javascript', 'image/svg+xml'].includes(mimeType);
                            let lines = undefined;
                            if (isText) {
                                try {
                                    const content = await fs.readFile(f, 'utf-8');
                                    lines = (content.match(/\n/g) || []).length + 1;
                                } catch (e) {}
                            }
                            
                            return {
                                path: relPath,
                                size: stats.size,
                                mimeType,
                                ...(lines !== undefined ? { lines } : {})
                            };
                        }));
                        return JSON.stringify(fileList);
                    } catch (error: any) {
                        return `Error listing files: ${error.message}`;
                    }
                }
            },
            {
                name: 'read_file',
                description: 'Read the content of a text file. If the file is large, you can specify startLine and endLine to read a specific section. Returns the content with line numbers prepended.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Relative path to the file.' },
                        startLine: { type: 'number', description: 'The starting line number to read (1-indexed). Optional.' },
                        endLine: { type: 'number', description: 'The ending line number to read (1-indexed). Optional.' },
                        summary: { type: 'string', description: 'Reason for reading the file.' }
                    },
                    required: ['filePath', 'summary']
                },
                execute: async ({ filePath, startLine, endLine }: { filePath: string; startLine?: number; endLine?: number; summary: string }) => {
                    try {
                        const fullPath = resolvePath(filePath);
                        const content = await fs.readFile(fullPath, 'utf-8');
                        return readTextRange(content, startLine, endLine);
                    } catch (error: any) {
                        return `Error reading file ${filePath}: ${error.message}`;
                    }
                }
            },
            {
                name: 'multi_edit_file',
                description: 'Edit a text file by replacing multiple non-contiguous blocks of text. The tool will automatically sort the replacements from bottom to top (descending line numbers) to prevent line number drift. Always use read_file first to check line numbers. expectedContent should not include the line numbers prepended by read_file.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Relative path to the file.' },
                        edits: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    startLine: { type: 'number', description: 'The starting line number of the block to replace (1-indexed).' },
                                    endLine: { type: 'number', description: 'The ending line number of the block to replace (1-indexed).' },
                                    expectedContent: { type: 'string', description: 'The exact string to replace. Use empty string "" to append/replace the whole slice.' },
                                    newContent: { type: 'string', description: 'The new string to replace it with.' }
                                },
                                required: ['startLine', 'endLine', 'expectedContent', 'newContent']
                            },
                            description: 'List of edits to apply to the file.'
                        },
                        summary: { type: 'string', description: 'Reason for editing the file.' }
                    },
                    required: ['filePath', 'edits', 'summary']
                },
                execute: async ({ filePath, edits, summary: _summary }: { filePath: string; edits: any[]; summary: string }) => {
                    try {
                        const fullPath = resolvePath(filePath);
                        let content = await fs.readFile(fullPath, 'utf-8');
                        
                        // Sort descending by startLine to prevent drift
                        const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);
                        
                        for (const edit of sortedEdits) {
                            content = editTextRange({
                                content, 
                                startLine: edit.startLine, 
                                endLine: edit.endLine, 
                                expectedContent: edit.expectedContent, 
                                newContent: edit.newContent
                            });
                        }
                        
                        await fs.writeFile(fullPath, content, 'utf-8');
                        return `Successfully applied ${edits.length} edits to ${filePath}`;
                    } catch (error: any) {
                        return `Error editing file ${filePath}: ${error.message}`;
                    }
                }
            },
            {
                name: 'fail_job',
                description: 'Mark a job as failed if it cannot be completed (e.g. invalid file format, unexpected errors). This will summon the Planner to adjust the plan.',
                parameters: {
                    type: 'object',
                    properties: {
                        job: { type: 'string', description: 'The job description to mark as failed.' },
                        reason: { type: 'string', description: 'Detailed reason for the failure.' }
                    },
                    required: ['job', 'reason']
                },
                execute: async ({ job, reason }: { job: string; reason: string }) => {
                    const success = await taskManagerService.failJob(taskId, job, reason);
                    if (abortController) {
                        abortController.abort();
                    }
                    if (success) {
                        return `Marked job as failed: ${job}\\n\\nSYSTEM INSTRUCTION: JOB HAS FAILED. YOU MUST NOW RETURN AN EMPTY RESPONSE (NO TOOLS, NO TEXT) TO YIELD CONTROL TO THE SYSTEM.`;
                    } else {
                        return `Job not found: ${job}\\n\\nSYSTEM INSTRUCTION: YIELD CONTROL.`;
                    }
                }
            },
            {
                name: 'set_state',
                description: 'Save a key-value pair to the structured memory store for sharing data between jobs and steps.',
                parameters: {
                    type: 'object',
                    properties: {
                        key: { type: 'string', description: 'The key to store the data under.' },
                        value: { type: 'string', description: 'A JSON-stringified representation of the value to store.' },
                        summary: { type: 'string', description: 'Reason for saving the state.' }
                    },
                    required: ['key', 'value', 'summary']
                },
                execute: async ({ key, value }: { key: string; value: string }) => {
                    try {
                        const statePath = resolvePath('_state.json');
                        let state: any = {};
                        try {
                            const content = await fs.readFile(statePath, 'utf-8');
                            state = JSON.parse(content);
                        } catch (e) {
                            // File doesn't exist or is invalid JSON, ignore
                        }
                        state[key] = JSON.parse(value);
                        await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
                        return `Successfully saved state for key '${key}'`;
                    } catch (error: any) {
                        return `Error saving state: ${error.message}`;
                    }
                }
            },
            {
                name: 'get_state',
                description: 'Retrieve a value from the structured memory store by key.',
                parameters: {
                    type: 'object',
                    properties: {
                        key: { type: 'string', description: 'The key to retrieve.' },
                        summary: { type: 'string', description: 'Reason for retrieving the state.' }
                    },
                    required: ['key', 'summary']
                },
                execute: async ({ key }: { key: string }) => {
                    try {
                        const statePath = resolvePath('_state.json');
                        const content = await fs.readFile(statePath, 'utf-8');
                        const state = JSON.parse(content);
                        if (key in state) {
                            return JSON.stringify(state[key], null, 2);
                        } else {
                            return `Key '${key}' not found in state store.`;
                        }
                    } catch (error: any) {
                        return `Error retrieving state: ${error.message}`;
                    }
                }
            },
            {
                name: 'validate_syntax',
                description: 'Validate the syntax of a JavaScript file.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Relative path to the JS file to validate.' },
                        summary: { type: 'string', description: 'Reason for validating.' }
                    },
                    required: ['filePath', 'summary']
                },
                execute: async ({ filePath }: { filePath: string }) => {
                    try {
                        const fullPath = resolvePath(filePath);
                        const ext = path.extname(filePath).toLowerCase();
                        if (ext !== '.js') {
                            return `Syntax validation is currently only supported for .js files. Cannot validate ${filePath}`;
                        }
                        
                        const { exec } = require('child_process');
                        const util = require('util');
                        const execAsync = util.promisify(exec);
                        
                        try {
                            // node -c checks syntax without executing
                            await execAsync(`node -c "${fullPath}"`);
                            return `Syntax validation passed for ${filePath}`;
                        } catch (e: any) {
                            // exec returns stdout/stderr in error object
                            return `Syntax validation FAILED for ${filePath}:\\n${e.stderr || e.stdout || e.message}`;
                        }
                    } catch (error: any) {
                        return `Error during validation: ${error.message}`;
                    }
                }
            },

            {
                name: 'move_files',
                description: 'Move or rename multiple files.',
                parameters: {
                    type: 'object',
                    properties: {
                        moves: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    sourcePath: { type: 'string', description: 'Source relative path.' },
                                    destPath: { type: 'string', description: 'Destination relative path.' }
                                },
                                required: ['sourcePath', 'destPath']
                            },
                            description: 'List of files to move or rename.'
                        },
                        summary: { type: 'string', description: 'Reason for moving the files.' }
                    },
                    required: ['moves', 'summary']
                },
                execute: async ({ moves }: { moves: { sourcePath: string, destPath: string }[]; summary: string }) => {
                    try {
                        const results = [];
                        for (const move of moves) {
                            const fullSource = resolvePath(move.sourcePath);
                            const fullDest = resolvePath(move.destPath);
                            await fs.mkdir(path.dirname(fullDest), { recursive: true });
                            await fs.rename(fullSource, fullDest);
                            results.push(`Successfully moved ${move.sourcePath} to ${move.destPath}`);
                        }
                        return results.join('\\n');
                    } catch (error: any) {
                        return `Error moving files: ${error.message}`;
                    }
                }
            },
            {
                name: 'delete_files',
                description: 'Delete multiple files or directories (recursive).',
                parameters: {
                    type: 'object',
                    properties: {
                        filePaths: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'List of relative paths to the files or directories to delete.'
                        },
                        summary: { type: 'string', description: 'Reason for deleting the files/directories.' }
                    },
                    required: ['filePaths', 'summary']
                },
                execute: async ({ filePaths }: { filePaths: string[]; summary: string }) => {
                    try {
                        const results = [];
                        for (const filePath of filePaths) {
                            const fullPath = resolvePath(filePath);
                            await fs.rm(fullPath, { recursive: true, force: true });
                            results.push(`Successfully deleted ${filePath}`);
                        }
                        return results.join('\\n');
                    } catch (error: any) {
                        return `Error deleting files: ${error.message}`;
                    }
                }
            },
            {
                name: 'regexp_search_files',
                description: 'Search for a regular expression pattern across all text files in a directory recursively. Returns a list of matches with file path, line number, and line content.',
                parameters: {
                    type: 'object',
                    properties: {
                        pattern: { type: 'string', description: 'The regular expression pattern string.' },
                        flags: { type: 'string', description: 'Optional regex flags (e.g., "i"). Do not use "g" or "m" here as searching is done line-by-line.' },
                        dirPath: { type: 'string', description: 'Relative directory path to search in (use "." for root).' },
                        summary: { type: 'string', description: 'Reason for searching files.' }
                    },
                    required: ['pattern', 'dirPath', 'summary']
                },
                execute: async ({ pattern, flags, dirPath }: { pattern: string; flags?: string; dirPath: string; summary: string }) => {
                    try {
                        const fullDir = resolvePath(dirPath);
                        const regexFlags = (flags || '').replace(/[gm]/g, ''); // strip g and m
                        const regex = new RegExp(pattern, regexFlags);
                        const matches: { path: string; line: number; content: string }[] = [];

                        async function searchDir(dir: string) {
                            const dirents = await fs.readdir(dir, { withFileTypes: true });
                            for (const dirent of dirents) {
                                const res = path.resolve(dir, dirent.name);
                                if (dirent.isDirectory()) {
                                    await searchDir(res);
                                } else {
                                    const ext = path.extname(res).toLowerCase();
                                    if (['.html', '.css', '.js', '.json', '.txt', '.md', '.svg'].includes(ext)) {
                                        try {
                                            const fileContent = await fs.readFile(res, 'utf-8');
                                            const lines = fileContent.split(/\\r?\\n/);
                                            for (let i = 0; i < lines.length; i++) {
                                                if (regex.test(lines[i])) {
                                                    matches.push({
                                                        path: path.relative(workingDirectory, res),
                                                        line: i + 1,
                                                        content: lines[i].trim()
                                                    });
                                                }
                                            }
                                        } catch (e) {
                                            // Ignore read errors for individual files
                                        }
                                    }
                                }
                            }
                        }

                        await searchDir(fullDir);
                        if (matches.length === 0) return 'No matches found.';
                        return JSON.stringify(matches, null, 2);
                    } catch (error: any) {
                        return `Error searching files in ${dirPath}: ${error.message}`;
                    }
                }
            }
        ];
    };
}
