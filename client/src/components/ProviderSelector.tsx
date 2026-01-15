import React from 'react';
import { UiDropdown } from './UiDropdown';
import { LlmProvider } from '../types';
import { LLM_PROVIDERS } from '../constants';

interface ProviderSelectorProps {
    value?: LlmProvider;
    onChange: (provider: LlmProvider) => void;
    disabled?: boolean;
    className?: string;
    variant?: 'standard' | 'ghost';
}

export class ProviderSelector extends React.Component<ProviderSelectorProps> {
    handleChange = (newValue: string) => {
        this.props.onChange(newValue as LlmProvider);
    };

    render() {
        const { value = 'openai', disabled, className, variant } = this.props;

        return (
            <UiDropdown
                value={value}
                options={LLM_PROVIDERS}
                onChange={this.handleChange}
                disabled={disabled}
                className={className}
                title="Select AI Model Provider"
                variant={variant}
            />
        );
    }
}
