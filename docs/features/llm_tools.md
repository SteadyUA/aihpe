# LLM Tools & Capabilities

**Location:** `/server/src/services/llm/tools/PageGenTools.ts`

The server provides a suite of native tools that the LLM uses to fulfill user requests. These tools act as the "hands" of the AI.

## Tool Execution Flow
1. **Model Decides:** The LLM decides it needs to edit a file or save memory. It outputs a `tool_call` JSON block.
2. **Proxy/Server intercepts:** The `OpenaiRawClient` intercepts the tool call.
3. **Execution:** The server pauses the LLM stream, executes the requested TypeScript function (e.g., `edit_file`), and captures the result (success or error).
4. **Callback:** The server appends the result to the conversation context and resumes the LLM generation so it knows the tool succeeded.

## Available Tools

### 1. `edit_file` / `create_file`
- **Purpose:** Modifies or creates HTML, CSS, or JS files.
- **Mechanism:** Uses advanced diffing or full replacement. The server validates the syntax before saving. If it's the first time a file is edited in a new version, the server initializes it from the previous version's state.

### 2. `edit_memory_file`
- **Purpose:** Manages the AI's persistent context.
- **Mechanism:** Because the system uses a sliding context window (truncating old messages), the AI uses this tool to jot down rules, brand colors, or architectural decisions. The contents are injected at the top of the prompt on every subsequent turn.

### 3. `copy_clipboard_file`
- **Purpose:** Cross-session resource sharing.
- **Mechanism:** Allows the AI to pull an image, font, or code block from the Global Clipboard and inject it into the current session's workspace.

### 4. `generate_image`
- **Purpose:** Creates placeholder or specific images.
- **Mechanism:** Calls an external image generation API (like DALL-E) based on a prompt and automatically saves the resulting image to the session's upload directory.
