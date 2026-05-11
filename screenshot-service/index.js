const express = require('express');
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const opentype = require('opentype.js');
const wawoff2 = require('wawoff2');
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


// Get video metadata using ffprobe
function getVideoMetadata(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) return reject(err);
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
            if (!videoStream) return reject(new Error('No video stream found'));
            const duration = metadata.format.duration || videoStream.duration;
            resolve({
                width: videoStream.width,
                height: videoStream.height,
                duration: parseFloat(duration),
                videoCodec: videoStream.codec_name,
                audioCodec: audioStream ? audioStream.codec_name : null,
                container: metadata.format.format_name
            });
        });
    });
}

// Extract multiple frames
function extractFrames(videoPath, timestamps, size, isVertical) {
    return new Promise((resolve, reject) => {
        const outDir = os.tmpdir();
        const prefix = `frames_${crypto.randomUUID()}`;

        const options = {
            timestamps: timestamps,
            filename: `${prefix}_%i.png`,
            folder: outDir,
        };

        if (size) {
            if (isVertical) {
                options.size = `?x${size}`;
            } else {
                options.size = `${size}x?`;
            }
        }

        ffmpeg(videoPath).screenshots(options)
            .on('end', () => {
                const files = timestamps.map((_, i) => path.join(outDir, `${prefix}_${i + 1}.png`));
                resolve(files);
            })
            .on('error', (err) => reject(err));
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

app.post('/screenshot', express.json({ limit: '50mb' }), async (req, res) => {
    try {
        const { url, viewportWidth = 1280, viewportHeight = 800, size, html, scrollY } = req.body;

        const resolved = resolveUrl(url);

        await semaphore.acquire();
        let page = null;
        try {
            await initBrowser();

            page = await browser.newPage();
            await page.setViewport({ width: parseInt(viewportWidth), height: parseInt(viewportHeight) });

            if (html) {
                const headRegex = /<head[^>]*>/i;
                let htmlWithBase = html;
                if (headRegex.test(html)) {
                    htmlWithBase = html.replace(headRegex, `$&<base href="${resolved.url}">`);
                } else {
                    htmlWithBase = `<head><base href="${resolved.url}"></head>` + html;
                }
                await withTimeout(page.setContent(htmlWithBase, { waitUntil: 'load' }), TIMEOUT_MS);
                await new Promise(resolve => setTimeout(resolve, 500));
            } else {
                await withTimeout(page.goto(resolved.url, { waitUntil: 'load' }), TIMEOUT_MS);
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Disable animations and transitions globally to avoid capturing mid-animation states
            await page.addStyleTag({
                content: `
                    *, *::after, *::before {
                        animation: none !important;
                        transition: none !important;
                        animation-delay: 0s !important;
                    }
                `
            });

            if (scrollY) {
                await page.evaluate((y) => window.scrollTo(0, y), parseInt(scrollY));
            }

            let imageBuffer = await withTimeout(page.screenshot({ type: 'png' }), TIMEOUT_MS);

            if (size) {
                let s = sharp(imageBuffer);
                s = s.resize(parseInt(size), parseInt(size), { fit: 'inside' });
                imageBuffer = await s.toBuffer();
            }

            res.setHeader('Content-Type', 'image/png');
            res.send(imageBuffer);
        } finally {
            if (page) await page.close().catch(console.error);
            semaphore.release();
        }
    } catch (err) {
        console.error(`Screenshot error for URL ${req.body?.url}:`, err);
        res.status(400).json({ error: err.message });
    }
});

async function renderFont(targetFilePath, mimeType, size, ignore_height, mode, range = null, customText = null) {
    await initBrowser();
    const page = await browser.newPage();
    try {
        let viewportWidth = parseInt(size || (mode === 'preview' ? 10000 : 800)); // Large initial width to avoid wrap
        let viewportHeight = mode === 'preview' ? 10 : parseInt(size || 400);
        const fileBuffer = await fs.promises.readFile(targetFilePath);
        const base64Font = fileBuffer.toString('base64');
        const dataUri = `data:${mimeType};charset=utf-8;base64,${base64Font}`;

        // Parse font to detect if it's an icon font
        let isIconFont = false;
        let iconHtml = '';

        try {
            let parseBuffer = fileBuffer;
            if (fileBuffer.slice(0, 4).toString() === 'wOF2') {
                parseBuffer = await wawoff2.decompress(fileBuffer);
            }
            const arrayBuffer = new Uint8Array(parseBuffer).buffer;
            const font = opentype.parse(arrayBuffer);

            let numGlyphs = font.glyphs.length;
            let numPua = 0;
            let numStandardAlnum = 0;
            let puaCodes = [];

            for (let i = 0; i < font.glyphs.length; i++) {
                const glyph = font.glyphs.get(i);
                const u = glyph.unicode;
                if (u !== undefined) {
                    if (u >= 0xE000 && u <= 0xF8FF) {
                        numPua++;
                        puaCodes.push(u);
                    }
                    if ((u >= 48 && u <= 57) || (u >= 65 && u <= 90) || (u >= 97 && u <= 122)) {
                        numStandardAlnum++;
                    }
                }
            }

            if ((numPua > 50) || (numStandardAlnum < 20 && numGlyphs > 50)) {
                isIconFont = true;
            }

            if (isIconFont && !(customText && mode === 'preview')) {
                if (mode === 'thumbnail') {
                    // Take first 4 PUA characters for a 2x2 grid
                    const codesToDisplay = puaCodes.slice(0, 4);
                    const gridItems = codesToDisplay.map(code => `<div>&#x${code.toString(16)};</div>`).join('');
                    iconHtml = `<div class="icon-grid-thumbnail">${gridItems}</div>`;
                } else {
                    // Preview mode: display all or filtered icons
                    let codesToDisplay = puaCodes;
                    if (range && mode === 'preview') {
                        const rangeGroups = range.split(',').map(g => g.trim()).filter(Boolean);
                        const validRanges = [];
                        for (const group of rangeGroups) {
                            const parts = group.split('-');
                            let rMin = 0;
                            let rMax = 0;
                            if (parts.length === 2) {
                                rMin = parseInt(parts[0], 16);
                                rMax = parseInt(parts[1], 16);
                            } else if (parts.length === 1) {
                                rMin = parseInt(parts[0], 16);
                                rMax = rMin;
                            }
                            if (!isNaN(rMin) && !isNaN(rMax)) {
                                validRanges.push({ min: rMin, max: rMax });
                            }
                        }
                        if (validRanges.length > 0) {
                            codesToDisplay = puaCodes.filter(c => {
                                return validRanges.some(r => c >= r.min && c <= r.max);
                            });
                        }
                    }

                    if (mode === 'preview' && !size) {
                        const numIcons = codesToDisplay.length;
                        if (numIcons > 0) {
                            const cellWidth = 60; // Approximate min cell width including gap
                            const cols = Math.ceil(Math.sqrt(numIcons));
                            // Exact width: cols * 50px (card) + (cols-1) * 8px (gap) + 16px (body padding)
                            viewportWidth = cols * 58 + 8;
                            viewportHeight = 10; // Small height so fullPage screenshot tightly wraps content
                        }
                    }

                    const gridItems = codesToDisplay.map(code => {
                        const hex = code.toString(16).toUpperCase();
                        return `
                            <div class="icon-card">
                                <div class="icon">&#x${hex};</div>
                                <div class="label">${hex}</div>
                            </div>
                        `;
                    }).join('');
                    iconHtml = `<div class="icon-grid-preview">${gridItems}</div>`;
                }
            }
        } catch (err) {
            console.error('Error parsing font with opentype.js:', err);
        }

        if (!isIconFont || (customText && mode === 'preview')) {
            if (mode === 'thumbnail') {
                iconHtml = `
                    <div class="icon-grid-thumbnail">
                        <div>Aa</div>
                        <div>Bb</div>
                        <div>Cc</div>
                        <div>Dd</div>
                    </div>
                `;
            } else {
                const textToRender = customText || 'The quick brown fox jumps over the lazy dog';
                const formattedText = textToRender
                    .replace(/\\n/g, '\n')
                    .replace(/\n/g, '<br>')
                    .replace(/\\u([0-9a-fA-F]{4})/g, '&#x$1;');
                iconHtml = `
                    <div class="preview-full custom-text">
                        ${formattedText}
                    </div>
                `;
            }
        }

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
            <style>
            @font-face {
                font-family: 'PreviewFont';
                src: url('${dataUri}');
            }
            * {
                box-sizing: border-box;
            }
            body {
                margin: 0;
                ${mode === 'thumbnail' ? `
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                padding: 0;
                ` : `
                display: block;
                padding: 8px;
                `}
                background: white;
                box-sizing: border-box;
            }
            .preview-thumbnail {
                font-family: 'PreviewFont', sans-serif;
                font-size: 60vmin;
                line-height: 1;
                text-align: center;
                color: #333;
                margin: 0;
                padding: 0;
            }
            .icon-grid-thumbnail {
                font-family: 'PreviewFont', sans-serif;
                font-size: 30vmin;
                line-height: 1;
                text-align: center;
                color: #333;
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10vmin;
                margin: 0;
                padding: 0;
            }
            .preview-full {
                font-family: 'PreviewFont', sans-serif;
                color: #333;
                width: max-content;
                text-align: left;
                white-space: nowrap;
            }
            .preview-full.custom-text {
                font-size: 3rem;
                line-height: 1.2;
            }

            .icon-grid-preview {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
                gap: 8px;
                margin: 0 auto;
                padding: 0;
                width: 100%;
            }
            .icon-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-end;
                background: #f9f9f9;
                padding: 5px;
                border-radius: 6px;
            }
            .icon-card .icon {
                font-family: 'PreviewFont', sans-serif;
                font-size: 2rem;
                color: #333;
                margin-bottom: 4px;
                text-align: center;
            }
            .icon-card .label {
                font-family: monospace;
                font-size: 10px;
                color: #666;
            }
            </style>
            </head>
            <body>
                ${iconHtml}
            </body>
            </html>
        `;
        await page.setViewport({ width: viewportWidth, height: viewportHeight });
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.evaluate(async () => {
            await document.fonts.ready;
        });

        if ((!isIconFont || (customText && mode === 'preview')) && mode === 'preview' && !size) {
            const contentWidth = await page.evaluate(() => {
                const el = document.querySelector('.preview-full');
                return el ? Math.ceil(el.getBoundingClientRect().width) : 1200;
            });
            await page.setViewport({ width: contentWidth + 16, height: 10 }); // +16px for body padding
        }

        return await withTimeout(page.screenshot({ type: 'png', fullPage: mode === 'preview' }), TIMEOUT_MS);
    } finally {
        await page.close().catch(console.error);
    }
}

app.get('/thumbnail', async (req, res) => {
    let tempDownloadedFile = null;
    let tempFrameFile = null;

    try {
        let { url, size, timestamp = '00:00:01' } = req.query;
        size = size ? parseInt(size) : 480;

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

            const mimeType = await getMimeType(targetFilePath);
            const isVideo = mimeType.startsWith('video/');
            const isFont = mimeType.includes('font') || mimeType.includes('opentype') || mimeType.includes('truetype');

            let imageBuffer;

            if (isVideo) {
                tempFrameFile = await withTimeout(extractFrame(targetFilePath, timestamp), TIMEOUT_MS);
                imageBuffer = await fs.promises.readFile(tempFrameFile);
            } else if (isFont) {
                imageBuffer = await renderFont(targetFilePath, mimeType, size, null, 'thumbnail');
            } else {
                imageBuffer = await fs.promises.readFile(targetFilePath);
            }

            let s = sharp(imageBuffer);
            if (size) {
                s = s.resize(size, size, { fit: 'inside' });
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

app.get('/preview', async (req, res) => {
    let tempDownloadedFile = null;
    let tempFrameFiles = [];

    try {
        let { url, size, frames = 5, range, text } = req.query;
        size = size ? parseInt(size) : null;
        frames = parseInt(frames);
        if (isNaN(frames) || frames < 1) frames = 5;

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

            const mimeType = await getMimeType(targetFilePath);
            const isVideo = mimeType.startsWith('video/');
            const isFont = mimeType.includes('font') || mimeType.includes('opentype') || mimeType.includes('truetype');
            const isImage = mimeType.startsWith('image/');

            let finalBuffer;
            let contentType = 'image/png';

            if (isVideo) {
                const metadata = await getVideoMetadata(targetFilePath);
                const isVertical = metadata.height > metadata.width;

                // Generate timestamps
                const duration = metadata.duration;
                const timestamps = [];
                for (let i = 0; i < frames; i++) {
                    const percent = (i + 1) / (frames + 1);
                    timestamps.push(percent * duration);
                }

                // Extract frames
                tempFrameFiles = await withTimeout(extractFrames(targetFilePath, timestamps, size, isVertical), TIMEOUT_MS * 2);

                // Load all images and composite
                const imageBuffers = [];
                for (const f of tempFrameFiles) {
                    if (fs.existsSync(f)) {
                        imageBuffers.push(await fs.promises.readFile(f));
                    }
                }

                if (imageBuffers.length === 0) {
                    throw new Error('Failed to extract any frames from the video');
                }

                const metadataList = await Promise.all(imageBuffers.map(b => sharp(b).metadata()));
                const frameW = metadataList[0].width;
                const frameH = metadataList[0].height;

                let canvasW, canvasH;
                const compositeOperations = [];

                if (isVertical) {
                    // Combine left to right
                    canvasW = frameW * imageBuffers.length;
                    canvasH = frameH;
                    imageBuffers.forEach((buf, i) => {
                        compositeOperations.push({ input: buf, left: i * frameW, top: 0 });
                    });
                } else {
                    // Combine top to bottom
                    canvasW = frameW;
                    canvasH = frameH * imageBuffers.length;
                    imageBuffers.forEach((buf, i) => {
                        compositeOperations.push({ input: buf, left: 0, top: i * frameH });
                    });
                }

                finalBuffer = await sharp({
                    create: {
                        width: canvasW,
                        height: canvasH,
                        channels: 4,
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    }
                })
                    .composite(compositeOperations)
                    .png()
                    .toBuffer();

            } else if (isFont) {
                finalBuffer = await renderFont(targetFilePath, mimeType, size, null, 'preview', range, text);
                // No sharp resizing needed; renderFont already sets the correct viewport width.
            } else if (isImage) {
                const imageSize = size || 1000;
                const metadata = await sharp(targetFilePath).metadata();
                const isSvg = mimeType.includes('svg');

                if (metadata.width <= imageSize && metadata.height <= imageSize) {
                    if (isSvg) {
                        finalBuffer = await sharp(targetFilePath).png().toBuffer();
                        contentType = 'image/png';
                    } else {
                        finalBuffer = await fs.promises.readFile(targetFilePath);
                        contentType = mimeType;
                    }
                } else {
                    finalBuffer = await sharp(targetFilePath)
                        .resize(imageSize, imageSize, { fit: 'inside' })
                        .jpeg()
                        .toBuffer();
                    contentType = 'image/jpeg';
                }
            } else {
                throw new Error('Preview is currently only supported for image, font and video files');
            }

            res.setHeader('Content-Type', contentType);
            res.send(finalBuffer);
        } finally {
            semaphore.release();
        }
    } catch (err) {
        console.error('Preview error:', err);
        res.status(400).json({ error: err.message });
    } finally {
        if (tempDownloadedFile && fs.existsSync(tempDownloadedFile)) {
            fs.unlink(tempDownloadedFile, () => { });
        }
        for (const file of tempFrameFiles) {
            if (fs.existsSync(file)) fs.unlink(file, () => { });
        }
    }
});


app.get('/info', async (req, res) => {
    let tempDownloadedFile = null;

    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'Missing url parameter' });
        }

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

            const mimeType = await getMimeType(targetFilePath);
            const isVideo = mimeType.startsWith('video/');
            const isImage = mimeType.startsWith('image/');
            const isFont = mimeType.includes('font') || mimeType.includes('opentype') || mimeType.includes('truetype');

            if (isImage) {
                const metadata = await sharp(targetFilePath).metadata();
                return res.json({
                    type: 'image',
                    format: metadata.format,
                    width: metadata.width,
                    height: metadata.height
                });
            } else if (isVideo) {
                const metadata = await getVideoMetadata(targetFilePath);
                return res.json({
                    type: 'video',
                    width: metadata.width,
                    height: metadata.height,
                    duration: metadata.duration,
                    videoCodec: metadata.videoCodec,
                    audioCodec: metadata.audioCodec,
                    container: metadata.container
                });

            } else if (isFont) {
                const fileBuffer = await fs.promises.readFile(targetFilePath);
                let parseBuffer = fileBuffer;
                if (fileBuffer.slice(0, 4).toString() === 'wOF2') {
                    parseBuffer = await wawoff2.decompress(fileBuffer);
                }
                const arrayBuffer = new Uint8Array(parseBuffer).buffer;
                const font = opentype.parse(arrayBuffer);

                const getFontFamily = (f) => {
                    if (!f || !f.names) return 'Unknown';
                    if (f.names.fontFamily) return f.names.fontFamily.en || Object.values(f.names.fontFamily)[0] || 'Unknown';
                    for (const platform of ['windows', 'macintosh', 'unicode']) {
                        if (f.names[platform] && f.names[platform].fontFamily) {
                            return f.names[platform].fontFamily.en || Object.values(f.names[platform].fontFamily)[0] || 'Unknown';
                        }
                    }
                    return 'Unknown';
                };

                let numGlyphs = font.glyphs.length;
                let numPua = 0;
                let numStandardAlnum = 0;
                let puaCodes = [];

                for (let i = 0; i < font.glyphs.length; i++) {
                    const glyph = font.glyphs.get(i);
                    const u = glyph.unicode;
                    if (u !== undefined) {
                        if (u >= 0xE000 && u <= 0xF8FF) {
                            numPua++;
                            puaCodes.push(u);
                        }
                        if ((u >= 48 && u <= 57) || (u >= 65 && u <= 90) || (u >= 97 && u <= 122)) {
                            numStandardAlnum++;
                        }
                    }
                }

                const isIconFont = (numPua > 50) || (numStandardAlnum < 20 && numGlyphs > 50);

                if (isIconFont) {
                    puaCodes.sort((a, b) => a - b);
                    const puaRanges = [];
                    if (puaCodes.length > 0) {
                        let rangeStart = puaCodes[0];
                        let rangeEnd = puaCodes[0];
                        const formatHex = (num) => num.toString(16).toUpperCase();
                        for (let i = 1; i < puaCodes.length; i++) {
                            if (puaCodes[i] === rangeEnd + 1 || puaCodes[i] === rangeEnd) {
                                rangeEnd = puaCodes[i];
                            } else {
                                puaRanges.push(rangeStart === rangeEnd ? formatHex(rangeStart) : `${formatHex(rangeStart)}-${formatHex(rangeEnd)}`);
                                rangeStart = puaCodes[i];
                                rangeEnd = puaCodes[i];
                            }
                        }
                        puaRanges.push(rangeStart === rangeEnd ? formatHex(rangeStart) : `${formatHex(rangeStart)}-${formatHex(rangeEnd)}`);
                    }

                    return res.json({
                        type: 'icons',
                        fontFamily: getFontFamily(font),
                        glyphCount: numGlyphs,
                        puaRanges: puaRanges
                    });
                } else {
                    // Determine serif vs sans-serif
                    let style = 'unknown';

                    // Method 1: Check OS/2 Panose
                    if (font.tables.os2 && font.tables.os2.panose) {
                        const panose = font.tables.os2.panose;
                        const bFamilyType = panose[0];
                        const bSerifStyle = panose[1];
                        if (bFamilyType === 2) { // Latin Text
                            if (bSerifStyle >= 2 && bSerifStyle <= 10) {
                                style = 'serif';
                            } else if (bSerifStyle >= 11 && bSerifStyle <= 15) {
                                style = 'sans-serif';
                            }
                        }
                    }

                    // Method 2: Heuristic via font name
                    if (style === 'unknown') {
                        const name = getFontFamily(font).toLowerCase();
                        if (name.includes('sans')) style = 'sans-serif';
                        else if (name.includes('serif')) style = 'serif';
                    }

                    return res.json({
                        type: 'font',
                        fontFamily: getFontFamily(font),
                        style: style,
                        glyphCount: numGlyphs
                    });
                }
            } else {
                return res.status(400).json({ error: `Info is currently only supported for image, video, and font files. Detected mimeType: ${mimeType}` });
            }
        } finally {
            semaphore.release();
        }
    } catch (err) {
        console.error('Info error:', err);
        res.status(400).json({ error: err.message });
    } finally {
        if (tempDownloadedFile && fs.existsSync(tempDownloadedFile)) {
            fs.unlink(tempDownloadedFile, () => { });
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
