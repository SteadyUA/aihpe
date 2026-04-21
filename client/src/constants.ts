import { LlmProvider } from './types';

export const LLM_PROVIDERS: { value: LlmProvider; label: string }[] = [
    { value: LlmProvider.OPENAI, label: 'OpenAI (GPT)' },
    { value: LlmProvider.GOOGLE, label: 'Google (Gemini)' },
];
