import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import path from 'path';

const NODE_ENV = process.env.NODE_ENV || 'development';

if (NODE_ENV === 'development') {
    const envPath = path.resolve(process.cwd(), '.env.development');
    // Load .env.development
    dotenvExpand.expand(dotenv.config({ path: envPath }));
}

// Always load default .env as fallback (it won't overwrite existing variables)
dotenvExpand.expand(dotenv.config());

console.log(`Environment loaded for ${NODE_ENV}`);
