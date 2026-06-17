// utils.js
// Generic helpers: PIN auth, date/time mode controls, tab switching, collapsible sections.
import { state } from './state.js';

// Reconstructs the API key from a 4-digit PIN.
function decodeKey(pin) {
    const masked = "$a#0$*fa-*a07-%%f%-a%*%-f*c8$9c*%8*8";
    const p1 = pin[0], p2 = pin[1], p3 = pin[2], p4 = pin[3];
    return masked.replace(/\*/g, p1).replace(/#/g, p2).replace(/\$/g, p3).replace(/%/g, p4);
}

// Validates and stores the API token from the PIN modal.
export function savePin(onSuccessCallback) {
    const pin = document.getElementById('pinInput').value;
    if (pin.length !== 4) {
        document.getElementById('pinError').style.display = 'block';
        return;
    }
    state.apiToken = decodeKey(pin);
    localStorage.setItem("nipto_api_token", state.apiToken);
    document.getElementById('pinModal').style.display = 'none';
    if (onSuccessCallback) onSuccessCallback();
}

// Switches the visible main tab (nipto / routines / todo).
export function switchTab(tabName) {
    ['nipto', 'routines', 'todo'].forEach(t => {
        const tabBtn = document.getElementById(`tab-${t}`);
        if (tabBtn) {
            tabBtn.style.backgroundColor = 'var(--card-bg)';
            tabBtn.style.color = 'var(--text-main)';
            tabBtn.classList.remove('active');
        }
        const pane = document.getElementById(`pane-${t}`);
        if (pane) pane.style.display = 'none';
    });

    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) {
        activeBtn.style.backgroundColor = 'var(--primary)';
        activeBtn.style.color = 'white';
        activeBtn.classList.add('active');
    }
    const activePane = document.getElementById(`pane-${tabName}`);
    if (activePane) activePane.style.display = 'block';
}

// Formats a Date for a datetime-local input.
function formatForInput(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const h = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
}

// Switches between live-time and custom-time logging modes.
export function setMode(mode) {
    if (state.isEditMode) return;
    state.currentMode = mode;
    if (mode === 'live') {
        document.getElementById('btnLive').classList.add('active');
        document.getElementById('btnCustom').classList.remove('active');
        document.getElementById('customTimeBox').classList.remove('visible');
    } else {
        document.getElementById('btnCustom').classList.add('active');
        document.getElementById('btnLive').classList.remove('active');
        document.getElementById('customTimeBox').classList.add('visible');
        const dateInput = document.getElementById('taskDate');
        if (!dateInput.value) dateInput.value = formatForInput(new Date());
    }
}

// Nudges the custom log time by a number of minutes.
export function setTimeOffset(minutes) {
    if (state.currentMode === 'live') setMode('custom');
    const dateInput = document.getElementById('taskDate');
    let targetDate = dateInput.value ? new Date(dateInput.value) : new Date();
    targetDate.setMinutes(targetDate.getMinutes() + minutes);
    dateInput.value = formatForInput(targetDate);
}

// Toggles a collapsible section and remembers its state in localStorage.
export function toggleSection(contentId, iconId, storageKey) {
    const content = document.getElementById(contentId);
    const icon = document.getElementById(iconId);
    if (!content || !icon) return;
    const isCollapsed = content.classList.toggle('collapsed');
    icon.classList.toggle('collapsed', isCollapsed);
    if (storageKey) localStorage.setItem(storageKey, isCollapsed);
}

// Restores collapsed states for a set of sections on load.
export function initCollapsibles(sectionsArray) {
    sectionsArray.forEach(sec => {
        if (localStorage.getItem(sec.key) === 'true') {
            const content = document.getElementById(sec.content);
            const icon = document.getElementById(sec.icon);
            if (content) content.classList.add('collapsed');
            if (icon) icon.classList.add('collapsed');
        }
    });
}