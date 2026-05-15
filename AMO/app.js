// AMO/app.js
import { Store } from './services/Store.js';

// Import Web Components so the browser registers them
import './components/SidebarLayout.js';
import './components/ContentRenderer.js';
import './components/MasteryTutor.js';

/**
 * Main Application Entry Point
 */
async function initApp() {
    console.log("[*] AMO Orchestrator: Initializing components...");

    // 1. Load the Tutorial Data
    // This looks one level up into the /output/ folder for your JSON
    await Store.loadTutorial('../output/augmented_tutorial.json');

    // 2. Metadata Updates
    const sessionGuid = crypto.randomUUID().split('-')[0];
    const guidElement = document.getElementById('session-guid');
    if (guidElement) guidElement.textContent = sessionGuid;

    console.log("[+] AMO Orchestrator: System Ready.");
}

// Boot the app
initApp();