// todos.js
// Active To-Dos: Single compact toolbar row (My Actionable / Shared / Projects / All),
// 3-Column Responsive Grid, hollow-square checkboxes, collapsed notes & subtasks,
// and Direct Assignment Alerts to Home Assistant.

import { state, ALL_USERS, NIPTO_PUBLIC_URL } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { updateLeaderboardUI, rebuildCompletedToday, renderDoneTodayFeed } from './leaderboard.js';
import { getLocalTodayKey } from './utils.js';

export { NIPTO_PUBLIC_URL };

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==========================================
// FILTER HANDLERS
// ==========================================
export function setTodoView(view) {
    state.todoView = view;
    // When switching away from All, reset person filter to 'all' so view is intuitive
    if (view !== 'all') {
        state.todoPersonFilter = 'all';
    }
    renderTodoTasks();
}

export function setTodoPersonFilter(val) {
    state.todoPersonFilter = val;
    renderTodoTasks();
}

export function setTodoBucketFilter(val) {
    state.todoBucketFilter = val;
    renderTodoTasks();
}

export function setTodoFrictionFilter(val) {
    state.todoFrictionFilter = val;
    renderTodoTasks();
}

export function setTodoPriorityFilter(val) {
    state.todoPriorityFilter = val;
    renderTodoTasks();
}

// Helper to toggle subtask checklist expansion on a card
export function toggleSubtasksList(taskId) {
    const el = document.getElementById(`subtasks-list-${taskId}`);
    const arrow = document.getElementById(`subtasks-arrow-${taskId}`);
    if (!el) return;
    const isHidden = el.style.display === 'none' || !el.style.display;
    el.style.display = isHidden ? 'flex' : 'none';
    if (arrow) arrow.innerHTML = isHidden ? '&#x25B4;' : '&#x25BE;';
}

// Quick action to clear an auto-defaulted friction tag
export async function clearTaskFriction(taskId, event) {
    if (event) event.stopPropagation();
    try {
        await api.updateFirestoreDocument('custom_tasks', taskId, { frictionTag: '' });
        const task = state.todoTasksData?.find(t => t.id === taskId);
        if (task) task.frictionTag = '';
        renderTodoTasks();
    } catch (e) {
        console.error("Error clearing friction tag:", e);
    }
}

// Format a single compact assignee pill (at most ONE pill, no duplicate list badges)
function formatTodoAssigneePill(task) {
    const assignees = task.assignees || [];
    if (assignees.length === 0) {
        return `<span class="todo-pill">&#x1F465; Anyone</span>`;
    }
    if (assignees.length >= 3) {
        const fullNames = assignees.map(uid => {
            const u = ALL_USERS.find(user => user.uid === uid);
            return u ? u.name : 'Unknown';
        }).join(', ');
        return `<span class="todo-pill shared-pill" title="${escapeHtml(fullNames)}">&#x1F465; Shared</span>`;
    }
    if (assignees.length === 2) {
        const names = assignees.map(uid => {
            const u = ALL_USERS.find(user => user.uid === uid);
            return u ? u.name : 'Unknown';
        });
        return `<span class="todo-pill shared-pill" title="${escapeHtml(names.join(' & '))}"><span style="color: var(--text-muted);">&#x1F465; ${escapeHtml(names.join(' / '))}</span></span>`;
    }
    const singleUid = assignees[0];
    const u = ALL_USERS.find(user => user.uid === singleUid);
    if (!u) return `<span class="todo-pill">&#x1F465; Anyone</span>`;
    return `<span class="todo-pill" style="color: ${u.color}; font-weight: 700;">&#x1F464; ${escapeHtml(u.name)}</span>`;
}

// ==========================================
// MAIN TO-DOS RENDERER
// ==========================================
export function renderTodoTasks() {
    const container = document.getElementById('todoContainer');
    if (!container) return;

    let tasks = state.todoTasksData || [];
    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeUserObj = ALL_USERS.find(u => u.uid === activeUid);
    const activeName = activeUserObj ? activeUserObj.name : 'Active';

    // Default view: 'my_actionable'
    if (!state.todoView) state.todoView = 'my_actionable';
    const currentView = state.todoView;
    const personFilter = state.todoPersonFilter || 'all';
    const frictionFilter = state.todoFrictionFilter || 'all';
    const priorityFilter = state.todoPriorityFilter || 'all';

    // 1. Primary View Filter
    if (currentView === 'my_actionable') {
        // Only actionable tasks (bucket !== 'project_idea')
        // Assigned to active user OR Anyone / unassigned
        tasks = tasks.filter(t => {
            const isActionable = (t.bucket || 'actionable') !== 'project_idea';
            const isForMe = !t.assignees || t.assignees.length === 0 || t.assignees.includes(activeUid);
            return isActionable && isForMe;
        });
    } else if (currentView === 'shared') {
        // Shared or Anyone
        tasks = tasks.filter(t => {
            const isActionable = (t.bucket || 'actionable') !== 'project_idea';
            const isSharedOrAnyone = !t.assignees || t.assignees.length === 0 || t.assignees.length > 1;
            return isActionable && isSharedOrAnyone;
        });
    } else if (currentView === 'projects') {
        // Long-term projects & ideas
        tasks = tasks.filter(t => t.bucket === 'project_idea');
    } else if (currentView === 'all') {
        // All household tasks
    }

    // 2. Secondary Person Filter
    if (personFilter === 'me') {
        tasks = tasks.filter(t => t.assignees && t.assignees.includes(activeUid));
    } else if (personFilter === 'unassigned') {
        tasks = tasks.filter(t => !t.assignees || t.assignees.length === 0);
    } else if (personFilter !== 'all') {
        tasks = tasks.filter(t => t.assignees && t.assignees.includes(personFilter));
    }

    // 3. Secondary Friction Filter (STRICT: no auto-defaulting un-set tasks to quick!)
    if (frictionFilter !== 'all') {
        tasks = tasks.filter(t => t.frictionTag === frictionFilter);
    }

    // 4. Secondary Priority Filter
    if (priorityFilter !== 'all') {
        tasks = tasks.filter(t => (t.priority || '').toLowerCase() === priorityFilter);
    }

    // 5. Render Single Compact Toolbar Row
    let toolbarHtml = `
    <div class="todo-toolbar-row">
        <!-- Left: Primary View Pills -->
        <div class="todo-view-pills">
            <button class="filter-pill ${currentView === 'my_actionable' ? 'active' : ''}" onclick="setTodoView('my_actionable')" title="Actionable to-dos for me or anyone">
                &#x26A1; My Actionable
            </button>
            <button class="filter-pill ${currentView === 'shared' ? 'active' : ''}" onclick="setTodoView('shared')" title="Shared tasks and open household to-dos">
                &#x1F465; Shared / Anyone
            </button>
            <button class="filter-pill ${currentView === 'projects' ? 'active' : ''}" onclick="setTodoView('projects')" title="Projects, someday goals, and brainstormed ideas">
                &#x1F4A1; Projects &amp; Ideas
            </button>
            <button class="filter-pill ${currentView === 'all' ? 'active' : ''}" onclick="setTodoView('all')" title="All household tasks across all members">
                All Household
            </button>
        </div>

        <!-- Right: Secondary Compact Dropdowns -->
        <div class="todo-secondary-filters">
            <select class="todo-compact-select" onchange="setTodoPersonFilter(this.value)" title="Filter by Person">
                <option value="all" ${personFilter === 'all' ? 'selected' : ''}>Person: All</option>
                <option value="me" ${personFilter === 'me' ? 'selected' : ''}>Me (${escapeHtml(activeName)})</option>
                <option value="unassigned" ${personFilter === 'unassigned' ? 'selected' : ''}>Anyone</option>
                ${ALL_USERS.map(u => `<option value="${u.uid}" ${personFilter === u.uid ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
            </select>
            <select class="todo-compact-select" onchange="setTodoPriorityFilter(this.value)" title="Filter by Priority">
                <option value="all" ${priorityFilter === 'all' ? 'selected' : ''}>Priority: All</option>
                <option value="high" ${priorityFilter === 'high' ? 'selected' : ''}>&#x1F525; High</option>
                <option value="medium" ${priorityFilter === 'medium' ? 'selected' : ''}>&#x26A1; Medium</option>
                <option value="low" ${priorityFilter === 'low' ? 'selected' : ''}>&#x1F53D; Low</option>
            </select>
            <select class="todo-compact-select" onchange="setTodoFrictionFilter(this.value)" title="Filter by Friction Level">
                <option value="all" ${frictionFilter === 'all' ? 'selected' : ''}>Friction: All</option>
                <option value="quick" ${frictionFilter === 'quick' ? 'selected' : ''}>&#x26A1; Quick (&lt;5m)</option>
                <option value="low_brain" ${frictionFilter === 'low_brain' ? 'selected' : ''}>&#x1F9E0; Low Brain</option>
                <option value="deep_focus" ${frictionFilter === 'deep_focus' ? 'selected' : ''}>&#x1F3AF; Deep Focus</option>
            </select>
        </div>
    </div>
    `;

    if (tasks.length === 0) {
        container.innerHTML = toolbarHtml + `
        <div class="empty-dashboard-msg" style="padding: 30px;">
            No to-dos matching this view. Click "+ Add Task" to create one.
        </div>`;
        return;
    }

    function getPriorityWeight(p) {
        if (!p) return 0;
        const lp = p.toLowerCase();
        if (lp === 'high') return 3;
        if (lp === 'medium') return 2;
        if (lp === 'low') return 1;
        return 0;
    }

    // Sort: incomplete first, then highest priority first, then newest first
    tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const pA = getPriorityWeight(a.priority);
        const pB = getPriorityWeight(b.priority);
        if (pA !== pB) return pB - pA;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    // Partition tasks into Individual vs Shared / Anyone
    const individualTasks = [];
    const sharedTasks = [];

    tasks.forEach(t => {
        const isShared = !t.assignees || t.assignees.length === 0 || t.assignees.length > 1;
        if (isShared) {
            sharedTasks.push(t);
        } else {
            individualTasks.push(t);
        }
    });

    let individualSectionTitle = "Assigned to Me (Individual)";
    if (personFilter !== 'all' && personFilter !== 'unassigned' && personFilter !== 'me') {
        const u = ALL_USERS.find(user => user.uid === personFilter);
        individualSectionTitle = `Assigned to ${u ? escapeHtml(u.name) : 'User'} (Individual)`;
    } else if (currentView === 'all') {
        individualSectionTitle = "Individual Tasks (Single Assignee)";
    }

    // Helper to render individual To-Do Card HTML
    function renderCard(t) {
        const isCompleted = !!t.completed;
        const assigneePill = formatTodoAssigneePill(t);

        // Priority badge
        let priorityBadge = '';
        if (t.priority === 'high') {
            priorityBadge = `<span class="todo-priority-badge high">&#x1F525; High</span>`;
        } else if (t.priority === 'medium') {
            priorityBadge = `<span class="todo-priority-badge medium">&#x26A1; Med</span>`;
        } else if (t.priority === 'low') {
            priorityBadge = `<span class="todo-priority-badge low">&#x1F53D; Low</span>`;
        }

        // Friction tag
        let frictionBadge = '';
        if (t.frictionTag === 'quick') {
            frictionBadge = `<span class="todo-friction-badge quick" title="Quick (<5m). Click x to clear.">&#x26A1; Quick <button type="button" class="btn-clear-friction" onclick="clearTaskFriction('${t.id}', event)">&times;</button></span>`;
        } else if (t.frictionTag === 'low_brain') {
            frictionBadge = `<span class="todo-friction-badge low_brain" title="Low Brain. Click x to clear.">&#x1F9E0; Low Brain <button type="button" class="btn-clear-friction" onclick="clearTaskFriction('${t.id}', event)">&times;</button></span>`;
        } else if (t.frictionTag === 'deep_focus') {
            frictionBadge = `<span class="todo-friction-badge deep_focus" title="Deep Focus. Click x to clear.">&#x1F3AF; Deep Focus <button type="button" class="btn-clear-friction" onclick="clearTaskFriction('${t.id}', event)">&times;</button></span>`;
        }

        // Project idea badge
        const isProject = t.bucket === 'project_idea';
        const projectBadge = isProject
            ? `<span class="todo-pill project-pill">&#x1F4A1; Project</span>`
            : '';

        // Category badge
        let categoryBadge = '';
        if (t.category && !t.category.toLowerCase().includes('list') && !ALL_USERS.some(u => u.name.toLowerCase() === t.category.toLowerCase())) {
            categoryBadge = `<span class="todo-pill" style="color: var(--text-muted);">&#x1F4C1; ${escapeHtml(t.category)}</span>`;
        }

        // Points badge
        const ptsDisplay = (t.points && t.points > 0)
            ? `<span class="pts-badge">+${t.points} pts</span>`
            : '';

        // Creator badge
        const createdBy = t.createdBy || 'Alyssa';
        const isSingleAssignee = t.assignees && t.assignees.length === 1;
        const assigneeObj = isSingleAssignee ? ALL_USERS.find(u => u.uid === t.assignees[0]) : null;
        const isDifferentCreator = isSingleAssignee && assigneeObj && assigneeObj.name.toLowerCase() !== createdBy.toLowerCase();

        let creatorBadge = '';
        if (isDifferentCreator) {
            creatorBadge = `<span class="todo-creator-tag different-user" title="Added by ${escapeHtml(createdBy)}">&#x270D; Added by ${escapeHtml(createdBy)}</span>`;
        } else if (createdBy) {
            creatorBadge = `<span class="todo-creator-tag" title="Added by ${escapeHtml(createdBy)}">by ${escapeHtml(createdBy)}</span>`;
        }

        // Subtasks section
        let subtasksSection = '';
        if (t.subTasks && t.subTasks.length > 0) {
            const completedCount = t.subTasks.filter(st => st.completed).length;
            subtasksSection = `
            <div class="todo-subtasks-wrapper">
                <button type="button" class="todo-subtasks-toggle" onclick="toggleSubtasksList('${t.id}')">
                    Subtasks (${completedCount}/${t.subTasks.length}) <span id="subtasks-arrow-${t.id}">&#x25BE;</span>
                </button>
                <div id="subtasks-list-${t.id}" class="todo-subtasks-list" style="display: none;">
                    ${t.subTasks.map(st => `
                        <label class="todo-subtask-item">
                            <input type="checkbox" ${st.completed ? 'checked' : ''} onchange="toggleSubTask('${t.id}', '${st.id}', this.checked)">
                            <span class="${st.completed ? 'completed-subtask' : ''}">${escapeHtml(st.name || st.text)}</span>
                            ${st.createdBy && st.createdBy !== createdBy ? `<span style="font-size: 10px; color: var(--text-muted);">(${escapeHtml(st.createdBy)})</span>` : ''}
                        </label>
                    `).join('')}
                </div>
            </div>
            `;
        }

        return `
        <div class="todo-card ${isCompleted ? 'completed' : ''}">
            <div class="todo-card-top">
                <div class="todo-card-main-line">
                    <button type="button" class="item-checkbox ${isCompleted ? 'checked' : ''}" onclick="toggleTaskStatus('${t.id}', ${isCompleted})" title="${isCompleted ? 'Completed - click to undo' : 'Mark task complete'}" aria-label="${isCompleted ? 'Mark incomplete' : 'Mark complete'}">
                        ${isCompleted ? '&#x2714;' : ''}
                    </button>
                    <span class="todo-title ${isCompleted ? 'completed-text' : ''}">
                        ${escapeHtml(t.name)}
                    </span>
                    <div class="todo-card-actions">
                        <button class="chore-btn" onclick="editTask('${t.id}')" title="Edit Task" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x270E;</button>
                        <button class="chore-btn delete-btn" onclick="deleteTask('${t.id}')" title="Delete Task" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x1F5D1;</button>
                    </div>
                </div>

                <div class="todo-badges-row">
                    ${assigneePill}
                    ${priorityBadge}
                    ${frictionBadge}
                    ${projectBadge}
                    ${categoryBadge}
                    ${ptsDisplay}
                    ${creatorBadge}
                </div>

                ${t.notes ? `
                    <div class="todo-notes-preview" onclick="this.classList.toggle('expanded')" title="Click note to expand/collapse">
                        ${escapeHtml(t.notes)}
                    </div>
                ` : ''}

                ${subtasksSection}
            </div>
        </div>
        `;
    }

    // 6. Build Split Visual Sections HTML
    let bodyHtml = `
    <!-- SECTION 1: INDIVIDUAL / MINE -->
    <div class="todo-section-container">
        <div class="todo-section-header">
            <h4 class="todo-section-title">
                <span>&#x1F464; ${individualSectionTitle}</span>
                <span class="todo-section-count">${individualTasks.length}</span>
            </h4>
        </div>
        ${individualTasks.length > 0
            ? `<div class="todo-grid">${individualTasks.map(renderCard).join('')}</div>`
            : `<div class="empty-section-muted">&#x1F464; No individual tasks matching current filters.</div>`
        }
    </div>

    <!-- SECTION 2: SHARED / ANYONE CAN DO -->
    <div class="todo-section-container">
        <div class="todo-section-header shared-header">
            <h4 class="todo-section-title">
                <span>&#x1F465; Shared / Anyone Can Do</span>
                <span class="todo-section-count">${sharedTasks.length}</span>
            </h4>
        </div>
        ${sharedTasks.length > 0
            ? `<div class="todo-grid">${sharedTasks.map(renderCard).join('')}</div>`
            : `<div class="empty-section-muted">&#x1F465; No shared or household-wide tasks matching current filters.</div>`
        }
    </div>
    `;

    container.innerHTML = toolbarHtml + bodyHtml;
}

// Completes or uncompletes a task
export async function toggleTaskStatus(taskId, currentCompleted) {
    const todo = state.todoTasksData?.find(t => t.id === taskId);
    if (!todo) return;

    const nextCompleted = !currentCompleted;
    const nowIso = new Date().toISOString();

    const doerUid = state.activeUsers[0] || ALL_USERS[0].uid;
    const doerName = ALL_USERS.find(u => u.uid === doerUid)?.name || 'Someone';

    // Update in-memory task immediately
    todo.completed = nextCompleted;
    todo.completedAt = nextCompleted ? nowIso : null;
    todo.completedBy = nextCompleted ? [doerUid] : [];

    try {
        await api.updateFirestoreDocument('custom_tasks', taskId, {
            completed: nextCompleted,
            completedAt: nextCompleted ? nowIso : null,
            completedBy: nextCompleted ? [doerUid] : []
        });

        if (nextCompleted) {
            showToast("todo_done", `Completed "${todo.name}"!`, todo.points || 0, doerName);
            // Award allowance if Ayden or DJ
            if (todo.points && todo.points > 0) {
                api.awardAllowancePoints(doerUid, todo.points);
            }
            await api.recordDailyCompletion({
                id: `todo_${taskId}`,
                itemId: taskId,
                sourceType: 'todo',
                title: todo.name,
                user: doerName,
                userUid: doerUid,
                points: todo.points || 0,
                completedAt: nowIso,
                dateKey: getLocalTodayKey()
            });
        } else {
            await api.removeDailyCompletion(`todo_${taskId}`, getLocalTodayKey());
        }

        rebuildCompletedToday();
        renderDoneTodayFeed();
        renderTodoTasks();
        updateLeaderboardUI();
    } catch (e) {
        console.error("Error toggling task status:", e);
        alert("Failed to update task: " + e.message);
    }
}

// Toggles subtask completion
export async function toggleSubTask(taskId, subTaskId, isChecked) {
    const todo = state.todoTasksData?.find(t => t.id === taskId);
    if (!todo || !todo.subTasks) return;

    const nowIso = new Date().toISOString();
    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeName = ALL_USERS.find(u => u.uid === activeUid)?.name || 'Someone';

    const updated = todo.subTasks.map(st => {
        if (st.id === subTaskId) return {
            ...st,
            completed: isChecked,
            completedAt: isChecked ? nowIso : null,
            completedBy: isChecked ? activeName : null
        };
        return st;
    });

    todo.subTasks = updated;

    try {
        await api.updateFirestoreDocument('custom_tasks', taskId, { subTasks: updated });

        const subObj = todo.subTasks?.find(s => s.id === subTaskId);
        const subName = subObj?.name || subObj?.text || 'Subtask';

        if (isChecked) {
            await api.recordDailyCompletion({
                id: `subtask_${taskId}_${subTaskId}`,
                itemId: subTaskId,
                sourceType: 'subtask',
                title: `${todo.name}: ${subName}`,
                user: activeName,
                userUid: activeUid,
                points: 0,
                completedAt: nowIso,
                dateKey: getLocalTodayKey()
            });
        } else {
            await api.removeDailyCompletion(`subtask_${taskId}_${subTaskId}`, getLocalTodayKey());
        }

        rebuildCompletedToday();
        renderDoneTodayFeed();
        renderTodoTasks();
    } catch (e) {
        console.error("Error updating subtask:", e);
    }
}

// Opens modal to add new task
export function openTaskModal() {
    document.getElementById('taskModalTitle').innerText = "Add To-Do Task";
    document.getElementById('taskId').value = '';
    document.getElementById('taskName').value = '';
    document.getElementById('taskCategory').value = 'Home';
    document.getElementById('taskLocation').value = 'Inside';
    document.getElementById('taskBucket').value = 'actionable';
    const priorityEl = document.getElementById('taskPriority');
    if (priorityEl) priorityEl.value = '';
    document.getElementById('taskFriction').value = ''; // Default without friction tag
    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeName = ALL_USERS.find(u => u.uid === activeUid)?.name || 'Alyssa';
    const createdByEl = document.getElementById('taskCreatedBy');
    if (createdByEl) createdByEl.value = activeName;
    document.getElementById('taskNotes').value = '';
    populateTodoAssignees([]);
    populateSubTaskFields([]);
    document.getElementById('taskModal').style.display = 'flex';
}

export function closeTaskModal() {
    document.getElementById('taskModal').style.display = 'none';
}

export function editTask(id) {
    const task = state.todoTasksData?.find(t => t.id === id);
    if (!task) return;

    document.getElementById('taskModalTitle').innerText = "Edit To-Do Task";
    document.getElementById('taskId').value = task.id;
    document.getElementById('taskName').value = task.name || '';
    document.getElementById('taskCategory').value = task.category || 'Home';
    document.getElementById('taskLocation').value = task.location || 'Inside';
    document.getElementById('taskBucket').value = task.bucket || 'actionable';
    const priorityEl = document.getElementById('taskPriority');
    if (priorityEl) priorityEl.value = task.priority || '';
    document.getElementById('taskFriction').value = task.frictionTag || '';
    const createdByEl = document.getElementById('taskCreatedBy');
    if (createdByEl) createdByEl.value = task.createdBy || 'Alyssa';
    document.getElementById('taskNotes').value = task.notes || '';
    populateTodoAssignees(task.assignees || []);
    populateSubTaskFields(task.subTasks || []);
    document.getElementById('taskModal').style.display = 'flex';
}

function populateTodoAssignees(selected = []) {
    const container = document.getElementById('todoAssignees');
    if (!container) return;
    container.innerHTML = '';
    ALL_USERS.forEach(u => {
        const isChecked = selected.includes(u.uid) ? 'checked' : '';
        container.innerHTML += `
        <label style="font-size: 13px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" value="${u.uid}" class="todo-assignee-cb" ${isChecked}> ${escapeHtml(u.name)}
        </label>`;
    });
}

export function addSubTaskField(name = '', completed = false, createdBy = '') {
    const container = document.getElementById('subTasksContainer');
    if (!container) return;
    const emptyMsg = container.querySelector('.empty-subtasks-msg');
    if (emptyMsg) emptyMsg.remove();

    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeName = ALL_USERS.find(u => u.uid === activeUid)?.name || 'Alyssa';
    const creator = createdBy || activeName;

    const subId = 'st_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const row = document.createElement('div');
    row.className = 'subtask-field-row';
    row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 6px;';
    row.innerHTML = `
        <input type="hidden" class="subtask-id" value="${subId}">
        <input type="hidden" class="subtask-created-by" value="${escapeHtml(creator)}">
        <input type="text" class="subtask-name" value="${escapeHtml(name)}" placeholder="Sub-task name" style="flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 13px;">
        <span style="font-size: 10px; color: var(--text-muted); white-space: nowrap;">by ${escapeHtml(creator)}</span>
        <button type="button" onclick="this.closest('.subtask-field-row').remove()" style="background: none; border: none; cursor: pointer; color: var(--danger); font-size: 16px;">&times;</button>
    `;
    container.appendChild(row);
}

function populateSubTaskFields(subtasks = []) {
    const container = document.getElementById('subTasksContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!subtasks || subtasks.length === 0) {
        container.innerHTML = '<div class="empty-subtasks-msg" style="font-size: 12px; color: var(--text-muted); font-style: italic; text-align: center;">No sub-tasks added.</div>';
        return;
    }
    subtasks.forEach(st => addSubTaskField(st.name || st.text, st.completed, st.createdBy));
}

// Saves a task to Firestore and triggers Direct Assignment Alerts
export async function saveTask() {
    const id = document.getElementById('taskId').value;
    const name = document.getElementById('taskName').value.trim();
    if (!name) { alert("Task name is required!"); return; }

    const assignees = Array.from(document.querySelectorAll('.todo-assignee-cb:checked')).map(cb => cb.value);
    const bucket = document.getElementById('taskBucket')?.value || 'actionable';
    const priority = document.getElementById('taskPriority')?.value || '';
    const frictionTag = document.getElementById('taskFriction')?.value || '';
    const category = document.getElementById('taskCategory')?.value || 'Home';
    const location = document.getElementById('taskLocation')?.value || 'Inside';
    const notes = document.getElementById('taskNotes')?.value.trim() || '';

    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeName = ALL_USERS.find(u => u.uid === activeUid)?.name || 'Alyssa';
    const createdBy = document.getElementById('taskCreatedBy')?.value || activeName;

    const subTasks = [];
    document.querySelectorAll('.subtask-field-row').forEach(row => {
        const subId = row.querySelector('.subtask-id').value;
        const subName = row.querySelector('.subtask-name').value.trim();
        const subCreator = row.querySelector('.subtask-created-by')?.value || createdBy;
        if (subName) subTasks.push({ id: subId, name: subName, completed: false, createdBy: subCreator, createdAt: new Date().toISOString() });
    });

    const taskData = {
        name,
        category,
        location,
        bucket,
        priority,
        frictionTag,
        createdBy,
        notes,
        assignees,
        subTasks
    };

    try {
        let createdId = id;
        if (id) {
            await api.updateFirestoreDocument('custom_tasks', id, taskData);
        } else {
            taskData.completed = false;
            taskData.createdAt = new Date().toISOString();
            const docRef = await window.getNiptoCollection('custom_tasks').add(taskData);
            createdId = docRef.id;

            // Direct Assignment Alert to Home Assistant for Adults
            dispatchDirectAssignmentAlerts(taskData, createdId);
        }

        closeTaskModal();
    } catch (e) {
        console.error("Error saving task:", e);
        alert("Failed to save task: " + e.message);
    }
}

// Dispatches Home Assistant push notification if assigned directly to an adult
function dispatchDirectAssignmentAlerts(task, taskId) {
    if (!task.assignees || task.assignees.length === 0) return;
    const adultProfiles = state.notificationPreferences?.adults || {};
    const activeUserName = ALL_USERS.find(u => u.uid === state.activeUsers[0])?.name || 'Someone';

    task.assignees.forEach(uid => {
        const profile = adultProfiles[uid];
        if (profile && profile.haTarget && profile.directAssignmentAlerts) {
            const appUrl = (state.integrationsConfig?.publicAppUrl || NIPTO_PUBLIC_URL);
            const payload = {
                targets: [profile.haTarget],
                title: `Task Assigned: ${task.name}`,
                message: `Assigned to you by ${activeUserName}`,
                tag: `task_${taskId}`,
                cooldown_seconds: 0,
                critical: false,
                dashboard_path: appUrl,
                actions: [
                    { action: "URI", title: "Mark Done", uri: `${appUrl}?quickAction=complete&taskId=${taskId}` },
                    { action: "URI", title: "Snooze 1 Hr", uri: `${appUrl}?quickAction=snooze&taskId=${taskId}` }
                ]
            };
            api.dispatchHomeAssistantNotification(payload);
        }
    });
}

export async function deleteTask(id) {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
        await api.deleteFirestoreDocument('custom_tasks', id);
    } catch (e) {
        alert("Error deleting task: " + e.message);
    }
}

// Bind to window for HTML onclicks
if (typeof window !== 'undefined') {
    window.setTodoView = setTodoView;
    window.setTodoPersonFilter = setTodoPersonFilter;
    window.setTodoBucketFilter = setTodoBucketFilter;
    window.setTodoFrictionFilter = setTodoFrictionFilter;
    window.setTodoPriorityFilter = setTodoPriorityFilter;
    window.toggleSubtasksList = toggleSubtasksList;
    window.clearTaskFriction = clearTaskFriction;
    window.toggleTaskStatus = toggleTaskStatus;
    window.toggleSubTask = toggleSubTask;
    window.openTaskModal = openTaskModal;
    window.closeTaskModal = closeTaskModal;
    window.editTask = editTask;
    window.saveTask = saveTask;
    window.deleteTask = deleteTask;
    window.addSubTaskField = addSubTaskField;
    window.renderTodoTasks = renderTodoTasks;
}
