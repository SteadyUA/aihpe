# Media & Screenshot Microservice

A standalone microservice for taking screenshots of web pages, rendering SVG files, and generating thumbnails for videos and fonts.

## Features

- **Web Screenshots**: Capture full or viewport-sized screenshots of URLs.
- **Video Thumbnails**: Extract specific frames from video files (via URL or local shared folder).
- **Font Thumbnails**: Generate 2x2 grid text previews for font files (`.ttf`, `.woff`, `.woff2`, etc.).
- **Image Resizing**: Resize any output image using `sharp`.
- **Local File Access**: Safe access to local files via `file://` URLs mounted in a read-only volume.

## Configuration

You can configure the service using environment variables. Copy `.env.example` to `.env` to override defaults:

- `PORT` (default: 3001): Port for the Express server to listen on.
- `SHARED_DIR` (default: `/app/shared`): Path to the mounted shared directory where `file://` URLs will be resolved.
- `MAX_CONCURRENT` (default: 5): Maximum number of concurrent browser tabs or FFmpeg processes to prevent CPU/memory exhaustion.
- `TIMEOUT_MS` (default: 15000): Timeout in milliseconds for browser and FFmpeg operations.

## API Endpoints

### 1. `POST /screenshot`
Captures a screenshot of a web page or a provided HTML snapshot using Puppeteer.

**JSON Body Parameters:**
- `url` (optional if `html` is provided): HTTP/HTTPS or `file://` URL to capture. If `html` is provided, this URL is injected as a `<base href>` to resolve relative assets.
- `html` (optional): A full HTML string to render directly instead of navigating to the `url`. Useful for capturing dynamic DOM states without relying on the network.
- `viewportWidth` (optional, default: 1280): Width of the browser viewport.
- `viewportHeight` (optional, default: 800): Height of the browser viewport.
- `scrollY` (optional): Scroll the page to this Y coordinate before taking the screenshot.
- `size` (optional): Resize the final image so its maximum dimension is `size` (aspect ratio preserved).

### 2. `GET /thumbnail`
Generates a thumbnail for a video, image, or font file.

**Query Parameters:**
- `url` (required): HTTP/HTTPS or `file://` URL of the media file.
- `timestamp` (optional, default: `00:00:01`): Timecode to extract a frame from a video.
- `size` (optional, default: 480): Resize the final thumbnail so its maximum dimension is `size` (aspect ratio preserved). For font thumbnails, this produces a strictly square `size`x`size` image.

### 3. `GET /preview`
Generates a full preview image for media, optimized for fonts, videos, and images. For text fonts, it generates an extended character layout. For icon fonts, it generates a grid of icons, allowing a comprehensive visual evaluation. For images, it provides a scaled-down version or rasterized format for SVGs.

**Query Parameters:**
- `url` (required): HTTP/HTTPS or `file://` URL of the media file.
- `timestamp` (optional, default: `00:00:01`): Timecode to extract a frame from a video.
- `size` (optional): For videos, the maximum dimension of a **single frame**. For font icon grids, leaving this empty allows the service to automatically scale the image width to create a perfectly square grid layout. For images, the default size is `1000`; images larger than `size` are proportionally resized and returned as JPEG. SVGs smaller than `size` are rasterized to PNG.
- `frames` (optional, default: 5): The number of frames to extract and composite for video previews. Frames are selected at evenly distributed intervals across the video duration (dividing the timeline into `frames + 1` parts), which avoids capturing blank screens at the very beginning or end.
- `range` (optional): For icon fonts, filter the icons rendered in the preview grid. Accepts a hex string (e.g., `F000`), a range (`F000-F0FF`), or multiple comma-separated values (`F000-F0FF,F100`).
- `text` (optional): Provide custom text to render instead of the default layout. Supports literal newlines (`\n`) and Unicode hex codes (e.g., `\uF000`) to render specific icons mixed with words. When used, the image width is automatically cropped to precisely fit the text.


### 4. `GET /info`
Analyzes a media file and returns detailed JSON metadata without generating an image.

**Query Parameters:**
- `url` (required): HTTP/HTTPS or `file://` URL of the media file.

**Responses:**
- **Images:** Returns `format`, `width`, `height`.
- **Videos:** Returns `width`, `height`, `duration`, `videoCodec`, `audioCodec`, and `container`.
- **Icon Fonts:** Returns `type: "icons"`, `fontFamily`, `glyphCount`, and `puaRanges` (an array of hex ranges).
- **Text Fonts:** Returns `type: "font"`, `fontFamily`, `style` (`serif`, `sans-serif`, or `unknown`), and `glyphCount`.

---

## Examples

### 1. Web Page Screenshot
Take a screenshot of a website by sending a POST request with JSON payload:
```bash
curl -X POST -H "Content-Type: application/json" -d '{"url":"https://example.com"}' http://localhost:3001/screenshot > example_screenshot.png
```

### 2. Video Thumbnail (via HTTP URL)
Extract a frame at the 5-second mark from an online video:
```bash
curl "http://localhost:3001/thumbnail?url=https://media.w3.org/2010/05/sintel/trailer.mp4&timestamp=00:00:05&size=640" > video_thumb.png
```

### 3. Local File Thumbnail (via `file://`)
Assuming you have a file at `./server/data/video.mp4` (which maps to the read-only shared volume inside the container):
```bash
curl "http://localhost:3001/thumbnail?url=file://video.mp4" > local_video_thumb.png
```

### 4. Font Thumbnail (Google Fonts)
Generate a preview for a font file directly from Google Fonts (Roboto Regular):
```bash
curl "http://localhost:3001/thumbnail?url=https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2&size=400" > font_roboto.png
```

### 5. Font Full Preview
Generate an extended preview image showing the alphabet, pangrams, and numbers for a font file:
```bash
curl "http://localhost:3001/preview?url=https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2" > font_preview.png
```

### 6. Video Full Preview (Storyboard)
Generate an extended preview image showing 5 extracted frames from a video file:
```bash
curl "http://localhost:3001/preview?url=https://media.w3.org/2010/05/sintel/trailer.mp4&size=480&frames=5" > video_preview.png
```
