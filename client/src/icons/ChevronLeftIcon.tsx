import React from 'react';
import { IconProps } from './IconProps';

export const ChevronLeftIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
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
        <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
);
