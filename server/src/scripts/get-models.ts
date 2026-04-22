import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
    const apiUrl = process.env.LITELLM_API_URL;
    const apiKey = process.env.LITELLM_API_KEY;

    if (!apiUrl) {
        console.error('Error: LITELLM_API_URL is not set in environment variables.');
        process.exit(1);
    }

    if (!apiKey) {
        console.error('Error: LITELLM_API_KEY is not set in environment variables.');
        process.exit(1);
    }

    const modelsUrl = `${apiUrl}/models`;
    console.log(`Fetching models from: ${modelsUrl} ...`);

    try {
        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP Error ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        
        if (data && Array.isArray(data.data)) {
            console.log('\n--- Available Models ---');
            data.data.forEach((model: any) => {
                console.log(`- ${model.id}`);
            });
            console.log(`\nTotal models found: ${data.data.length}`);
        } else {
            console.log('Successfully fetched models response:');
            console.dir(data, { depth: null, colors: true });
        }

    } catch (error: any) {
        console.error('\nError fetching models:', error.message);
        process.exit(1);
    }
}

main();
