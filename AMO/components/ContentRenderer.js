import { Store } from '../services/Store.js';

class ContentRenderer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    async connectedCallback() {
        // Load Template
        const templateReq = await fetch('./templates/ContentRenderer.html');
        const templateHtml = await templateReq.text();
        
        const sheet = new CSSStyleSheet();
        await sheet.replace(`@import url('https://cdn.tailwindcss.com');`);
        this.shadowRoot.adoptedStyleSheets = [sheet];

        this.shadowRoot.innerHTML = templateHtml;

        // Listen for the "Brain" to tell us the subject changed
        window.addEventListener('amo-state-changed', (e) => {
            if (e.detail.property === 'currentSubject') {
                this.renderContent(e.detail.value);
            }
        });
    }

    renderContent(subject) {
        const viewer = this.shadowRoot.getElementById('markdown-viewer');
        const title = this.shadowRoot.getElementById('subject-title');
        
        if (!subject) return;

        // 1. Set Title
        title.textContent = subject.subject_title;

        // 2. Render Markdown using Marked.js (Global library)
        // We use marked.parse because it's loaded in index.html
        viewer.innerHTML = marked.parse(subject.comprehensive_analysis_md);

        // 3. Render Math using KaTeX (Global library)
        // This scans the shadow DOM specifically for math markers
        if (window.renderMathInElement) {
            renderMathInElement(viewer, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '\\(', right: '\\)', display: false}
                ],
                throwOnError : false
            });
        }

        // 4. Update Visuals Sidebar (Emit event for SidebarLayout to catch)
        window.dispatchEvent(new CustomEvent('amo-update-visuals', { 
            detail: { figures: subject.learning_figures } 
        }));
    }
}

customElements.define('content-renderer', ContentRenderer);