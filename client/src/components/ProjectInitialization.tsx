import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiAuth } from '../utils/api';
import { UiButton, ButtonVariant} from './UiButton';
import styles from './Projects.module.css';
import { TaskStatus } from '../types';
import { createMarkedInstance } from '../utils/markdownUtils';

const marked = createMarkedInstance({ styles: {} });

interface Task {
    id: string;
    status: TaskStatus;
    errorMessage?: string;
}

interface ProjectInitializationProps {
    taskId: string;
    projectName?: string;
    onComplete: () => void;
}

interface ToolCallLog {
    agentName: string;
    toolName: string;
    summary: string;
    timestamp: number;
}

export const ProjectInitialization: React.FC<ProjectInitializationProps> = ({ taskId, projectName, onComplete }) => {
    const [task, setTask] = useState<Task | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [planHtml, setPlanHtml] = useState<string>('');
    const [retryCount, setRetryCount] = useState<number>(0);
    const [toolLogs, setToolLogs] = useState<ToolCallLog[]>([]);

    const fetchTaskStatus = async () => {
        try {
            const res = await apiAuth.fetch(`/api/tasks/${taskId}`);
            if (!res.ok) throw new Error('Failed to fetch task status');
            const data = await res.json();
            setTask(data);

            if (data.status === TaskStatus.COMPLETED) {
                onComplete();
                return true;
            } else if (data.status === TaskStatus.FAILED) {
                setError(data.errorMessage || 'Conversion failed');
                return true;
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message);
            return true;
        }
        return false;
    };

    const fetchPlanContent = async () => {
        try {
            const res = await apiAuth.fetch(`/api/tasks/${taskId}/plan`);
            if (res.ok) {
                const data = await res.json();
                const rawMarkdown = data.content || '';
                const html = marked.parse(rawMarkdown) as string;
                setPlanHtml(html);
            }
        } catch (err) {
            console.error('Failed to fetch plan:', err);
        }
    };

    useEffect(() => {
        // Initial fetch
        fetchTaskStatus();
        fetchPlanContent();

        // SSE listener for plan updates
        const handlePlanUpdated = (e: any) => {
            if (e.detail && e.detail.taskId === taskId) {
                fetchPlanContent();
            }
        };

        const handleTaskCompleted = (e: any) => {
            if (e.detail && e.detail.taskId === taskId) {
                onComplete();
            }
        };

        const handleTaskFailed = (e: any) => {
            if (e.detail && e.detail.taskId === taskId) {
                setError(e.detail.error || 'Conversion failed');
            }
        };

        const handleToolCalled = (e: any) => {
            if (e.detail && e.detail.taskId === taskId) {
                setToolLogs(prev => [...prev, {
                    agentName: e.detail.agentName,
                    toolName: e.detail.toolName,
                    summary: e.detail.summary,
                    timestamp: Date.now()
                }]);
            }
        };

        window.addEventListener('app:plan-updated', handlePlanUpdated);
        window.addEventListener('app:task-completed', handleTaskCompleted);
        window.addEventListener('app:task-failed', handleTaskFailed);
        window.addEventListener('app:tool-called', handleToolCalled);

        return () => {
            window.removeEventListener('app:plan-updated', handlePlanUpdated);
            window.removeEventListener('app:task-completed', handleTaskCompleted);
            window.removeEventListener('app:task-failed', handleTaskFailed);
            window.removeEventListener('app:tool-called', handleToolCalled);
        };
    }, [taskId, onComplete, retryCount]);

    const handleRetry = async () => {
        try {
            setTask(null);
            setError(null);
            setPlanHtml('');
            setToolLogs([]);
            const res = await apiAuth.fetch(`/api/tasks/${taskId}/retry`, { method: 'POST' });
            if (!res.ok) throw new Error('Failed to restart task');
            setRetryCount(prev => prev + 1);
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        }
    };

    const headerContent = (
        <div style={{ marginLeft: '1rem', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '1.2rem', color: 'var(--text-primary)' }}>
                {projectName || 'Initializing Project...'}
            </span>
            <span style={{
                marginLeft: '1rem',
                padding: '2px 8px',
                borderRadius: '12px',
                backgroundColor: 'rgba(24, 144, 255, 0.1)',
                color: '#1890ff',
                fontSize: '0.8rem',
                fontWeight: 600
            }}>
                Initialization
            </span>
        </div>
    );

    const headerPortalTarget = document.getElementById('header-portal-target');

    if (error) {
        return (
            <>
                {headerPortalTarget && createPortal(headerContent, headerPortalTarget)}
                <div className={styles.container} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <h2 style={{ color: '#ff4d4f' }}>Initialization Failed</h2>
                    <p>{error}</p>
                    <UiButton 
                        variant={ButtonVariant.PRIMARY} 
                        onClick={handleRetry} 
                        style={{ marginTop: '1rem' }}
                    >
                        Retry
                    </UiButton>
                </div>
            </>
        );
    }

    if (!task) {
        return (
            <>
                {headerPortalTarget && createPortal(headerContent, headerPortalTarget)}
                <div className={styles.loading}>Initializing project...</div>
            </>
        );
    }

    return (
        <>
            {headerPortalTarget && createPortal(headerContent, headerPortalTarget)}
            <div className={styles.container} style={{ padding: '2rem', overflowY: 'auto' }}>
                <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                    <h1>Preparing Your Project</h1>
                    <p>We are converting your HTML archive into an interactive session. This may take a few minutes.</p>

                    <div style={{ marginTop: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
                            <div style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                border: '3px solid #ccc',
                                borderTopColor: '#1890ff',
                                animation: 'spin 1s linear infinite'
                            }} />
                            <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                                Status: {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                            </span>
                        </div>

                        <style>{`
                            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                            .plan-content-wrapper {
                                margin-top: 1.5rem;
                                padding: 1.5rem;
                                border-radius: 8px;
                                background-color: var(--bg-secondary, #f8f9fa);
                                border: 1px solid var(--border-color, #eaeaea);
                                max-height: 500px;
                                overflow-y: auto;
                                text-align: left;
                            }
                            .plan-content-wrapper h1, .plan-content-wrapper h2, .plan-content-wrapper h3 {
                                margin-top: 0;
                            }
                            .plan-content-wrapper ul {
                                padding-left: 20px;
                            }
                            .plan-content-wrapper li {
                                margin-bottom: 8px;
                            }
                        `}</style>

                        {planHtml ? (
                            <div 
                                className="plan-content-wrapper markdown-body" 
                                dangerouslySetInnerHTML={{ __html: planHtml }} 
                            />
                        ) : (
                            <div style={{ color: '#888', fontStyle: 'italic', marginTop: '1rem' }}>
                                Planning initial steps...
                            </div>
                        )}

                        {toolLogs.length > 0 && (
                            <div style={{ marginTop: '2rem' }}>
                                <h3>Agent Activity Log</h3>
                                <div style={{
                                    backgroundColor: '#1e1e1e',
                                    color: '#d4d4d4',
                                    padding: '1rem',
                                    borderRadius: '8px',
                                    fontFamily: 'monospace',
                                    fontSize: '0.85rem',
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px'
                                }}>
                                    {toolLogs.map((log, index) => (
                                        <div key={index} style={{ display: 'flex', gap: '10px' }}>
                                            <span style={{ color: '#569cd6' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                            <span style={{ 
                                                color: log.agentName === 'Orchestrator' ? '#ce9178' : '#4ec9b0',
                                                fontWeight: 'bold',
                                                minWidth: '100px'
                                            }}>
                                                {log.agentName}
                                            </span>
                                            <span style={{ color: '#dcdcaa' }}>{log.toolName}</span>
                                            <span style={{ color: '#9cdcfe' }}>-</span>
                                            <span>{log.summary || 'No summary provided'}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};
