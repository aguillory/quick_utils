// dashboard.js
// App entry point: imports all modules, wires global window handlers for inline
// HTML onclick attributes, defines moveCategory, and runs startup/auth/init.
import { state } from './state.js';
import * as api from './api.js';
import { initChat, onChatTabOpened, refreshChatUser, sendChatMessage, editChatMessage, deleteChatMessage } from './chat.js';
import { saveCloudPreference } from './preferences.js';
import { savePin, switchTab, setMode, setTimeOffset, toggleSection, initCollapsibles, toggleHeaderCollapse, updateMiniUserDisplay, initHeaderCollapse } from './utils.js';
import { toggleThemeMenu, setTheme, initTheme } from './theme.js';
import { updateLeaderboardUI, setHistoryView } from './leaderboard.js';
import {
    logPinnedTask, deleteTaskActivity, togglePinTask, populateTaskPointsSelect,
    renderTasks, renderPinnedTasks,
    openQuickAddModal, closeQuickAddModal, submitQuickAdd
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
    refreshChatUser();
}
function toggleTogetherMode() {
    _toggleTogetherMode();
    updateMiniUserDisplay();
    refreshChatUser();
}
// NEW: chat needs to know when its tab opens (to clear unreads)
function switchTabWithChat(tab) {
    switchTab(tab);
    if (tab === 'messages') onChatTabOpened();
}
// NEW: together checkbox changes also affect chat (send lock / alignment)
function processTogetherSelectionWithChat(...args) {
    const result = processTogetherSelection(...args);
    refreshChatUser();
    return result;
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
    setActiveUser, toggleTogetherMode, processTogetherSelection: processTogetherSelectionWithChat,
    toggleViewAll, toggleEditMode,
    deleteTaskActivity, togglePinTask, logPinnedTask, populateTaskPointsSelect,
    openQuickAddModal, closeQuickAddModal, submitQuickAdd,
    openTaskModal, closeTaskModal, editTask, saveTask, deleteTask, toggleTaskStatus,
    renderTodoTasks, updateTaskDatalists, renderSidebarTodos,
    savePin, switchTab: switchTabWithChat, setMode, setTimeOffset, setHistoryView,
    toggleSection, toggleThemeMenu, setTheme, toggleHeaderCollapse,
    openRoutineModal, closeRoutineModal, toggleRoutineFrequencyFields, saveRoutine,
    editRoutine, completeRoutine, deleteRoutine, skipRoutine, updateOverdueDefaults,
    renderRoutines, renderSidebarRoutines, undoRoutine, renderAllRoutines, renderMyRoutines,
    moveCategory, sendChatMessage, editChatMessage, deleteChatMessage
});

// ---- HTML button bridges ----
window.submitPin = async () => {
    savePin();
    await startDashboardData(); // Call the unified loader
};

window.runSync = async () => {
    await api.syncNiptoTasks();
    await api.loadTasksFromFirestore();
    renderTasks();
    renderPinnedTasks();
};

window.refreshDashboard = async () => {
    const btn = document.getElementById('refreshBtn');
    const statusText = document.getElementById('status');
    if (btn) { btn.innerText = "⏳ Syncing..."; btn.disabled = true; }

    try {
        await Promise.all([
            api.loadTasksFromFirestore(),
            api.loadRoutinesFromFirestore(),
            api.loadUsersFromFirestore()
        ]);
        await updateLeaderboardUI();

        renderTasks();
        renderPinnedTasks();
        renderRoutines();
        renderSidebarRoutines();
        renderTodoTasks();
        renderSidebarTodos();
        if (statusText) statusText.innerText = "";
    } catch (e) {
        console.error("Refresh failed:", e);
        if (statusText) {
            statusText.innerText = `Dashboard refresh failed: ${e.message}`;
            statusText.style.color = "var(--danger, #cf6679)";
        } else {
            alert(`Dashboard refresh failed: ${e.message}`);
        }
    }

    if (btn) { btn.innerText = "🔄 Refresh"; btn.disabled = false; }
};

// ---- Startup ----
initTheme();
initHeaderCollapse();
initChat();
updateMiniUserDisplay();
populateTodoAssigneeFilter();
initCollapsibles([
    { content: 'activity-content', icon: 'activity-icon', key: 'nipto_merged_act_collapsed' },
    { content: 'pinned-content', icon: 'pin-icon', key: 'nipto_merged_pin_collapsed' },
    { content: 'assigned-content', icon: 'assign-icon', key: 'nipto_merged_assign_collapsed' }
]);
// Extract all the data loading logic into one reusable function
async function startDashboardData() {
    try {
        await api.loadUsersFromFirestore();
        await Promise.all([
            api.loadTasksFromFirestore(),
            api.loadRoutinesFromFirestore(),
            api.loadActivityLabelsFromFirestore()
        ]);
        
        await initUsers();
        
        renderTasks();
        renderPinnedTasks();
        renderRoutines();
        renderSidebarRoutines();
        updateLeaderboardUI();
    } catch (e) {
        console.error("Dashboard initialization failed:", e);
        const statusText = document.getElementById('status');
        if (statusText) {
            statusText.innerText = `Dashboard initialization failed: ${e.message}`;
            statusText.style.color = "var(--danger, #cf6679)";
            statusText.style.display = "block";
        }
    }

    window.getNiptoCollection('custom_tasks').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
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
    
    let firstActivitySignal = true;
    let activitySignalTimer = null;
    window.getNiptoCollection('sync_signals').doc('activity').onSnapshot(snap => {
        if (firstActivitySignal) { firstActivitySignal = false; return; } 
        if (snap.metadata.hasPendingWrites) return; 
        if (window.__localActivityPingAt && (Date.now() - window.__localActivityPingAt < 5000)) return; 
        clearTimeout(activitySignalTimer);
        activitySignalTimer = setTimeout(() => updateLeaderboardUI(), 1500); 
    });
}

// Run auth check and trigger the unified loader
api.checkAuth(
    async () => {
        await startDashboardData();
    },
    () => { document.getElementById('pinModal').style.display = 'flex'; },
    (error) => { console.error("Database Auth Failed."); }
);
