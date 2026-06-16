// users.js
// User selection, "Together" multi-user mode, and the floating user indicator.
import { state, ALL_USERS, saveUserState } from './state.js';
import { loadCloudPreferences } from './preferences.js';
import { applyTheme } from './theme.js';
import { setHistoryView } from './leaderboard.js';
import { renderTasks, renderPinnedTasks } from './niptoTasks.js';
import { renderTodoTasks, renderSidebarTodos } from './todos.js';
import { renderRoutines, renderSidebarRoutines } from './routines.js';

// Restores the last-used user/together state on startup.
export async function initUsers() {
    populateTogetherCheckboxes();
    const stored = localStorage.getItem("nipto_merged_users");
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed.isTogetherMode) {
                setTogetherState(parsed.users);
            } else if (parsed.users && parsed.users.length === 1) {
                await setActiveUser(parsed.users[0], true);
            } else {
                await setActiveUser(ALL_USERS[0].uid, true);
            }
        } catch (e) { await setActiveUser(ALL_USERS[0].uid, true); }
    } else {
        await setActiveUser(ALL_USERS[0].uid, true);
    }
}

// Switches the dashboard to a single active user.
export async function setActiveUser(uid, skipSave = false) {
    if (state.isEditMode) {
        alert("Please save your dashboard edits before switching users.");
        return;
    }

    state.isTogetherMode = false;
    state.activeUsers = [uid];
    state.currentSplitDivisor = 1;
    document.getElementById('together-drawer').classList.remove('visible');

    ALL_USERS.forEach(user => {
        const el = document.getElementById(`toggle-${user.uid}`);
        if (user.uid === uid) { el.classList.add('active'); el.classList.remove('inactive'); }
        else { el.classList.add('inactive'); el.classList.remove('active'); }
    });

    const togEl = document.getElementById('toggle-together');
    togEl.classList.add('inactive');
    togEl.classList.remove('active');

    await loadCloudPreferences(uid);

    applyTheme(state.userPrefs.theme || 'boring');
    setHistoryView(state.userPrefs.historyView || 'everyone', true);

    if (!skipSave) saveUserState();
    updateFloatingIndicator();
    renderTasks();
    renderPinnedTasks();
    renderTodoTasks();
    renderRoutines();
    renderSidebarRoutines();
    renderSidebarTodos();
}

// Updates the floating avatar/indicator showing who's selected.
export function updateFloatingIndicator() {
    const container = document.getElementById('floating-avatars');
    const indBox = document.getElementById('floating-user-indicator');
    container.innerHTML = '';

    if (state.activeUsers.length === 0) {
        container.innerHTML = '<span class="floating-avatar" style="background: var(--danger);">No one selected!</span>';
        indBox.style.borderColor = 'var(--danger)';
        return;
    }

    let borderColors = [];
    state.activeUsers.forEach(uid => {
        const user = ALL_USERS.find(u => u.uid === uid);
        if (user) {
            borderColors.push(user.color);
            container.innerHTML += `<div class="floating-avatar" style="background: ${user.color};">${user.name}</div>`;
        }
    });

    indBox.style.borderColor = state.isTogetherMode ? 'var(--text-muted)' : borderColors[0];
}

// Enables "Together" mode (points split across selected users).
export function toggleTogetherMode() {
    if (state.isEditMode) {
        alert("You cannot edit the dashboard while in 'Together' mode. Please select a specific person to edit their dashboard.");
        return;
    }

    state.isTogetherMode = true;

    if (state.activeUsers.length <= 1) {
        state.activeUsers = ["NMRQaRQbvCwBaJbiMFId", "RMNUTP8VOHD9PDzNjf0g"];
        updateTogetherCheckboxes();
    }

    ALL_USERS.forEach(user => {
        const el = document.getElementById(`toggle-${user.uid}`);
        el.classList.add('inactive');
        el.classList.remove('active');
    });

    const togEl = document.getElementById('toggle-together');
    togEl.classList.remove('inactive');
    togEl.classList.add('active');

    document.getElementById('together-drawer').classList.add('visible');
    processTogetherSelection(true);
}

// Restores a saved together-mode selection.
function setTogetherState(uids) {
    state.activeUsers = uids;
    updateTogetherCheckboxes();
    toggleTogetherMode();
}

// Builds the together-mode user checkboxes.
function populateTogetherCheckboxes() {
    const container = document.getElementById('together-checkbox-container');
    container.innerHTML = '';
    ALL_USERS.forEach(u => {
        container.innerHTML += `
        <label class="together-label" style="border-left: 4px solid ${u.color};">
        <input type="checkbox" value="${u.uid}" class="t-check" onchange="processTogetherSelection()">
        ${u.name}
        </label>
        `;
    });
}

// Syncs checkbox states to the current together selection.
function updateTogetherCheckboxes() {
    document.querySelectorAll('.t-check').forEach(cb => {
        cb.checked = state.activeUsers.includes(cb.value);
    });
}

// Reads the together checkboxes and updates split/render state.
export function processTogetherSelection(skipSave = false) {
    const checkboxes = document.querySelectorAll('.t-check:checked');
    state.activeUsers = Array.from(checkboxes).map(cb => cb.value);
    state.currentSplitDivisor = Math.max(1, state.activeUsers.length);

    if (!skipSave) saveUserState();
    updateFloatingIndicator();
    renderTasks();
    renderPinnedTasks();
}