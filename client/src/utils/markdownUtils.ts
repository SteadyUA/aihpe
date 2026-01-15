import { Marked } from 'marked';

export interface ColorPreviewStyles {
    colorContainer: string;
    colorSwatch: string;
}

const escapeHtml = (unsafe: string) => {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

export const createMarkedInstance = (styles: ColorPreviewStyles) => {
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
            codespan(token: any) {
                const code = token.text || token; // Handle object or string
                const rule = /^#([0-9a-fA-F]{3}){1,2}$/;
                if (typeof code === 'string' && rule.test(code)) {
                    return `<code class="${styles.colorContainer}"><span class="${styles.colorSwatch}" style="background-color: ${code}"></span>${code}</code>`;
                }
                return `<code>${escapeHtml(String(code))}</code>`;
            }
        }
    });
};
