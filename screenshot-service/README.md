# Media & Screenshot Microservice

A standalone microservice for taking screenshots of web pages, rendering SVG files, and generating thumbnails for videos and fonts.

## Features

- **Web Screenshots**: Capture full or viewport-sized screenshots of URLs.
- **Video Thumbnails**: Extract specific frames from video files (via URL or local shared folder).
- **Font Thumbnails**: Generate text previews for font files (`.ttf`, `.woff`, `.woff2`, etc.).
- **Image Resizing**: Resize any output image using `sharp`.
- **Local File Access**: Safe access to local files via `file://` URLs mounted in a read-only volume.

## Configuration

You can configure the service using environment variables. Copy `.env.example` to `.env` to override defaults:

- `PORT` (default: 3001): Port for the Express server to listen on.
- `SHARED_DIR` (default: `/app/shared`): Path to the mounted shared directory where `file://` URLs will be resolved.
- `MAX_CONCURRENT` (default: 5): Maximum number of concurrent browser tabs or FFmpeg processes to prevent CPU/memory exhaustion.
- `TIMEOUT_MS` (default: 15000): Timeout in milliseconds for browser and FFmpeg operations.

## API Endpoints

### 1. `GET /screenshot`
Captures a screenshot of a web page using Puppeteer.

**Query Parameters:**
- `url` (required): HTTP/HTTPS or `file://` URL to capture.
- `viewportWidth` (optional, default: 1280): Width of the browser viewport.
- `viewportHeight` (optional, default: 800): Height of the browser viewport.
- `resultWidth` (optional): Resize the final image to this width.
- `resultHeight` (optional): Resize the final image to this height.

### 2. `GET /thumbnail`
Generates a thumbnail for a video, image, or font file.

**Query Parameters:**
- `url` (required): HTTP/HTTPS or `file://` URL of the media file.
- `timestamp` (optional, default: `00:00:01`): Timecode to extract a frame from a video.
- `resultWidth` (optional): Resize the final thumbnail to this width.
- `resultHeight` (optional): Resize the final thumbnail to this height.

---

## Examples

### 1. Web Page Screenshot
Take a screenshot of a website:
```bash
curl "http://localhost:3001/screenshot?url=https://example.com" > example_screenshot.png
```

### 2. Video Thumbnail (via HTTP URL)
Extract a frame at the 5-second mark from an online video:
```bash
curl "http://localhost:3001/thumbnail?url=https://media.w3.org/2010/05/sintel/trailer.mp4&timestamp=00:00:05&resultWidth=640" > video_thumb.png
```

### 3. Local File Thumbnail (via `file://`)
Assuming you have a file at `./server/data/video.mp4` (which maps to the read-only shared volume inside the container):
```bash
curl "http://localhost:3001/thumbnail?url=file://video.mp4" > local_video_thumb.png
```

### 4. Font Thumbnail (Google Fonts)
Generate a preview for a font file directly from Google Fonts (Roboto Regular):
```bash
curl "http://localhost:3001/thumbnail?url=https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2&resultWidth=400" > font_roboto.png
```
