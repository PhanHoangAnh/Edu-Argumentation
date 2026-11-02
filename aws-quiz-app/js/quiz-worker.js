function randomIndex(maxExclusive) {
    if (maxExclusive <= 1) return 0;

    const cryptoApi = self.crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
        return Math.floor(Math.random() * maxExclusive);
    }

    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    const value = new Uint32Array(1);

    do {
        cryptoApi.getRandomValues(value);
    } while (value[0] >= limit);

    return value[0] % maxExclusive;
}

function sampleQuestions(questionBank, requestedCount) {
    const shuffled = questionBank.slice();

    for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = randomIndex(index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled.slice(0, Math.min(requestedCount, shuffled.length));
}

self.onmessage = function(event) {
    const { quizData, count = 20 } = event.data || {};

    if (!Array.isArray(quizData) || quizData.length === 0) {
        self.postMessage({ type: 'error', message: 'The loaded module has no selectable quiz questions.' });
        return;
    }

    const safeCount = Number.isInteger(count) && count > 0 ? count : 20;
    self.postMessage({ type: 'success', data: sampleQuestions(quizData, safeCount) });
};
