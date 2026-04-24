import { Service } from 'typedi';
import { FilesService, MEMORY_FILES } from './FilesService';

@Service()
export class MemoryService {
    constructor(
        private readonly filesService: FilesService
    ) { }

    public async getMemoryContext(sessionId: string, version: number): Promise<string> {
        let context = '';

        for (const file of MEMORY_FILES) {
            const content = this.filesService.readMemoryFile(sessionId, version, file) || '';
            context += `### ${file}\n${content}\n`;
        }

        return context;
    }

    public updateMemoryFile(sessionId: string, version: number, filename: string, content: string): void {
        if (!MEMORY_FILES.includes(filename)) {
            throw new Error(`Invalid memory file: ${filename}. Allowed files: ${MEMORY_FILES.join(', ')}`);
        }
        this.filesService.writeMemoryFile(sessionId, version, filename, content);
    }

    public readMemoryFile(sessionId: string, version: number, filename: string): string {
        if (!MEMORY_FILES.includes(filename)) {
            throw new Error(`Invalid memory file: ${filename}. Allowed files: ${MEMORY_FILES.join(', ')}`);
        }
        return this.filesService.readMemoryFile(sessionId, version, filename) || '';
    }
}
