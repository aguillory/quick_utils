// dashboard.js
// App entry point: startup orchestration, Firestore-first data loading,
// tab navigation, real-time listeners, and lock-screen URL action parameter handling.

import { state } from './state.js';
import * as api from './api.js';
import { initChat, onChatTabOpened, sendChatMessage, editChatMessage, deleteChatMessage } from './chat.js';
import {
    savePin, setMode, setTimeOffset, getLocalTodayKey, getLocalWeekBounds, isDateInLocalWeek,
    toMillisSafe, isCompletedTodoExpired,
    loadCustomCategoriesFromFirestore, loadCategoryConfigFromFirestore, saveCategoryConfigToFirestore,
    isCategoryVisibleForTasks, getEligibleTaskCategories,
    getAllKnownCategories, registerCustomCategory, renderCategoryCombobox,
    openCategoryCombobox, toggleCategoryComboboxDropdown, clearCategoryComboboxInput,
    filterCategoryCombobox, selectCategoryComboboxOption, handleCategoryComboboxKeydown
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
    setTodoGroupBy, resetTodoFilters, classifyTaskOwnership, normalizeTask, expandCategoryOnReactivation, moveTodoCategory, toggleCategoryCollapse, toggleMainSectionCollapse, toggleTaskDescription,
    toggleSubtasksList, clearTaskFriction,
    openStaleRefresherModal, closeStaleRefresherModal, prevStaleCard, nextStaleCard,
    toggleStaleInlineEdit, saveStaleInlineEdit, handleStaleAction, simplifyTaskWithAi
} from './todos.js';
import {
    openRoutineModal, closeRoutineModal, editRoutine, toggleRoutineFrequencyFields,
    saveRoutine, deleteRoutine, deleteRoutineFromModal, renderRoutines, renderRollingSchedule,
    completeRoutineForDate, undoRoutineForDate, clearCascadedRoutineCompletion, getRoutineCompletionForDate, setScheduleFilter,
    toggleHideCompletedRoutines, clearAllMissedRoutines, isDailyRoutine,
    normalizeChoreTitle, findMatchingRoutineForChore, populateRoutineLinkedNiptoTaskSelect
} from './routines.js';
import {
    refreshBrainDumpUser, insertBrainDumpHint,
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
    setBulkSortBy, toggleBulkShowArchivedDone
} from './braindump.js';
import {
    initUsers, setActiveUser, toggleTogetherMode,
    toggleUserDropdown, selectUserFromDropdown, renderActiveUserPill, renderUserDropdownMenu
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
let unsubCategoryConfig = null;

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
        refreshBrainDumpUser();
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

const inFlightDoneRemovals = new Set();

function collectRealActivityUids(targetSet, obj) {
    if (!obj || typeof obj !== 'object') return;
    const addUid = (val) => {
        const s = String(val || '').trim();
        if (s && !s.includes('_')) targetSet.add(s);
    };
    addUid(obj.activityUid);
    addUid(obj.niptoActivityUid);
    addUid(obj.completedActivityUid);
    if (Array.isArray(obj.activityUids)) obj.activityUids.forEach(addUid);
    if (Array.isArray(obj.niptoActivityUids)) obj.niptoActivityUids.forEach(addUid);
    if (Array.isArray(obj.completedActivityUids)) obj.completedActivityUids.forEach(addUid);
}

function isQuickAddCustomTask(doc) {
    return Boolean(doc && (doc.category === '\u26A1 Quick Add' || doc.category === '&#x26A1; Quick Add' || doc.notes === 'Quick added points'));
}

export async function removeDoneWeekItem(compId, dateKey, btnEl = null) {
    if (!compId || inFlightDoneRemovals.has(compId)) return;

    const item = (state.completedThisWeek || []).find(it => it && it.id === compId);
    if (!item) return;

    const todayKey = getLocalTodayKey();
    const targetDateKey = dateKey || item.dateKey || todayKey;
    const ptsNum = Number(item.points) || 0;

    const uidSet = new Set();
    collectRealActivityUids(uidSet, item);

    let todoDoc = null;
    let parentTodo = null;
    let subTask = null;
    let routineDoc = null;

    const taskIdGuess = item.itemId || (compId.startsWith('todo_') ? compId.slice(5) : '');

    if (item.sourceType === 'todo') {
        todoDoc = (state.todoTasksData || []).find(t => t && t.id === taskIdGuess) || null;
        if (todoDoc) collectRealActivityUids(uidSet, todoDoc);
    } else if (item.sourceType === 'subtask') {
        if (item.parentTaskId) {
            parentTodo = (state.todoTasksData || []).find(t => t && t.id === item.parentTaskId) || null;
        }
        if (parentTodo && Array.isArray(parentTodo.subTasks)) {
            subTask = parentTodo.subTasks.find(st => st && (st.id === item.itemId || ('subtask_' + parentTodo.id + '_' + st.id) === compId)) || null;
        } else {
            for (const t of (state.todoTasksData || [])) {
                if (!t || !Array.isArray(t.subTasks)) continue;
                const match = t.subTasks.find(st => st && (st.id === item.itemId || ('subtask_' + t.id + '_' + st.id) === compId));
                if (match) {
                    parentTodo = t;
                    subTask = match;
                    break;
                }
            }
        }
        if (subTask) collectRealActivityUids(uidSet, subTask);
    } else if (item.sourceType === 'routine') {
        routineDoc = (state.routines || []).find(r => r && r.uid === item.itemId) || null;
        if (routineDoc?.completionsByDate?.[targetDateKey]) {
            collectRealActivityUids(uidSet, routineDoc.completionsByDate[targetDateKey]);
        }
    } else if (item.sourceType === 'nipto') {
        if (compId.startsWith('nipto_')) {
            const suffix = compId.slice(6);
            if (suffix && !suffix.includes('_')) uidSet.add(suffix);
        }
    }

    const linkedActivityUids = Array.from(uidSet);
    if ((linkedActivityUids.length > 0 || item.sourceType === 'nipto') && !state.apiToken) {
        const pinModal = document.getElementById('pinModal');
        if (pinModal) pinModal.style.display = 'flex';
        return;
    }

    const revokeText = ptsNum > 0 ? (' and revoke ' + ptsNum + ' pts') : '';
    const confirmMsg = 'Remove "' + item.title + '" (' + (item.user || 'Someone') + ', ' + targetDateKey + ')' + revokeText + '?';
    if (!window.confirm(confirmMsg)) return;

    inFlightDoneRemovals.add(compId);
    const origHtml = btnEl ? btnEl.innerHTML : '&times;';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '&#x23F3;';
    }

    const removeCompletionAcrossDates = async (key, extraDateKey = '') => {
        if (!key) return;
        await api.removeDailyCompletion(key, targetDateKey);
        if (todayKey && todayKey !== targetDateKey) {
            await api.removeDailyCompletion(key, todayKey);
        }
        if (extraDateKey && extraDateKey !== targetDateKey && extraDateKey !== todayKey) {
            await api.removeDailyCompletion(key, extraDateKey);
        }
    };

    try {
        if (item.sourceType === 'routine') {
            const rStatus = routineDoc ? getRoutineCompletionForDate(routineDoc, targetDateKey) : null;
            if (rStatus && rStatus.isDone) {
                const undone = await undoRoutineForDate(item.itemId, targetDateKey);
                if (!undone) {
                    if (btnEl) {
                        btnEl.disabled = false;
                        btnEl.innerHTML = origHtml;
                    }
                    return;
                }
                await removeCompletionAcrossDates(compId);
            } else {
                if (linkedActivityUids.length > 0) {
                    for (const actUid of linkedActivityUids) {
                        await api.deleteActivityFromNipto(actUid);
                        await removeCompletionAcrossDates('nipto_' + actUid);
                    }
                } else if (ptsNum > 0 && item.userUid) {
                    await api.revokeAllowancePoints(item.userUid, ptsNum);
                }
                await removeCompletionAcrossDates(compId);
                expandCategoryOnReactivation('routine', routineDoc?.category || 'Home');
            }
        } else if (item.sourceType === 'todo') {
            const taskId = taskIdGuess;
            let targetTodo = todoDoc;
            if (!targetTodo && taskId) {
                try {
                    const snap = await window.getNiptoCollection('custom_tasks').doc(taskId).get();
                    if (snap && snap.exists) {
                        targetTodo = { id: snap.id, ...snap.data() };
                        collectRealActivityUids(uidSet, targetTodo);
                    }
                } catch (e) { /* ignore fallback lookup failure */ }
            }

            const todoActivityUids = Array.from(uidSet);
            if (todoActivityUids.length > 0 && !state.apiToken) {
                const pinModal = document.getElementById('pinModal');
                if (pinModal) pinModal.style.display = 'flex';
                if (btnEl) {
                    btnEl.disabled = false;
                    btnEl.innerHTML = origHtml;
                }
                return;
            }

            const docDateKey = targetTodo?.completedAt ? getLocalTodayKey(new Date(targetTodo.completedAt)) : '';
            if (todoActivityUids.length > 0) {
                for (const actUid of todoActivityUids) {
                    await api.deleteActivityFromNipto(actUid);
                    await removeCompletionAcrossDates('nipto_' + actUid, docDateKey);
                }
            } else if (ptsNum > 0) {
                const rawDoers = (Array.isArray(targetTodo?.completedBy) && targetTodo.completedBy.length > 0)
                    ? targetTodo.completedBy
                    : (item.userUid ? [item.userUid] : []);
                const doerUids = rawDoers.filter(Boolean);
                if (doerUids.length > 0) {
                    const splitPts = Math.ceil(ptsNum / doerUids.length);
                    for (const uid of doerUids) {
                        await api.revokeAllowancePoints(uid, splitPts);
                    }
                }
            }

            if (taskId && targetTodo) {
                if (isQuickAddCustomTask(targetTodo)) {
                    await api.deleteFirestoreDocument('custom_tasks', taskId);
                    if (Array.isArray(state.todoTasksData)) {
                        state.todoTasksData = state.todoTasksData.filter(t => t && t.id !== taskId);
                    }
                } else {
                    const nowIso = new Date().toISOString();
                    const updates = {
                        completed: false,
                        completedAt: null,
                        completedBy: [],
                        completedActivityUids: [],
                        completedActivityUid: null,
                        updatedAt: nowIso,
                        lastReviewedAt: nowIso
                    };
                    await api.updateFirestoreDocument('custom_tasks', taskId, updates);
                    if (todoDoc) Object.assign(todoDoc, updates);
                    const norm = normalizeTask(targetTodo);
                    expandCategoryOnReactivation(norm.type, norm.category || 'General');
                }
            }

            await removeCompletionAcrossDates(compId, docDateKey);
            if (taskId && compId !== ('todo_' + taskId)) {
                await removeCompletionAcrossDates('todo_' + taskId, docDateKey);
            }

            const linkedRoutine = targetTodo ? findMatchingRoutineForChore(targetTodo, 'todo') : null;
            const routineComp = linkedRoutine?.completionsByDate?.[targetDateKey];
            if (routineComp && routineComp.completedByChore === true && routineComp.sourceChoreId === taskId) {
                await clearCascadedRoutineCompletion(linkedRoutine.uid, targetDateKey);
            }
        } else if (item.sourceType === 'subtask') {
            if (!parentTodo && item.parentTaskId) {
                try {
                    const snap = await window.getNiptoCollection('custom_tasks').doc(item.parentTaskId).get();
                    if (snap && snap.exists) {
                        parentTodo = { id: snap.id, ...snap.data() };
                        if (Array.isArray(parentTodo.subTasks)) {
                            subTask = parentTodo.subTasks.find(st => st && (st.id === item.itemId || ('subtask_' + parentTodo.id + '_' + st.id) === compId)) || null;
                        }
                        if (subTask) collectRealActivityUids(uidSet, subTask);
                    }
                } catch (e) { /* ignore fallback lookup failure */ }
            }

            const subActivityUids = Array.from(uidSet);
            if (subActivityUids.length > 0 && !state.apiToken) {
                const pinModal = document.getElementById('pinModal');
                if (pinModal) pinModal.style.display = 'flex';
                if (btnEl) {
                    btnEl.disabled = false;
                    btnEl.innerHTML = origHtml;
                }
                return;
            }

            const subDateKey = subTask?.completedAt ? getLocalTodayKey(new Date(subTask.completedAt)) : '';
            if (subActivityUids.length > 0) {
                for (const actUid of subActivityUids) {
                    await api.deleteActivityFromNipto(actUid);
                    await removeCompletionAcrossDates('nipto_' + actUid, subDateKey);
                }
            } else if (ptsNum > 0) {
                const rawDoers = (Array.isArray(subTask?.completedByUids) && subTask.completedByUids.length > 0)
                    ? subTask.completedByUids
                    : (item.userUid ? [item.userUid] : []);
                const doerUids = rawDoers.filter(Boolean);
                if (doerUids.length > 0) {
                    const splitPts = Math.ceil(ptsNum / doerUids.length);
                    for (const uid of doerUids) {
                        await api.revokeAllowancePoints(uid, splitPts);
                    }
                }
            }

            if (parentTodo && Array.isArray(parentTodo.subTasks)) {
                const nowIso = new Date().toISOString();
                const updatedSubTasks = parentTodo.subTasks.map(st => {
                    if (st && (st.id === item.itemId || ('subtask_' + parentTodo.id + '_' + st.id) === compId)) {
                        return {
                            ...st,
                            completed: false,
                            completedAt: null,
                            completedBy: null,
                            completedByUids: [],
                            completedActivityUids: [],
                            completedActivityUid: null
                        };
                    }
                    return st;
                });
                parentTodo.subTasks = updatedSubTasks;
                parentTodo.updatedAt = nowIso;
                parentTodo.lastReviewedAt = nowIso;
                await api.updateFirestoreDocument('custom_tasks', parentTodo.id, {
                    subTasks: updatedSubTasks,
                    updatedAt: nowIso,
                    lastReviewedAt: nowIso
                });
                const normParent = normalizeTask(parentTodo);
                expandCategoryOnReactivation(normParent.type, parentTodo.category || 'General');
            }

            await removeCompletionAcrossDates(compId, subDateKey);
        } else {
            if (linkedActivityUids.length > 0) {
                for (const actUid of linkedActivityUids) {
                    await api.deleteActivityFromNipto(actUid);
                    await removeCompletionAcrossDates('nipto_' + actUid);
                }
            } else if (ptsNum > 0 && item.userUid) {
                await api.revokeAllowancePoints(item.userUid, ptsNum);
            }
            await removeCompletionAcrossDates(compId);

            for (const actUid of linkedActivityUids) {
                const matchedMap = new Map();
                (state.todoTasksData || []).forEach(t => {
                    if (t && (t.completedActivityUid === actUid || (Array.isArray(t.completedActivityUids) && t.completedActivityUids.includes(actUid)))) {
                        matchedMap.set(t.id, t);
                    }
                });
                if (matchedMap.size === 0) {
                    try {
                        let snap = await window.getNiptoCollection('custom_tasks')
                            .where('completedActivityUids', 'array-contains', actUid).get();
                        if (snap.empty) {
                            snap = await window.getNiptoCollection('custom_tasks')
                                .where('completedActivityUid', '==', actUid).get();
                        }
                        snap.forEach(doc => {
                            matchedMap.set(doc.id, { id: doc.id, ...doc.data() });
                        });
                    } catch (e) { /* ignore fallback query error */ }
                }

                for (const tDoc of matchedMap.values()) {
                    const existingSet = new Set();
                    if (Array.isArray(tDoc.completedActivityUids)) {
                        tDoc.completedActivityUids.forEach(u => { if (u) existingSet.add(u); });
                    }
                    if (tDoc.completedActivityUid) existingSet.add(tDoc.completedActivityUid);
                    const remainingUids = Array.from(existingSet).filter(u => u && u !== actUid);

                    if (remainingUids.length === 0) {
                        if (isQuickAddCustomTask(tDoc)) {
                            await api.deleteFirestoreDocument('custom_tasks', tDoc.id);
                            if (Array.isArray(state.todoTasksData)) {
                                state.todoTasksData = state.todoTasksData.filter(t => t && t.id !== tDoc.id);
                            }
                        } else {
                            const nowIso = new Date().toISOString();
                            const updates = {
                                completed: false,
                                completedAt: null,
                                completedBy: [],
                                completedActivityUids: [],
                                completedActivityUid: null,
                                updatedAt: nowIso,
                                lastReviewedAt: nowIso
                            };
                            await api.updateFirestoreDocument('custom_tasks', tDoc.id, updates);
                            const memDoc = (state.todoTasksData || []).find(t => t && t.id === tDoc.id);
                            if (memDoc) Object.assign(memDoc, updates);
                            const norm = normalizeTask(tDoc);
                            expandCategoryOnReactivation(norm.type, norm.category || 'General');
                            await removeCompletionAcrossDates('todo_' + tDoc.id);
                        }
                    } else {
                        const nowIso = new Date().toISOString();
                        const partialUpdates = {
                            completedActivityUids: remainingUids,
                            completedActivityUid: remainingUids[0] || null,
                            updatedAt: nowIso
                        };
                        await api.updateFirestoreDocument('custom_tasks', tDoc.id, partialUpdates);
                        const memDoc = (state.todoTasksData || []).find(t => t && t.id === tDoc.id);
                        if (memDoc) Object.assign(memDoc, partialUpdates);
                    }
                }

                for (const r of (state.routines || [])) {
                    if (!r?.completionsByDate || typeof r.completionsByDate !== 'object') continue;
                    for (const [dKey, entry] of Object.entries(r.completionsByDate)) {
                        if (
                            entry &&
                            entry.completedByChore === true &&
                            (entry.niptoActivityUid === actUid ||
                                entry.activityUid === actUid ||
                                (Array.isArray(entry.niptoActivityUids) && entry.niptoActivityUids.includes(actUid)) ||
                                (Array.isArray(entry.activityUids) && entry.activityUids.includes(actUid)))
                        ) {
                            await clearCascadedRoutineCompletion(r.uid, dKey);
                        }
                    }
                }
            }
        }

        await api.loadWeeklyCompletionsFromFirestore(state.doneWeekOffset || 0);
        if ((state.doneWeekOffset || 0) !== 0) {
            await api.loadWeeklyPointsFromFirestore();
        }
        drawLeaderboard(state.currentWeekScores, false);
        rebuildCompletedThisWeek();
        renderDoneThisWeekFeed();
        renderRollingSchedule();
        renderTodoTasks();
        renderBulkTriageList();
        showToast("done_removed", 'Removed "' + item.title + '"', 0, "");
    } catch (err) {
        console.error("Failed to remove completed item:", err);
        if (/token\s*expired|unauthorized/i.test(String(err?.message || ''))) {
            const pinModal = document.getElementById('pinModal');
            if (pinModal) pinModal.style.display = 'flex';
        }
        alert('Could not remove completed task: ' + (err?.message || err));
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = origHtml;
        }
    } finally {
        inFlightDoneRemovals.delete(compId);
    }
}

// Window bindings for inline HTML onclick/onchange/onfocus handlers
Object.assign(window, {
    switchNavTab,
    removeDoneWeekItem,
    setActiveUser, toggleTogetherMode, toggleUserDropdown, selectUserFromDropdown, renderActiveUserPill, renderUserDropdownMenu,
    deleteTaskActivity, populateTaskPointsSelect,
    openQuickAddModal, closeQuickAddModal, submitQuickAdd,
    toggleEditMode, saveEditMode, toggleViewAllMode, toggleViewAll, moveCategory,
    openTaskModal, closeTaskModal, editTask, saveTask, deleteTask, toggleTaskStatus, addSubTaskField,
    renderTodoTasks, renderSidebarTodos,
    setTodoView, setTodoPersonFilter, setTodoBucketFilter, setTodoFrictionFilter, setTodoPriorityFilter,
    setTodoTypeFilter, setTodoCategoryFilter, setTodoSort, setTodoGroupBy, resetTodoFilters, classifyTaskOwnership, expandCategoryOnReactivation, moveTodoCategory, toggleCategoryCollapse, toggleMainSectionCollapse, toggleTaskDescription,
    toggleSubtasksList, clearTaskFriction,
    openStaleRefresherModal, closeStaleRefresherModal, prevStaleCard, nextStaleCard,
    toggleStaleInlineEdit, saveStaleInlineEdit, handleStaleAction, simplifyTaskWithAi,
    openRoutineModal, closeRoutineModal, editRoutine, toggleRoutineFrequencyFields, saveRoutine, deleteRoutine, deleteRoutineFromModal,
    completeRoutineForDate, undoRoutineForDate, setScheduleFilter, toggleHideCompletedRoutines, clearAllMissedRoutines, isDailyRoutine,
    normalizeChoreTitle, findMatchingRoutineForChore, populateRoutineLinkedNiptoTaskSelect,
    switchBrainDumpMode, refreshBrainDumpUser, insertBrainDumpHint, parseWithGemini, rawLineByLineAdd, clearBrainDumpStaging, commitBrainDumpToFirestore,
    applyUnifiedStagingToFirestore, toggleSectionStagingRows,
    updateStagingItem, updateStagingRoutineSchedule, deleteStagingItem, addSubtaskToStaging, updateStagingSubtask, removeStagingSubtask, toggleAllStagingRows,
    analyzeRambleWithGemini, renderRambleDiffStaging, updateRambleRow, updateRambleProp,
    toggleAllRambleRows, clearRambleStaging, applyRambleUpdatesToFirestore,
    toggleBulkItem, toggleBulkSelectAll, toggleBulkSectionCollapse, executeBulkAction,
    openBulkCategoryModal, confirmBulkCategoryModal,
    updateInlineTaskField, updateRoutineScheduleInline,
    switchManageSubtab, filterManageList,
    setBulkTypeFilter, setBulkCategoryFilter, setBulkPriorityFilter, setBulkOwnershipFilter, setBulkSortBy, toggleBulkShowArchivedDone,
    openSettingsModal, closeSettingsModal, saveSettingsModal, testGeminiConnection,
    setTheme, toggleThemeMenu, setMode, setTimeOffset, savePin,
    toMillisSafe, isCompletedTodoExpired,
    getLocalTodayKey, getLocalWeekBounds, isDateInLocalWeek,
    loadCategoryConfigFromFirestore, saveCategoryConfigToFirestore, isCategoryVisibleForTasks, getEligibleTaskCategories,
    getAllKnownCategories, registerCustomCategory, renderCategoryCombobox,
    openCategoryCombobox, toggleCategoryComboboxDropdown, clearCategoryComboboxInput, filterCategoryCombobox,
    selectCategoryComboboxOption, handleCategoryComboboxKeydown,
    setDoneTodayView, changeDoneWeekOffset, resetDoneWeekToCurrent,
    rebuildCompletedThisWeek, renderDoneThisWeekFeed,
    rebuildCompletedToday, renderDoneTodayFeed, updateLeaderboardUI,
    sendChatMessage, editChatMessage, deleteChatMessage,
    reconcileNiptoActivitiesToFirestore: api.reconcileNiptoActivitiesToFirestore,
    findAndDeduplicateChores: api.findAndDeduplicateChores
});

window.submitPin = async () => {
    savePin();
    await startDashboardData();
};

window.runSync = async () => {
    const statusText = document.getElementById('status');
    const settingsSyncStatus = document.getElementById('settingsSyncStatus');
    if (statusText) statusText.innerText = "Syncing with Nipto...";
    if (settingsSyncStatus) {
        settingsSyncStatus.style.display = 'block';
        settingsSyncStatus.style.color = 'var(--primary, #2563eb)';
        settingsSyncStatus.textContent = "Syncing with Nipto...";
    }
    const syncedOk = await api.syncNiptoTasks();
    if (!syncedOk) return;

    await api.loadTasksFromFirestore();
    renderTasks();
    const reconcileRes = await api.reconcileNiptoActivitiesToFirestore(true);
    if (statusText) statusText.innerText = "";
    if (reconcileRes && reconcileRes.reconciledCount > 0) {
        const msg = `Synced Nipto tasks and reconciled ${reconcileRes.reconciledCount} external activities (+${reconcileRes.newPoints} pts)!`;
        if (settingsSyncStatus) {
            settingsSyncStatus.style.display = 'block';
            settingsSyncStatus.style.color = 'var(--success, #059669)';
            settingsSyncStatus.textContent = msg;
        }
        showToast("sync_ok", `Synced Nipto tasks and reconciled ${reconcileRes.reconciledCount} external activities!`, reconcileRes.newPoints, "Nipto Sync");
    } else {
        if (settingsSyncStatus) {
            settingsSyncStatus.style.display = 'block';
            settingsSyncStatus.style.color = 'var(--success, #059669)';
            settingsSyncStatus.textContent = "Nipto tasks synchronized successfully!";
        }
        showToast("sync_ok", "Nipto tasks synchronized successfully!", 0, "");
    }
};

// ==========================================
// FIRESTORE-FIRST STARTUP ORCHESTRATION
// ==========================================
async function startDashboardData() {
    try {
        await api.loadUsersFromFirestore();

        // Clean up any prior listeners before attaching new ones
        if (unsubTodos) { unsubTodos(); unsubTodos = null; }
        if (unsubRoutines) { unsubRoutines(); unsubRoutines = null; }
        if (unsubDailyComp) { unsubDailyComp(); unsubDailyComp = null; }
        if (unsubSyncSignal) { unsubSyncSignal(); unsubSyncSignal = null; }
        if (unsubCategoryConfig) { unsubCategoryConfig(); unsubCategoryConfig = null; }

        let resolveTodosInitial, resolveRoutinesInitial;
        const todosInitialPromise = new Promise(resolve => { resolveTodosInitial = resolve; });
        const routinesInitialPromise = new Promise(resolve => { resolveRoutinesInitial = resolve; });
        let todosInitialized = false;
        let routinesInitialized = false;

        // Real-time listener for To-Dos in Firestore (populates initial state on first snapshot)
        unsubTodos = window.getNiptoCollection('custom_tasks').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
            state.todoTasksData = [];
            snapshot.forEach(doc => {
                state.todoTasksData.push({ id: doc.id, ...doc.data() });
            });
            if (!todosInitialized) {
                todosInitialized = true;
                resolveTodosInitial();
            } else {
                rebuildCompletedThisWeek();
                renderDoneThisWeekFeed();
                renderTodoTasks();
                renderBulkTriageList();
            }
        }, err => {
            console.error("Error in custom_tasks listener:", err);
            if (!todosInitialized) {
                todosInitialized = true;
                resolveTodosInitial();
            }
        });

        // Real-time listener for Routines in Firestore (with schedule auto-healing; populates initial state on first snapshot)
        unsubRoutines = window.getNiptoCollection('routines').onSnapshot(snapshot => {
            state.routines = [];
            snapshot.forEach(doc => {
                state.routines.push(api.normalizeAndHealRoutineDoc({ uid: doc.id, ...doc.data() }));
            });
            if (!routinesInitialized) {
                routinesInitialized = true;
                resolveRoutinesInitial();
            } else {
                rebuildCompletedThisWeek();
                renderDoneThisWeekFeed();
                renderRollingSchedule();
                renderTodoTasks();
                renderBulkTriageList();
            }
        }, err => {
            console.error("Error in routines listener:", err);
            if (!routinesInitialized) {
                routinesInitialized = true;
                resolveRoutinesInitial();
            }
        });

        await Promise.all([
            api.loadTasksFromFirestore(),
            loadCustomCategoriesFromFirestore(),
            loadCategoryConfigFromFirestore(),
            todosInitialPromise,
            routinesInitialPromise,
            api.loadAllowanceLedgerFromFirestore(),
            api.loadIntegrationsConfigFromFirestore(),
            api.loadNotificationPreferencesFromFirestore(),
            api.loadWeeklyCompletionsFromFirestore(0)
        ]);

        await initUsers();
        refreshBrainDumpUser();
        renderRollingSchedule();
        renderTodoTasks();
        renderTasks();
        renderAllowanceUI();
        drawLeaderboard(state.currentWeekScores, false);
        if ((state.doneWeekOffset || 0) !== 0) {
            await api.loadWeeklyCompletionsFromFirestore(state.doneWeekOffset);
        }
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

    // Real-time listener for category visibility config
    let firstCategoryConfigSnap = true;
    unsubCategoryConfig = window.getNiptoCollection('config').doc('categories').onSnapshot(doc => {
        const data = (doc && doc.exists) ? (doc.data() || {}) : {};
        state.categoryConfig = {
            hiddenCategories: Array.isArray(data.hiddenCategories) ? data.hiddenCategories.filter(Boolean) : [],
            unhiddenNiptoCategories: Array.isArray(data.unhiddenNiptoCategories) ? data.unhiddenNiptoCategories.filter(Boolean) : []
        };
        if (firstCategoryConfigSnap) {
            firstCategoryConfigSnap = false;
            return;
        }
        renderTodoTasks();
        renderBulkTriageList();
    }, err => {
        console.warn("Error in category config listener:", err);
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
