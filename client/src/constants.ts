import { LlmProvider } from './types';

export const LLM_PROVIDERS: { value: LlmProvider; label: string }[] = [
    { value: 'openai', label: 'OpenAI (GPT)' },
    { value: 'google', label: 'Google (Gemini)' },
];
