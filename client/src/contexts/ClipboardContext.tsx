import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiAuth } from '../utils/api';

export interface ClipboardRecord {
    id: string;
    description: string;
}

export interface ClipboardContextProps {
    clipboardRecord: ClipboardRecord | null;
    clearClipboard: () => Promise<void>;
}

const ClipboardContext = createContext<ClipboardContextProps>({
    clipboardRecord: null,
    clearClipboard: async () => {},
});

export const useClipboard = () => useContext(ClipboardContext);

export const ClipboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [clipboardRecord, setClipboardRecord] = useState<ClipboardRecord | null>(null);

    const fetchClipboard = async () => {
        try {
            const res = await apiAuth.fetch('/api/clipboard/active');
            if (res.ok) {
                const data = await res.json();
                setClipboardRecord(data.record || null);
            }
        } catch (e) {
            console.error('Failed to fetch active clipboard', e);
        }
    };

    const clearClipboard = async () => {
        try {
            await apiAuth.fetch('/api/clipboard/active', { method: 'DELETE' });
            setClipboardRecord(null);
        } catch (e) {
            console.error('Failed to clear clipboard', e);
        }
    };

    useEffect(() => {
        fetchClipboard();

        const handleClipboardUpdate = (event: CustomEvent) => {
            setClipboardRecord(event.detail || null);
        };

        window.addEventListener('app:clipboard-update', handleClipboardUpdate as EventListener);

        return () => {
            window.removeEventListener('app:clipboard-update', handleClipboardUpdate as EventListener);
        };
    }, []);

    return (
        <ClipboardContext.Provider value={{ clipboardRecord, clearClipboard }}>
            {children}
        </ClipboardContext.Provider>
    );
};

export const withClipboard = <P extends ClipboardContextProps, R = any>(
    WrappedComponent: React.ComponentType<P>
) => {
    return React.forwardRef<R, Omit<P, keyof ClipboardContextProps>>((props, ref) => {
        const clipboardProps = useClipboard();
        return <WrappedComponent {...(props as any)} {...clipboardProps} ref={ref} />;
    });
};
