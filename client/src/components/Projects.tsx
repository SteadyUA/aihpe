
import React, { Component } from 'react';
import { apiAuth } from '../utils/api';
import { Project } from '../types';
import { ProjectCreationModal } from './ProjectCreationModal';
import { ConfirmationModal } from './ConfirmationModal';
import { withRouter, RouterProps } from './withRouter';
import styles from './Projects.module.css';

interface ProjectsProps extends RouterProps {
    onSelectProject: (projectId: string, lastSessionId?: string) => void;
    currentProjectId: string | null;
}

interface ProjectsState {
    projects: Project[];
    loading: boolean;
    error: string | null;
    showCreationModal: boolean;
    projectToDelete: Project | null;
}

class Projects extends Component<ProjectsProps, ProjectsState> {
    constructor(props: ProjectsProps) {
        super(props);
        this.state = {
            projects: [],
            loading: true,
            error: null,
            showCreationModal: false,
            projectToDelete: null
        };
    }

    componentDidMount() {
        document.title = 'Projects';
        this.loadProjects();
    }

    loadProjects = async () => {
        try {
            this.setState({ loading: true, error: null });
            const res = await apiAuth.fetch('/api/projects');
            if (!res.ok) throw new Error('Failed to fetch projects');
            const data = await res.json();
            this.setState({ projects: data, loading: false });
        } catch (error: any) {
            console.error('Failed to load projects', error);
            this.setState({ error: error.message, loading: false });
        }
    };

    handleSelectProject = (projectId: string) => {
        const project = this.state.projects.find(p => p.id === projectId);
        let lastSessionId: string | undefined;

        if (project) {
            if (project.activeSessionId) {
                lastSessionId = project.activeSessionId;
            } else if (project.sessionIds && project.sessionIds.length > 0) {
                lastSessionId = project.sessionIds[project.sessionIds.length - 1];
            }
        }
        this.props.onSelectProject(projectId, lastSessionId);
    };

    handleCreateProject = async (defaultProvider: string, name: string, file?: File) => {
        try {
            const formData = new FormData();
            formData.append('defaultProvider', defaultProvider);
            if (name) formData.append('name', name);
            if (file) {
                formData.append('file', file);
            }

            const res = await apiAuth.fetch('/api/projects', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                throw new Error('Failed to create project');
            }

            const project = await res.json();
            this.setState(prev => ({
                projects: [...prev.projects, project],
                showCreationModal: false
            }));
            this.handleSelectProject(project.id);
        } catch (error) {
            console.error('Failed to create project', error);
            alert('Failed to create project');
        }
    };

    toggleCreationModal = () => {
        this.setState(prev => ({ showCreationModal: !prev.showCreationModal }));
    };

    handleRequestDelete = (e: React.MouseEvent, project: Project) => {
        e.stopPropagation(); // Prevent card selection
        this.setState({ projectToDelete: project });
    };

    handleCancelDelete = () => {
        this.setState({ projectToDelete: null });
    };

    handleConfirmDelete = async () => {
        const { projectToDelete } = this.state;
        if (!projectToDelete) return;

        try {
            const res = await apiAuth.fetch(`/api/projects/${projectToDelete.id}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                throw new Error('Failed to delete project');
            }

            // Remove from state
            this.setState(prev => ({
                projects: prev.projects.filter(p => p.id !== projectToDelete.id),
                projectToDelete: null
            }));

        } catch (error) {
            console.error('Failed to delete project', error);
            alert('Failed to delete project');
            this.setState({ projectToDelete: null });
        }
    };

    render() {
        const { currentProjectId } = this.props;
        const { projects, loading, error, showCreationModal, projectToDelete } = this.state;

        return (
            <div className={styles.container}>

                <div className={styles.content}>
                    <div className={styles.controls}>
                        <button className={styles.createButton} onClick={this.toggleCreationModal}>
                            + New Project
                        </button>
                    </div>

                    {loading && <div className={styles.loading}>Loading projects...</div>}

                    {error && <div className={styles.error}>{error}</div>}

                    {!loading && !error && projects.length === 0 && (
                        <div className={styles.loading}>No projects found. Create one to get started!</div>
                    )}

                    <div className={styles.projectGrid}>
                        {projects.map(project => (
                            <div
                                key={project.id}
                                className={`${styles.projectCard} ${project.id === currentProjectId ? styles.active : ''}`}
                                onClick={() => this.handleSelectProject(project.id)}
                            >
                                <div className={styles.projectName}>{project.name}</div>
                                <div className={styles.projectDate}>{new Date(project.createdAt).toLocaleDateString()}</div>
                                <div className={styles.projectFooter}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>{project.sessionIds?.length || 0} Sessions</span>
                                        {project.status === 'initialization' && (
                                            <span style={{
                                                padding: '2px 6px',
                                                borderRadius: '12px',
                                                backgroundColor: 'rgba(24, 144, 255, 0.1)',
                                                color: '#1890ff',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}>
                                                <div style={{
                                                    width: '8px',
                                                    height: '8px',
                                                    borderRadius: '50%',
                                                    border: '2px solid #1890ff',
                                                    borderTopColor: 'transparent',
                                                    animation: 'spin 1s linear infinite'
                                                }} />
                                                Initializing...
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        className={styles.deleteButton}
                                        onClick={(e) => this.handleRequestDelete(e, project)}
                                        title="Delete Project"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <ProjectCreationModal
                    isOpen={showCreationModal}
                    onCreate={async (prov, name, file) => {
                        await this.handleCreateProject(prov, name, file);
                    }}
                    onClose={this.toggleCreationModal}
                />

                <ConfirmationModal
                    isOpen={!!projectToDelete}
                    title="Delete Project"
                    message={`Are you sure you want to delete "${projectToDelete?.name}"? This will delete all sessions associated with it.`}
                    onConfirm={this.handleConfirmDelete}
                    onCancel={this.handleCancelDelete}
                />
            </div>
        );
    }
}

export default withRouter(Projects);
