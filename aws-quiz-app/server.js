const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const APP_ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const MAX_REQUEST_BYTES = 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_REQUESTS = 5;

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8'
    });
    response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of request) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_REQUEST_BYTES) {
            throw new HttpError(413, 'Request body exceeds the 1 MB limit.');
        }
        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new HttpError(400, 'Request body must contain valid JSON.');
    }
}

function validateRequestBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Request body must be a JSON object.');
    }
    if (!body.tutorialData || typeof body.tutorialData !== 'object'
        || !Array.isArray(body.tutorialData.sections) || body.tutorialData.sections.length === 0) {
        throw new HttpError(400, 'tutorialData must include at least one section.');
    }
    if (!Array.isArray(body.quizData)) {
        throw new HttpError(400, 'quizData must be an array.');
    }
}

function isRateLimited(clientAddress, rateLimitBuckets) {
    const now = Date.now();
    const recentRequests = (rateLimitBuckets.get(clientAddress) || [])
        .filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);

    if (recentRequests.length >= RATE_LIMIT_REQUESTS) {
        rateLimitBuckets.set(clientAddress, recentRequests);
        return true;
    }

    recentRequests.push(now);
    rateLimitBuckets.set(clientAddress, recentRequests);
    return false;
}

function validateGeneratedQuestions(questions) {
    if (!Array.isArray(questions) || questions.length !== 20) {
        throw new HttpError(502, 'Gemini did not return exactly 20 questions.');
    }

    questions.forEach((question, index) => {
        const prefix = `Generated question ${index + 1}`;
        if (!question || typeof question.question !== 'string' || !question.question.trim()) {
            throw new HttpError(502, `${prefix} is missing its question text.`);
        }
        if (!Array.isArray(question.options) || question.options.length !== 4
            || question.options.some(option => typeof option !== 'string' || !option.trim())) {
            throw new HttpError(502, `${prefix} must have 4 non-empty options.`);
        }
        if (!Number.isInteger(question.correct) || question.correct < 0 || question.correct > 3) {
            throw new HttpError(502, `${prefix} has an invalid correct-answer index.`);
        }
        if (!Array.isArray(question.explanations) || question.explanations.length !== 4
            || question.explanations.some(explanation => typeof explanation !== 'string' || !explanation.trim())) {
            throw new HttpError(502, `${prefix} must have 4 non-empty explanations.`);
        }
    });

    return questions;
}

function buildPrompt(tutorialData, previousQuestions) {
    const previousContext = previousQuestions.length > 0
        ? `\nExisting Static Questions (DO NOT duplicate these concepts):\n${JSON.stringify(previousQuestions)}`
        : '';

    return `You are an expert AWS Machine Learning Specialty exam architect.
Based ONLY on the following tutorial data, generate exactly 20 highly advanced, scenario-based practice questions.
Focus heavily on different parts of the tutorial to ensure variety.${previousContext}

COMPLEXITY RULES:
1. Do not ask simple definitional questions.
2. Each question MUST present a real-world architectural scenario (e.g., a company is trying to optimize X using Y, but encounters Z).
3. The options must represent plausible architectural decisions, requiring multi-step reasoning to find the correct one.
4. Keep explanations concise (1-2 sentences max) but deeply technical.

CRITICAL FORMAT RULE: You MUST provide exactly 4 options and exactly 4 explanations for EACH of the 20 questions. The explanations array must map exactly to the options array. Do not leave any explanations blank.

5. LIST FORMATTING STRICT RULE: If a question or explanation contains a list of steps, items, or processes, you MUST format it sequentially using numbers followed by a period and a space (e.g., "1. ", "2. ", "3. "). ABSOLUTELY DO NOT use markdown bullets (- or *) or unnumbered lists.

Tutorial Data:
${JSON.stringify(tutorialData)}`;
}

function stripCodeFences(text) {
    const cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
        return cleaned.replace(/^```json\n?/, '').replace(/```\s*$/, '').trim();
    }
    if (cleaned.startsWith('```')) {
        return cleaned.replace(/^```\w*\n?/, '').replace(/```\s*$/, '').trim();
    }
    return cleaned;
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function generateQuestions(body) {
    const promptText = buildPrompt(body.tutorialData, body.quizData);
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-3.5-flash')}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }],
                        generationConfig: {
                            temperature: 0.7,
                            responseMimeType: 'application/json',
                            responseSchema: {
                                type: 'ARRAY',
                                items: {
                                    type: 'OBJECT',
                                    properties: {
                                        question: { type: 'STRING' },
                                        options: { type: 'ARRAY', items: { type: 'STRING' } },
                                        correct: { type: 'INTEGER' },
                                        explanations: { type: 'ARRAY', items: { type: 'STRING' } }
                                    },
                                    required: ['question', 'options', 'correct', 'explanations']
                                }
                            }
                        }
                    })
                }
            );

            if (!response.ok) {
                if ((response.status === 429 || response.status >= 500) && attempt < 3) {
                    lastError = new Error(`Gemini returned HTTP ${response.status}.`);
                } else {
                    const detail = await response.json().then(
                        (body) => body?.error?.message,
                        () => undefined
                    );
                    const hint = response.status === 429
                        ? ' Quota or rate limit reached; wait a minute, check your Gemini plan/quota, or set GEMINI_MODEL to a different model.'
                        : '';
                    throw new HttpError(
                        502,
                        `Gemini request failed with HTTP ${response.status}.${hint}${detail ? ` Details: ${String(detail).slice(0, 300)}` : ''}`
                    );
                }
            } else {
                const payload = await response.json();
                const responseText = payload.candidates?.[0]?.content?.parts?.[0]?.text;
                if (typeof responseText !== 'string') {
                    throw new Error('Gemini returned no question content.');
                }
                return validateGeneratedQuestions(JSON.parse(stripCodeFences(responseText)));
            }
        } catch (error) {
            if (error instanceof HttpError) throw error;
            lastError = error;
        } finally {
            clearTimeout(timeout);
        }

        if (attempt < 3) await sleep(1500 * attempt);
    }

    throw new HttpError(502, `Question generation failed: ${lastError.message}`);
}

async function handleAiQuizRequest(request, response, rateLimitBuckets) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new HttpError(405, 'Method not allowed.');
    }
    if (!process.env.GEMINI_API_KEY) {
        throw new HttpError(503, 'AI quiz generation is not configured. Set GEMINI_API_KEY on the server.');
    }
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new HttpError(415, 'Content-Type must be application/json.');
    }
    if (isRateLimited(request.socket.remoteAddress || 'unknown', rateLimitBuckets)) {
        throw new HttpError(429, 'Too many AI quiz requests. Try again in a minute.');
    }

    const body = await readJsonBody(request);
    validateRequestBody(body);
    const questions = await generateQuestions(body);
    sendJson(response, 200, questions);
}

function serveStaticFile(request, response, pathname) {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        throw new HttpError(400, 'Invalid URL path.');
    }

    const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^[/\\]+/, '');
    let filePath = path.resolve(APP_ROOT, relativePath);
    if (filePath !== APP_ROOT && !filePath.startsWith(`${APP_ROOT}${path.sep}`)) {
        throw new HttpError(403, 'Forbidden.');
    }
    if (relativePath.split(/[\\/]/).some(segment => segment.startsWith('.'))
        || path.basename(relativePath).toLowerCase() === 'config.js') {
        throw new HttpError(404, 'Not found.');
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        throw new HttpError(404, 'Not found.');
    }
    if (!stat.isFile()) throw new HttpError(404, 'Not found.');

    response.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') {
        response.end();
        return;
    }
    fs.createReadStream(filePath).pipe(response);
}

function createAppServer() {
    const rateLimitBuckets = new Map();
    return http.createServer(async (request, response) => {
        try {
            const requestUrl = new URL(request.url, 'http://localhost');
            if (requestUrl.pathname === '/api/ai-quiz') {
                await handleAiQuizRequest(request, response, rateLimitBuckets);
                return;
            }
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                response.setHeader('Allow', 'GET, HEAD');
                throw new HttpError(405, 'Method not allowed.');
            }
            serveStaticFile(request, response, requestUrl.pathname);
        } catch (error) {
            const statusCode = error instanceof HttpError ? error.statusCode : 500;
            if (statusCode >= 500) console.error('Request error:', error);
            sendJson(response, statusCode, { error: error.message || 'Internal server error.' });
        }
    });
}

function startServer(port = PORT, host = HOST) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('PORT must be an integer between 0 and 65535.');
    }
    const server = createAppServer();
    server.listen(port, host, () => {
        const address = server.address();
        console.log(`Edu-Argumentation server listening at http://${host}:${address.port}`);
        if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
            console.warn('This server has no user authentication; do not expose it to the public internet.');
        }
        if (!process.env.GEMINI_API_KEY) {
            console.warn('GEMINI_API_KEY is not set. Course features work, but AI quiz generation will be unavailable.');
        }
    });
    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = {
    HttpError,
    createAppServer,
    isRateLimited,
    readJsonBody,
    startServer,
    validateGeneratedQuestions,
    validateRequestBody
};
