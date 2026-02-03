
import React from 'react';
import { WorkSession } from './WorkSession';
import { withSession, SessionContextProps } from '../contexts/SessionContext';
import { withRouter, RouterProps } from './withRouter';

interface SessionManagerProps extends SessionContextProps, RouterProps {
    // Resize props removed
}

class SessionManagerInternal extends React.Component<SessionManagerProps> {
    render() {
        const {
            stableSessionIds,
            sessions,
            activeSessionId,
            updateSession,
            cloneTurn,
            previewTurn,
            switchSession,
            notFoundSessionId,
            router
        } = this.props;

        const urlSessionId = (router.params as Record<string, string | undefined>)['sessionId'];

        if (notFoundSessionId && notFoundSessionId === urlSessionId) {
            return (
                <div style={{
                    gridColumn: '1 / -1',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                    fontSize: '1.5rem',
                    color: 'var(--text-secondary, #888)'
                }}>
                    Session Not Found
                </div>
            );
        }

        return (
            <>
                {stableSessionIds.map(sessionId => {
                    const session = sessions[sessionId];
                    if (!session) return null;
                    const isVisible = sessionId === activeSessionId;

                    return (
                        <WorkSession
                            key={sessionId}
                            session={session}
                            isVisible={isVisible}
                            onUpdateSession={(updates) => updateSession(sessionId, updates)}
                            onCloneTurn={cloneTurn}
                            onPreviewTurn={previewTurn}
                            sessionIds={Object.keys(sessions)}
                            onSwitchSession={switchSession}
                        />
                    );
                })}
            </>
        );
    }
}

export const SessionManager = withRouter(withSession(SessionManagerInternal));
