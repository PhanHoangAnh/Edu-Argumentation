self.onmessage = async function(e) {
    const { tutorialData, quizData } = e.data;

    try {
        self.postMessage({ type: 'progress', message: 'Architecting 20 advanced scenario-based questions...' });

        const response = await fetch('/api/ai-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tutorialData, quizData: quizData || [] })
        });
        if (!response.headers.get('content-type')?.includes('application/json')) {
            throw new Error('AI quiz endpoint is unavailable. Start the app with `node server.js`.');
        }
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || `AI request failed with status ${response.status}.`);
        }

        self.postMessage({ type: 'success', data: payload });
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};
