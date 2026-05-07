import * as dns from 'node:dns';
import { promisify } from 'node:util';

const lookup = promisify(dns.lookup);

export async function resolveInternalUrl(urlStr: string): Promise<string> {
    try {
        const urlObj = new URL(urlStr);
        if (urlObj.hostname === 'app') {
            const { address } = await lookup('app');
            urlObj.hostname = address;
            return urlObj.toString().replace(/\/$/, '');
        }
    } catch (e) {
        console.error('Failed to resolve app hostname:', e);
    }
    return urlStr;
}
