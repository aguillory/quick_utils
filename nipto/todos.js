// todos.js
// General to-do tasks: list rendering, the add/edit modal, status toggling, and sidebar.
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { updateLeaderboardUI } from './leaderboard.js';
import { saveCloudCollapsed } from './preferences.js';
import { populateTaskPointsSelect } from './niptoTasks.js';
import { enableDragSort } from './dragSort.js';
import { saveCloudPreference } from './preferences.js';

// Priority ranking for sorting (high -> low)
const PRIORITY_RANK = { High: 3, Medium: 2, Low: 1 };

// Reads a filter <select> value safely.
function getFilterValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : 'all';
}
// Hides a filter when it matches the current sort, and resets it so a
// hidden filter never silently restricts the list.
function updateTodoFilterVisibility(viewBy) {
    const map = {
        assigneeFilter: 'assignee',
        categoryFilter: 'category',
        locationFilter: 'location',
        priorityFilter: 'priority'
    };
    Object.keys(map).forEach(function (id) {
        const el = document.getElementById(id);
        if (!el) return;
        const wrapper = el.closest('.todo-filter') || el;
        if (viewBy === map[id]) {
            el.value = 'all';
            wrapper.style.display = 'none';
        } else {
            wrapper.style.display = '';
        }
    });
}
// Renders the grouped to-do list in the main pane.
export function renderTodoTasks() {
    const container = document.getElementById('todoContainer');
    populateTodoFilters();
    const viewSelect = document.getElementById('viewSelect');
    const viewBy = viewSelect ? viewSelect.value : 'category';
    updateTodoFilterVisibility(viewBy);
    const assigneeFilter = getFilterValue('assigneeFilter');
    const categoryFilter = getFilterValue('categoryFilter');
    const locationFilter = getFilterValue('locationFilter');
    const priorityFilter = getFilterValue('priorityFilter');
    let sourceTasks = state.todoTasksData || [];
    if (viewBy !== 'assignee' && assigneeFilter !== 'all') {
        if (assigneeFilter === 'unassigned') {
            sourceTasks = sourceTasks.filter(function (t) { return !t.assignees || t.assignees.length === 0; });
        } else {
            sourceTasks = sourceTasks.filter(function (t) { return t.assignees && t.assignees.includes(assigneeFilter); });
        }
    }
    if (viewBy !== 'category' && categoryFilter !== 'all') {
        sourceTasks = sourceTasks.filter(function (t) { return (t.category || 'Uncategorized') === categoryFilter; });
    }
    if (viewBy !== 'location' && locationFilter !== 'all') {
        sourceTasks = sourceTasks.filter(function (t) { return (t.location || 'N/A') === locationFilter; });
    }
    if (viewBy !== 'priority' && priorityFilter !== 'all') {
        sourceTasks = sourceTasks.filter(function (t) { return (t.priority || 'Medium') === priorityFilter; });
    }
    container.innerHTML = '';
    if (sourceTasks.length === 0) {
        container.innerHTML = '<div class="empty-dashboard-msg" style="padding: 20px; text-align: center; color: var(--text-muted);">No general tasks found. Click "Add Task" to get started.</div>';
        return;
    }
    const grouped = {};
    sourceTasks.forEach(function (task) {
        if (viewBy === 'assignee') {
            if (!task.assignees || task.assignees.length === 0) {
                (grouped['Unassigned'] = grouped['Unassigned'] || []).push(task);
            } else {
                task.assignees.forEach(function (uid) {
                    const u = ALL_USERS.find(function (user) { return user.uid === uid; });
                    const name = u ? u.name : 'Unknown';
                    (grouped[name] = grouped[name] || []).push(task);
                });
            }
        } else {
            let key;
            if (viewBy === 'category') key = task.category || 'Uncategorized';
            else if (viewBy === 'location') key = task.location || 'N/A';
            else if (viewBy === 'priority') key = task.priority || 'Medium';
            else key = task[viewBy] || 'Uncategorized';
            (grouped[key] = grouped[key] || []).push(task);
        }
    });
    const activeUser = state.activeUsers[0] || 'default';
    let keys = Object.keys(grouped);
    if (viewBy === 'priority') {
        keys.sort(function (a, b) { return (PRIORITY_RANK[b] || 0) - (PRIORITY_RANK[a] || 0); });
    } else {
        const savedOrder = state.userPrefs.todoSortOrder || [];
        keys.sort(function (a, b) {
            const idxA = savedOrder.indexOf(a);
            const idxB = savedOrder.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });
    }
    keys.forEach(function (key) {
        const section = document.createElement('div');
        section.className = 'group-section category-section';
        const isCatCollapsed = localStorage.getItem('todo_cat_' + activeUser + '_' + key) === 'true';
        const orderControls =
            '<span class="drag-handle" style="cursor: grab; font-size: 18px; margin-left: 10px; padding: 0 8px; opacity: 0.6;" title="Drag to reorder">&#9776;</span>' +
            '<span class="sort-controls" style="font-size: 14px; opacity: 0.5;">' +
            '<button onclick="moveCategory(\'' + key + '\', -1, \'todo\', event)" style="cursor:pointer; background:none; border:none;" title="Move Up">&#9650;</button>' +
            '<button onclick="moveCategory(\'' + key + '\', 1, \'todo\', event)" style="cursor:pointer; background:none; border:none;" title="Move Down">&#9660;</button>' +
            '</span>';
        const header = document.createElement('h3');
        header.className = 'category-header collapsible-header';
        header.innerHTML = key + ' ' + orderControls +
            ' <span class="toggle-icon ' + (isCatCollapsed ? 'collapsed' : '') + '" style="margin-left: auto;">&#9660;</span>';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.color = 'var(--primary)';
        header.style.textTransform = 'capitalize';
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'collapsible-content ' + (isCatCollapsed ? 'collapsed' : '');
        header.onclick = function (e) {
            if (e.target.tagName === 'BUTTON' || e.target.classList.contains('drag-handle')) return;
            const collapsed = contentWrapper.classList.toggle('collapsed');
            header.querySelector('.toggle-icon').classList.toggle('collapsed', collapsed);
            saveCloudCollapsed('todo_' + key, collapsed);
        };
        section.appendChild(header);
        grouped[key].sort(function (a, b) {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            if (viewBy !== 'priority') {
                const pr = (PRIORITY_RANK[b.priority] || 2) - (PRIORITY_RANK[a.priority] || 2);
                if (pr !== 0) return pr;
            }
            const aIsIndividual = (a.assignees || []).length === 1;
            const bIsIndividual = (b.assignees || []).length === 1;
            if (aIsIndividual && !bIsIndividual) return -1;
            if (!aIsIndividual && bIsIndividual) return 1;
            return 0;
        });
        grouped[key].forEach(function (task) {
            const card = document.createElement('div');
            card.className = 'chore-card ' + (task.completed ? 'completed' : '');
            let pointsDisplay = '';
            if (task.linkedNiptoTask && task.linkedNiptoTask !== 'null') {
                const linkedTaskInfo = state.tasks.find(function (t) { return t.uid === task.linkedNiptoTask; });
                const pts = linkedTaskInfo ? Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor) : '?';
                pointsDisplay = '<span style="color: var(--primary); font-size: 11px; font-weight: bold; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">&#11088; ' + pts + ' pts</span>';
            }
            let assigneesHtml = '';
            if (task.assignees && task.assignees.length > 0) {
                assigneesHtml = task.assignees.map(function (uid) {
                    const u = ALL_USERS.find(function (user) { return user.uid === uid; });
                    return u ? '<span style="color: ' + u.color + '; font-size: 11px; font-weight: bold; margin-right: 4px; background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">&#128100; ' + u.name + '</span>' : '';
                }).join('');
            }
            const linkedTaskArg = task.linkedNiptoTask ? "'" + task.linkedNiptoTask + "'" : 'null';
            card.innerHTML =
                '<div class="chore-header">' +
                '<div class="chore-title-area">' +
                '<div class="chore-title" style="' + (task.completed ? 'text-decoration: line-through; color: var(--text-muted);' : '') + '">' + task.name + '</div>' +
                '<div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">' +
                '<span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">&#128193; ' + (task.category || 'None') + '</span>' +
                '<span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">&#128205; ' + (task.location || 'N/A') + '</span>' +
                '<span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">&#9889; ' + task.priority + '</span>' +
                assigneesHtml +
                pointsDisplay +
                '</div>' +
                '</div>' +
                '<div class="chore-actions">' +
                '<button class="chore-btn complete-btn" onclick="toggleTaskStatus(\'' + task.id + '\', ' + task.completed + ', ' + linkedTaskArg + ')" title="Mark Complete/Incomplete">' + (task.completed ? '&#9194;' : '&#9989;') + '</button>' +
                '<button class="chore-btn" onclick="editTask(\'' + task.id + '\')" title="Edit">&#9999;&#65039;</button>' +
                '<button class="chore-btn delete-btn" onclick="deleteTask(\'' + task.id + '\')" title="Delete">&#128465;&#65039;</button>' +
                '</div>' +
                '</div>' +
                (task.notes ? '<div class="chore-desc" style="display: block; margin-top: 8px;">' + task.notes + '</div>' : '');
            contentWrapper.appendChild(card);
        });
        section.appendChild(contentWrapper);
        container.appendChild(section);
    });
    enableDragSort('todoContainer', function (order) { saveCloudPreference('todoSortOrder', order); });
}
// Fills the assignee filter dropdown and refreshes category/location filters.
export function populateTodoAssigneeFilter() {
    const select = document.getElementById('assigneeFilter');
    if (select) {
        const current = select.value || 'all';
        select.innerHTML = '<option value="all">All Assignees</option><option value="unassigned">Anyone / Unassigned</option>';
        ALL_USERS.forEach(function (u) { select.innerHTML += '<option value="' + u.uid + '">' + u.name + '</option>'; });
        select.value = current;
    }
    populateTodoFilters();
}
// Populates the category/location filter dropdowns from current task data.
export function populateTodoFilters() {
    const categories = new Set();
    const locations = new Set();
    (state.todoTasksData || []).forEach(function (t) {
        if (t.category && t.category.trim() !== '') categories.add(t.category.trim());
        if (t.location && t.location.trim() !== '') locations.add(t.location.trim());
    });
    const catSel = document.getElementById('categoryFilter');
    if (catSel) {
        const cur = catSel.value || 'all';
        catSel.innerHTML = '<option value="all">All Categories</option>';
        Array.from(categories).sort().forEach(function (c) { catSel.innerHTML += '<option value="' + c + '">' + c + '</option>'; });
        catSel.value = Array.from(catSel.options).some(function (o) { return o.value === cur; }) ? cur : 'all';
    }
    const locSel = document.getElementById('locationFilter');
    if (locSel) {
        const cur = locSel.value || 'all';
        locSel.innerHTML = '<option value="all">All Locations</option>';
        Array.from(locations).sort().forEach(function (l) { locSel.innerHTML += '<option value="' + l + '">' + l + '</option>'; });
        locSel.value = Array.from(locSel.options).some(function (o) { return o.value === cur; }) ? cur : 'all';
    }
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