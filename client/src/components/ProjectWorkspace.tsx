
import React from 'react';
import { WorkspaceLayout } from './WorkspaceLayout';
import { SessionProvider } from '../contexts/SessionContext';
import { apiAuth } from '../utils/api';
import { LlmProvider } from '../types';
import { withRouter, RouterProps } from './withRouter';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface ProjectWorkspaceProps extends RouterProps {
}

interface ProjectWorkspaceState {
    projectId: string | null;
    projectName: string;
    projectRulesAndGoal: string;
    projectImageGenerationPref: string;
    projectDefaultProvider: LlmProvider;
    projectModelRole: string;
    projectSessions: any[];
    activeSessionId?: string | null;
}

class ProjectWorkspace extends React.Component<ProjectWorkspaceProps, ProjectWorkspaceState> {
    constructor(props: ProjectWorkspaceProps) {
        super(props);
        this.state = {
            projectId: null,
            projectName: '',
            projectRulesAndGoal: '',
            projectImageGenerationPref: '',
            projectDefaultProvider: 'openai',
            projectModelRole: '',
            projectSessions: [],
            activeSessionId: null
        };
    }

    componentDidMount() {
        this.initWorkspace();
    }

    componentDidUpdate(prevProps: ProjectWorkspaceProps) {
        const prevParams = prevProps.router.params as Record<string, string | undefined>;
        const currParams = this.props.router.params as Record<string, string | undefined>;

        if (prevParams['projectId'] !== currParams['projectId']) {
            this.initWorkspace();
        }
    }

    initWorkspace = async () => {
        const { params } = this.props.router;
        const projectIdParam = (params as Record<string, string | undefined>)['projectId'];

        if (projectIdParam) {
            await this.fetchProject(projectIdParam);
        }
    };

    fetchProject = async (id: string, sessionContextSync?: (sessions: any[], activeId?: string) => void) => {
        try {
            const res = await apiAuth.fetch(`/api/projects/${id}`);
            if (!res.ok) throw new Error('Failed to fetch project');

            const data = await res.json();

            this.setState({
                projectId: id,
                projectName: data.name || 'Untitled',
                projectRulesAndGoal: data.rulesAndGoal || '',
                projectImageGenerationPref: data.imageGenerationPref,
                projectDefaultProvider: data.defaultProvider,
                projectModelRole: data.modelRole,
                projectSessions: data.sessions || [],
                activeSessionId: data.activeSessionId
            }, () => {
                if (sessionContextSync && data.sessions) {
                    sessionContextSync(data.sessions, data.activeSessionId);
                }
                this.normalizeUrl(data);
            });

        } catch (e) {
            console.error('Failed to load project', e);
        }
    };

    normalizeUrl = (projectData: any) => {
        const { router } = this.props;
        const { searchParams, navigate, location } = router;

        const sessionIdQuery = searchParams.get('sessionId');

        if (!sessionIdQuery) {
            // No session specified. Find active.
            const activeId = projectData.activeSessionId ||
                (projectData.sessions && projectData.sessions.length > 0 ? projectData.sessions[0].sessionId : null);

            if (activeId) {
                // Replace URL
                const newParams = new URLSearchParams(searchParams);
                newParams.set('sessionId', activeId);
                navigate(`${location.pathname}?${newParams.toString()}`, { replace: true });
            }
        }
    };

    handleCreateProject = async (rules: string, imgPref: string, provider: LlmProvider, name: string) => {
        try {
            const response = await apiAuth.fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    rulesAndGoal: rules,
                    imageGenerationPref: imgPref,
                    defaultProvider: provider
                }),
            });
            if (!response.ok) throw new Error('Failed to create project');
            const project = await response.json();
            this.setState({
                projectId: project.id,
                projectName: project.name,
                projectRulesAndGoal: project.rulesAndGoal,
                projectImageGenerationPref: project.imageGenerationPref,
                projectDefaultProvider: project.defaultProvider,
                projectModelRole: project.modelRole
            });
        } catch (e) {
            console.error('Failed to create project', e);
            throw e;
        }
    };

    handleUpdateProject = async (rules: string, imgPref: string, provider: LlmProvider, name: string, modelRole: string) => {
        const { projectId } = this.state;
        if (!projectId) return;

        try {
            const response = await apiAuth.fetch(`/api/projects/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rulesAndGoal: rules,
                    imageGenerationPref: imgPref,
                    defaultProvider: provider,
                    name,
                    modelRole
                })
            });
            if (!response.ok) throw new Error('Failed to update project');

            this.setState({
                projectName: name,
                projectRulesAndGoal: rules,
                projectImageGenerationPref: imgPref,
                projectDefaultProvider: provider,
                projectModelRole: modelRole
            });
        } catch (e) {
            console.error('Failed to update project', e);
        }
    };

    render() {
        const {
            projectId, projectName, projectRulesAndGoal,
            projectImageGenerationPref, projectDefaultProvider, projectModelRole
        } = this.state;

        if (!projectId) return <div>Loading Workspace...</div>;

        return (
            <SessionProvider projectId={projectId}>
                <WorkspaceLayout
                    projectId={projectId}
                    projectName={projectName}
                    projectRulesAndGoal={projectRulesAndGoal}
                    projectImageGenerationPref={projectImageGenerationPref}
                    projectDefaultProvider={projectDefaultProvider}
                    projectModelRole={projectModelRole}
                    initialProjectSessions={this.state.projectSessions}
                    initialActiveSessionId={this.state.activeSessionId}

                    onUpdateProject={this.handleUpdateProject}
                    onCreateProject={this.handleCreateProject}

                    fetchProject={this.fetchProject}
                />
            </SessionProvider>
        );
    }
}

export default withRouter(ProjectWorkspace);
