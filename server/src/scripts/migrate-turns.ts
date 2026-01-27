
import fs from 'fs';
import path from 'path';
import { ChatMessage, Turn } from '../types/chat';

import { getSessionsDir } from '../utils/pathUtils';

const SESSION_ROOT = getSessionsDir();

function migrateSessions() {
    if (!fs.existsSync(SESSION_ROOT)) {
        console.log('No sessions directory found.');
        return;
    }

    const sessions = fs.readdirSync(SESSION_ROOT);
    let migratedCount = 0;

    for (const sessionId of sessions) {
        const sessionDir = path.join(SESSION_ROOT, sessionId);
        if (!fs.statSync(sessionDir).isDirectory()) {
            continue;
        }

        const messagesPath = path.join(sessionDir, 'messages.json');
        const sessionPath = path.join(sessionDir, 'session.json');
        const turnsPath = path.join(sessionDir, 'turns.json');

        if (fs.existsSync(turnsPath)) {
            // Already migrated or manual
            console.log(`Skipping ${sessionId}, turns.json exists.`);
            continue;
        }

        if (!fs.existsSync(messagesPath)) {
            console.log(`Skipping ${sessionId}, no messages.json.`);
            continue;
        }

        try {
            const rawMessages = fs.readFileSync(messagesPath, 'utf-8');
            const messages: ChatMessage[] = JSON.parse(rawMessages);

            let sessionData: any = {};
            if (fs.existsSync(sessionPath)) {
                sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
            }

            // Group by turn
            const turnsMap = new Map<number, ChatMessage[]>();
            for (const msg of messages) {
                const t = msg.turn || 0;
                if (!turnsMap.has(t)) {
                    turnsMap.set(t, []);
                }
                turnsMap.get(t)?.push(msg);
            }

            const turns: Turn[] = [];

            // Sort turn keys
            const turnIds = Array.from(turnsMap.keys()).sort((a, b) => a - b);

            for (const turnId of turnIds) {
                const msgs = turnsMap.get(turnId)!;
                const userMsg = msgs.find(m => m.role === 'user');
                const assistantMsg = msgs.find(m => m.role === 'assistant');

                // If strictly no user and no assistant, maybe just system? Skip?
                // Usually turn 0 might be empty or valid.

                const beginTime = userMsg ? new Date(userMsg.createdAt) : (msgs[0] ? new Date(msgs[0].createdAt) : new Date());
                const endTime = assistantMsg ? new Date(assistantMsg.createdAt) : beginTime;

                // If we have content, create a turn
                if (userMsg || assistantMsg) {
                    const turn: Turn = {
                        turn: turnId,
                        beginTime: beginTime,
                        endTime: endTime,
                        request: userMsg ? (typeof userMsg.content === 'string' ? userMsg.content : JSON.stringify(userMsg.content)) : '',
                        response: assistantMsg ? (typeof assistantMsg.content === 'string' ? assistantMsg.content : JSON.stringify(assistantMsg.content)) : '',
                        provider: sessionData.provider || 'openai',
                        fastMode: sessionData.fastMode || false,
                        selection: userMsg?.selection,
                        attachment: userMsg?.attachment,
                        version: userMsg?.version || assistantMsg?.version || 0
                    };
                    turns.push(turn);
                }
            }

            fs.writeFileSync(turnsPath, JSON.stringify(turns, null, 2), 'utf-8');
            console.log(`Migrated ${sessionId}: ${turns.length} turns.`);
            migratedCount++;

        } catch (error) {
            console.error(`Failed to migrate session ${sessionId}`, error);
        }
    }

    console.log(`Migration complete. Migrated ${migratedCount} sessions.`);
}

migrateSessions();
