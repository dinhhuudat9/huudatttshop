const serverless = require('serverless-http');

let bootstrapPromise = null;
let handlerPromise = null;

async function loadHandler() {
    if (!handlerPromise) {
        handlerPromise = (async () => {
            const app = require('../../backend/app');
            const { ensureBootstrapped } = require('../../backend/bootstrap');

            return {
                handler: serverless(app),
                ensureBootstrapped
            };
        })().catch((error) => {
            handlerPromise = null;
            throw error;
        });
    }

    return handlerPromise;
}

async function ensureReady(ensureBootstrapped) {
    if (!bootstrapPromise) {
        bootstrapPromise = ensureBootstrapped().catch((error) => {
            bootstrapPromise = null;
            throw error;
        });
    }

    return bootstrapPromise;
}

module.exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    const method = event?.httpMethod || 'UNKNOWN';
    const path = event?.path || event?.rawPath || 'UNKNOWN';

    try {
        console.log(`[netlify-api] ${method} ${path}`);

        const { handler, ensureBootstrapped } = await loadHandler();
        await ensureReady(ensureBootstrapped);

        return await handler(event, context);
    } catch (error) {
        console.error('[netlify-api] failed', {
            method,
            path,
            message: error?.message || String(error),
            stack: error?.stack || ''
        });

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            },
            body: JSON.stringify({
                success: false,
                code: 'NETLIFY_FUNCTION_ERROR',
                message: error?.message || 'Netlify function failed'
            })
        };
    }
};
