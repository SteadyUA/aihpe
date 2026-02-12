import React, { useRef, useEffect, useState } from 'react';
import styles from './Workarea.module.css';
import { useMonaco } from '../../utils/monacoLoader';

interface EditorProps {
    language: string;
    value: string;
    loading: boolean;
    active: boolean;
    onChange: (value: string | undefined) => void;
    onMount?: (editor: any, monaco: any) => void;
}

export const Editor: React.FC<EditorProps> = ({ language, value, loading, active, onChange, onMount }) => {
    const monaco = useMonaco();
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<any>(null);
    const [isInternalChange, setIsInternalChange] = useState(false);

    useEffect(() => {
        if (monaco && containerRef.current && !editorRef.current && !loading) {
            const editor = monaco.editor.create(containerRef.current, {
                value: value,
                language: language,
                theme: 'vs', // 'light' maps to 'vs' usually, or just use default
                automaticLayout: true, // Handle resizing automatically
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on',
                padding: { top: 16, bottom: 16 },
            });

            editorRef.current = editor;

            editor.onDidChangeModelContent(() => {
                const newValue = editor.getValue();
                setIsInternalChange(true);
                onChange(newValue);
                setIsInternalChange(false);
            });

            if (onMount) {
                onMount(editor, monaco);
            }
        }

        return () => {
            if (editorRef.current) {
                editorRef.current.dispose();
                editorRef.current = null;
            }
        };
    }, [monaco, loading]); // Depend on monaco loading and loading prop

    // Handle language change
    useEffect(() => {
        if (editorRef.current && monaco) {
            const model = editorRef.current.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, language);
            }
        }
    }, [language, monaco]);

    // Handle value change from props
    useEffect(() => {
        if (editorRef.current) {
            const currentValue = editorRef.current.getValue();
            if (currentValue !== value && !isInternalChange) {
                editorRef.current.setValue(value);
            }
        }
    }, [value, isInternalChange]);

    // Handle theme/options if needed, but static for now suited to requirements

    return (
        <div className={styles.assetsPanels} style={{ display: active ? 'flex' : 'none' }}>
            {loading || !monaco ? (
                <div className={styles.loading}>Loading...</div>
            ) : (
                <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
            )}
        </div>
    );
};
