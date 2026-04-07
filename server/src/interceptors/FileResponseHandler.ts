import { Interceptor, InterceptorInterface, Action } from 'routing-controllers';
import { Service } from 'typedi';
import fs from 'fs';
import path from 'path';

export class FileResponse {
    constructor(
        public readonly filePath: string,
        public readonly downloadFilename?: string,
    ) {
    }
}

export class FileStreamResponse {
    constructor(
        public readonly filename: string,
        public readonly stream: any,
        public readonly downloadFilename?: string,
    ) {
    }
}

@Service()
@Interceptor()
export class FileResponseHandler implements InterceptorInterface {
    private readonly mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.zip': 'application/zip',
    };

    intercept(action: Action, content: any) {
        let fileExt = '';
        let fileStream;
        if (content instanceof FileResponse) {
            fileExt = path.extname(content.filePath).toLowerCase();
            fileStream = fs.createReadStream(content.filePath);
        } else if (content instanceof FileStreamResponse) {
            fileExt = path.extname(content.filename).toLowerCase();
            fileStream = content.stream;
        } else {
            return content;
        }
        const res = action.response;
        const contentType = this.mimeTypes[fileExt] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);

        if (content.downloadFilename) {
            res.setHeader('Content-Disposition', `attachment; filename="${content.downloadFilename}"`);
        }

        return fileStream;
    }
}
