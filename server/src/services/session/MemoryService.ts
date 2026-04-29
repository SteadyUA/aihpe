import { Service } from 'typedi';
import { FilesService } from './FilesService';

export const MEMORY_FILES = ['preferences.md', 'state.md', 'decisions.md'];

@Service()
export class MemoryService {
    constructor(
        private readonly filesService: FilesService
    ) { }

    public async getMemoryContext(sessionId: string, version: number): Promise<string> {
        let context = '';

        for (const file of MEMORY_FILES) {
            const content = this.filesService.readVersionFile(sessionId, version, `.memory/${file}`) || '';
            context += `### ${file}\n${content}\n`;
        }

        return context;
    }

    public updateMemoryFile(sessionId: string, version: number, filename: string, content: string): void {
        if (!MEMORY_FILES.includes(filename)) {
            throw new Error(`Invalid memory file: ${filename}. Allowed files: ${MEMORY_FILES.join(', ')}`);
        }
        this.filesService.writeVersionFile(sessionId, version, `.memory/${filename}`, content);
    }

    public readMemoryFile(sessionId: string, version: number, filename: string): string {
        if (!MEMORY_FILES.includes(filename)) {
            throw new Error(`Invalid memory file: ${filename}. Allowed files: ${MEMORY_FILES.join(', ')}`);
        }
        return (this.filesService.readVersionFile(sessionId, version, `.memory/${filename}`) as string) || '';
    }

    public initMemory(sessionId: string): void {
        for (const file of MEMORY_FILES) {
            this.filesService.writeVersionFile(sessionId, 0, `.memory/${file}`, '');
        }
    }
}
