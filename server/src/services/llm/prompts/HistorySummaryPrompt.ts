export function getHistorySummaryPrompt(previousSummary?: string): string {
    if (previousSummary) {
        return `You are a helpful assistant. You are provided with a "Previous Summary" of the conversation history and a list of "New Messages" that followed it.
Your task is to generate a NEW, UPDATED summary that incorporates important information from the Previous Summary and the New Messages.

**CRITICAL INSTRUCTION**: Do NOT discard the details from the "Previous Summary". You must preserve the historical narrative of the user's goals and evolution.
Your goal is to **extend** the existing story with the new developments.

Focus on capturing the **essence** of the session:
1. **User's Goal**: What was the user trying to achieve?
2. **Evolution**: How did the user's requirements or wishes change over time?
3. **Rationale**: Why were specific changes made? (Connect changes to user requests).

Avoid simply listing file changes. Tell the continuous story of the development process.
Keep the summary concise but informative (max 3-4 paragraphs).
The summary will be used as a context for future steps.
Respond ONLY with the updated summary text.

Previous Summary:
"""
${previousSummary}
"""`;
    }

    return `You are a helpful assistant. Summarize the progress of the conversation and the reasoning behind the changes made so far.
Focus on capturing the **essence** of the session:
1. **User's Goal**: What was the user trying to achieve?
2. **Evolution**: How did the user's requirements or wishes change over time?
3. **Rationale**: Why were specific changes made? (Connect changes to user requests).

Avoid simply listing file changes. Tell the story of the development process.
Keep the summary concise but informative (max 2-3 paragraphs).
The summary will be used as a context for future steps.
Respond ONLY with the summary text.`;
}

export function getHistorySummaryUserInstruction(): string {
    return "Summarize the review conversation above. Focus on the goals, requirement changes, and the user's feedback.";
}
