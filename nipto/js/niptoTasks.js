// niptoTasks.js
// Nipto task logging, the main task grid, pinned tasks, and the points dropdown.
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { updateLeaderboardUI, rebuildCompletedToday, renderDoneTodayFeed } from './leaderboard.js';
import { saveCloudCollapsed, saveCloudPreference } from './preferences.js';
import { renderRoutines } from './routines.js';
import { enableDragSort } from './dragSort.js';
import { getLocalTodayKey } from './utils.js';

// Logs a task to Nipto for the active users and cross-wires linked routines.
export async function logTask(buttonElement, taskUid, taskName) {
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return false; }
    if (state.activeUsers.length === 0) {
        alert("No users selected! Please select someone at the top of the dashboard.");
        return false;
    }

    buttonElement.style.transition = 'border 0.1s, transform 0.1s';
    buttonElement.style.transform = 'scale(0.96)';
    buttonElement.disabled = true;

    const statusDiv = document.getElementById('status');
    const targetDate = state.currentMode === 'live' ? new Date() : new Date(document.getElementById('taskDate').value);

    if (state.currentMode !== 'live' && !document.getElementById('taskDate').value) {
        statusDiv.innerText = "Error: Please select a valid custom date/time.";
        statusDiv.style.color = 'var(--danger)';
        buttonElement.style.transform = 'scale(1)';
        buttonElement.disabled = false;
        return false;
    }

    const namesString = state.activeUsers.map(uid => ALL_USERS.find(u => u.uid === uid)?.name || 'Unknown').join(', ');
    const taskObj = state.tasks.find(t => t.uid === taskUid);
    const points = taskObj ? Math.ceil(taskObj.value / state.currentSplitDivisor) : 0;
    const targetDateKey = getLocalTodayKey(targetDate);

    try {
        await api.logActivityToNipto(taskUid, targetDate.toISOString());

        buttonElement.style.border = '2px solid var(--success, #22c55e)';
        setTimeout(() => { buttonElement.style.border = ''; buttonElement.style.transform = 'scale(1)'; }, 250);
        showToast(taskUid, taskName, points, namesString);
        statusDiv.innerText = "";

        if (state.routines) {
            const linkedRoutines = state.routines.filter(r => r.linkedNiptoTask === taskUid);
            let requiresRoutineRender = false;

            for (const routine of linkedRoutines) {
                const newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
                const newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};
                const newCompletionsByDate = routine.completionsByDate ? { ...routine.completionsByDate } : {};

                const primaryUid = state.activeUsers[0] || '';
                newCompletionsByDate[targetDateKey] = {
                    completedAt: targetDate.toISOString(),
                    completedByUid: primaryUid,
                    completedByName: namesString,
                    withoutPoints: false
                };

                if (routine.completionType === 'shared') {
                    newLastCompleted['shared'] = targetDate.toISOString();
                    newLastCompletedBy['shared'] = namesString;
                } else {
                    state.activeUsers.forEach(uid => {
                        newLastCompleted[uid] = targetDate.toISOString();
                        const uObj = ALL_USERS.find(u => u.uid === uid);
                        newLastCompletedBy[uid] = uObj ? uObj.name : "Unknown";
                    });
                }

                routine.lastCompleted = newLastCompleted;
                routine.lastCompletedBy = newLastCompletedBy;
                routine.completionsByDate = newCompletionsByDate;
                requiresRoutineRender = true;

                api.updateFirestoreDocument('routines', routine.uid, {
                    lastCompleted: newLastCompleted,
                    lastCompletedBy: newLastCompletedBy,
                    completionsByDate: newCompletionsByDate
                }).catch(e => console.error("Routine auto-update failed:", e));
            }

            if (requiresRoutineRender) { renderRoutines(); }
        }

        // Record to daily_completions for the target date key so it appears in "Done This Week"
        for (const uid of state.activeUsers) {
            const uObj = ALL_USERS.find(u => u.uid === uid);
            const actId = `nipto_${taskUid}_${uid}_${Date.now()}`;
            await api.recordDailyCompletion({
                id: actId,
                itemId: taskUid,
                sourceType: 'nipto',
                title: taskName,
                user: uObj ? uObj.name : namesString,
                userUid: uid,
                points: points,
                completedAt: targetDate.toISOString(),
                dateKey: targetDateKey
            });
        }

        rebuildCompletedToday();
        renderDoneTodayFeed();
        updateLeaderboardUI();
        buttonElement.disabled = false;
        return true;
    } catch (error) {
        statusDiv.innerText = `Error logging ${taskName}: ${error.message}`;
        statusDiv.style.color = 'var(--danger)';
        buttonElement.style.transform = 'scale(1)';
        buttonElement.disabled = false;
        return false;
    }
}

// Deletes a logged activity and resets any linked chore.
export async function deleteTaskActivity(activityUid, btnElement) {
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return; }
    if (!confirm("Are you sure you want to delete this logged task?")) return;

    const statusDiv = document.getElementById('status');
    const originalHtml = btnElement.innerHTML;
    btnElement.disabled = true;
    btnElement.innerHTML = "&#x23F3;";

    try {
        await api.deleteActivityFromNipto(activityUid);
        await api.removeDailyCompletion(`nipto_${activityUid}`, getLocalTodayKey());

        const linkedTodo = state.todoTasksData ? state.todoTasksData.find(t =>
            (t.completedActivityUids && t.completedActivityUids.includes(activityUid)) ||
            t.completedActivityUid === activityUid
        ) : null;

        if (linkedTodo) {
            if (linkedTodo.category === '&#x26A1; Quick Add' || linkedTodo.notes === 'Quick added points') {
                await api.deleteFirestoreDocument('custom_tasks', linkedTodo.id);
                state.todoTasksData = state.todoTasksData.filter(t => t.id !== linkedTodo.id);
            } else {
                await api.updateFirestoreDocument('custom_tasks', linkedTodo.id, {
                    completed: false,
                    completedActivityUids: [],
                    completedActivityUid: null,
                    completedBy: null,
                    completedAt: null
                });
                linkedTodo.completed = false;
                linkedTodo.completedActivityUids = [];
                linkedTodo.completedBy = null;
                linkedTodo.completedAt = null;
            }
        }

        try {
            const snap = await window.getNiptoCollection('custom_tasks')
                .where('completedActivityUids', 'array-contains', activityUid).get();
            snap.forEach(async doc => {
                const data = doc.data();
                if (data.category === '&#x26A1; Quick Add' || data.notes === 'Quick added points') {
                    await api.deleteFirestoreDocument('custom_tasks', doc.id);
                } else {
                    await api.updateFirestoreDocument('custom_tasks', doc.id, {
                        completed: false,
                        completedActivityUids: [],
                        completedActivityUid: null,
                        completedBy: null,
                        completedAt: null
                    });
                }
            });
        } catch (e) {
            console.warn("Firestore custom_tasks cleanup query:", e);
        }

        const { renderTodoTasks } = await import('./todos.js');
        renderTodoTasks();

        statusDiv.innerText = `Activity and task deleted successfully!`;
        statusDiv.style.color = 'var(--success)';
        rebuildCompletedToday();
        renderDoneTodayFeed();
        updateLeaderboardUI();
        setTimeout(() => { statusDiv.innerText = ""; statusDiv.style.color = 'var(--text-main)'; }, 3000);
    } catch (error) {
        console.error("Delete Error:", error);
        statusDiv.innerText = `Error: ${error.message}`;
        statusDiv.style.color = 'var(--danger)';
        btnElement.disabled = false;
        btnElement.innerHTML = originalHtml;
    }
}

// Either toggles a dashboard preference (edit mode) or logs the task.
export function handleTaskClick(btn, taskUid, taskName) {
    if (state.isEditMode) {
        const label = btn.querySelector('.edit-status-label');
        if (state.tempEditPrefs.has(taskUid)) {
            state.tempEditPrefs.delete(taskUid);
            btn.classList.remove('selected-pref');
            btn.classList.add('unselected-pref');
            if (label) label.textContent = '&#x274C; Hidden';
        } else {
            state.tempEditPrefs.add(taskUid);
            btn.classList.add('selected-pref');
            btn.classList.remove('unselected-pref');
            if (label) label.textContent = '&#x2714; Selected';
        }
    } else {
        logTask(btn, taskUid, taskName);
    }
}

// Pins/unpins a task to the active user's reminders.
export async function togglePinTask(taskUid) {
    const task = state.tasks.find(t => t.uid === taskUid);
    if (!task) return;
    const targetUid = state.activeUsers[0];
    if (!targetUid) return;

    let pinned = task.pinnedUsers ? [...task.pinnedUsers] : [];
    if (pinned.includes(targetUid)) pinned = pinned.filter(id => id !== targetUid);
    else pinned.push(targetUid);

    task.pinnedUsers = pinned;
    renderTasks();
    renderPinnedTasks();

    try {
        await api.updateFirestoreDocument('nipto_tasks', taskUid, { pinnedUsers: pinned });
    } catch (error) { console.error("Error updating pin:", error); }
}

export async function logPinnedTask(btnElement, taskUid, taskName) {
    await logTask(btnElement, taskUid, taskName);
}

// Populates the "points" dropdown and quick pills from synced "Assigned task" entries.
export function populateTaskPointsSelect(selectedValue = '', elementId = 'taskPoints') {
    const select = document.getElementById(elementId);
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Points --</option>';
    if (!state.tasks || state.tasks.length === 0) return;

    let pointTasks = state.tasks.filter(t => t.name && t.name.toLowerCase().startsWith('assigned task'));
    if (pointTasks.length === 0) {
        pointTasks = state.tasks.filter(t => t.value && t.value > 0);
    }
    pointTasks.sort((a, b) => (a.value || 0) - (b.value || 0));

    pointTasks.forEach(t => {
        const selected = (t.uid === selectedValue) ? 'selected' : '';
        select.innerHTML += `<option value="${t.uid}" ${selected}>${t.value} Points (${t.name})</option>`;
    });

    if (elementId === 'quickAddPoints') {
        const pillsContainer = document.getElementById('quickAddPillsContainer');
        if (pillsContainer) {
            pillsContainer.innerHTML = '';
            pointTasks.forEach(t => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'qa-point-pill' + (t.uid === selectedValue ? ' active' : '');
                btn.innerText = `+${t.value} pts`;
                btn.onclick = () => {
                    select.value = t.uid;
                    document.querySelectorAll('.qa-point-pill').forEach(p => p.classList.remove('active'));
                    btn.classList.add('active');
                };
                pillsContainer.appendChild(btn);
            });
            select.onchange = () => {
                const val = select.value;
                document.querySelectorAll('.qa-point-pill').forEach((p, idx) => {
                    p.classList.toggle('active', pointTasks[idx] && pointTasks[idx].uid === val);
                });
            };
        }
    }
}

// Renders the main Nipto task grid, grouped and ordered by category.
export function renderTasks() {
    const container = document.getElementById('mainContainer');
    if (!container) return;
    container.innerHTML = '';

    const activeUserObj = ALL_USERS.find(u => u.uid === state.activeUsers[0]);
    const activeUserName = activeUserObj ? activeUserObj.name : 'this user';

    let visibleTasks = [];
    let isShowingFallbackAll = false;

    if (state.isEditMode || state.isViewAllMode) {
        visibleTasks = state.tasks;
    } else {
        visibleTasks = state.tasks.filter(t =>
            state.activeUsers.some(uid => t.dashboardUsers && t.dashboardUsers.includes(uid))
        );
        // Sensible fallback: if a user has 0 tasks selected on their dashboard, show all non-generic chores
        // along with a helpful banner so they can immediately log chores or customize with the Pencil icon.
        if (visibleTasks.length === 0 && state.tasks.length > 0) {
            visibleTasks = state.tasks.filter(t => !(t.name && t.name.toLowerCase().startsWith('assigned task')));
            if (visibleTasks.length === 0) visibleTasks = state.tasks;
            isShowingFallbackAll = true;
        }
    }

    if (visibleTasks.length === 0 && !state.isEditMode) {
        container.innerHTML = `
            <div class="empty-dashboard-msg">
                Your dashboard is empty. Click the <strong>&#x270F;&#xFE0F; Edit Dashboard</strong> button above to select your chores!
                <div style="margin-top: 12px;">
                    <button type="button" class="action-btn" onclick="toggleEditMode()">&#x270F;&#xFE0F; Customize My Dashboard</button>
                </div>
            </div>`;
        return;
    }

    if (isShowingFallbackAll && !state.isEditMode) {
        const banner = document.createElement('div');
        banner.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 14px; margin-bottom: 16px; border-radius: 8px; background: rgba(79, 70, 229, 0.08); border: 1px solid var(--primary); font-size: 13px; color: var(--text-main);';
        banner.innerHTML = `
            <span>&#x1F4A1; <strong>${activeUserName}</strong> doesn't have a custom chore filter saved yet &mdash; showing all household chores below.</span>
            <button type="button" class="action-btn" onclick="toggleEditMode()" style="padding: 5px 10px; font-size: 12px;">&#x270F;&#xFE0F; Customize ${activeUserName}'s Dashboard</button>
        `;
        container.appendChild(banner);
    }

    const groupedTasks = visibleTasks.reduce((acc, task) => {
        if (!acc[task.category]) acc[task.category] = [];
        acc[task.category].push(task);
        return acc;
    }, {});

    const savedOrder = state.userPrefs.niptoSortOrder || [];
    const keys = Object.keys(groupedTasks);

    keys.sort((a, b) => {
        const idxA = savedOrder.indexOf(a);
        const idxB = savedOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    keys.forEach(category => {
        const section = document.createElement('div');
        section.className = 'category-section';
        section.setAttribute('data-category', category);

        const isCatCollapsed = state.userPrefs.collapsed && state.userPrefs.collapsed[`nipto_${category}`] === true;
        const safeCatAttr = String(category).replace(/'/g, "\\'");

        const orderControls = `
        <span class="drag-handle" style="cursor: grab; font-size: 18px; margin-left: 10px; padding: 0 8px; opacity: 0.6;" title="Drag to reorder">&#x2630;</span>
        <span class="sort-controls" style="font-size: 14px; opacity: 0.5;">
        <button onclick="moveCategory('${safeCatAttr}', -1, 'nipto', event)" style="cursor:pointer; background:none; border:none;" title="Move Up">&#x25B2;</button>
        <button onclick="moveCategory('${safeCatAttr}', 1, 'nipto', event)" style="cursor:pointer; background:none; border:none;" title="Move Down">&#x25BC;</button>
        </span>`;

        const header = document.createElement('h3');
        header.className = 'category-header collapsible-header';
        header.innerHTML = `${category} ${orderControls} <span class="toggle-icon ${isCatCollapsed ? 'collapsed' : ''}" style="margin-left: auto;">&#x25BC;</span>`;
        header.style.display = 'flex';
        header.style.alignItems = 'center';

        const gridWrapper = document.createElement('div');
        gridWrapper.className = `collapsible-content ${isCatCollapsed ? 'collapsed' : ''}`;

        header.onclick = (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.classList.contains('drag-handle')) return;
            const collapsed = gridWrapper.classList.toggle('collapsed');
            header.querySelector('.toggle-icon').classList.toggle('collapsed', collapsed);
            saveCloudCollapsed(`nipto_${category}`, collapsed);
        };

        section.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'task-grid';

        groupedTasks[category].forEach(task => {
            const btn = document.createElement('button');
            btn.className = 'task-btn';

            const displayValue = Math.ceil(task.value / state.currentSplitDivisor);
            const taskContentHtml = `<span>${task.name}</span><span style="display:block; margin-top:5px; font-weight:bold; color:var(--primary); font-size:13px;">${displayValue} pts</span>`;

            if (state.isEditMode) {
                btn.classList.add('edit-mode');
                if (state.tempEditPrefs.has(task.uid)) {
                    btn.classList.add('selected-pref');
                    btn.innerHTML = taskContentHtml + '<span class="edit-status-label" style="font-size:12px; margin-top:5px; display:block;">&#x2714; Selected</span>';
                } else {
                    btn.classList.add('unselected-pref');
                    btn.innerHTML = taskContentHtml + '<span class="edit-status-label" style="font-size:12px; margin-top:5px; display:block;">&#x274C; Hidden</span>';
                }

                const targetUid = state.activeUsers[0];
                const isPinned = targetUid && task.pinnedUsers && task.pinnedUsers.includes(targetUid);
                const pinBtn = document.createElement('button');
                pinBtn.className = `pin-task-btn ${isPinned ? 'active' : ''}`;
                pinBtn.innerHTML = '&#x1F4CC;';
                pinBtn.title = isPinned ? "Unpin task" : "Pin task to reminders";
                pinBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (state.activeUsers.length > 1) { alert("You can only pin tasks when a single person is selected at the top."); return; }
                    togglePinTask(task.uid);
                };
                btn.appendChild(pinBtn);
            } else {
                btn.innerHTML = taskContentHtml;
            }

            btn.setAttribute('data-original-html', btn.innerHTML);
            btn.onclick = () => handleTaskClick(btn, task.uid, task.name);
            grid.appendChild(btn);
        });

        gridWrapper.appendChild(grid);
        section.appendChild(gridWrapper);
        container.appendChild(section);
    });
    enableDragSort('mainContainer', (order) => saveCloudPreference('niptoSortOrder', order));
}

// Reorders categories up/down and saves the sort order to Firestore user_preferences.
export function moveCategory(category, direction, type = 'nipto', event = null) {
    if (event) event.stopPropagation();
    const container = document.getElementById('mainContainer');
    if (!container) return;

    const headers = Array.from(container.querySelectorAll('.category-header'));
    const currentOrder = headers.map(h => {
        const clone = h.cloneNode(true);
        clone.querySelectorAll('span, button').forEach(el => el.remove());
        return clone.textContent.trim();
    });

    const idx = currentOrder.indexOf(category);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= currentOrder.length) return;

    const temp = currentOrder[idx];
    currentOrder[idx] = currentOrder[targetIdx];
    currentOrder[targetIdx] = temp;

    saveCloudPreference('niptoSortOrder', currentOrder);
    renderTasks();
}

// Toggles "View All Tasks" vs. the active user's customized dashboard.
export function toggleViewAllMode() {
    if (state.isEditMode) return;
    state.isViewAllMode = !state.isViewAllMode;
    const btn = document.getElementById('viewAllBtn');
    if (btn) {
        if (state.isViewAllMode) {
            btn.innerHTML = "&#x1F3E0; View My Dashboard";
            btn.style.backgroundColor = "var(--primary)";
            btn.style.color = "#ffffff";
        } else {
            btn.innerHTML = "&#x1F441;&#xFE0F; View All Tasks";
            btn.style.backgroundColor = "";
            btn.style.color = "";
        }
    }
    renderTasks();
}

export const toggleViewAll = toggleViewAllMode;

function getCurrentUserDashboardTaskSet() {
    const prefs = new Set();
    const targetUid = state.activeUsers[0];
    if (!targetUid) return prefs;
    state.tasks.forEach(t => {
        if (t.dashboardUsers && t.dashboardUsers.includes(targetUid)) {
            prefs.add(t.uid);
        }
    });
    return prefs;
}

// Enters or exits Nipto Chores dashboard Edit Mode.
export async function toggleEditMode() {
    if (state.isTogetherMode) {
        alert("Please select a single person at the top before editing their dashboard.");
        return;
    }

    if (state.isEditMode) {
        await saveEditMode();
        return;
    }

    state.isEditMode = true;
    state.tempEditPrefs = getCurrentUserDashboardTaskSet();

    const editBtn = document.getElementById('editBtn');
    const saveBtn = document.getElementById('saveEditBtn');
    const viewAllBtn = document.getElementById('viewAllBtn');
    const statusDiv = document.getElementById('status');

    if (editBtn) editBtn.style.display = 'none';
    if (saveBtn) {
        saveBtn.style.display = 'inline-flex';
        saveBtn.disabled = false;
        saveBtn.innerHTML = "&#x2714; Save Changes";
    }
    if (viewAllBtn) viewAllBtn.style.display = 'none';

    const userName = ALL_USERS.find(u => u.uid === state.activeUsers[0])?.name || 'User';
    if (statusDiv) {
        statusDiv.innerText = `EDIT MODE: Tap chores below to show/hide them on ${userName}'s dashboard, then click Save Changes.`;
        statusDiv.style.color = "var(--primary)";
    }

    if (state.isViewAllMode) {
        state.isViewAllMode = false;
        if (viewAllBtn) {
            viewAllBtn.innerHTML = "&#x1F441;&#xFE0F; View All Tasks";
            viewAllBtn.style.backgroundColor = "";
            viewAllBtn.style.color = "";
        }
    }

    renderTasks();
}

// Saves the active user's shown/hidden Nipto chores to Firestore (both nipto_tasks and user_preferences).
export async function saveEditMode() {
    if (!state.isEditMode) return;

    const targetUid = state.activeUsers[0];
    const editBtn = document.getElementById('editBtn');
    const saveBtn = document.getElementById('saveEditBtn');
    const viewAllBtn = document.getElementById('viewAllBtn');
    const statusDiv = document.getElementById('status');

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = "&#x23F3; Saving...";
    }

    try {
        if (targetUid && window.db) {
            const batch = window.db.batch();
            let hasTaskChanges = false;

            state.tasks.forEach(task => {
                const wantsItOnDash = state.tempEditPrefs.has(task.uid);
                const hasItCurrently = Array.isArray(task.dashboardUsers) && task.dashboardUsers.includes(targetUid);

                if (wantsItOnDash !== hasItCurrently) {
                    hasTaskChanges = true;
                    let newUsersList = Array.isArray(task.dashboardUsers) ? [...task.dashboardUsers] : [];
                    if (wantsItOnDash && !newUsersList.includes(targetUid)) {
                        newUsersList.push(targetUid);
                    } else if (!wantsItOnDash) {
                        newUsersList = newUsersList.filter(id => id !== targetUid);
                    }
                    task.dashboardUsers = newUsersList;
                    const docRef = window.getNiptoCollection('nipto_tasks').doc(task.uid);
                    batch.update(docRef, { dashboardUsers: newUsersList });
                }
            });

            if (hasTaskChanges) {
                await batch.commit();
            }

            // Also persist the full list of selected task UIDs in user_preferences/{targetUid}
            const selectedTaskUids = Array.from(state.tempEditPrefs);
            saveCloudPreference('dashboardTaskUids', selectedTaskUids);
        }

        const userName = ALL_USERS.find(u => u.uid === targetUid)?.name || 'User';
        showToast("prefs_saved", `Saved ${userName}'s dashboard preferences!`, 0, "");
    } catch (error) {
        console.error("Error saving dashboard preferences:", error);
        alert("Failed to save dashboard preferences: " + error.message);
    } finally {
        state.isEditMode = false;
        state.hasEnteredTaskPin = false;

        if (saveBtn) {
            saveBtn.style.display = 'none';
            saveBtn.disabled = false;
            saveBtn.innerHTML = "&#x2714; Save Changes";
        }
        if (editBtn) {
            editBtn.style.display = 'inline-flex';
            editBtn.disabled = false;
            editBtn.innerHTML = "&#x270F;&#xFE0F; Edit Dashboard";
        }
        if (viewAllBtn) {
            viewAllBtn.style.display = 'inline-flex';
        }
        if (statusDiv) {
            statusDiv.innerText = "";
            statusDiv.style.color = "var(--text-main)";
        }

        renderTasks();
    }
}

export function renderPinnedTasks() {
    const container = document.getElementById('pinnedContainer');
    if (!container) return;
    container.innerHTML = '';

    const targetUid = state.activeUsers[0];
    const myPinnedTasks = state.tasks.filter(t => t.pinnedUsers && t.pinnedUsers.includes(targetUid));

    if (myPinnedTasks.length === 0) {
        container.innerHTML = '<div class="empty-history" style="margin-top: 10px;">No pinned tasks.</div>';
        return;
    }

    myPinnedTasks.forEach(task => {
        const displayValue = Math.ceil(task.value / state.currentSplitDivisor);
        const card = document.createElement('div');
        card.className = 'chore-card';
        card.innerHTML = `
        <div class="chore-header">
        <div class="chore-title-area">
        <div class="chore-title">&#x1F4CC; ${task.name}</div>
        <div class="chore-points">+${displayValue} pts</div>
        </div>
        <div class="chore-actions">
        <button class="chore-btn complete-btn" onclick="logPinnedTask(this, '${task.uid}', '${task.name}')" title="Log Task">&#x2714;</button>
        <button class="chore-btn delete-btn" onclick="togglePinTask('${task.uid}')" title="Unpin">&#x274C;</button>
        </div>
        </div>
        `;
        container.appendChild(card);
    });
}

// =======================================================
// QUICK ADD FEATURE
// =======================================================
export function openQuickAddModal() {
    const modal = document.getElementById('quickAddModal');
    if (!modal) return;

    const descInput = document.getElementById('quickAddDesc');
    if (descInput) descInput.value = '';

    populateTaskPointsSelect('', 'quickAddPoints');
    populateQuickAddUsers();

    modal.style.display = 'flex';
    if (descInput) setTimeout(() => descInput.focus(), 50);

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeQuickAddModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

export function closeQuickAddModal() {
    const modal = document.getElementById('quickAddModal');
    if (modal) modal.style.display = 'none';
}

export function populateQuickAddUsers() {
    const container = document.getElementById('quickAddUsersContainer');
    if (!container) return;
    container.innerHTML = '';

    const activeUids = state.activeUsers && state.activeUsers.length > 0
        ? state.activeUsers
        : (ALL_USERS.length > 0 ? [ALL_USERS[0].uid] : []);

    ALL_USERS.forEach(u => {
        const isChecked = activeUids.includes(u.uid) ? 'checked' : '';
        container.innerHTML += `
            <label class="quick-add-user-label" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--card-bg); cursor: pointer; user-select: none;">
                <input type="checkbox" value="${u.uid}" class="qa-user-check" ${isChecked} style="accent-color: ${u.color}; cursor: pointer;">
                <span style="color: ${u.color}; font-weight: bold; font-size: 13px;">${u.name}</span>
            </label>
        `;
    });
}

export async function submitQuickAdd() {
    const descInput = document.getElementById('quickAddDesc');
    const pointsSelect = document.getElementById('quickAddPoints');
    const submitBtn = document.getElementById('quickAddSubmitBtn');

    const description = descInput ? descInput.value.trim() : '';
    if (!description) {
        alert("Please enter a description for the completed task.");
        if (descInput) descInput.focus();
        return;
    }

    const linkedNiptoTask = pointsSelect ? pointsSelect.value : '';
    if (!linkedNiptoTask) {
        alert("Please select the number of points to award.");
        if (pointsSelect) pointsSelect.focus();
        return;
    }

    const selectedCheckboxes = document.querySelectorAll('.qa-user-check:checked');
    const selectedUids = Array.from(selectedCheckboxes).map(cb => cb.value);
    if (selectedUids.length === 0) {
        alert("Please select at least one person who completed the chore.");
        return;
    }

    if (!state.apiToken) {
        document.getElementById('pinModal').style.display = 'flex';
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Awarding...";
    }

    const targetDate = state.currentMode === 'live'
        ? new Date()
        : new Date(document.getElementById('taskDate').value || new Date());
    const targetDateKey = getLocalTodayKey(targetDate);

    const taskObj = state.tasks ? state.tasks.find(t => t.uid === linkedNiptoTask) : null;
    const rawPoints = taskObj ? taskObj.value : 0;
    const splitDivisor = Math.max(1, selectedUids.length);
    const pointsPerUser = Math.ceil(rawPoints / splitDivisor);
    const doerNames = selectedUids.map(uid => {
        const u = ALL_USERS.find(user => user.uid === uid);
        return u ? u.name : 'Unknown';
    }).join(', ');

    try {
        const activityUids = await api.logActivityToNipto(linkedNiptoTask, targetDate.toISOString(), selectedUids);
        await api.saveActivityLabels(activityUids, description);

        await api.addFirestoreDocument('custom_tasks', {
            name: description,
            category: '&#x26A1; Quick Add',
            priority: 'medium',
            points: pointsPerUser,
            assignees: selectedUids,
            linkedNiptoTask: linkedNiptoTask,
            completed: true,
            completedActivityUids: activityUids,
            completedBy: selectedUids,
            completedAt: targetDate.toISOString(),
            notes: 'Quick added points'
        });

        for (let i = 0; i < selectedUids.length; i++) {
            const uid = selectedUids[i];
            const u = ALL_USERS.find(user => user.uid === uid);
            const actUid = activityUids[i] || `${linkedNiptoTask}_${uid}_${Date.now()}`;
            await api.recordDailyCompletion({
                id: `nipto_${actUid}`,
                itemId: actUid,
                sourceType: 'nipto',
                title: description,
                user: u ? u.name : doerNames,
                userUid: uid,
                points: pointsPerUser,
                completedAt: targetDate.toISOString(),
                dateKey: targetDateKey
            });
        }

        await updateLeaderboardUI();
        showToast(linkedNiptoTask, description, pointsPerUser, doerNames);
        closeQuickAddModal();
    } catch (error) {
        console.error("Error in submitQuickAdd:", error);
        alert("Error awarding points: " + error.message);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = "&#x26A1; Award Points";
        }
    }
}
