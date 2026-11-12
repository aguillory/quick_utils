// dashboard.js
// App entry point: startup orchestration, Firestore-first data loading,
// tab navigation, real-time listeners, and lock-screen URL action parameter handling.

import { state } from './state.js';
import * as api from './api.js';
import { initChat, onChatTabOpened, sendChatMessage, editChatMessage, deleteChatMessage } from './chat.js';
import {
    savePin, setMode, setTimeOffset, getLocalTodayKey, getLocalWeekBounds, isDateInLocalWeek,
    getAllKnownCategories, registerCustomCategory, renderCategoryCombobox,
    openCategoryCombobox, toggleCategoryComboboxDropdown, filterCategoryCombobox,
    selectCategoryComboboxOption, handleCategoryComboboxKeydown
} from './utils.js';
import { toggleThemeMenu, setTheme, initTheme } from './theme.js';
import {
    updateLeaderboardUI, drawLeaderboard, renderAllowanceUI,
    rebuildCompletedThisWeek, renderDoneThisWeekFeed,
    rebuildCompletedToday, renderDoneTodayFeed,
    changeDoneWeekOffset, resetDoneWeekToCurrent, setDoneTodayView
} from './leaderboard.js';
import {
    deleteTaskActivity, populateTaskPointsSelect,
    renderTasks, openQuickAddModal, closeQuickAddModal, submitQuickAdd,
    toggleEditMode, saveEditMode, toggleViewAllMode, toggleViewAll, moveCategory
} from './niptoTasks.js';
import {
    renderTodoTasks, renderSidebarTodos, openTaskModal, editTask, saveTask,
    closeTaskModal, deleteTask, toggleTaskStatus, addSubTaskField,
    setTodoView, setTodoPersonFilter, setTodoBucketFilter, setTodoFrictionFilter,
    setTodoPriorityFilter, setTodoTypeFilter, setTodoCategoryFilter, setTodoSort,
    setTodoGroupBy, toggleCategoryCollapse, toggleMainSectionCollapse, toggleTaskDescription,
    toggleSubtasksList, clearTaskFriction,
    openStaleRefresherModal, closeStaleRefresherModal, prevStaleCard, nextStaleCard,
    toggleStaleInlineEdit, saveStaleInlineEdit, handleStaleAction, simplifyTaskWithAi
} from './todos.js';
import {
    openRoutineModal, closeRoutineModal, editRoutine, toggleRoutineFrequencyFields,
    saveRoutine, deleteRoutine, deleteRoutineFromModal, renderRoutines, renderRollingSchedule,
    completeRoutineForDate, undoRoutineForDate, setScheduleFilter,
    toggleHideCompletedRoutines, clearAllMissedRoutines, isDailyRoutine
} from './routines.js';
import {
    parseWithGemini, rawLineByLineAdd, renderBrainDumpStaging,
    updateStagingItem, updateStagingRoutineSchedule, deleteStagingItem,
    addSubtaskToStaging, updateStagingSubtask, removeStagingSubtask,
    toggleAllStagingRows, toggleSectionStagingRows,
    clearBrainDumpStaging, commitBrainDumpToFirestore, applyUnifiedStagingToFirestore,
    switchBrainDumpMode, analyzeRambleWithGemini, renderRambleDiffStaging,
    updateRambleRow, updateRambleProp, toggleAllRambleRows, clearRambleStaging,
    applyRambleUpdatesToFirestore,
    renderBulkTriageList, toggleBulkItem, toggleBulkSelectAll, toggleBulkSectionCollapse,
    executeBulkAction, openBulkCategoryModal, confirmBulkCategoryModal,
    switchManageSubtab, filterManageList, updateInlineTaskField, updateRoutineScheduleInline,
    setBulkTypeFilter, setBulkCategoryFilter, setBulkPriorityFilter, setBulkOwnershipFilter,
    setBulkSortBy
} from './braindump.js';
import {
    initUsers, setActiveUser, toggleTogetherMode,
    toggleUserDropdown, selectUserFromDropdown, renderActiveUserPill
} from './users.js';
import {
    openSettingsModal, closeSettingsModal, saveSettingsModal, testGeminiConnection
} from './settings.js';
import { showToast } from './toast.js';

// Firestore listener unsubscribe handles to prevent duplicate subscriptions
let unsubTodos = null;
let unsubRoutines = null;
let unsubDailyComp = null;
let unsubSyncSignal = null;

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

    window.history.replaceState({}, document.title, window.location.pathname);

    if (quickAction === 'complete') {
        const todo = state.todoTasksData?.find(t => t.id === taskId);
        if (todo) {
            await toggleTaskStatus(taskId, false);
            showToast("url_act", `Quick Action: Completed "${todo.name}"!`, todo.points || 0, "Notification");
        } else {
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

// Window bindings for inline HTML onclick/onchange/onfocus handlers
Object.assign(window, {
    switchNavTab,
    setActiveUser, toggleTogetherMode, toggleUserDropdown, selectUserFromDropdown, renderActiveUserPill,
    deleteTaskActivity, populateTaskPointsSelect,
    openQuickAddModal, closeQuickAddModal, submitQuickAdd,
    toggleEditMode, saveEditMode, toggleViewAllMode, toggleViewAll, moveCategory,
    openTaskModal, closeTaskModal, editTask, saveTask, deleteTask, toggleTaskStatus, addSubTaskField,
    renderTodoTasks, renderSidebarTodos,
    setTodoView, setTodoPersonFilter, setTodoBucketFilter, setTodoFrictionFilter, setTodoPriorityFilter,
    setTodoTypeFilter, setTodoCategoryFilter, setTodoSort, setTodoGroupBy, toggleCategoryCollapse, toggleMainSectionCollapse, toggleTaskDescription,
    toggleSubtasksList, clearTaskFriction,
    openStaleRefresherModal, closeStaleRefresherModal, prevStaleCard, nextStaleCard,
    toggleStaleInlineEdit, saveStaleInlineEdit, handleStaleAction, simplifyTaskWithAi,
    openRoutineModal, closeRoutineModal, editRoutine, toggleRoutineFrequencyFields, saveRoutine, deleteRoutine, deleteRoutineFromModal,
    completeRoutineForDate, undoRoutineForDate, setScheduleFilter, toggleHideCompletedRoutines, clearAllMissedRoutines, isDailyRoutine,
    switchBrainDumpMode, parseWithGemini, rawLineByLineAdd, clearBrainDumpStaging, commitBrainDumpToFirestore,
    applyUnifiedStagingToFirestore, toggleSectionStagingRows,
    updateStagingItem, updateStagingRoutineSchedule, deleteStagingItem, addSubtaskToStaging, updateStagingSubtask, removeStagingSubtask, toggleAllStagingRows,
    analyzeRambleWithGemini, renderRambleDiffStaging, updateRambleRow, updateRambleProp,
    toggleAllRambleRows, clearRambleStaging, applyRambleUpdatesToFirestore,
    toggleBulkItem, toggleBulkSelectAll, toggleBulkSectionCollapse, executeBulkAction,
    openBulkCategoryModal, confirmBulkCategoryModal,
    updateInlineTaskField, updateRoutineScheduleInline,
    switchManageSubtab, filterManageList,
    setBulkTypeFilter, setBulkCategoryFilter, setBulkPriorityFilter, setBulkOwnershipFilter, setBulkSortBy,
    openSettingsModal, closeSettingsModal, saveSettingsModal, testGeminiConnection,
    setTheme, toggleThemeMenu, setMode, setTimeOffset, savePin,
    getLocalTodayKey, getLocalWeekBounds, isDateInLocalWeek,
    getAllKnownCategories, registerCustomCategory, renderCategoryCombobox,
    openCategoryCombobox, toggleCategoryComboboxDropdown, filterCategoryCombobox,
    selectCategoryComboboxOption, handleCategoryComboboxKeydown,
    setDoneTodayView, changeDoneWeekOffset, resetDoneWeekToCurrent,
    rebuildCompletedThisWeek, renderDoneThisWeekFeed,
    rebuildCompletedToday, renderDoneTodayFeed,
    sendChatMessage, editChatMessage, deleteChatMessage
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
        await api.loadWeeklyCompletionsFromFirestore(state.doneWeekOffset || 0);
        rebuildCompletedThisWeek();
        renderDoneThisWeekFeed();

        handleUrlQuickActions();
    } catch (e) {
        console.error("Dashboard initialization error:", e);
        const statusText = document.getElementById('status');
        if (statusText) {
            statusText.innerText = `Dashboard initialization error: ${e.message}`;
            statusText.style.color = "var(--danger)";
        }
    }

    // Clean up any prior listeners before attaching new ones
    if (unsubTodos) { unsubTodos(); unsubTodos = null; }
    if (unsubRoutines) { unsubRoutines(); unsubRoutines = null; }
    if (unsubDailyComp) { unsubDailyComp(); unsubDailyComp = null; }
    if (unsubSyncSignal) { unsubSyncSignal(); unsubSyncSignal = null; }

    // Real-time listener for To-Dos in Firestore
    unsubTodos = window.getNiptoCollection('custom_tasks').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        state.todoTasksData = [];
        snapshot.forEach(doc => {
            state.todoTasksData.push({ id: doc.id, ...doc.data() });
        });
        rebuildCompletedThisWeek();
        renderDoneThisWeekFeed();
        renderTodoTasks();
        renderBulkTriageList();
    }, err => {
        console.error("Error in custom_tasks listener:", err);
    });

    // Real-time listener for Routines in Firestore (with schedule auto-healing)
    unsubRoutines = window.getNiptoCollection('routines').onSnapshot(snapshot => {
        state.routines = [];
        snapshot.forEach(doc => {
            state.routines.push(api.normalizeAndHealRoutineDoc({ uid: doc.id, ...doc.data() }));
        });
        rebuildCompletedThisWeek();
        renderDoneThisWeekFeed();
        renderRollingSchedule();
        renderTodoTasks();
        renderBulkTriageList();
    }, err => {
        console.error("Error in routines listener:", err);
    });

    // Real-time listener for today's daily_completions doc (merges with the rest of the current week)
    const todayKey = getLocalTodayKey();
    unsubDailyComp = window.getNiptoCollection('daily_completions').doc(todayKey).onSnapshot(doc => {
        if ((state.doneWeekOffset || 0) === 0) {
            const otherDays = (state.persistedDailyCompletions || []).filter(it => it && it.dateKey !== todayKey);
            let todayItems = [];
            if (doc && doc.exists) {
                const data = doc.data() || {};
                const itemsMap = data.items || {};
                todayItems = Object.values(itemsMap).map(it => ({ ...it, dateKey: it.dateKey || todayKey }));
            }
            state.persistedDailyCompletions = [...todayItems, ...otherDays];
            rebuildCompletedThisWeek();
            renderDoneThisWeekFeed();
        }
    }, err => {
        console.error("Error in daily_completions listener:", err);
    });

    // Real-time listener for cross-device activity sync signal
    let firstActivitySignal = true;
    unsubSyncSignal = window.getNiptoCollection('sync_signals').doc('activity').onSnapshot(snap => {
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
