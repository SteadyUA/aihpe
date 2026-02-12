import { useEffect, useState } from 'react';


const MONACO_CDN_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min';

// Define types for global require/monaco
declare global {
    interface Window {
        monaco: any;
        require: any;
    }
}

let loaderPromise: Promise<any> | null = null;

export const loadMonaco = (): Promise<any> => {
    if (window.monaco) {
        return Promise.resolve(window.monaco);
    }

    if (loaderPromise) {
        return loaderPromise;
    }

    loaderPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${MONACO_CDN_BASE}/vs/loader.min.js`;
        script.async = true;
        script.onload = () => {
            // Config require
            if (window.require) {
                window.require.config({ paths: { vs: `${MONACO_CDN_BASE}/vs` } });
                window.require(['vs/editor/editor.main'], (monaco: any) => {
                    resolve(monaco);
                });
            } else {
                reject(new Error('Monaco loader did not initialize window.require'));
            }
        };
        script.onerror = reject;
        document.body.appendChild(script);
    });

    return loaderPromise;
};

export const useMonaco = () => {
    const [monaco, setMonaco] = useState<any>(null);

    useEffect(() => {
        let mounted = true;
        loadMonaco().then((m) => {
            if (mounted) {
                setMonaco(m);
            }
        }).catch(console.error);

        return () => {
            mounted = false;
        };
    }, []);

    return monaco;
};
