// AMO/components/SidebarLayout.js
import { Store } from '../services/Store.js';

class SidebarLayout extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    async connectedCallback() {
        // 1. Load Template and CSS
        const templateReq = await fetch('./templates/SidebarLayout.html');
        const templateHtml = await templateReq.text();
        
        const sheet = new CSSStyleSheet();
        // Inject Tailwind via @import so it works inside Shadow DOM
        await sheet.replace(`@import url('https://cdn.tailwindcss.com');`);
        this.shadowRoot.adoptedStyleSheets = [sheet];

        this.shadowRoot.innerHTML = templateHtml;

        // 2. Listen for Store Updates
        window.addEventListener('amo-state-changed', (e) => {
            if (e.detail.property === 'topics') this.renderTOC(e.detail.value);
            if (e.detail.property === 'courseTitle') this.updateTitle(e.detail.value);
        });
    }

    updateTitle(title) {
        // Update the header outside the shadow DOM if needed, 
        // or just handle internal title changes here.
        const headerTitle = document.getElementById('course-title');
        if (headerTitle) headerTitle.textContent = title;
    }

    renderTOC(topics) {
        const container = this.shadowRoot.getElementById('chapter-list');
        container.innerHTML = ''; // Clear loader

        topics.forEach((topic, tIdx) => {
            // Create Chapter Header
            const chapterEl = document.createElement('div');
            chapterEl.className = "mb-4";
            chapterEl.innerHTML = `<h3 class="text-sm font-bold text-slate-700 px-2 py-1">${topic.topic_name}</h3>`;
            
            // Create Subject Links
            const subjectList = document.createElement('ul');
            subjectList.className = "mt-1 space-y-1";
            
            topic.subjects.forEach((subject, sIdx) => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <button class="w-full text-left px-3 py-2 text-sm rounded-md transition-colors hover:bg-blue-50 hover:text-blue-600 text-slate-600">
                        ${subject.subject_title}
                    </button>
                `;
                li.querySelector('button').onclick = () => {
                    // Update the global state
                    Store.state.currentSubject = subject;
                };
                subjectList.appendChild(li);
            });

            chapterEl.appendChild(subjectList);
            container.appendChild(chapterEl);
        });
    }
}

customElements.define('sidebar-layout', SidebarLayout);