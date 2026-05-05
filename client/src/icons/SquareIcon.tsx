import React from 'react';
import { IconProps } from './IconProps';

export const SquareIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
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
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
    </svg>
);
