// niptoTasks.js
// Nipto task logging, the main task grid, pinned tasks, and the points dropdown.
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { updateLeaderboardUI } from './leaderboard.js';
import { saveCloudCollapsed } from './preferences.js';
import { renderRoutines, renderSidebarRoutines } from './routines.js';
import { enableDragSort } from './dragSort.js';
import { saveCloudPreference } from './preferences.js';
// Logs a task to Nipto for the active users and cross-wires linked routines.
export async function logTask(buttonElement, taskUid, taskName) {
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return false; }
    if (state.activeUsers.length === 0) {
        alert("No users selected! Please select someone at the top of the dashboard.");
        return false;
    }

    buttonElement.style.transition = 'border 0.1s, transform 0.1s';
    buttonElement.style.transform = 'scale(0.96)';
    buttonElement.disabled = true; // Disable double clicks while logging

    const statusDiv = document.getElementById('status');
    let targetDate = state.currentMode === 'live' ? new Date() : new Date(document.getElementById('taskDate').value);

    if (state.currentMode !== 'live' && !document.getElementById('taskDate').value) {
        statusDiv.innerText = "Error: Please select a valid custom date/time.";
        statusDiv.style.color = 'var(--danger)';
        buttonElement.style.transform = 'scale(1)';
        buttonElement.disabled = false;
        return false;
    }

    let namesString = state.activeUsers.map(uid => ALL_USERS.find(u => u.uid === uid).name).join(', ');
    const taskObj = state.tasks.find(t => t.uid === taskUid);
    const points = taskObj ? Math.ceil(taskObj.value / state.currentSplitDivisor) : 0;

    try {
        await api.logActivityToNipto(taskUid, targetDate.toISOString());
        
        // Success feedback!
        buttonElement.style.border = '2px solid var(--success, #22c55e)';
        setTimeout(() => { buttonElement.style.border = ''; buttonElement.style.transform = 'scale(1)'; }, 250);
        showToast(taskUid, taskName, points, namesString);
        statusDiv.innerText = "";

        if (state.routines) {
            const linkedRoutines = state.routines.filter(r => r.linkedNiptoTask === taskUid);
            let requiresRoutineRender = false;

            for (const routine of linkedRoutines) {
                let newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
                let newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};

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
                requiresRoutineRender = true;

                api.updateFirestoreDocument('routines', routine.uid, {
                    lastCompleted: newLastCompleted,
                    lastCompletedBy: newLastCompletedBy
                }).catch(e => console.error("Routine auto-update failed:", e));
            }

            if (requiresRoutineRender) { renderRoutines(); renderSidebarRoutines(); }
        }

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
    btnElement.innerHTML = "⏳";

    try {
        await api.deleteActivityFromNipto(activityUid);

        // 1. Reset any linked routine / custom chore by querying Firestore directly
        try {
            // Check completedActivityUids array
            const snapArray = await window.getNiptoCollection('custom_chores')
                .where('completedActivityUids', 'array-contains', activityUid).get();
            snapArray.forEach(async doc => {
                await api.updateFirestoreDocument('custom_chores', doc.id, {
                    completed: false,
                    completedActivityUid: null,
                    completedActivityUids: [],
                    completedInfo: window.firebase.firestore.FieldValue.delete()
                });
            });

            // Check single completedActivityUid (legacy)
            const snapSingle = await window.getNiptoCollection('custom_chores')
                .where('completedActivityUid', '==', activityUid).get();
            snapSingle.forEach(async doc => {
                await api.updateFirestoreDocument('custom_chores', doc.id, {
                    completed: false,
                    completedActivityUid: null,
                    completedActivityUids: [],
                    completedInfo: window.firebase.firestore.FieldValue.delete()
                });
            });

            // Reload chores if any were found
            if (!snapArray.empty || !snapSingle.empty) {
                await api.loadChoresFromFirestore();
            }
        } catch (e) {
            console.warn("Firestore custom_chores cleanup query failed:", e);
        }

        // 2. Clean up from custom_tasks (Quick Add chores and General To-Dos)
        const linkedTodo = state.todoTasksData ? state.todoTasksData.find(t =>
            (t.completedActivityUids && t.completedActivityUids.includes(activityUid)) ||
            t.completedActivityUid === activityUid
        ) : null;

        if (linkedTodo) {
            if (linkedTodo.category === '⚡ Quick Add' || linkedTodo.notes === 'Quick added points') {
                // Completely delete the quick add task from Firestore!
                await api.deleteFirestoreDocument('custom_tasks', linkedTodo.id);
                state.todoTasksData = state.todoTasksData.filter(t => t.id !== linkedTodo.id);
            } else {
                // Revert regular to-do to incomplete
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

        // Also query Firestore directly to ensure any tasks not in memory are cleaned up
        try {
            const snap = await window.getNiptoCollection('custom_tasks')
                .where('completedActivityUids', 'array-contains', activityUid).get();
            snap.forEach(async doc => {
                const data = doc.data();
                if (data.category === '⚡ Quick Add' || data.notes === 'Quick added points') {
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

        // Re-render to-do lists if visible
        const { renderTodoTasks, renderSidebarTodos } = await import('./todos.js');
        renderTodoTasks();
        renderSidebarTodos();

        statusDiv.innerText = `Activity and task deleted successfully!`;
        statusDiv.style.color = 'var(--success)';
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
            if (label) label.textContent = '❌ Hidden';
        } else {
            state.tempEditPrefs.add(taskUid);
            btn.classList.add('selected-pref');
            btn.classList.remove('unselected-pref');
            if (label) label.textContent = '✅ Selected';
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

// Logs a pinned task (wrapper around logTask).
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
    container.innerHTML = '';

    let visibleTasks = [];
    if (state.isEditMode || state.isViewAllMode) {
        visibleTasks = state.tasks;
    } else {
        visibleTasks = state.tasks.filter(t =>
            state.activeUsers.some(uid => t.dashboardUsers && t.dashboardUsers.includes(uid))
        );
    }

    if (visibleTasks.length === 0 && !state.isEditMode) {
        container.innerHTML = '<div class="empty-dashboard-msg">Your dashboard is empty. Click the pencil icon to add tasks!</div>';
        return;
    }

    const groupedTasks = visibleTasks.reduce((acc, task) => {
        if (!acc[task.category]) acc[task.category] = [];
        acc[task.category].push(task);
        return acc;
    }, {});

    let savedOrder = state.userPrefs.niptoSortOrder || [];
    let keys = Object.keys(groupedTasks);

    keys.sort((a, b) => {
        let idxA = savedOrder.indexOf(a);
        let idxB = savedOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    keys.forEach(category => {
        const section = document.createElement('div');
        section.className = 'category-section';

        const isCatCollapsed = state.userPrefs.collapsed && state.userPrefs.collapsed[`nipto_${category}`] === true;

const orderControls = `
        <span class="drag-handle" style="cursor: grab; font-size: 18px; margin-left: 10px; padding: 0 8px; opacity: 0.6;" title="Drag to reorder">☰</span>
        <span class="sort-controls" style="font-size: 14px; opacity: 0.5;">
        <button onclick="moveCategory('${category}', -1, 'nipto', event)" style="cursor:pointer; background:none; border:none;" title="Move Up">▲</button>
        <button onclick="moveCategory('${category}', 1, 'nipto', event)" style="cursor:pointer; background:none; border:none;" title="Move Down">▼</button>
        </span>`;

        const header = document.createElement('h3');
        header.className = 'category-header collapsible-header';
        header.innerHTML = `${category} ${orderControls} <span class="toggle-icon ${isCatCollapsed ? 'collapsed' : ''}" style="margin-left: auto;">▼</span>`;
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
    btn.innerHTML = taskContentHtml + '<span class="edit-status-label" style="font-size:12px; margin-top:5px; display:block;">✅ Selected</span>';
} else {
    btn.classList.add('unselected-pref');
    btn.innerHTML = taskContentHtml + '<span class="edit-status-label" style="font-size:12px; margin-top:5px; display:block;">❌ Hidden</span>';
}

                const targetUid = state.activeUsers[0];
                const isPinned = targetUid && task.pinnedUsers && task.pinnedUsers.includes(targetUid);
                const pinBtn = document.createElement('button');
                pinBtn.className = `pin-task-btn ${isPinned ? 'active' : ''}`;
                pinBtn.innerHTML = '📌';
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

// Renders the active user's pinned tasks.
export function renderPinnedTasks() {
    const container = document.getElementById('pinnedContainer');
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
        <div class="chore-title">📌 ${task.name}</div>
        <div class="chore-points">+${displayValue} pts</div>
        </div>
        <div class="chore-actions">
        <button class="chore-btn complete-btn" onclick="logPinnedTask(this, '${task.uid}', '${task.name}')" title="Log Task">✅</button>
        <button class="chore-btn delete-btn" onclick="togglePinTask('${task.uid}')" title="Unpin">❌</button>
        </div>
        </div>
        `;
        container.appendChild(card);
    });
}

// =======================================================
// QUICK ADD FEATURE
// Quickly awards points and logs a completed chore to Nipto
// =======================================================

// Opens the Quick Add modal and prepares fields
export function openQuickAddModal() {
    const modal = document.getElementById('quickAddModal');
    if (!modal) return;

    const descInput = document.getElementById('quickAddDesc');
    if (descInput) descInput.value = '';

    // Populate points dropdown dynamically
    populateTaskPointsSelect('', 'quickAddPoints');

    // Populate user checkboxes
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

// Closes the Quick Add modal
export function closeQuickAddModal() {
    const modal = document.getElementById('quickAddModal');
    if (modal) modal.style.display = 'none';
}

// Builds user checkboxes for who completed the quick task
export function populateQuickAddUsers() {
    const container = document.getElementById('quickAddUsersContainer');
    if (!container) return;
    container.innerHTML = '';

    // Default to the currently active user(s) on the dashboard
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

// Submits the Quick Add chore, logs to Nipto and Firestore, and refreshes UI
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

    let targetDate = state.currentMode === 'live' 
        ? new Date() 
        : new Date(document.getElementById('taskDate').value || new Date());

    const taskObj = state.tasks ? state.tasks.find(t => t.uid === linkedNiptoTask) : null;
    const rawPoints = taskObj ? taskObj.value : 0;
    const splitDivisor = Math.max(1, selectedUids.length);
    const pointsPerUser = Math.ceil(rawPoints / splitDivisor);
    const doerNames = selectedUids.map(uid => {
        const u = ALL_USERS.find(user => user.uid === uid);
        return u ? u.name : 'Unknown';
    }).join(', ');

    try {
        // 1. Log to Nipto API with specified doers
        const activityUids = await api.logActivityToNipto(linkedNiptoTask, targetDate.toISOString(), selectedUids);

        // 2. Save activity label so the custom description displays in the left sidebar activity history
        await api.saveActivityLabels(activityUids, description);

        // 3. Save as completed in Firestore custom_tasks for audit/history
        await api.addFirestoreDocument('custom_tasks', {
            name: description,
            category: '⚡ Quick Add',
            priority: 'Medium',
            assignees: selectedUids,
            linkedNiptoTask: linkedNiptoTask,
            completed: true,
            completedActivityUids: activityUids,
            completedBy: selectedUids,
            completedAt: targetDate.toISOString(),
            notes: 'Quick added points'
        });

        // 4. Refresh leaderboard points, crown, and left sidebar history
        await updateLeaderboardUI();

        // 5. Show celebratory toast
        showToast(linkedNiptoTask, description, pointsPerUser, doerNames);

        closeQuickAddModal();
    } catch (error) {
        console.error("Error in submitQuickAdd:", error);
        alert("Error awarding points: " + error.message);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = "⚡ Award Points";
        }
    }
}
