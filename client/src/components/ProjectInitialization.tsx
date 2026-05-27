import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiAuth } from '../utils/api';
import { UiButton, ButtonVariant } from './UiButton';
import sharedStyles from './Projects.module.css';
import styles from './ProjectInitialization.module.css';
import { ProjectStatus } from '../types';
import { createMarkedInstance } from '../utils/markdownUtils';

const marked = createMarkedInstance({ styles: {} });

interface Project {
    id: string;
    status: ProjectStatus;
    errorMessage?: string; // Not in Project entity strictly, but handled via SSE for display here
}

interface ProjectInitializationProps {
    projectId: string;
    projectName?: string;
    onComplete: () => void;
}

interface ToolCallLog {
    agentName: string;
    toolName: string;
    summary: string;
    timestamp: number;
}

export const ProjectInitialization: React.FC<ProjectInitializationProps> = ({ projectId, projectName, onComplete }) => {
    const [project, setProject] = useState<Project | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [planHtml, setPlanHtml] = useState<string>('');
    const [retryCount, setRetryCount] = useState<number>(0);
    const [toolLogs, setToolLogs] = useState<ToolCallLog[]>([]);
    const logContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [toolLogs]);

    const fetchProjectStatus = async () => {
        try {
            const res = await apiAuth.fetch(`/api/projects/${projectId}`);
            if (!res.ok) throw new Error('Failed to fetch project status');
            const data = await res.json();
            setProject(data);

            if (data.status === ProjectStatus.READY) {
                onComplete();
                return true;
            } else if (data.status === ProjectStatus.ERROR) {
                // If it's already in error state on load, we might not have the detailed message,
                // but we know it failed.
                setError('Conversion failed previously. Please retry.');
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
            const res = await apiAuth.fetch(`/api/projects/${projectId}/import-plan`);
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
        fetchProjectStatus();
        fetchPlanContent();

        // SSE listener for plan updates
        const handlePlanUpdated = (e: any) => {
            if (e.detail && e.detail.projectId === projectId) {
                fetchPlanContent();
            }
        };

        const handleTaskCompleted = (e: any) => {
            if (e.detail && e.detail.projectId === projectId) {
                onComplete();
            }
        };

        const handleTaskFailed = (e: any) => {
            if (e.detail && e.detail.projectId === projectId) {
                setError(e.detail.error || 'Conversion failed');
                setProject(prev => prev ? { ...prev, status: ProjectStatus.ERROR } : null);
            }
        };

        const handleToolCalled = (e: any) => {
            if (e.detail && e.detail.projectId === projectId) {
                setToolLogs(prev => [...prev, {
                    agentName: e.detail.agentName,
                    toolName: e.detail.toolName,
                    summary: e.detail.summary,
                    timestamp: Date.now()
                }]);
            }
        };

        window.addEventListener('app:plan-updated', handlePlanUpdated);
        window.addEventListener('app:import-completed', handleTaskCompleted);
        window.addEventListener('app:import-failed', handleTaskFailed);
        window.addEventListener('app:tool-called', handleToolCalled);

        return () => {
            window.removeEventListener('app:plan-updated', handlePlanUpdated);
            window.removeEventListener('app:import-completed', handleTaskCompleted);
            window.removeEventListener('app:import-failed', handleTaskFailed);
            window.removeEventListener('app:tool-called', handleToolCalled);
        };
    }, [projectId, onComplete, retryCount]);

    const handleRetry = async () => {
        try {
            setProject(null);
            setError(null);
            setPlanHtml('');
            setToolLogs([]);
            const res = await apiAuth.fetch(`/api/projects/${projectId}/import-retry`, { method: 'POST' });
            if (!res.ok) throw new Error('Failed to restart task');
            setRetryCount(prev => prev + 1);
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        }
    };

    const headerContent = (
        <div className={styles.headerWrapper}>
            <span className={styles.projectName}>
                {projectName || 'Initializing Project...'}
            </span>
            <span className={styles.statusBadge}>
                Initialization
            </span>
        </div>
    );

    const headerPortalTarget = document.getElementById('header-portal-target');

    if (error || (project && project.status === ProjectStatus.ERROR)) {
        return (
            <>
                {headerPortalTarget && createPortal(headerContent, headerPortalTarget)}
                <div className={`${sharedStyles.container} ${styles.errorContainer}`}>
                    <h2 className={styles.errorTitle}>Initialization Failed</h2>
                    <p>{error}</p>
                    <UiButton
                        variant={ButtonVariant.PRIMARY}
                        onClick={handleRetry}
                        className={styles.retryButton}
                    >
                        Retry
                    </UiButton>
                </div>
            </>
        );
    }

    if (!project) {
        return (
            <>
                {headerPortalTarget && createPortal(headerContent, headerPortalTarget)}
                <div className={sharedStyles.loading}>Initializing project...</div>
            </>
        );
    }

    return (
        <>
            {headerPortalTarget && createPortal(headerContent, headerPortalTarget)}
            <div className={sharedStyles.container}>
                <div className={styles.splitViewContainer}>
                    {/* Left Column: Plan */}
                    <div className={styles.column}>
                        {planHtml ? (
                            <div
                                className={`${styles.planContentWrapper} markdown-body`}
                                dangerouslySetInnerHTML={{ __html: planHtml }}
                            />
                        ) : (
                            <div className={styles.placeholderText}>
                                Planning initial steps...
                            </div>
                        )}
                    </div>

                    {/* Right Column: Logs */}
                    <div className={styles.column}>
                        <div className={styles.logHeader}>
                            <h3 className={styles.logTitle}>Agent Activity Log</h3>
                            {project.status !== ProjectStatus.READY && project.status !== ProjectStatus.ERROR && (
                                <div className={styles.spinner} />
                            )}
                        </div>
                        <div ref={logContainerRef} className={styles.logContainer}>
                            {toolLogs.length === 0 ? (
                                <div className={styles.waitingText}>Waiting for agent activity...</div>
                            ) : (
                                toolLogs.map((log, index) => (
                                    <div key={index}>
                                        <span className={styles.logTime}>[{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}]</span>
                                        {' '}
                                        <span className={log.agentName === 'Orchestrator' ? styles.logAgentOrchestrator : styles.logAgentOther}>
                                            {log.agentName}
                                        </span>
                                        {' '}
                                        <span className={styles.logTool}>{log.toolName}</span>
                                        {' '}
                                        <span>{log.summary || 'No summary provided'}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
