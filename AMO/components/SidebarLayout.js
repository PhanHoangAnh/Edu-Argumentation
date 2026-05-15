// AMO/components/SidebarLayout.js
import { Store } from '../services/Store.js';

class SidebarLayout extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    async connectedCallback() {
        const res = await fetch('./templates/SidebarLayout.html');
        this.shadowRoot.innerHTML = await res.text();
        
        // Listen for Store changes
        window.addEventListener('amo-state-changed', (e) => {
            if (property === 'topics') this.renderTOC(e.detail.value);
            if (property === 'currentSubject') this.highlightActive(e.detail.value);
        });

        // Initialize Content Renderer inside the layout
        this.renderVisuals(Store.state.currentSubject?.learning_figures || []);
    }

    renderTOC(topics) {
        const list = this.shadowRoot.getElementById('chapter-list');
        list.innerHTML = topics.map(t => `
            <div class="mb-4">
                <h3 class="text-xs font-bold text-slate-400 uppercase p-2">${t.topic_name}</h3>
                ${t.subjects.map(s => `
                    <button class="w-full text-left p-2 text-sm rounded hover:bg-slate-100 transition" 
                            onclick="window.dispatchSubject('${s.subject_title}')">
                        ${s.subject_title}
                    </button>
                `).join('')}
            </div>
        `).join('');
    }
}
customElements.define('sidebar-layout', SidebarLayout);