// dashboard.js
// App entry point: startup orchestration, Firestore-first data loading,
// tab navigation, and lock-screen URL action parameter handling.

import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { initChat, onChatTabOpened, refreshChatUser, sendChatMessage, editChatMessage, deleteChatMessage } from './chat.js';
import { saveCloudPreference } from './preferences.js';
import { savePin, setMode, setTimeOffset, getLocalTodayKey } from './utils.js';
import { toggleThemeMenu, setTheme, initTheme } from './theme.js';
import { updateLeaderboardUI, drawLeaderboard, renderAllowanceUI, rebuildCompletedToday, renderDoneTodayFeed } from './leaderboard.js';
import {
    deleteTaskActivity, populateTaskPointsSelect,
    renderTasks, openQuickAddModal, closeQuickAddModal, submitQuickAdd
} from './niptoTasks.js';
import {
    renderTodoTasks, openTaskModal, editTask, saveTask,
    closeTaskModal, deleteTask, toggleTaskStatus, addSubTaskField,
    setTodoView, setTodoPersonFilter, setTodoBucketFilter, setTodoFrictionFilter,
    setTodoPriorityFilter, toggleSubtasksList, clearTaskFriction
} from './todos.js';
import {
    openRoutineModal, closeRoutineModal, editRoutine, toggleRoutineFrequencyFields,
    saveRoutine, deleteRoutine, deleteRoutineFromModal, renderRoutines, renderRollingSchedule,
    completeRoutineForDate, undoRoutineForDate, setScheduleFilter,
    toggleHideCompletedRoutines, clearAllMissedRoutines, isDailyRoutine
} from './routines.js';
import {
    parseWithGemini, rawLineByLineAdd, renderBrainDumpStaging,
    updateStagingItem, deleteStagingItem, toggleAllStagingRows,
    clearBrainDumpStaging, commitBrainDumpToFirestore,
    renderBulkTriageList, toggleBulkItem, toggleBulkSelectAll, executeBulkAction,
    switchManageSubtab, filterManageList
} from './braindump.js';
import {
    initUsers, setActiveUser, toggleTogetherMode,
    toggleUserDropdown, selectUserFromDropdown, renderActiveUserPill
} from './users.js';
import {
    openSettingsModal, closeSettingsModal, saveSettingsModal, testGeminiConnection
} from './settings.js';
import { showToast } from './toast.js';

// ==========================================
// NAVIGATION TAB SWITCHER
// ==========================================
export function switchNavTab(tabName) {
    const tabs = ['schedule-todos', 'braindump', 'nipto', 'hub'];
    
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const pane = document.getElementById(`pane-${t}`);
        if (btn) {
            if (t === tabName) btn.classList.add('active');
            else btn.classList.remove('active');
        }
        if (pane) {
            if (t === tabName) pane.style.display = 'block';
            else pane.style.display = 'none';
        }
    });

    const sidebar = document.getElementById('householdHubSidebar');
    if (sidebar) {
        if (tabName === 'hub') {
            sidebar.classList.add('mobile-active-pane');
        } else {
            sidebar.classList.remove('mobile-active-pane');
        }
    }

    if (tabName === 'schedule-todos') {
        renderRollingSchedule();
        renderTodoTasks();
    } else if (tabName === 'braindump') {
        renderBrainDumpStaging();
        renderBulkTriageList();
    } else if (tabName === 'nipto') {
        renderTasks();
    } else if (tabName === 'hub') {
        onChatTabOpened();
        updateLeaderboardUI();
    }
}

// ==========================================
// ACTIONABLE LOCK-SCREEN URL ACTIONS
// ==========================================
async function handleUrlQuickActions() {
    const params = new URLSearchParams(window.location.search);
    const quickAction = params.get('quickAction');
    const taskId = params.get('taskId');

    if (!quickAction || !taskId) return;

    // Clean URL so refresh does not re-trigger
    window.history.replaceState({}, document.title, window.location.pathname);

    if (quickAction === 'complete') {
        // Check if taskId matches a To-Do
        const todo = state.todoTasksData?.find(t => t.id === taskId);
        if (todo) {
            await toggleTaskStatus(taskId, false);
            showToast("url_act", `Quick Action: Completed "${todo.name}"!`, todo.points || 0, "Notification");
        } else {
            // Check if taskId matches a Routine
            const routine = state.routines?.find(r => r.uid === taskId);
            if (routine) {
                const todayKey = getLocalTodayKey();
                await completeRoutineForDate(taskId, todayKey, true);
                showToast("url_act", `Quick Action: Completed routine "${routine.name}"!`, 0, "Notification");
            }
        }
    } else if (quickAction === 'snooze') {
        showToast("url_snooze", "Notification snoozed for 1 hour.", 0, "");
    }
}

// Window bindings for inline HTML onclick handlers
Object.assign(window, {
    switchNavTab,
    setActiveUser, toggleTogetherMode, toggleUserDropdown, selectUserFromDropdown,
    deleteTaskActivity, populateTaskPointsSelect,
    openQuickAddModal, closeQuickAddModal, submitQuickAdd,
    openTaskModal, closeTaskModal, editTask, saveTask, deleteTask, toggleTaskStatus, addSubTaskField,
    setTodoView, setTodoPersonFilter, setTodoBucketFilter, setTodoFrictionFilter, setTodoPriorityFilter, toggleSubtasksList, clearTaskFriction,
    openRoutineModal, closeRoutineModal, editRoutine, toggleRoutineFrequencyFields, saveRoutine, deleteRoutine, deleteRoutineFromModal,
    completeRoutineForDate, undoRoutineForDate, setScheduleFilter, toggleHideCompletedRoutines, clearAllMissedRoutines, isDailyRoutine,
    parseWithGemini, rawLineByLineAdd, clearBrainDumpStaging, commitBrainDumpToFirestore,
    updateStagingItem, deleteStagingItem, toggleAllStagingRows,
    toggleBulkItem, toggleBulkSelectAll, executeBulkAction,
    switchManageSubtab, filterManageList,
    openSettingsModal, closeSettingsModal, saveSettingsModal, testGeminiConnection,
    setTheme, toggleThemeMenu, setMode, setTimeOffset, savePin, getLocalTodayKey,
    rebuildCompletedToday, renderDoneTodayFeed
});

window.submitPin = async () => {
    savePin();
    await startDashboardData();
};

window.runSync = async () => {
    const statusText = document.getElementById('status');
    if (statusText) statusText.innerText = "Syncing with Nipto...";
    await api.syncNiptoTasks();
    await api.loadTasksFromFirestore();
    renderTasks();
    if (statusText) statusText.innerText = "";
    showToast("sync_ok", "Nipto tasks synchronized successfully!", 0, "");
};

// ==========================================
// FIRESTORE-FIRST STARTUP ORCHESTRATION
// ==========================================
async function startDashboardData() {
    try {
        await api.loadUsersFromFirestore();
        await Promise.all([
            api.loadTasksFromFirestore(),
            api.loadRoutinesFromFirestore(),
            api.loadTodosFromFirestore(),
            api.loadActivityLabelsFromFirestore(),
            api.loadAllowanceLedgerFromFirestore(),
            api.loadIntegrationsConfigFromFirestore(),
            api.loadNotificationPreferencesFromFirestore(),
            api.loadWeeklyPointsFromFirestore()
        ]);

        await initUsers();
        renderRollingSchedule();
        renderTodoTasks();
        renderTasks();
        renderAllowanceUI();
        updateLeaderboardUI();
        await api.loadDailyCompletionsFromFirestore();
        rebuildCompletedToday();
        renderDoneTodayFeed();

        // Check for URL lockscreen quick actions
        handleUrlQuickActions();
    } catch (e) {
        console.error("Dashboard initialization error:", e);
        const statusText = document.getElementById('status');
        if (statusText) {
            statusText.innerText = `Dashboard initialization error: ${e.message}`;
            statusText.style.color = "var(--danger)";
        }
    }

    // Real-time listener for To-Dos in Firestore
    window.getNiptoCollection('custom_tasks').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        state.todoTasksData = [];
        snapshot.forEach(doc => {
            state.todoTasksData.push({ id: doc.id, ...doc.data() });
        });
        rebuildCompletedToday();
        renderDoneTodayFeed();
        renderTodoTasks();
        renderBulkTriageList();
    });

    // Real-time listener for daily completions across devices (single doc for today)
    const todayKey = getLocalTodayKey();
    window.getNiptoCollection('daily_completions').doc(todayKey).onSnapshot(doc => {
        if (doc && doc.exists) {
            const data = doc.data() || {};
            const itemsMap = data.items || {};
            state.persistedDailyCompletions = Object.values(itemsMap);
        } else {
            state.persistedDailyCompletions = [];
        }
        rebuildCompletedToday();
        renderDoneTodayFeed();
    }, err => {
        console.error("Error in daily_completions listener:", err);
    });

    // Real-time listener for sync signal
    let firstActivitySignal = true;
    window.getNiptoCollection('sync_signals').doc('activity').onSnapshot(snap => {
        if (firstActivitySignal) { firstActivitySignal = false; return; }
        if (snap.metadata.hasPendingWrites) return;
        if (window.__localActivityPingAt && (Date.now() - window.__localActivityPingAt < 5000)) return;
        updateLeaderboardUI();
    });
}

// Startup execution
initTheme();
initChat();

api.checkAuth(
    async () => { await startDashboardData(); },
    () => { document.getElementById('pinModal').style.display = 'flex'; },
    (err) => { console.error("Database Auth Failed:", err); }
);
