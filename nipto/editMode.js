// editMode.js
// Edit-dashboard mode (choosing which Nipto tasks show) and the View-All toggle.
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { renderTasks } from './niptoTasks.js';

// Toggles the "view all tasks" mode and re-renders.
export function toggleViewAll() {
    if (state.isEditMode) return;
    state.isViewAllMode = !state.isViewAllMode;
    const btn = document.getElementById('viewAllBtn');
    if (state.isViewAllMode) {
        btn.innerText = "🏠 View My Dashboard";
        btn.style.backgroundColor = "var(--text-muted)";
        btn.style.color = "white";
    } else {
        btn.innerText = "🔍 View All Tasks";
        btn.style.backgroundColor = "";
        btn.style.color = "";
    }
    renderTasks();
}

// Returns the set of task UIDs currently on the active user's dashboard.
function getUserPreferences() {
    const prefs = new Set();
    const targetUid = state.activeUsers[0];
    state.tasks.forEach(t => {
        if (t.dashboardUsers && t.dashboardUsers.includes(targetUid)) prefs.add(t.uid);
    });
    return prefs;
}

// Enters or exits dashboard edit mode, saving changes on exit.
export async function toggleEditMode() {
    if (state.isTogetherMode) {
        alert("Please select a specific person's button before clicking Edit Dashboard.");
        return;
    }

    const btn = document.getElementById('editBtn');
    const floatingBtn = document.getElementById('floating-save-btn');
    const syncBtn = document.getElementById('syncNiptoBtn');
    const statusDiv = document.getElementById('status');
    const viewAllBtn = document.getElementById('viewAllBtn');

    if (!state.isEditMode) {
        state.isEditMode = true;
        btn.innerText = "💾 Save Dashboard";
        btn.classList.add('save-mode');

        floatingBtn.style.display = 'block';
        floatingBtn.innerText = "💾 Save Dashboard";
        floatingBtn.disabled = false;

        if (syncBtn) syncBtn.style.display = 'inline-block';
        viewAllBtn.style.display = 'none';
        statusDiv.innerText = `EDIT MODE: Modifying dashboard for ${ALL_USERS.find(u => u.uid === state.activeUsers[0]).name}`;
        statusDiv.style.color = "var(--primary)";

        state.tempEditPrefs = getUserPreferences();
        state.hasEnteredTaskPin = false;

        if (state.isViewAllMode) toggleViewAll();
        renderTasks();
    } else {
        btn.innerText = "⏳ Saving...";
        btn.disabled = true;
        floatingBtn.innerText = "⏳ Saving...";
        floatingBtn.disabled = true;
        if (syncBtn) syncBtn.disabled = true;

        await savePreferencesToFirestore();

        state.isEditMode = false;
        state.hasEnteredTaskPin = false;
        btn.innerText = "✏️ Edit Dashboard";
        btn.classList.remove('save-mode');
        btn.disabled = false;

        floatingBtn.style.display = 'none';

        if (syncBtn) { syncBtn.style.display = 'none'; syncBtn.disabled = false; }
        viewAllBtn.style.display = 'inline-block';

        statusDiv.innerText = "";
        statusDiv.style.color = "var(--text-main)";
        renderTasks();
    }
}

// Persists dashboard task-visibility changes to Firestore in a batch.
async function savePreferencesToFirestore() {
    const targetUid = state.activeUsers[0];
    let batch = window.db.batch();
    let hasChanges = false;

    state.tasks.forEach(task => {
        const wantsItOnDash = state.tempEditPrefs.has(task.uid);
        const hasItCurrently = task.dashboardUsers && task.dashboardUsers.includes(targetUid);

        if (wantsItOnDash !== hasItCurrently) {
            hasChanges = true;
            let newUsersList = task.dashboardUsers ? [...task.dashboardUsers] : [];
            if (wantsItOnDash) newUsersList.push(targetUid);
            else newUsersList = newUsersList.filter(id => id !== targetUid);

            task.dashboardUsers = newUsersList;
            const docRef = window.db.collection('nipto_tasks').doc(task.uid);
            batch.update(docRef, { dashboardUsers: newUsersList });
        }
    });

    if (hasChanges) {
        try { await batch.commit(); }
        catch (error) { console.error("Error saving preferences:", error); alert("Failed to save dashboard."); }
    }
}