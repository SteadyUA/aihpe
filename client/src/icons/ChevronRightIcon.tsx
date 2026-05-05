import React from 'react';
import { IconProps } from './IconProps';

export const ChevronRightIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
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
        <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
);
