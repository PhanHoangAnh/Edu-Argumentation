// AMO/services/Store.js
export const Store = {
    state: new Proxy({
        courseTitle: '',
        topics: [],
        currentSubject: null,
        assets: []
    }, {
        set(target, property, value) {
            target[property] = value;
            window.dispatchEvent(new CustomEvent('amo-state-changed', { 
                detail: { property, value } 
            }));
            return true;
        }
    }),

    async loadTutorial(url) {
        const response = await fetch(url);
        const data = await response.json();
        this.state.courseTitle = data.course_title;
        this.state.topics = data.topics;
        this.state.assets = data.extracted_assets;
        
        // Auto-select first subject
        if(data.topics[0]?.subjects[0]) {
            this.state.currentSubject = data.topics[0].subjects[0];
        }
    }
};