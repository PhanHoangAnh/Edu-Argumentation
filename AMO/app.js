// AMO/app.js
import { Store } from './services/Store.js';
import './components/SidebarLayout.js';
import './components/ContentRenderer.js';

async function init() {
    lucide.createIcons();
    document.getElementById('session-guid').textContent = crypto.randomUUID().split('-')[0];
    
    // Load data from the output folder
    await Store.loadTutorial('../output/augmented_tutorial.json');
}

init();