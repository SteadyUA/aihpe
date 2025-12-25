import React from 'react';
import { UiDropdown } from './UiDropdown';
import { LlmProvider } from '../types';

interface ProviderSelectorProps {
    value?: LlmProvider;
    onChange: (provider: LlmProvider) => void;
    disabled?: boolean;
    className?: string;
}

const PROVIDER_OPTIONS = [
    { value: 'openai', label: 'OpenAI (GPT)' },
    { value: 'google', label: 'Google (Gemini)' },
];

export class ProviderSelector extends React.Component<ProviderSelectorProps> {
    handleChange = (newValue: string) => {
        this.props.onChange(newValue as LlmProvider);
    };

    render() {
        const { value = 'openai', disabled, className } = this.props;

        return (
            <UiDropdown
                value={value}
                options={PROVIDER_OPTIONS}
                onChange={this.handleChange}
                disabled={disabled}
                className={className}
                title="Select AI Model Provider"
            />
        );
    }
}
