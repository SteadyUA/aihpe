# Screenshot Service Architecture

**Location:** `/screenshot-service`

The Screenshot Service is a standalone microservice responsible for generating thumbnails and visual previews of the user's generated web pages.

## Core Responsibilities
- **Capture Previews:** Takes a URL (usually pointing to a specific generated version of the app on the main server) and uses a headless browser to render it.
- **Stability:** Disables CSS animations and transitions globally before capturing to ensure accurate, non-blurry screenshots.
- **Delivery:** Streams the resulting binary image data back to the requesting service (the main Node.js server).

## Tech Stack
- **Runtime:** Node.js
- **Framework:** Express.js
- **Browser Automation:** Puppeteer (Headless Chrome)

## How it works
1. The main server requests a screenshot for a specific session version via a `POST` or `GET` request to the screenshot service.
2. The service spins up/uses an existing Puppeteer instance to open the provided URL.
3. It sets specific viewport parameters (desktop or mobile).
4. It injects a script to freeze animations (`* { animation: none !important; transition: none !important; }`).
5. It takes the screenshot, returns the raw image buffer as a readable stream (`Readable.from(buffer)`), and closes the page.
