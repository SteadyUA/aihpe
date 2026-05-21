
import * as fs from 'fs/promises';
import * as path from 'path';
import { readTextRange, editTextRange } from './PageGenTools';

export interface HtmlConversionContext {
    workingDirectory: string;
    taskId: string;
    abortController?: AbortController;
    onSubagentRun?: (instruction: string, targetFiles: string[]) => Promise<string>;
    onFinishImport?: () => void;
    onPlanUpdated?: () => void;
    onSubagentSuccess?: (summary: string) => void;
    onToolCall?: (agentName: 'Orchestrator' | 'Subagent', toolName: string, summary: string) => void;
}

const resolvePath = (workingDirectory: string, filePath: string) => {
    // Prevent directory traversal
    const resolved = path.resolve(workingDirectory, filePath);
    if (!resolved.startsWith(workingDirectory)) {
        throw new Error('Access denied: Path is outside working directory');
    }
    return resolved;
};

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
            case '.md': return 'text/markdown';
            case '.png': return 'image/png';
            case '.jpg': case '.jpeg': return 'image/jpeg';
            case '.gif': return 'image/gif';
            case '.svg': return 'image/svg+xml';
            default: return 'application/octet-stream';
        }
    }
};

const createListFilesTool = (workingDirectory: string) => ({
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

        try {
            const files = await getFiles(workingDirectory);
            const fileList = (await Promise.all(files.map(async f => {
                const relPath = path.relative(workingDirectory, f);
                
                if (relPath.startsWith('.memory')) {
                    return null;
                }
                
                const mimeType = await getMimeType(f);
                const stats = await fs.stat(f);
                
                const isText = mimeType.startsWith('text/') || ['application/json', 'application/javascript', 'image/svg+xml', 'text/markdown'].includes(mimeType);
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
            }))).filter(Boolean);
            return JSON.stringify(fileList);
        } catch (error: any) {
            return `Error listing files: ${error.message}`;
        }
    }
});

const createReadFileTool = (workingDirectory: string) => ({
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
    execute: async ({ filePath, startLine, endLine, summary: _summary }: { filePath: string; startLine?: number; endLine?: number; summary: string }) => {
        try {
            const fullPath = resolvePath(workingDirectory, filePath);
            const content = await fs.readFile(fullPath, 'utf-8');
            const totalLines = (content.match(/\n/g) || []).length + 1;
            
            const start = startLine ? Math.max(1, startLine) : 1;
            const end = endLine ? Math.min(totalLines, endLine) : totalLines;
            
            if (end - start + 1 > 400) {
                return `Error: You requested to read ${end - start + 1} lines (total file is ${totalLines} lines). The maximum allowed is 400 lines per request. Please use startLine and endLine to read the file in smaller chunks.`;
            }
            
            return readTextRange(content, startLine, endLine);
        } catch (error: any) {
            return `Error reading file ${filePath}: ${error.message}`;
        }
    }
});

const createMultiEditFileTool = (context: HtmlConversionContext) => ({
    name: 'multi_edit_file',
    description: 'Edit a text file by replacing multiple non-contiguous blocks of text. The tool will automatically sort the replacements from bottom to top (descending line numbers). Always use read_file first to check line numbers. expectedContent should not include the line numbers prepended by read_file. If the file does not exist, it will be created.',
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
                        expectedContent: { type: 'string', description: 'The exact string to replace within the line range. Leave empty ("") to blindly replace the lines between startLine and endLine without text matching. This is highly recommended to avoid whitespace mismatch errors.' },
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
            const fullPath = resolvePath(context.workingDirectory, filePath);
            // Ensure file exists or create it
            try {
                await fs.access(fullPath);
            } catch (e) {
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, '', 'utf-8');
            }

            let content = await fs.readFile(fullPath, 'utf-8');

            // Sort edits by startLine descending to prevent line drift
            edits.sort((a, b) => b.startLine - a.startLine);

            for (const edit of edits) {
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
});

const createRegexpSearchFilesTool = (workingDirectory: string) => ({
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
            const fullDir = resolvePath(workingDirectory, dirPath);
            const regexFlags = (flags || '').replace(/[gm]/g, ''); // strip g and m
            const regex = new RegExp(pattern, regexFlags);
            const matches: { path: string; line: number; content: string }[] = [];

            async function searchDir(dir: string) {
                const dirents = await fs.readdir(dir, { withFileTypes: true });
                for (const dirent of dirents) {
                    const res = path.resolve(dir, dirent.name);
                    const relPath = path.relative(workingDirectory, res);
                    
                    if (relPath.startsWith('.memory')) {
                        continue;
                    }
                    
                    if (dirent.isDirectory()) {
                        await searchDir(res);
                    } else {
                        const ext = path.extname(res).toLowerCase();
                        if (['.html', '.css', '.js', '.json', '.txt', '.md', '.svg'].includes(ext)) {
                            try {
                                const fileContent = await fs.readFile(res, 'utf-8');
                                const lines = fileContent.split(/\r?\n/);
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
});

const createRegexpReplaceInFileTool = (workingDirectory: string) => ({
    name: 'regexp_replace_in_file',
    description: 'Use a regular expression to perform a global search-and-replace across an entire text file. This is extremely useful for updating many similar paths or tags (like updating asset URLs) without needing exact line matching.',
    parameters: {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'Relative path to the file.' },
            pattern: { type: 'string', description: 'The regular expression pattern string.' },
            flags: { type: 'string', description: 'Regex flags (e.g., "g" for global, "i" for case-insensitive). Default is "g".' },
            replacement: { type: 'string', description: 'The string to replace matches with. You can use capture groups like $1, $2.' },
            summary: { type: 'string', description: 'Reason for replacing.' }
        },
        required: ['filePath', 'pattern', 'replacement', 'summary']
    },
    execute: async ({ filePath, pattern, flags = 'g', replacement, summary: _summary }: { filePath: string; pattern: string; flags?: string; replacement: string; summary: string }) => {
        try {
            const fullPath = resolvePath(workingDirectory, filePath);
            const content = await fs.readFile(fullPath, 'utf-8');
            
            // Ensure global flag is present if they want to replace all
            const regexFlags = flags.includes('g') ? flags : flags + 'g';
            const regex = new RegExp(pattern, regexFlags);
            
            const matchCount = (content.match(regex) || []).length;
            if (matchCount === 0) {
                return `No matches found for pattern /${pattern}/ in ${filePath}.`;
            }

            const updatedContent = content.replace(regex, replacement);
            await fs.writeFile(fullPath, updatedContent, 'utf-8');

            return `Successfully replaced ${matchCount} occurrences in ${filePath}.`;
        } catch (error: any) {
            return `Error replacing with regex in ${filePath}: ${error.message}`;
        }
    }
});

const createValidateSyntaxTool = (workingDirectory: string) => ({
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
            const fullPath = resolvePath(workingDirectory, filePath);
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
                return `Syntax validation FAILED for ${filePath}:\n${e.stderr || e.stdout || e.message}`;
            }
        } catch (error: any) {
            return `Error during validation: ${error.message}`;
        }
    }
});

const createMoveFilesTool = (workingDirectory: string) => ({
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
    execute: async ({ moves, summary: _summary }: { moves: { sourcePath: string, destPath: string }[]; summary: string }) => {
        try {
            const results = [];
            for (const move of moves) {
                const fullSource = resolvePath(workingDirectory, move.sourcePath);
                const fullDest = resolvePath(workingDirectory, move.destPath);
                await fs.mkdir(path.dirname(fullDest), { recursive: true });
                await fs.rename(fullSource, fullDest);
                results.push(`Successfully moved ${move.sourcePath} to ${move.destPath}`);
            }
            return results.join('\n');
        } catch (error: any) {
            return `Error moving files: ${error.message}`;
        }
    }
});

const createCopyFilesTool = (workingDirectory: string) => ({
    name: 'copy_files',
    description: 'Copy multiple files from a source path to a destination path.',
    parameters: {
        type: 'object',
        properties: {
            copies: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        sourcePath: { type: 'string', description: 'Source relative path.' },
                        destPath: { type: 'string', description: 'Destination relative path.' }
                    },
                    required: ['sourcePath', 'destPath']
                },
                description: 'List of files to copy.'
            },
            summary: { type: 'string', description: 'Reason for copying the files.' }
        },
        required: ['copies', 'summary']
    },
    execute: async ({ copies, summary: _summary }: { copies: { sourcePath: string, destPath: string }[]; summary: string }) => {
        try {
            const results = [];
            for (const copy of copies) {
                const fullSource = resolvePath(workingDirectory, copy.sourcePath);
                const fullDest = resolvePath(workingDirectory, copy.destPath);
                await fs.mkdir(path.dirname(fullDest), { recursive: true });
                await fs.copyFile(fullSource, fullDest);
                results.push(`Successfully copied ${copy.sourcePath} to ${copy.destPath}`);
            }
            return results.join('\n');
        } catch (error: any) {
            return `Error copying files: ${error.message}`;
        }
    }
});

const createConcatFilesTool = (workingDirectory: string) => ({
    name: 'concat_files',
    description: 'Concatenate (append) multiple source files into a destination file. Use this to merge JS or CSS files efficiently without reading their contents. A newline is automatically added between files.',
    parameters: {
        type: 'object',
        properties: {
            sourcePaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of relative paths to the source files to append.'
            },
            destPath: { type: 'string', description: 'Relative path to the destination file.' },
            summary: { type: 'string', description: 'Reason for concatenating the files.' }
        },
        required: ['sourcePaths', 'destPath', 'summary']
    },
    execute: async ({ sourcePaths, destPath, summary: _summary }: { sourcePaths: string[]; destPath: string; summary: string }) => {
        try {
            const fullDest = resolvePath(workingDirectory, destPath);
            await fs.mkdir(path.dirname(fullDest), { recursive: true });
            
            // Ensure dest exists
            try {
                await fs.access(fullDest);
            } catch (e) {
                await fs.writeFile(fullDest, '', 'utf-8');
            }

            for (const src of sourcePaths) {
                const fullSource = resolvePath(workingDirectory, src);
                let content = await fs.readFile(fullSource, 'utf-8');
                
                // Auto-strip strict mode for JS if concatenating to prevent syntax errors
                if (src.endsWith('.js') && destPath.endsWith('.js')) {
                    content = content.replace(/['"]use strict['"];?/g, '');
                }
                
                await fs.appendFile(fullDest, '\n' + content + '\n', 'utf-8');
            }
            return `Successfully concatenated ${sourcePaths.length} files into ${destPath}`;
        } catch (error: any) {
            return `Error concatenating files: ${error.message}`;
        }
    }
});

const createDeleteFilesTool = (workingDirectory: string) => ({
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
                const fullPath = resolvePath(workingDirectory, filePath);
                await fs.rm(fullPath, { recursive: true, force: true });
                results.push(`Successfully deleted ${filePath}`);
            }
            return results.join('\n');
        } catch (error: any) {
            return `Error deleting files: ${error.message}`;
        }
    }
});

const createListMemoryFilesTool = (workingDirectory: string) => ({
    name: 'list_memory_files',
    description: 'List all memory files in the .memory directory.',
    parameters: {
        type: 'object',
        properties: {
            summary: { type: 'string', description: 'Reason for listing memory files.' }
        },
        required: ['summary']
    },
    execute: async ({ summary: _summary }: { summary: string }) => {
        try {
            const memDir = path.join(workingDirectory, '.memory');
            try {
                await fs.access(memDir);
            } catch {
                return 'No memory files found.';
            }
            const files = await fs.readdir(memDir);
            return files.join('\n');
        } catch (error: any) {
            return `Error listing memory files: ${error.message}`;
        }
    }
});

const createReadMemoryFileTool = (workingDirectory: string) => ({
    name: 'read_memory_file',
    description: 'Read the contents of a memory file (e.g. plan.md). Returns the content with line numbers prepended.',
    parameters: {
        type: 'object',
        properties: {
            filename: { type: 'string', description: 'Name of the memory file (e.g. plan.md).' },
            summary: { type: 'string', description: 'Reason for reading the memory file.' }
        },
        required: ['filename', 'summary']
    },
    execute: async ({ filename, summary: _summary }: { filename: string; summary: string }) => {
        try {
            const fullPath = resolvePath(workingDirectory, path.join('.memory', filename));
            const content = await fs.readFile(fullPath, 'utf-8');
            return readTextRange(content);
        } catch (error: any) {
            return `Error reading memory file ${filename}: ${error.message}`;
        }
    }
});

const createMultiEditMemoryFileTool = (context: HtmlConversionContext) => ({
    name: 'multi_edit_memory_file',
    description: 'Edit a memory file by replacing multiple non-contiguous blocks of text. The tool will automatically sort the replacements from bottom to top (descending line numbers). Always use read_memory_file first to check line numbers. expectedContent should not include the line numbers prepended by read_memory_file. If the file does not exist, it will be created.',
    parameters: {
        type: 'object',
        properties: {
            filename: { type: 'string', description: 'Name of the memory file (e.g. plan.md).' },
            edits: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        startLine: { type: 'number', description: 'The starting line number of the block to replace (1-indexed).' },
                        endLine: { type: 'number', description: 'The ending line number of the block to replace (1-indexed).' },
                        expectedContent: { type: 'string', description: 'The exact string to replace within the line range.' },
                        newContent: { type: 'string', description: 'The new string to replace it with.' }
                    },
                    required: ['startLine', 'endLine', 'expectedContent', 'newContent']
                },
                description: 'List of edits to apply to the file.'
            },
            summary: { type: 'string', description: 'Reason for editing the memory file.' }
        },
        required: ['filename', 'edits', 'summary']
    },
    execute: async ({ filename, edits, summary: _summary }: { filename: string; edits: any[]; summary: string }) => {
        try {
            const fullPath = resolvePath(context.workingDirectory, path.join('.memory', filename));
            // Ensure file exists or create it
            try {
                await fs.access(fullPath);
            } catch (e) {
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, '', 'utf-8');
            }

            let content = await fs.readFile(fullPath, 'utf-8');

            // Sort edits by startLine descending to prevent line drift
            edits.sort((a, b) => b.startLine - a.startLine);

            for (const edit of edits) {
                content = editTextRange({
                    content,
                    startLine: edit.startLine,
                    endLine: edit.endLine,
                    expectedContent: edit.expectedContent,
                    newContent: edit.newContent
                });
            }

            await fs.writeFile(fullPath, content, 'utf-8');

            if (filename === 'plan.md' && context.onPlanUpdated) {
                context.onPlanUpdated();
            }

            return `Successfully applied ${edits.length} edits to ${filename}`;
        } catch (error: any) {
            return `Error editing memory file ${filename}: ${error.message}`;
        }
    }
});

const createAnalyzeJsAstTool = (workingDirectory: string) => ({
    name: 'analyze_js_ast',
    description: 'Parse a JavaScript file into an AST and return a map of all classes, methods, and functions with their exact start and end line numbers. Use this tool BEFORE attempting to extract or edit large blocks of JavaScript code to get precise line numbers and avoid regex errors.',
    parameters: {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'Relative path to the JS file to analyze.' },
            summary: { type: 'string', description: 'Reason for analyzing the AST.' }
        },
        required: ['filePath', 'summary']
    },
    execute: async ({ filePath, summary: _summary }: { filePath: string; summary: string }) => {
        try {
            const fullPath = resolvePath(workingDirectory, filePath);
            const ext = path.extname(filePath).toLowerCase();
            if (ext !== '.js') {
                return `AST analysis is currently only supported for .js files. Cannot analyze ${filePath}`;
            }

            const content = await fs.readFile(fullPath, 'utf-8');
            
            // Require acorn dynamically to avoid breaking other files if not installed
            const acorn = require('acorn');
            const walk = require('acorn-walk');

            const ast = acorn.parse(content, { ecmaVersion: 'latest', locations: true });

            const output: string[] = [];

            walk.simple(ast, {
                ClassDeclaration(node: any) {
                    if (node.id && node.id.name) {
                        output.push(`Class: ${node.id.name} (lines ${node.loc.start.line}-${node.loc.end.line})`);
                    }
                },
                MethodDefinition(node: any) {
                    if (node.key && node.key.name) {
                        output.push(`  Method: ${node.key.name} (lines ${node.loc.start.line}-${node.loc.end.line})`);
                    }
                },
                FunctionDeclaration(node: any) {
                    if (node.id && node.id.name) {
                        output.push(`Function: ${node.id.name} (lines ${node.loc.start.line}-${node.loc.end.line})`);
                    }
                },
                VariableDeclarator(node: any) {
                    if (node.id && node.id.name && node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
                        output.push(`FunctionExpression/Arrow: ${node.id.name} (lines ${node.loc.start.line}-${node.loc.end.line})`);
                    }
                }
            });

            if (output.length === 0) {
                return `No classes, methods, or named functions found in ${filePath}.`;
            }

            return `AST Analysis for ${filePath}:\n` + output.join('\n');
        } catch (error: any) {
            return `Error analyzing AST for ${filePath}: ${error.message}`;
        }
    }
});

export function createOrchestratorTools(): (request: any, context: HtmlConversionContext) => any[] {
    return (_request: any, context: HtmlConversionContext) => {
        const { workingDirectory, onSubagentRun, onFinishImport } = context;

        return [
            createListFilesTool(workingDirectory),
            createListMemoryFilesTool(workingDirectory),
            createReadMemoryFileTool(workingDirectory),
            createMultiEditMemoryFileTool(context),
            {
                name: 'run_subagent',
                description: 'Trigger the executor subagent to perform an atomic file modification based on your instruction.',
                parameters: {
                    type: 'object',
                    properties: {
                        instruction: { type: 'string', description: 'Precise instruction for the subagent on what to do.' },
                        targetFiles: { 
                            type: 'array', 
                            items: { type: 'string' }, 
                            description: 'List of files the subagent will read or modify. The system will create .bak copies of these files before execution for safety.'
                        },
                        summary: { type: 'string', description: 'Reason for invoking the subagent.' }
                    },
                    required: ['instruction', 'targetFiles', 'summary']
                },
                execute: async ({ instruction, targetFiles }: { instruction: string; targetFiles: string[] }) => {
                    if (!onSubagentRun) {
                        return 'Error: onSubagentRun callback not provided in context.';
                    }
                    
                    try {
                        // Create backups
                        for (const file of targetFiles) {
                            try {
                                const fullPath = resolvePath(workingDirectory, file);
                                const stats = await fs.stat(fullPath);
                                if (stats.isFile()) {
                                    await fs.copyFile(fullPath, fullPath + '.bak');
                                }
                            } catch (e) {
                                // Ignore if file doesn't exist (it might be a file the subagent will create)
                            }
                        }

                        const result = await onSubagentRun(instruction, targetFiles);
                        return `Subagent completed with result:\n${result}`;
                    } catch (e: any) {
                        if (context.onToolCall) {
                            context.onToolCall('Orchestrator', 'SUBAGENT_CRASHED', `Subagent run terminated with exception: ${e.message}`);
                        }
                        // Restore backups on catastrophic failure, though subagent could also report normal failure
                        for (const file of targetFiles) {
                            try {
                                const fullPath = resolvePath(workingDirectory, file);
                                await fs.copyFile(fullPath + '.bak', fullPath);
                                await fs.rm(fullPath + '.bak');
                            } catch (restoreError) {}
                        }
                        return `Subagent failed with error: ${e.message}. Files have been restored from backup.`;
                    } finally {
                        // Cleanup backups
                        for (const file of targetFiles) {
                            try {
                                const fullPath = resolvePath(workingDirectory, file);
                                await fs.rm(fullPath + '.bak', { force: true });
                            } catch (cleanupError) {}
                        }
                    }
                }
            },
            {
                name: 'finish_import',
                description: 'Mark the entire import process as fully complete.',
                parameters: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string', description: 'Final summary of the import.' }
                    },
                    required: ['summary']
                },
                execute: async ({ summary }: { summary: string }) => {
                    if (onFinishImport) {
                        onFinishImport();
                    }
                    return `Import process finished: ${summary}`;
                }
            }
        ];
    };
}

export function createSubagentTools(): (request: any, context: HtmlConversionContext) => any[] {
    return (_request: any, context: HtmlConversionContext) => {
        const { workingDirectory } = context;

        return [
            createListFilesTool(workingDirectory),
            createReadFileTool(workingDirectory),
            createMultiEditFileTool(context),
            createMoveFilesTool(workingDirectory),
            createCopyFilesTool(workingDirectory),
            createConcatFilesTool(workingDirectory),
            createDeleteFilesTool(workingDirectory),
            createValidateSyntaxTool(workingDirectory),
            createRegexpSearchFilesTool(workingDirectory),
            createRegexpReplaceInFileTool(workingDirectory),
            createAnalyzeJsAstTool(workingDirectory),
            {
                name: 'report_failure',
                description: 'Report that you are unable to complete the instruction due to an insurmountable error (e.g., unfixable syntax error, missing files). This will automatically cancel your edits, restore the files to their original state, and notify the Orchestrator.',
                parameters: {
                    type: 'object',
                    properties: {
                        reason: { type: 'string', description: 'Detailed reason why you cannot complete the task.' },
                        summary: { type: 'string', description: 'Short reason for failure.' }
                    },
                    required: ['reason', 'summary']
                },
                execute: async ({ reason }: { reason: string }) => {
                    // Throwing an error here triggers the catch block in run_subagent (in Orchestrator),
                    // which restores the .bak files and returns the error message to the Orchestrator.
                    throw new Error(reason);
                }
            },
            {
                name: 'report_success',
                description: 'Report that you have successfully completed the instruction. This MUST be the final tool you call to signal task completion.',
                parameters: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string', description: 'Short text describing the purpose of this call.' },
                        report: { type: 'string', description: 'A final text message summarizing exactly what you did and which files were modified.' }
                    },
                    required: ['summary', 'report']
                },
                execute: async ({ summary: _summary, report }: { summary: string; report: string }) => {
                    if (context.onSubagentSuccess) {
                        context.onSubagentSuccess(report);
                    }
                    return 'Success reported.';
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
                        const statePath = resolvePath(workingDirectory, '_state.json');
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
                        const statePath = resolvePath(workingDirectory, '_state.json');
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
            }
        ];
    };
}
