// theme.js
// Multi-theme switching (CSS swap) and the theme picker menu.
import { state } from './state.js';
import { saveCloudPreference } from './preferences.js';

const THEMES = {
    'boring': null,
    'pixel': 'minecraft.css',
    'tactical': 'blackops.css',
    'homestead': 'homestead.css'
};

let currentTheme = localStorage.getItem('nipto_theme') || 'boring';
if (currentTheme === 'fun') currentTheme = 'pixel';

// Applies the saved theme on startup.
export function initTheme() { applyTheme(currentTheme); }

// Shows/hides the theme picker menu.
export function toggleThemeMenu() {
    const menu = document.getElementById('themeMenu');
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
}

// Saves and applies the chosen theme for the active user.
export function setTheme(themeId) {
    const activeUid = state.activeUsers[0];
    if (state.isTogetherMode || !activeUid) {
        alert("Please select a specific person first to save their theme preference.");
        return;
    }
    saveCloudPreference('theme', themeId);
    applyTheme(themeId);
    document.getElementById('themeMenu').style.display = 'none';
}

// Swaps the active theme stylesheet and highlights the active option.
export function applyTheme(themeId) {
    let link = document.getElementById('dynamic-theme-css');
    if (link) link.remove();

    if (THEMES[themeId]) {
        link = document.createElement('link');
        link.id = 'dynamic-theme-css';
        link.rel = 'stylesheet';
        link.href = THEMES[themeId];
        document.head.appendChild(link);
    }

    document.querySelectorAll('.theme-option').forEach(btn => btn.classList.remove('active-theme'));
    const activeBtn = document.getElementById(`theme-opt-${themeId}`);
    if (activeBtn) activeBtn.classList.add('active-theme');
}

// Close the theme menu when clicking outside it.
document.addEventListener('click', function (event) {
    const container = document.querySelector('.theme-selector-container');
    const menu = document.getElementById('themeMenu');
    if (container && !container.contains(event.target) && menu) {
        menu.style.display = 'none';
    }
});