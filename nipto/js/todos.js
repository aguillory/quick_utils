// todos.js
// Active To-Dos: Person / Bucket / Friction Filter Pills, Subtasks,
// and Direct Assignment Alerts to Home Assistant.

import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { updateLeaderboardUI } from './leaderboard.js';

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
// FILTER PILLS HANDLERS
// ==========================================
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

// ==========================================
// MAIN TO-DOS RENDERER
// ==========================================
export function renderTodoTasks() {
    const container = document.getElementById('todoContainer');
    if (!container) return;

    let tasks = state.todoTasksData || [];
    const activeUid = state.activeUsers[0] || '';

    // Apply Person filter
    const personFilter = state.todoPersonFilter || 'all';
    if (personFilter === 'me') {
        tasks = tasks.filter(t => t.assignees && t.assignees.includes(activeUid));
    } else if (personFilter === 'unassigned') {
        tasks = tasks.filter(t => !t.assignees || t.assignees.length === 0);
    } else if (personFilter !== 'all') {
        tasks = tasks.filter(t => t.assignees && t.assignees.includes(personFilter));
    }

    // Apply Bucket filter
    const bucketFilter = state.todoBucketFilter || 'all';
    if (bucketFilter === 'actionable') {
        tasks = tasks.filter(t => (t.bucket || 'actionable') === 'actionable');
    } else if (bucketFilter === 'project_idea') {
        tasks = tasks.filter(t => t.bucket === 'project_idea');
    }

    // Apply Friction filter
    const frictionFilter = state.todoFrictionFilter || 'all';
    if (frictionFilter !== 'all') {
        tasks = tasks.filter(t => (t.frictionTag || 'quick') === frictionFilter);
    }

    // 1. Render Filter Pills UI
    let filterHtml = `
    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; background: var(--card-bg); padding: 14px; border-radius: 10px; border: 1px solid var(--border-color);">
        <!-- Person Filters -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; width: 65px;">Person:</span>
            <button class="filter-pill ${personFilter === 'all' ? 'active' : ''}" onclick="setTodoPersonFilter('all')">All</button>
            <button class="filter-pill ${personFilter === 'me' ? 'active' : ''}" onclick="setTodoPersonFilter('me')">My To-Dos</button>
            <button class="filter-pill ${personFilter === 'unassigned' ? 'active' : ''}" onclick="setTodoPersonFilter('unassigned')">Anyone</button>
        </div>

        <!-- Bucket Filters -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; width: 65px;">Bucket:</span>
            <button class="filter-pill ${bucketFilter === 'all' ? 'active' : ''}" onclick="setTodoBucketFilter('all')">All Buckets</button>
            <button class="filter-pill ${bucketFilter === 'actionable' ? 'active' : ''}" onclick="setTodoBucketFilter('actionable')">&#x26A1; Actionable To-Dos</button>
            <button class="filter-pill ${bucketFilter === 'project_idea' ? 'active' : ''}" onclick="setTodoBucketFilter('project_idea')">&#x1F4A1; Project Ideas / Someday</button>
        </div>

        <!-- Friction Filters -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; width: 65px;">Friction:</span>
            <button class="filter-pill ${frictionFilter === 'all' ? 'active' : ''}" onclick="setTodoFrictionFilter('all')">All</button>
            <button class="filter-pill ${frictionFilter === 'quick' ? 'active' : ''}" onclick="setTodoFrictionFilter('quick')">&#x26A1; Quick (&lt;5m)</button>
            <button class="filter-pill ${frictionFilter === 'low_brain' ? 'active' : ''}" onclick="setTodoFrictionFilter('low_brain')">&#x1F9E0; Low Brain</button>
            <button class="filter-pill ${frictionFilter === 'deep_focus' ? 'active' : ''}" onclick="setTodoFrictionFilter('deep_focus')">&#x1F3AF; Deep Focus</button>
        </div>
    </div>
    `;

    if (tasks.length === 0) {
        container.innerHTML = filterHtml + '<div style="text-align: center; color: var(--text-muted); padding: 30px;">No to-dos matching the active filters. Click "+ Add Task" to create one.</div>';
        return;
    }

    // Sort: incomplete first, then by createdAt desc
    tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    let listHtml = `<div style="display: flex; flex-direction: column; gap: 10px;">`;

    tasks.forEach(t => {
        const isCompleted = !!t.completed;
        const assignees = t.assignees || [];
        let assigneesHtml = '';
        if (assignees.length === 0) {
            assigneesHtml = `<span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">&#x1F465; Anyone</span>`;
        } else {
            assigneesHtml = assignees.map(uid => {
                const u = ALL_USERS.find(user => user.uid === uid);
                return u ? `<span style="color: ${u.color}; font-size: 11px; font-weight: bold; background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">&#x1F464; ${escapeHtml(u.name)}</span>` : '';
            }).join(' ');
        }

        // Friction badge
        let frictionBadge = '';
        const fTag = t.frictionTag || 'quick';
        if (fTag === 'quick') frictionBadge = `<span style="font-size: 10px; font-weight: 800; color: #0284c7; background: rgba(2,132,199,0.1); padding: 2px 6px; border-radius: 4px;">&#x26A1; Quick</span>`;
        else if (fTag === 'low_brain') frictionBadge = `<span style="font-size: 10px; font-weight: 800; color: #16a34a; background: rgba(22,163,74,0.1); padding: 2px 6px; border-radius: 4px;">&#x1F9E0; Low Brain</span>`;
        else if (fTag === 'deep_focus') frictionBadge = `<span style="font-size: 10px; font-weight: 800; color: #7c3aed; background: rgba(124,58,237,0.1); padding: 2px 6px; border-radius: 4px;">&#x1F3AF; Deep Focus</span>`;

        // Bucket badge
        const bucketBadge = t.bucket === 'project_idea'
            ? `<span style="font-size: 10px; font-weight: 800; color: #d97706; background: rgba(217,119,6,0.1); padding: 2px 6px; border-radius: 4px;">&#x1F4A1; Project Idea</span>`
            : '';

        // Points
        let ptsDisplay = '';
        if (t.points && t.points > 0) {
            ptsDisplay = `<span class="pts-badge">+${t.points} pts</span>`;
        }

        // Subtasks HTML
        let subtasksHtml = '';
        if (t.subTasks && t.subTasks.length > 0) {
            const completedCount = t.subTasks.filter(st => st.completed).length;
            subtasksHtml = `
            <div style="margin-top: 8px; padding-left: 12px; border-left: 2px solid var(--border-color);">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px;">
                    Sub-tasks (${completedCount}/${t.subTasks.length}):
                </div>
                ${t.subTasks.map(st => `
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0;">
                        <input type="checkbox" ${st.completed ? 'checked' : ''} onchange="toggleSubTask('${t.id}', '${st.id}', this.checked)">
                        <span style="${st.completed ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">${escapeHtml(st.name || st.text)}</span>
                    </div>
                `).join('')}
            </div>
            `;
        }

        listHtml += `
        <div class="chore-card ${isCompleted ? 'completed' : ''}" style="background: var(--card-bg); border-radius: 10px; border: 1px solid var(--border-color); padding: 12px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button type="button" class="btn-check-routine" onclick="toggleTaskStatus('${t.id}', ${isCompleted})" style="flex-shrink: 0;" title="${isCompleted ? 'Mark Incomplete' : 'Mark Complete'}">
                            ${isCompleted ? '&#x21A9;' : '&#x2714;'}
                        </button>
                        <span style="font-size: 15px; font-weight: 700; ${isCompleted ? 'text-decoration: line-through; color: var(--text-muted);' : 'color: var(--text-main);'}">
                            ${escapeHtml(t.name)}
                        </span>
                    </div>

                    <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 6px; margin-left: 36px;">
                        ${assigneesHtml}
                        ${frictionBadge}
                        ${bucketBadge}
                        ${t.category ? `<span style="font-size: 10px; color: var(--text-muted); border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 4px;">&#x1F4C1; ${escapeHtml(t.category)}</span>` : ''}
                        ${ptsDisplay}
                    </div>

                    ${t.notes ? `
                        <div style="margin-top: 6px; margin-left: 36px; font-size: 12px; color: var(--text-muted); white-space: pre-wrap;">
                            ${escapeHtml(t.notes)}
                        </div>
                    ` : ''}

                    <div style="margin-left: 36px;">
                        ${subtasksHtml}
                    </div>
                </div>

                <div style="display: flex; gap: 4px; flex-shrink: 0;">
                    <button class="chore-btn" onclick="editTask('${t.id}')" title="Edit Task">&#x270E;</button>
                    <button class="chore-btn delete-btn" onclick="deleteTask('${t.id}')" title="Delete Task">&#x1F5D1;</button>
                </div>
            </div>
        </div>
        `;
    });

    listHtml += `</div>`;
    container.innerHTML = filterHtml + listHtml;
}

// Completes or uncompletes a task
export async function toggleTaskStatus(taskId, currentCompleted) {
    const todo = state.todoTasksData?.find(t => t.id === taskId);
    if (!todo) return;

    const nextCompleted = !currentCompleted;
    const nowIso = new Date().toISOString();

    const doerUid = state.activeUsers[0] || ALL_USERS[0].uid;
    const doerName = ALL_USERS.find(u => u.uid === doerUid)?.name || 'Someone';

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
        }

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

    const updated = todo.subTasks.map(st => {
        if (st.id === subTaskId) return { ...st, completed: isChecked };
        return st;
    });

    try {
        await api.updateFirestoreDocument('custom_tasks', taskId, { subTasks: updated });
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
    document.getElementById('taskFriction').value = 'quick';
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
    document.getElementById('taskFriction').value = task.frictionTag || 'quick';
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

export function addSubTaskField(name = '', completed = false) {
    const container = document.getElementById('subTasksContainer');
    if (!container) return;
    const emptyMsg = container.querySelector('.empty-subtasks-msg');
    if (emptyMsg) emptyMsg.remove();

    const subId = 'st_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const row = document.createElement('div');
    row.className = 'subtask-field-row';
    row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 6px;';
    row.innerHTML = `
        <input type="hidden" class="subtask-id" value="${subId}">
        <input type="text" class="subtask-name" value="${escapeHtml(name)}" placeholder="Sub-task name" style="flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 13px;">
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
    subtasks.forEach(st => addSubTaskField(st.name || st.text, st.completed));
}

// Saves a task to Firestore and triggers Direct Assignment Alerts
export async function saveTask() {
    const id = document.getElementById('taskId').value;
    const name = document.getElementById('taskName').value.trim();
    if (!name) { alert("Task name is required!"); return; }

    const assignees = Array.from(document.querySelectorAll('.todo-assignee-cb:checked')).map(cb => cb.value);
    const bucket = document.getElementById('taskBucket')?.value || 'actionable';
    const frictionTag = document.getElementById('taskFriction')?.value || 'quick';
    const category = document.getElementById('taskCategory')?.value || 'Home';
    const location = document.getElementById('taskLocation')?.value || 'Inside';
    const notes = document.getElementById('taskNotes')?.value.trim() || '';

    const subTasks = [];
    document.querySelectorAll('.subtask-field-row').forEach(row => {
        const subId = row.querySelector('.subtask-id').value;
        const subName = row.querySelector('.subtask-name').value.trim();
        if (subName) subTasks.push({ id: subId, name: subName, completed: false });
    });

    const taskData = {
        name,
        category,
        location,
        bucket,
        frictionTag,
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
    if (!task.assignees || task.assignees.length === 0) return; // Ignore unassigned / Anyone
    const adultProfiles = state.notificationPreferences?.adults || {};
    const activeUserName = ALL_USERS.find(u => u.uid === state.activeUsers[0])?.name || 'Someone';

    task.assignees.forEach(uid => {
        const profile = adultProfiles[uid];
        if (profile && profile.haTarget && profile.directAssignmentAlerts) {
            const payload = {
                targets: [profile.haTarget],
                title: `Task Assigned: ${task.name}`,
                message: `Assigned to you by ${activeUserName}`,
                tag: `task_${taskId}`,
                cooldown_seconds: 0,
                critical: false,
                dashboard_path: `/nipto/common.html`,
                actions: [
                    { action: "URI", title: "Mark Done", uri: `/nipto/common.html?quickAction=complete&taskId=${taskId}` },
                    { action: "URI", title: "Snooze 1 Hr", uri: `/nipto/common.html?quickAction=snooze&taskId=${taskId}` }
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
window.setTodoPersonFilter = setTodoPersonFilter;
window.setTodoBucketFilter = setTodoBucketFilter;
window.setTodoFrictionFilter = setTodoFrictionFilter;
window.toggleTaskStatus = toggleTaskStatus;
window.toggleSubTask = toggleSubTask;
window.openTaskModal = openTaskModal;
window.closeTaskModal = closeTaskModal;
window.editTask = editTask;
window.saveTask = saveTask;
window.deleteTask = deleteTask;
window.addSubTaskField = addSubTaskField;
