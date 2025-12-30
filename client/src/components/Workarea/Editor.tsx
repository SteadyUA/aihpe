import React from 'react';
import MonacoEditor from '@monaco-editor/react';
import styles from './Workarea.module.css';

interface EditorProps {
    language: string;
    value: string;
    loading: boolean;
    active: boolean;
    onChange: (value: string | undefined) => void;
    onMount?: (editor: any, monaco: any) => void;
}

export class Editor extends React.Component<EditorProps> {
    render() {
        const { language, value, loading, active, onChange, onMount } = this.props;

        return (
            <div className={styles.assetsPanels} style={{ display: active ? 'flex' : 'none' }}>
                {loading ? (
                    <div className={styles.loading}>Loading...</div>
                ) : (
                    <MonacoEditor
                        height="100%"
                        defaultLanguage={language}
                        language={language}
                        value={value}
                        theme="light"
                        onMount={onMount}
                        onChange={onChange}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            wordWrap: 'on',
                            padding: { top: 16, bottom: 16 },
                        }}
                    />
                )}
            </div>
        );
    }
}
