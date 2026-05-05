import React from 'react';
import { IconProps } from './IconProps';

export const ExpandIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
    >
        <path d="M1 1h4" /><path d="M1 1v4" /><path d="M1 23v-4" /><path d="M1 23h4" /><path d="M23 1h-4" /><path d="M23 1v4" /><path d="M10 1h4" /><path d="M1 10v4" /><path d="M23 10v4" /><path d="M10 23h4" /><path d="M21 21l-9-9" /><path d="M12 12l8 3" /><path d="M12 12l3 8" />
    </svg>
);
