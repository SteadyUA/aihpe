import { Marked } from 'marked';

export interface ColorPreviewStyles {
    colorContainer: string;
    colorSwatch: string;
}



export interface ChatMarkedContext {
    styles: any;
    sessionId?: string;
    version?: number;
}

export const createMarkedInstance = (context: ChatMarkedContext) => {
    const styles = context.styles;
    return new Marked({
        breaks: true, // Preserve breaks like in Chat.tsx
        extensions: [{
            name: 'color',
            level: 'inline',
            start(src: string) {
                return src.match(/#[0-9a-fA-F]{3,6}/)?.index;
            },
            tokenizer(src: string) {
                const rule = /^#([0-9a-fA-F]{3}){1,2}\b/;
                const match = rule.exec(src);
                if (match) {
                    return {
                        type: 'color',
                        raw: match[0],
                        color: match[0]
                    };
                }
            },
            renderer(token: any) {
                return `<span class="${styles.colorContainer}"><span class="${styles.colorSwatch}" style="background-color: ${token.color}"></span>${token.color}</span>`;
            }
        }],
        renderer: {
            html(token: any) {
                const text = typeof token === 'string' ? token : (token.text || '');
                return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            },
            codespan(token: any) {
                const code = token.text || token; // Handle object or string
                const rule = /^#([0-9a-fA-F]{3}){1,2}$/;
                if (typeof code === 'string' && rule.test(code)) {
                    return `<code class="${styles.colorContainer}"><span class="${styles.colorSwatch}" style="background-color: ${code}"></span>${code}</code>`;
                }
                return false;
            },
            link(token: any) {
                if (token.href === '#resource' && context.sessionId && context.version !== undefined) {
                    const filename = token.text;
                    const thumbnailUrl = `${import.meta.env.BASE_URL}api/sessions/${context.sessionId}/${context.version}/resources/${filename}/thumbnail`;
                    const fileUrl = `${import.meta.env.BASE_URL}api/sessions/${context.sessionId}/${context.version}/files/${filename}`;

                    return `
                        <a href="${fileUrl}" target="_blank" rel="noopener noreferrer" class="${styles.resourceLinkTile}" contenteditable="false" data-resource-filename="${filename}">
                            <span class="${styles.resourceLinkThumbContainer}">
                                <img src="${thumbnailUrl}" alt="${filename}" class="${styles.resourceLinkThumb}" />
                            </span>
                        </a>
                    `;
                }
                if (token.href === '#session') {
                    const sessionId = token.text;
                    const displayId = sessionId.length > 8 ? sessionId.substring(0, 8) : sessionId;
                    return `<a href="#session" data-session-id="${sessionId}" title="Session ${sessionId}">${displayId}</a>`;
                }
                return false;
            }
        }
    });
};
