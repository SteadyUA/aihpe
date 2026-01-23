import { Service } from 'typedi';
import { ImageService } from './ImageService';

@Service()
export class LiteLLMImageService extends ImageService {
    protected async generateRaw(prompt: string, abortSignal?: AbortSignal): Promise<string> {
        const litellmUrl = process.env.LITELLM_API_URL;
        const litellmKey = process.env.LITELLM_API_KEY;

        if (!litellmUrl || !litellmKey) {
            throw new Error('LITELLM_API_URL or LITELLM_API_KEY not configured');
        }

        const baseUrl = litellmUrl.endsWith('/') ? litellmUrl.slice(0, -1) : litellmUrl;
        const url = `${baseUrl}/images/generations`;

        console.log(`Generating image via LiteLLM for description: ${prompt}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${litellmKey}`
            },
            signal: abortSignal,
            body: JSON.stringify({
                prompt: prompt,
                model: this.modelId, // Pass the model ID, proxy should handle mapping if needed
                n: 1,
                size: "1024x1024" // specific size might be needed or ignored depending on model
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LiteLLM request failed with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        let base64Data = data.data?.[0]?.b64_json;

        if (!base64Data) {
            // Some proxies might return url instead of b64_json even if requested
            if (data.data?.[0]?.url) {
                const imgRes = await fetch(data.data[0].url);
                const arrayBuffer = await imgRes.arrayBuffer();
                base64Data = Buffer.from(arrayBuffer).toString('base64');
            }
        }

        if (!base64Data) {
            throw new Error(`No image data found in LiteLLM response.`);
        }

        return base64Data;
    }

    protected async editRaw(imageBuffer: Buffer, mimeType: string, prompt: string, currentDescription?: string, abortSignal?: AbortSignal): Promise<{ base64: string; description?: string }> {
        const litellmUrl = process.env.LITELLM_API_URL;
        const litellmKey = process.env.LITELLM_API_KEY;

        if (!litellmUrl || !litellmKey) {
            throw new Error('LITELLM_API_URL or LITELLM_API_KEY not configured');
        }

        const baseUrl = litellmUrl.endsWith('/') ? litellmUrl.slice(0, -1) : litellmUrl;
        const url = `${baseUrl}/images/edits`;

        console.log(`Editing image via LiteLLM with prompt: ${prompt}`);

        const formData = new FormData();
        const blob = new Blob([imageBuffer as unknown as BlobPart], { type: mimeType });
        // Using 'image.png' as filename for the blob if simple filename not available
        formData.append('image', blob, 'image.png');
        formData.append('prompt', prompt);
        formData.append('model', this.modelId);


        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${litellmKey}`
            },
            signal: abortSignal,
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LiteLLM request failed with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        let newBase64Data = data.data?.[0]?.b64_json;

        if (!newBase64Data) {
            if (data.data?.[0]?.url) {
                const imgRes = await fetch(data.data[0].url);
                const arrayBuffer = await imgRes.arrayBuffer();
                newBase64Data = Buffer.from(arrayBuffer).toString('base64');
            }
        }

        if (!newBase64Data) {
            throw new Error(`No image data found in LiteLLM response.`);
        }

        let newDescription = currentDescription;

        // If we have a current description, try to update it using LLM
        if (currentDescription) {
            try {
                const chatUrl = `${baseUrl}/chat/completions`;
                const updatePrompt = `Original description: "${currentDescription}".
Edit instruction: "${prompt}".

The image has been edited according to the instruction. Provide a new, description of the resulting image. Do not add any preamble or "Here is the description". Just the description.`;

                const chatResponse = await fetch(chatUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${litellmKey}`
                    },
                    signal: abortSignal,
                    body: JSON.stringify({
                        model: this.modelId, // Use same model if capable, or fallback if needed. gemini-2.5-flash-image supports text too.
                        messages: [{ role: 'user', content: updatePrompt }]
                    })
                });

                if (chatResponse.ok) {
                    const chatData = await chatResponse.json();
                    const content = chatData.choices?.[0]?.message?.content;
                    if (content) {
                        newDescription = content.trim();
                        console.log(`Updated image description: ${newDescription}`);
                    }
                } else {
                    console.warn(`Failed to update image description via LLM: status ${chatResponse.status}`);
                }
            } catch (e) {
                console.warn('Failed to update image description:', e);
            }
        }

        return { base64: newBase64Data, description: newDescription };
    }

    protected async describeRaw(imageBuffer: Buffer, mimeType: string, abortSignal?: AbortSignal): Promise<string> {
        const litellmUrl = process.env.LITELLM_API_URL;
        const litellmKey = process.env.LITELLM_API_KEY;

        if (!litellmUrl || !litellmKey) {
            throw new Error('LITELLM_API_URL or LITELLM_API_KEY not configured');
        }

        const baseUrl = litellmUrl.endsWith('/') ? litellmUrl.slice(0, -1) : litellmUrl;
        const url = `${baseUrl}/chat/completions`;
        const base64Image = imageBuffer.toString('base64');

        const body = {
            model: this.modelId,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Analyze this image. Describe it in a single sentence so that I can use this description for alt-text or generating a similar image." },
                        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                    ]
                }
            ]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${litellmKey}`
            },
            signal: abortSignal,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LiteLLM request failed with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (content) {
            return content;
        }
        throw new Error('No description found in LiteLLM response');
    }
}
