import { LlmTool } from '../types';
import { TaskManagerService } from '../../TaskManagerService';
import { Container } from 'typedi';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface HtmlConversionContext {
    workingDirectory: string;
    taskId: string;
    abortController?: AbortController;
}

export function createHtmlConversionTools(): (
    request: any,
    context: HtmlConversionContext
) => LlmTool<HtmlConversionContext>[] {
    return (request: any, context: HtmlConversionContext) => {
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
                execute: async ({ steps, summary }: { steps: { stepName: string, concurrentJobs: { description: string, shortDescription: string }[] }[]; summary: string }) => {
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
                execute: async ({ job, summary }: { job: string; summary: string }) => {
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
                execute: async ({ summary }: { summary: string }) => {
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
                            return {
                                path: relPath,
                                mimeType: await getMimeType(f)
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
                description: 'Read the content of a file.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Relative path to the file.' },
                        summary: { type: 'string', description: 'Reason for reading the file.' }
                    },
                    required: ['filePath', 'summary']
                },
                execute: async ({ filePath, summary }: { filePath: string; summary: string }) => {
                    try {
                        const fullPath = resolvePath(filePath);
                        const content = await fs.readFile(fullPath, 'utf-8');
                        return content;
                    } catch (error: any) {
                        return `Error reading file ${filePath}: ${error.message}`;
                    }
                }
            },
            {
                name: 'write_file',
                description: 'Write content to a file. Overwrites if exists. Creates directories if needed.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Relative path to the file.' },
                        content: { type: 'string', description: 'Content to write.' },
                        summary: { type: 'string', description: 'Reason for writing the file.' }
                    },
                    required: ['filePath', 'content', 'summary']
                },
                execute: async ({ filePath, content, summary }: { filePath: string; content: string; summary: string }) => {
                    try {
                        const fullPath = resolvePath(filePath);
                        await fs.mkdir(path.dirname(fullPath), { recursive: true });
                        await fs.writeFile(fullPath, content, 'utf-8');
                        return `Successfully wrote to ${filePath}`;
                    } catch (error: any) {
                        return `Error writing file ${filePath}: ${error.message}`;
                    }
                }
            },
            {
                name: 'edit_file',
                description: 'Edit a file by replacing all occurrences of a specific string with a new string. Use this to quickly remove or change lines of code.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Relative path to the file.' },
                        oldString: { type: 'string', description: 'The exact string to be replaced.' },
                        newString: { type: 'string', description: 'The string to replace it with. Pass an empty string to delete oldString.' },
                        summary: { type: 'string', description: 'Reason for editing the file.' }
                    },
                    required: ['filePath', 'oldString', 'newString', 'summary']
                },
                execute: async ({ filePath, oldString, newString, summary }: { filePath: string; oldString: string; newString: string; summary: string }) => {
                    try {
                        const fullPath = resolvePath(filePath);
                        let content = await fs.readFile(fullPath, 'utf-8');
                        if (!content.includes(oldString)) {
                            return `Error: oldString was not found in ${filePath}`;
                        }
                        content = content.split(oldString).join(newString);
                        await fs.writeFile(fullPath, content, 'utf-8');
                        return `Successfully edited ${filePath}, replacing occurrences of the string.`;
                    } catch (error: any) {
                        return `Error editing file ${filePath}: ${error.message}`;
                    }
                }
            },
            {
                name: 'append_file',
                description: 'Append content to a file. Creates the file and directories if they do not exist.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Relative path to the file.' },
                        content: { type: 'string', description: 'Content to append.' },
                        summary: { type: 'string', description: 'Reason for appending to the file.' }
                    },
                    required: ['filePath', 'content', 'summary']
                },
                execute: async ({ filePath, content, summary }: { filePath: string; content: string; summary: string }) => {
                    try {
                        const fullPath = resolvePath(filePath);
                        await fs.mkdir(path.dirname(fullPath), { recursive: true });
                        await fs.appendFile(fullPath, content + '\n', 'utf-8');
                        return `Successfully appended to ${filePath}`;
                    } catch (error: any) {
                        return `Error appending to file ${filePath}: ${error.message}`;
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
                execute: async ({ moves, summary }: { moves: { sourcePath: string, destPath: string }[]; summary: string }) => {
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
                execute: async ({ filePaths, summary }: { filePaths: string[]; summary: string }) => {
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
                name: 'get_file_info',
                description: 'Get file size and type info.',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Relative path to the file.' },
                        summary: { type: 'string', description: 'Reason for checking file info.' }
                    },
                    required: ['filePath', 'summary']
                },
                execute: async ({ filePath, summary }: { filePath: string; summary: string }) => {
                    try {
                        const fullPath = resolvePath(filePath);
                        const stats = await fs.stat(fullPath);
                        return JSON.stringify({
                            size: stats.size,
                            isFile: stats.isFile(),
                            isDirectory: stats.isDirectory()
                        });
                    } catch (error: any) {
                        return `Error getting info for ${filePath}: ${error.message}`;
                    }
                }
            },
            {
                name: 'regexp_match_all',
                description: 'Find all occurrences of a regular expression within a specific file and return the matched strings. Capture groups are returned if the regex contains them.',
                parameters: {
                    type: 'object',
                    properties: {
                        pattern: { type: 'string', description: 'The regular expression pattern string (e.g., "(?<=\\\\()url\\\\([^)]+\\\\)")' },
                        flags: { type: 'string', description: 'Optional regex flags (e.g., "g", "i", "m"). Defaults to "g" if omitted.' },
                        filePath: { type: 'string', description: 'Relative path to the file to search in.' },
                        summary: { type: 'string', description: 'Reason for searching the file.' }
                    },
                    required: ['pattern', 'filePath', 'summary']
                },
                execute: async ({ pattern, flags, filePath, summary }: { pattern: string; flags?: string; filePath: string; summary: string }) => {
                    try {
                        const fullPath = resolvePath(filePath);
                        const content = await fs.readFile(fullPath, 'utf-8');
                        const regexFlags = flags || 'g';
                        const isGlobal = regexFlags.includes('g');
                        const regex = new RegExp(pattern, regexFlags);

                        if (isGlobal) {
                            const matches = [...content.matchAll(regex)];
                            if (matches.length === 0) return 'No matches found.';

                            // Extract full match and capture groups
                            const results = matches.map(m => {
                                if (m.length > 1) {
                                    // Remove the full match at index 0, return just the capture groups
                                    return m.slice(1).filter(g => g !== undefined);
                                }
                                return [m[0]];
                            });
                            return JSON.stringify(results);
                        } else {
                            const match = content.match(regex);
                            if (!match) return 'No match found.';

                            if (match.length > 1) {
                                return JSON.stringify([match.slice(1).filter(g => g !== undefined)]);
                            }
                            return JSON.stringify([[match[0]]]);
                        }
                    } catch (error: any) {
                        return `Error scanning file ${filePath}: ${error.message}`;
                    }
                }
            },
            {
                name: 'regexp_search_files',
                description: 'Search for a regular expression pattern across all files in a directory recursively. Returns a list of filenames that contain at least one match.',
                parameters: {
                    type: 'object',
                    properties: {
                        pattern: { type: 'string', description: 'The regular expression pattern string.' },
                        flags: { type: 'string', description: 'Optional regex flags (e.g., "i", "m"). Do not use "g" here.' },
                        dirPath: { type: 'string', description: 'Relative directory path to search in (use "." for root).' },
                        summary: { type: 'string', description: 'Reason for searching files.' }
                    },
                    required: ['pattern', 'dirPath', 'summary']
                },
                execute: async ({ pattern, flags, dirPath, summary }: { pattern: string; flags?: string; dirPath: string; summary: string }) => {
                    try {
                        const fullDir = resolvePath(dirPath);
                        const regex = new RegExp(pattern, flags);
                        const matchingFiles: string[] = [];

                        async function searchDir(dir: string) {
                            const dirents = await fs.readdir(dir, { withFileTypes: true });
                            for (const dirent of dirents) {
                                const res = path.resolve(dir, dirent.name);
                                if (dirent.isDirectory()) {
                                    await searchDir(res);
                                } else {
                                    // Skip binary files naively by checking extension or just trying to read as utf8
                                    const ext = path.extname(res).toLowerCase();
                                    if (['.html', '.css', '.js', '.json', '.txt', '.md', '.svg'].includes(ext)) {
                                        try {
                                            const content = await fs.readFile(res, 'utf-8');
                                            if (regex.test(content)) {
                                                matchingFiles.push(path.relative(workingDirectory, res));
                                            }
                                        } catch (e) {
                                            // Ignore read errors for individual files
                                        }
                                    }
                                }
                            }
                        }

                        await searchDir(fullDir);
                        if (matchingFiles.length === 0) return 'No files matched the pattern.';
                        return JSON.stringify(matchingFiles);
                    } catch (error: any) {
                        return `Error searching files in ${dirPath}: ${error.message}`;
                    }
                }
            }
        ];
    };
}
