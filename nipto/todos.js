// todos.js
// General to-do tasks: list rendering, the add/edit modal, status toggling, and sidebar.
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { updateLeaderboardUI } from './leaderboard.js';
import { saveCloudCollapsed } from './preferences.js';
import { populateTaskPointsSelect } from './niptoTasks.js';
import { enableDragSort } from './dragSort.js';
import { saveCloudPreference } from './preferences.js';

// Renders the grouped to-do list in the main pane.
export function renderTodoTasks() {
    const container = document.getElementById('todoContainer');
    const viewSelect = document.getElementById('viewSelect');
    const viewBy = viewSelect ? viewSelect.value : 'category'
    const assigneeSel = document.getElementById('assigneeFilter');
const assigneeFilter = assigneeSel ? assigneeSel.value : 'all';

let sourceTasks = state.todoTasksData;
if (assigneeFilter === 'unassigned') {
    sourceTasks = sourceTasks.filter(t => !t.assignees || t.assignees.length === 0);
} else if (assigneeFilter !== 'all') {
    sourceTasks = sourceTasks.filter(t => t.assignees && t.assignees.includes(assigneeFilter));
};
    container.innerHTML = '';

    if (!state.todoTasksData || sourceTasks.length === 0) {
        container.innerHTML = '<div class="empty-dashboard-msg" style="padding: 20px; text-align: center; color: var(--text-muted);">No general tasks found. Click "Add Task" to get started.</div>';
        return;
    }

const grouped = sourceTasks.reduce((acc, task) => {
        const key = task[viewBy] || 'Uncategorized';
        if (!acc[key]) acc[key] = [];
        acc[key].push(task);
        return acc;
    }, {});

let activeUser = state.activeUsers[0] || 'default';
let savedOrder = state.userPrefs.todoSortOrder || [];
    let keys = Object.keys(grouped);

    keys.sort((a, b) => {
        let idxA = savedOrder.indexOf(a);
        let idxB = savedOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    keys.forEach(key => {
        const section = document.createElement('div');
        section.className = 'group-section category-section';

        const isCatCollapsed = localStorage.getItem(`todo_cat_${activeUser}_${key}`) === 'true';

        const orderControls = `<span class="sort-controls" style="font-size: 14px; margin-left: 10px; opacity: 0.5;">
        <button onclick="moveCategory('${key}', -1, 'todo', event)" style="cursor:pointer; background:none; border:none;" title="Move Up">▲</button>
        <button onclick="moveCategory('${key}', 1, 'todo', event)" style="cursor:pointer; background:none; border:none;" title="Move Down">▼</button>
        </span>`;

        const header = document.createElement('h3');
        header.className = 'category-header collapsible-header';
        header.innerHTML = `${key} ${orderControls} <span class="toggle-icon ${isCatCollapsed ? 'collapsed' : ''}" style="margin-left: auto;">▼</span>`;
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.color = 'var(--primary)';
        header.style.textTransform = 'capitalize';

        const contentWrapper = document.createElement('div');
        contentWrapper.className = `collapsible-content ${isCatCollapsed ? 'collapsed' : ''}`;

        header.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const collapsed = contentWrapper.classList.toggle('collapsed');
            header.querySelector('.toggle-icon').classList.toggle('collapsed', collapsed);
            saveCloudCollapsed("todo_" + key, collapsed);
        };

        section.appendChild(header);
        grouped[key].sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            const aIsIndividual = (a.assignees || []).length === 1;
            const bIsIndividual = (b.assignees || []).length === 1;
            if (aIsIndividual && !bIsIndividual) return -1;
            if (!aIsIndividual && bIsIndividual) return 1;
            return 0;
        });

        grouped[key].forEach(task => {
            const card = document.createElement('div');
            card.className = `chore-card ${task.completed ? 'completed' : ''}`;

            let pointsDisplay = '';
            if (task.linkedNiptoTask && task.linkedNiptoTask !== 'null') {
                const linkedTaskInfo = state.tasks.find(t => t.uid === task.linkedNiptoTask);
                const pts = linkedTaskInfo ? Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor) : '?';
                pointsDisplay = `<span style="color: var(--primary); font-size: 11px; font-weight: bold; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">⭐ ${pts} pts</span>`;
            }

            let assigneesHtml = '';
            if (task.assignees && task.assignees.length > 0) {
                assigneesHtml = task.assignees.map(uid => {
                    const u = ALL_USERS.find(user => user.uid === uid);
                    return u ? `<span style="color: ${u.color}; font-size: 11px; font-weight: bold; margin-right: 4px; background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">👤 ${u.name}</span>` : '';
                }).join('');
            }

            const linkedTaskArg = task.linkedNiptoTask ? `'${task.linkedNiptoTask}'` : 'null';

            card.innerHTML = `
            <div class="chore-header">
            <div class="chore-title-area">
            <div class="chore-title" style="${task.completed ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">${task.name}</div>
            <div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
            <span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">📁 ${task.category || 'None'}</span>
            <span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">📍 ${task.location || 'N/A'}</span>
            <span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">⚡ ${task.priority}</span>
            ${assigneesHtml}
            ${pointsDisplay}
            </div>
            </div>
            <div class="chore-actions">
            <button class="chore-btn complete-btn" onclick="toggleTaskStatus('${task.id}', ${task.completed}, ${linkedTaskArg})" title="Mark Complete/Incomplete">
            ${task.completed ? '⏪' : '✅'}
            </button>
            <button class="chore-btn" onclick="editTask('${task.id}')" title="Edit">✏️</button>
            <button class="chore-btn delete-btn" onclick="deleteTask('${task.id}')" title="Delete">🗑️</button>
            </div>
            </div>
            ${task.notes ? `<div class="chore-desc" style="display: block; margin-top: 8px;">${task.notes}</div>` : ''}
            `;
            contentWrapper.appendChild(card);
        });
        section.appendChild(contentWrapper);
        container.appendChild(section);
    });
enableDragSort('todoContainer', (order) => saveCloudPreference('todoSortOrder', order));
}

// Fills the assignee filter dropdown (keeps the static All/Unassigned options).
export function populateTodoAssigneeFilter() {
    const select = document.getElementById('assigneeFilter');
    if (!select) return;
    const current = select.value || 'all';
    select.innerHTML = `
        <option value="all">All Assignees</option>
        <option value="unassigned">Anyone / Unassigned</option>`;
    ALL_USERS.forEach(u => { select.innerHTML += `<option value="${u.uid}">${u.name}</option>`; });
    select.value = current;
}

// Refreshes the category/location autocomplete datalists.
export function updateTaskDatalists() {
    const categories = new Set();
    const locations = new Set();

    if (state.todoTasksData) {
        state.todoTasksData.forEach(task => {
            if (task.category && task.category.trim() !== "") categories.add(task.category.trim());
            if (task.location && task.location.trim() !== "") locations.add(task.location.trim());
        });
    }
    if (state.tasks) {
        state.tasks.forEach(task => {
            if (task.category && task.category.trim() !== "" && task.category !== "📌") categories.add(task.category.trim());
        });
    }

    const catDatalist = document.getElementById('categoryOptions');
    const locDatalist = document.getElementById('locationOptions');
    if (catDatalist) catDatalist.innerHTML = Array.from(categories).sort().map(c => `<option value="${c}"></option>`).join('');
    if (locDatalist) locDatalist.innerHTML = Array.from(locations).sort().map(l => `<option value="${l}"></option>`).join('');
}

// Opens the modal for creating a new task.
export function openTaskModal() {
    document.getElementById('taskModalTitle').innerText = "Add Task";
    document.getElementById('taskId').value = '';
    document.getElementById('taskName').value = '';
    document.getElementById('taskCategory').value = '';
    document.getElementById('taskLocation').value = '';
    document.getElementById('taskPriority').value = 'Medium';
    document.getElementById('taskNotes').value = '';
    populateTodoAssignees([]);
    updateTaskDatalists();
    populateTaskPointsSelect('');
    document.getElementById('taskModal').style.display = 'flex';
}

// Opens the modal pre-filled to edit an existing task.
export function editTask(id) {
    const task = state.todoTasksData.find(t => t.id === id);
    if (!task) return;

    document.getElementById('taskModalTitle').innerText = "Edit Task";
    document.getElementById('taskId').value = task.id;
    document.getElementById('taskName').value = task.name || '';
    document.getElementById('taskCategory').value = task.category || '';
    document.getElementById('taskLocation').value = task.location || '';
    document.getElementById('taskPriority').value = task.priority || 'Medium';
    document.getElementById('taskNotes').value = task.notes || '';
    populateTodoAssignees(task.assignees || []);
    updateTaskDatalists();
    populateTaskPointsSelect(task.linkedNiptoTask || '');
    document.getElementById('taskModal').style.display = 'flex';
}

// Creates or updates a task from the modal fields.
export async function saveTask() {
    const id = document.getElementById('taskId').value;
    const assignees = Array.from(document.querySelectorAll('.todo-assignee-cb:checked')).map(cb => cb.value);

    const taskData = {
        name: document.getElementById('taskName').value.trim(),
        category: document.getElementById('taskCategory').value.trim(),
        location: document.getElementById('taskLocation').value.trim(),
        priority: document.getElementById('taskPriority').value,
        linkedNiptoTask: document.getElementById('taskPoints').value || null,
        notes: document.getElementById('taskNotes').value.trim(),
        assignees: assignees
    };

    if (!taskData.name) { alert("Task name is required!"); return; }

    if (id) {
        await api.updateFirestoreDocument('custom_tasks', id, taskData);
    } else {
        taskData.completed = false;
        await api.addFirestoreDocument('custom_tasks', taskData);
    }
    closeTaskModal();
}

// Closes the task modal.
export function closeTaskModal() {
    document.getElementById('taskModal').style.display = 'none';
}

// Deletes a to-do task after confirmation.
export async function deleteTask(id) {
    if (confirm("Are you sure you want to delete this task?")) {
        await api.deleteFirestoreDocument('custom_tasks', id);
    }
}

// Toggles completion; awards points to Nipto if the task is linked.
export async function toggleTaskStatus(taskId, currentStatus, linkedNiptoTask) {
    if (!currentStatus && linkedNiptoTask && linkedNiptoTask !== 'null') {
        if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return; }
        if (state.activeUsers.length === 0) { alert("Select who completed this task at the top of the dashboard first!"); return; }

        let targetDate = state.currentMode === 'live' ? new Date() : new Date(document.getElementById('taskDate').value);

        try {
           const activityUids = await api.logActivityToNipto(linkedNiptoTask, targetDate.toISOString());
const todo = state.todoTasksData.find(t => t.id === taskId);
await api.saveActivityLabels(activityUids, todo ? todo.name : 'To-Do Task');   // NEW
await api.updateFirestoreDocument('custom_tasks', taskId, {
    completed: true,
    completedActivityUids: activityUids,
    completedBy: state.activeUsers,
    completedAt: targetDate.toISOString()
});
            updateLeaderboardUI();
        } catch (error) { alert("Error awarding points: " + error.message); }
    } else {
        await api.updateFirestoreDocument('custom_tasks', taskId, {
            completed: !currentStatus,
            completedAt: !currentStatus ? new Date().toISOString() : null
        });
    }
}

// Builds the assignee checkboxes in the task modal.
export function populateTodoAssignees(selectedUids = []) {
    const container = document.getElementById('todoAssignees');
    container.innerHTML = '';
    ALL_USERS.forEach(u => {
        const isChecked = selectedUids.includes(u.uid) ? 'checked' : '';
        container.innerHTML += `
        <label style="font-size: 13px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
        <input type="checkbox" value="${u.uid}" class="todo-assignee-cb" ${isChecked}> ${u.name}
        </label>`;
    });
}

// Renders the active user's unfinished to-dos in the sidebar.
export function renderSidebarTodos() {
    const container = document.getElementById('sidebarTodosContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!state.todoTasksData) return;

    let visibleTodos = state.todoTasksData.filter(t => !t.completed && t.assignees && state.activeUsers.some(uid => t.assignees.includes(uid)));

    if (visibleTodos.length === 0) {
        container.innerHTML = '<div class="empty-history" style="margin-top: 10px;">No general to-dos assigned.</div>'; return;
    }

    visibleTodos.forEach(task => {
        const linkedTaskArg = task.linkedNiptoTask ? `'${task.linkedNiptoTask}'` : 'null';
        const card = document.createElement('div');
        card.className = 'chore-card';
        const assigneesHtml = (task.assignees || []).map(uid => {
            const u = ALL_USERS.find(user => user.uid === uid);
            return u ? `<span style="color: ${u.color}; font-size: 10px; margin-right: 3px;">${u.name}</span>` : '';
        }).join('');

        let pts = '';
        if (task.linkedNiptoTask && task.linkedNiptoTask !== 'null') {
            const linkedTaskInfo = state.tasks.find(t => t.uid === task.linkedNiptoTask);
            if (linkedTaskInfo) pts = `⭐ ${Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor)} pts`;
        }

        card.innerHTML = `
        <div class="chore-header" style="flex-direction: column; align-items: flex-start; gap: 6px;">
        <div style="display: flex; justify-content: space-between; width: 100%;">
        <div class="chore-title" style="font-size: 13px;">📋 ${task.name}</div>
        <button class="chore-btn complete-btn" style="padding: 4px 8px; font-size: 12px;" onclick="toggleTaskStatus('${task.id}', ${task.completed}, ${linkedTaskArg})">✅</button>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; flex-wrap: wrap;">
        <span>👥 ${assigneesHtml || 'Anyone'}</span>
        <span style="color: ${task.priority === 'High' ? 'var(--danger)' : 'inherit'}">⚡ ${task.priority || 'Medium'}</span>
        ${pts ? `<span style="color: var(--primary); font-weight: bold;">${pts}</span>` : ''}
        </div>
        </div>
        `;
        container.appendChild(card);
    });
}