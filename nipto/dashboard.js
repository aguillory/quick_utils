// dashboard.js
// App entry point: imports all modules, wires global window handlers for inline
// HTML onclick attributes, defines moveCategory, and runs startup/auth/init.
import { state } from './state.js';
import * as api from './api.js';

import { saveCloudPreference } from './preferences.js';
import { savePin, switchTab, setMode, setTimeOffset, toggleSection, initCollapsibles, toggleHeaderCollapse, updateMiniUserDisplay, initHeaderCollapse } from './utils.js';
import { toggleThemeMenu, setTheme, initTheme } from './theme.js';
import { updateLeaderboardUI, setHistoryView } from './leaderboard.js';
import {
    logPinnedTask, deleteTaskActivity, togglePinTask, populateTaskPointsSelect,
    renderTasks, renderPinnedTasks
} from './niptoTasks.js';
import {
    renderTodoTasks, updateTaskDatalists, openTaskModal, editTask, saveTask,
    closeTaskModal, deleteTask, toggleTaskStatus, renderSidebarTodos, populateTodoAssigneeFilter
} from './todos.js';
import {
    openRoutineModal, closeRoutineModal, editRoutine, toggleRoutineFrequencyFields,
    saveRoutine, updateOverdueDefaults, completeRoutine, deleteRoutine, skipRoutine,
    undoRoutine, renderRoutines, renderAllRoutines, renderMyRoutines,
    renderSidebarRoutines, syncRoutinesWithNiptoHistory
} from './routines.js';
import { toggleViewAll, toggleEditMode } from './editMode.js';
import { initUsers, setActiveUser as _setActiveUser, toggleTogetherMode as _toggleTogetherMode, processTogetherSelection } from './users.js';

function setActiveUser(uid) {
    _setActiveUser(uid);
    updateMiniUserDisplay();
}
function toggleTogetherMode() {
    _toggleTogetherMode();
    updateMiniUserDisplay();
}

// Reorders a task/todo category and saves the new order.
function moveCategory(category, direction, type, event) {
    event.stopPropagation();

    let savedOrder = (type === 'todo') ? (state.userPrefs.todoSortOrder || []) : (state.userPrefs.niptoSortOrder || []);

    // 1. Grab all the categories that are actually visible on the screen right now
    const containerId = type === 'todo' ? 'todoContainer' : 'mainContainer';
    const container = document.getElementById(containerId);
    const currentCategories = Array.from(container.querySelectorAll('.category-header'))
        .map(el => el.childNodes[0].textContent.trim());

    // 2. Make a clone of the saved order so we don't accidentally mutate state directly
    let newOrder = [...savedOrder];
    
    // 3. Ensure any new/missing categories are appended to our working array before we swap
    currentCategories.forEach(cat => {
        if (!newOrder.includes(cat)) {
            newOrder.push(cat);
        }
    });

    // 4. Now perform the swap safely
    const idx = newOrder.indexOf(category);
    if (idx === -1) return;
    
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= newOrder.length) return;

    [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];

    // 5. Save and Re-render
    if (type === 'todo') {
        saveCloudPreference('todoSortOrder', newOrder);
        renderTodoTasks();
    } else {
        saveCloudPreference('niptoSortOrder', newOrder);
        renderTasks();
    }
}

// ---- Window bindings for inline HTML onclick handlers ----
Object.assign(window, {
    setActiveUser, toggleTogetherMode, processTogetherSelection,
    toggleViewAll, toggleEditMode,
    deleteTaskActivity, togglePinTask, logPinnedTask, populateTaskPointsSelect,
    openTaskModal, closeTaskModal, editTask, saveTask, deleteTask, toggleTaskStatus,
    renderTodoTasks, updateTaskDatalists, renderSidebarTodos,
    savePin, switchTab, setMode, setTimeOffset, setHistoryView,
    toggleSection, toggleThemeMenu, setTheme, toggleHeaderCollapse,
    openRoutineModal, closeRoutineModal, toggleRoutineFrequencyFields, saveRoutine,
    editRoutine, completeRoutine, deleteRoutine, skipRoutine, updateOverdueDefaults,
    renderRoutines, renderSidebarRoutines, undoRoutine, renderAllRoutines, renderMyRoutines,
    moveCategory
});

// ---- HTML button bridges ----
window.submitPin = async () => {
    savePin();
    await api.loadTasksFromFirestore();
    renderTasks();
    renderPinnedTasks();
    updateLeaderboardUI();
};

window.runSync = async () => {
    await api.syncNiptoTasks();
    await api.loadTasksFromFirestore();
    renderTasks();
    renderPinnedTasks();
};

window.refreshDashboard = async () => {
    const btn = document.getElementById('refreshBtn');
    if (btn) { btn.innerText = "⏳ Syncing..."; btn.disabled = true; }

    try {
        await api.loadTasksFromFirestore();
        await api.loadChoresFromFirestore();
        await api.loadRoutinesFromFirestore();
        await updateLeaderboardUI();

        renderTasks();
        renderPinnedTasks();
        renderRoutines();
        renderSidebarRoutines();
        renderTodoTasks();
        renderSidebarTodos();
    } catch (e) {
        console.error("Refresh failed:", e);
    }

    if (btn) { btn.innerText = "🔄 Refresh"; btn.disabled = false; }
};

// ---- Startup ----
initTheme();
initUsers();
initHeaderCollapse();
updateMiniUserDisplay();
populateTodoAssigneeFilter();
initCollapsibles([
    { content: 'activity-content', icon: 'activity-icon', key: 'nipto_merged_act_collapsed' },
    { content: 'pinned-content', icon: 'pin-icon', key: 'nipto_merged_pin_collapsed' },
    { content: 'assigned-content', icon: 'assign-icon', key: 'nipto_merged_assign_collapsed' }
]);

api.checkAuth(
    async () => {
        await api.loadTasksFromFirestore();
        await api.loadChoresFromFirestore();
        await api.loadRoutinesFromFirestore();
        await api.loadActivityLabelsFromFirestore();
        renderTasks();
        renderPinnedTasks();
        renderRoutines();
        renderSidebarRoutines();
        updateLeaderboardUI();

        window.db.collection('custom_tasks').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
            state.todoTasksData = [];
            const now = Date.now();
            const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.completed && data.completedAt) {
                    const completedTime = new Date(data.completedAt).getTime();
                    if (now - completedTime > TWO_DAYS_MS) {
                        api.deleteFirestoreDocument('custom_tasks', doc.id);
                        return;
                    }
                }
                state.todoTasksData.push({ id: doc.id, ...data });
            });
            renderTodoTasks();
            renderSidebarTodos();
        });
    },
    () => { document.getElementById('pinModal').style.display = 'flex'; },
    (error) => { console.error("Database Auth Failed."); }
);