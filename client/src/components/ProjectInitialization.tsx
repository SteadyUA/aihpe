import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiAuth } from '../utils/api';
import { UiButton, ButtonVariant} from './UiButton';
import styles from './Projects.module.css';
import { TaskStatus } from '../types';

interface Job {
    description: string;
    shortDescription: string;
    completed: boolean;
}

interface Step {
    stepName: string;
    concurrentJobs: Job[];
}

interface Task {
    id: string;
    status: TaskStatus;
    steps: Step[];
    errorMessage?: string;
}

interface ProjectInitializationProps {
    taskId: string;
    projectName?: string;
    onComplete: () => void;
}

export const ProjectInitialization: React.FC<ProjectInitializationProps> = ({ taskId, projectName, onComplete }) => {
    const [task, setTask] = useState<Task | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState<number>(0);

    useEffect(() => {
        let interval: any;

        const fetchTaskStatus = async () => {
            try {
                const res = await apiAuth.fetch(`/api/tasks/${taskId}`);
                if (!res.ok) throw new Error('Failed to fetch task status');
                const data = await res.json();
                setTask(data);

                if (data.status === TaskStatus.COMPLETED) {
                    clearInterval(interval);
                    onComplete();
                } else if (data.status === TaskStatus.FAILED) {
                    clearInterval(interval);
                    setError(data.errorMessage || 'Conversion failed');
                }
            } catch (err: any) {
                console.error(err);
                setError(err.message);
                clearInterval(interval);
            }
        };

        fetchTaskStatus();
        interval = setInterval(fetchTaskStatus, 2000);

        return () => clearInterval(interval);
    }, [taskId, onComplete, retryCount]);

    const handleRetry = async () => {
        try {
            setTask(null);
            setError(null);
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
                        `}</style>

                        {(() => {
                            const activeStepIndex = task.steps.findIndex(step => step.concurrentJobs.some(job => !job.completed));
                            return task.steps.map((step, sIdx) => {
                                const isActive = sIdx === activeStepIndex;
                                const borderColor = isActive ? '#1890ff' : '#ccc';
                                return (
                                    <div key={sIdx} style={{ marginBottom: '1.5rem', borderLeft: `3px solid ${borderColor}`, paddingLeft: '1rem' }}>
                                        <h3 style={{ margin: '0 0 0.5rem 0', color: isActive ? '#333' : '#888' }}>{step.stepName}</h3>
                                        <ul style={{ listStyle: 'none', padding: 0 }}>
                                            {step.concurrentJobs.map((job, tIdx) => (
                                                <li key={tIdx} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                    <span style={{
                                                        color: job.completed ? '#52c41a' : '#888',
                                                        fontSize: '1.2rem'
                                                    }}>
                                                        {job.completed ? '✓' : '○'}
                                                    </span>
                                                    <span style={{ textDecoration: job.completed ? 'line-through' : 'none', color: job.completed ? '#888' : '#333' }}>
                                                        {job.shortDescription}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            });
                        })()}

                        {task.steps.length === 0 && (
                            <div style={{ color: '#888', fontStyle: 'italic' }}>
                                Planning initial steps...
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};
