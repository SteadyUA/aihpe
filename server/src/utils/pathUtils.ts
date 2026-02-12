import path from 'path';

export function getDataDir(): string {
    return path.resolve(process.cwd(), process.env.DATA_DIR || 'data');
}

export function getSessionsDir(): string {
    return path.join(getDataDir(), 'sessions');
}
