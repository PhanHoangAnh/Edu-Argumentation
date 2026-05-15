/**
 * AMO Store: The Single Source of Truth
 * Handles: Loading JSON, Tracking current Topic, and Mastery Scores.
 */
export const Store = {
    state: new Proxy({
        courseTitle: 'Loading...',
        topics: [],
        currentTopic: null,
        currentSubject: null,
        assets: [],
        masteryScore: 0
    }, {
        set(target, property, value) {
            target[property] = value;
            // Notify all listening components that the state changed
            window.dispatchEvent(new CustomEvent('amo-state-changed', { 
                detail: { property, value } 
            }));
            return true;
        }
    }),

    /**
     * Load the tutorial data from the output folder
     */
    async loadTutorial(url = '../output/augmented_tutorial.json') {
        try {
            console.log(`[*] Fetching data from: ${url}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error("Failed to load JSON");
            
            const data = await response.json();
            
            // Update state (this triggers the Proxy 'set' above)
            this.state.courseTitle = data.course_title;
            this.state.topics = data.topics;
            this.state.assets = data.extracted_assets;
            
            // Set default view to the first subject of the first topic
            if (data.topics.length > 0 && data.topics[0].subjects.length > 0) {
                this.state.currentSubject = data.topics[0].subjects[0];
            }

            console.log("[+] Store populated successfully.");
        } catch (error) {
            console.error("[!] Store Error:", error);
        }
    }
};