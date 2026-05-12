# User Guide: Code App

Welcome to Code App! This guide will walk you through how to use the system from a user's perspective.

## 1. Creating a Project
When you open the application, you will be greeted with your workspace. To start building something new, you need to create a **Project**.
- A Project acts as a folder or a primary goal (e.g., "Landing Page for my Startup").
- **HTML Archive Import:** If you already have existing HTML/CSS/JS code, you can upload it as a ZIP archive during project creation. The AI will import it and allow you to continue working on it directly in the app.

## 2. Generation Modes
The AI agent can work in two main modes, which you can switch between depending on your needs (via the `fastMode` parameter):
- **Planning Mode (Default):** The AI first analyzes the request, researches, and creates a structured plan before writing any code. This is best for complex changes, creating new components, or architectural decisions.
- **Just Do It (Fast Mode):** The AI skips the planning phase and immediately executes the code edits. This mode is ideal for quick tweaks, minor styling fixes, or simple bug corrections.

## 3. Working with Sessions
Within a single project, you can have multiple **Sessions** (conversations with the AI).
- **Starting a Session:** Click to create a new Session to open the chat interface. The **Session Bar** (chat history) is on the left, and the **Preview Workspace** is on the right.
- **Parallel Generations:** You can have multiple sessions running and generating code simultaneously. You can even explicitly ask the AI to *"implement three different versions of this design in new sessions"*, and the system will branch out and spin up parallel sessions to explore those variations simultaneously.
- **Branching (Cloning):** If you like a specific version of your app but want to experiment in a different direction, you can "Clone" the session from that specific message turn. This creates a new session branching off from that exact state without altering your original work.

## 4. Generating Code & Iterating
Simply describe what you want to build in the chat input. For example: *"Create a modern pricing page with 3 tiers."*
- The AI agent will begin generating the necessary HTML, CSS, and JS files. You can watch the generation process in real-time.
- **Refining:** If the result isn't perfect, just send another message: *"Make the button colors blue and add a subtle shadow."* The AI will edit the specific files required.
- **Rich Media & Image Generation:** You can upload images, videos, and custom font files via the attachment icon in the chat. Alternatively, you can simply **ask the AI to generate images** for you based on a text prompt. The generated images will automatically be saved to your resource files and integrated into your project.
- **Interactive Quotes & Context Menu:** You can highlight specific text or code blocks in the chat history. A context menu will appear, allowing you to instantly reply to or reference that specific quote in your next message. This makes it easier to point out exactly what you want the AI to fix.

## 5. File Versioning & Previews
The system automatically tracks changes to your code across every interaction.
- **File Versioning:** Every time the AI successfully modifies your code after a chat message, a new version is saved. The system stores these snapshots, meaning you never lose previous iterations of your application.
- **Previewing Versions:** When you hover over or select a past message in the chat history, the system instantly shows a screenshot/preview of how the app looked at that specific moment. You can safely navigate back and forth through time to see your app's evolution.

## 6. Advanced Features
- **Global Clipboard:** The clipboard is a powerful tool to share context across completely different sessions and projects. You can use it to seamlessly transfer both uploaded resource files (like images, videos, or fonts) and various blocks of generated code from one session to another.
- **Memory Management (AI Context):** To ensure the AI doesn't forget important details (like brand colors, user preferences, or architectural rules) during long conversations, it automatically manages "memory files". Because the system uses a floating context window that truncates older chat messages to save tokens, the AI proactively writes to these memory files to persist crucial context. *Note: These files are not directly editable by the user; they are an internal tool for the AI. You can view their state and content by clicking on the memory badges displayed next to file versions.*
