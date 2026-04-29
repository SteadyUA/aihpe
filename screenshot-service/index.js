const express = require('express');
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);

const app = express();
const PORT = process.env.PORT || 3001;
const SHARED_DIR = process.env.SHARED_DIR || '/app/shared';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS) || 15000;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT) || 5;

let browser = null;

// Simple semaphore for concurrency control
class Semaphore {
    constructor(max) {
        this.max = max;
        this.current = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.current < this.max) {
            this.current++;
            return;
        }
        return new Promise(resolve => this.queue.push(resolve));
    }

    release() {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
        } else {
            this.current--;
        }
    }
}

const semaphore = new Semaphore(MAX_CONCURRENT);

function withTimeout(promise, ms) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Operation timed out after ${ms} ms`));
        }, ms);
    });

    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => clearTimeout(timeoutId));
}

// Ensure the URL is valid and if it's file://, resolve it safely
function resolveUrl(inputUrl) {
    if (!inputUrl) throw new Error('URL is required');

    if (inputUrl.startsWith('file://')) {
        let filePath = inputUrl.slice('file://'.length);

        // Remove leading slashes if they exist so it's always treated as relative to SHARED_DIR
        filePath = filePath.replace(/^\/+/, '');

        // Forbid path traversal
        if (filePath.includes('../') || filePath.includes('..\\')) {
            throw new Error('Path traversal is not allowed (/../ is forbidden)');
        }

        const resolvedPath = path.resolve(SHARED_DIR, filePath);

        // Sanity check to ensure it stays within SHARED_DIR
        if (!resolvedPath.startsWith(SHARED_DIR)) {
            throw new Error('Path traversal is not allowed');
        }

        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        return { type: 'file', path: resolvedPath, url: 'file://' + resolvedPath };
    }

    if (inputUrl.startsWith('http://') || inputUrl.startsWith('https://')) {
        return { type: 'web', url: inputUrl };
    }

    throw new Error('Invalid URL format. Must start with http://, https://, or file://');
}

// Download file helper
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);
        client.get(url, response => {
            if (response.statusCode >= 300) {
                return reject(new Error(`Failed to download, status code: ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve());
            });
        }).on('error', err => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

// Extract frame using FFmpeg
function extractFrame(videoPath, timestamp) {
    return new Promise((resolve, reject) => {
        const tempImage = path.join(os.tmpdir(), `frame_${crypto.randomUUID()}.png`);
        ffmpeg(videoPath)
            .screenshots({
                timestamps: [timestamp],
                filename: path.basename(tempImage),
                folder: path.dirname(tempImage),
            })
            .on('end', () => resolve(tempImage))
            .on('error', (err) => reject(err));
    });
}

// Get mime type using the system `file` utility
async function getMimeType(filePath) {
    try {
        const { stdout } = await execFile('file', ['--mime-type', '-b', filePath]);
        return stdout.trim();
    } catch (err) {
        console.error('Error running file command:', err);
        return 'application/octet-stream';
    }
}

// Initialize browser
async function initBrowser() {
    if (!browser) {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-crash-reporter']
        });
    }
}

app.get('/screenshot', async (req, res) => {
    try {
        const { url, viewportWidth = 1280, viewportHeight = 800, resultWidth, resultHeight } = req.query;

        const resolved = resolveUrl(url);

        await semaphore.acquire();
        let page = null;
        try {
            await initBrowser();

            page = await browser.newPage();
            await page.setViewport({ width: parseInt(viewportWidth), height: parseInt(viewportHeight) });

            await withTimeout(page.goto(resolved.url, { waitUntil: 'networkidle0' }), TIMEOUT_MS);

            let imageBuffer = await withTimeout(page.screenshot({ type: 'png' }), TIMEOUT_MS);

            if (resultWidth || resultHeight) {
                let s = sharp(imageBuffer);
                s = s.resize(
                    resultWidth ? parseInt(resultWidth) : null,
                    resultHeight ? parseInt(resultHeight) : null,
                    { fit: 'inside' }
                );
                imageBuffer = await s.toBuffer();
            }

            res.setHeader('Content-Type', 'image/png');
            res.send(imageBuffer);
        } finally {
            if (page) await page.close().catch(console.error);
            semaphore.release();
        }
    } catch (err) {
        console.error('Screenshot error:', err);
        res.status(400).json({ error: err.message });
    }
});

app.get('/thumbnail', async (req, res) => {
    let tempDownloadedFile = null;
    let tempFrameFile = null;

    try {
        const { url, resultWidth, resultHeight, timestamp = '00:00:01' } = req.query;

        const resolved = resolveUrl(url);
        let targetFilePath = null;

        await semaphore.acquire();
        try {
            if (resolved.type === 'web') {
                tempDownloadedFile = path.join(os.tmpdir(), `dl_${crypto.randomUUID()}`);
                await withTimeout(downloadFile(resolved.url, tempDownloadedFile), TIMEOUT_MS);
                targetFilePath = tempDownloadedFile;
            } else {
                targetFilePath = resolved.path;
            }

            // Get mime type using the system `file` utility
            const mimeType = await getMimeType(targetFilePath);
            const isVideo = mimeType.startsWith('video/');
            const isFont = mimeType.includes('font') || mimeType.includes('opentype') || mimeType.includes('truetype');

            let imageBuffer;

            if (isVideo) {
                tempFrameFile = await withTimeout(extractFrame(targetFilePath, timestamp), TIMEOUT_MS);
                imageBuffer = await fs.promises.readFile(tempFrameFile);
            } else if (isFont) {
                await initBrowser();
                const page = await browser.newPage();
                try {
                    await page.setViewport({ width: parseInt(resultWidth || 800), height: parseInt(resultHeight || 400) });
                    const base64Font = await fs.promises.readFile(targetFilePath, 'base64');
                    const dataUri = `data:${mimeType};charset=utf-8;base64,${base64Font}`;
                    const htmlContent = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                        <style>
                        @font-face {
                            font-family: 'PreviewFont';
                            src: url('${dataUri}');
                        }
                        body {
                            margin: 0;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            background: white;
                        }
                        .preview {
                            font-family: 'PreviewFont', sans-serif;
                            font-size: 60vmin;
                            line-height: 1;
                            text-align: center;
                            color: #333;
                            margin: 0;
                            padding: 0;
                        }
                        </style>
                        </head>
                        <body>
                            <div class="preview">Aa</div>
                        </body>
                        </html>
                    `;
                    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
                    await page.evaluate(async () => {
                        await document.fonts.ready;
                    });
                    imageBuffer = await withTimeout(page.screenshot({ type: 'png' }), TIMEOUT_MS);
                } finally {
                    await page.close().catch(console.error);
                }
            } else {
                imageBuffer = await fs.promises.readFile(targetFilePath);
            }

            let s = sharp(imageBuffer);
            if (resultWidth || resultHeight) {
                s = s.resize(
                    resultWidth ? parseInt(resultWidth) : null,
                    resultHeight ? parseInt(resultHeight) : null,
                    { fit: 'inside' }
                );
            }
            const finalBuffer = await s.png().toBuffer();

            res.setHeader('Content-Type', 'image/png');
            res.send(finalBuffer);
        } finally {
            semaphore.release();
        }
    } catch (err) {
        console.error('Thumbnail error:', err);
        res.status(400).json({ error: err.message });
    } finally {
        if (tempDownloadedFile && fs.existsSync(tempDownloadedFile)) {
            fs.unlink(tempDownloadedFile, () => { });
        }
        if (tempFrameFile && fs.existsSync(tempFrameFile)) {
            fs.unlink(tempFrameFile, () => { });
        }
    }
});

// Cleanly close browser on exit
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing browser');
    if (browser) await browser.close();
    process.exit(0);
});

// Start browser on boot so first request is fast
initBrowser().then(() => {
    console.log('Puppeteer initialized');
}).catch(err => {
    console.error('Failed to initialize Puppeteer:', err);
});

app.listen(PORT, () => {
    console.log(`Media & Screenshot microservice listening on port ${PORT}`);
});
