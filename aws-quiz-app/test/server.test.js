const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const {
    HttpError,
    createAppServer,
    validateGeneratedQuestions,
    validateRequestBody
} = require('../server');

async function withServer(t, apiKey = '') {
    const previousApiKey = process.env.GEMINI_API_KEY;
    if (apiKey) process.env.GEMINI_API_KEY = apiKey;
    else delete process.env.GEMINI_API_KEY;

    const server = createAppServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    t.after(async () => {
        if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousApiKey;
        const closed = once(server, 'close');
        server.close();
        await closed;
    });

    return { baseUrl };
}

function makeQuestions() {
    return Array.from({ length: 20 }, (_, index) => ({
        question: `Question ${index + 1}`,
        options: ['A', 'B', 'C', 'D'],
        correct: 0,
        explanations: ['Correct', 'Incorrect', 'Incorrect', 'Incorrect']
    }));
}

test('serves the app and rejects unsafe or unknown static paths', async t => {
    const { baseUrl } = await withServer(t);

    const home = await fetch(`${baseUrl}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(await home.text(), /bundled-course-select/);

    const head = await fetch(`${baseUrl}/index.html`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');

    for (const pathname of ['/js/config.js', '/.gitignore', '/missing-file.json']) {
        const response = await fetch(`${baseUrl}${pathname}`);
        assert.equal(response.status, 404, `${pathname} should not be served`);
    }

    const traversal = await fetch(`${baseUrl}/%2e%2e%2fREADME.md`);
    assert.equal(traversal.status, 403);
    const malformedPath = await fetch(`${baseUrl}/%`);
    assert.equal(malformedPath.status, 400);

    const post = await fetch(`${baseUrl}/`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('returns a clear unavailable response when Gemini is not configured', async t => {
    const { baseUrl } = await withServer(t);
    const response = await fetch(`${baseUrl}/api/ai-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorialData: { sections: [{}] }, quizData: [] })
    });

    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Set GEMINI_API_KEY on the server/);
});

test('validates the AI endpoint method, media type, JSON, and payload shape', async t => {
    const { baseUrl } = await withServer(t, 'test-key-not-used-by-validation-tests');

    const get = await fetch(`${baseUrl}/api/ai-quiz`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');

    const wrongMediaType = await fetch(`${baseUrl}/api/ai-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}'
    });
    assert.equal(wrongMediaType.status, 415);

    const invalidJson = await fetch(`${baseUrl}/api/ai-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{'
    });
    assert.equal(invalidJson.status, 400);
    assert.match((await invalidJson.json()).error, /valid JSON/);

    const invalidPayloads = [
        ['[]', /JSON object/],
        ['{"tutorialData":{},"quizData":[]}', /at least one section/],
        ['{"tutorialData":{"sections":[{}]},"quizData":{}}', /quizData must be an array/],
        ['{"tutorialData":{"sections":[]},"quizData":[]}', /at least one section/]
    ];
    for (const [body, expectedMessage] of invalidPayloads) {
        const response = await fetch(`${baseUrl}/api/ai-quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
        });
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, expectedMessage);
    }
});

test('accepts a JSON content type with whitespace and parameters', async t => {
    const { baseUrl } = await withServer(t, 'test-key-not-used-by-content-type-test');
    const response = await fetch(`${baseUrl}/api/ai-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json ; charset=utf-8' },
        body: '{}'
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /at least one section/);
});

test('rejects request bodies larger than 1 MB', async t => {
    const { baseUrl } = await withServer(t, 'test-key-not-used-by-size-test');
    const response = await fetch(`${baseUrl}/api/ai-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tutorialData: { sections: [{}] },
            quizData: [],
            padding: 'x'.repeat(1024 * 1024)
        })
    });

    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /1 MB limit/);
});

test('limits clients to five AI requests per minute', async t => {
    const { baseUrl } = await withServer(t, 'test-key-not-used-by-rate-limit-test');
    const request = () => fetch(`${baseUrl}/api/ai-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorialData: {}, quizData: [] })
    });

    for (let attempt = 0; attempt < 5; attempt++) {
        assert.equal((await request()).status, 400);
    }
    const limited = await request();
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /Try again in a minute/);
});

test('validates request and generated question edge cases', () => {
    for (const body of [null, 1, 'module', []]) {
        assert.throws(() => validateRequestBody(body), HttpError);
    }

    const validBody = { tutorialData: { sections: [{}] }, quizData: [] };
    assert.doesNotThrow(() => validateRequestBody(validBody));
    assert.throws(() => validateRequestBody({ ...validBody, quizData: null }), /quizData must be an array/);

    const validQuestions = makeQuestions();
    assert.equal(validateGeneratedQuestions(validQuestions), validQuestions);
    assert.throws(() => validateGeneratedQuestions(validQuestions.slice(0, 19)), /exactly 20/);

    const mutations = [
        question => { question.question = ''; },
        question => { question.options = ['A', 'B', 'C']; },
        question => { question.options[0] = ''; },
        question => { question.correct = 4; },
        question => { question.correct = 1.5; },
        question => { question.explanations = ['Only one']; },
        question => { question.explanations[0] = ''; }
    ];
    for (const mutate of mutations) {
        const questions = makeQuestions();
        mutate(questions[0]);
        assert.throws(() => validateGeneratedQuestions(questions), HttpError);
    }
});
