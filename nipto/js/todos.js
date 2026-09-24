// Helper to safely escape HTML while preserving line breaks
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

import { showToast } from './toast.js';
// todos.js
// General to-do tasks: list rendering, the add/edit modal, status toggling, and sidebar.
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { updateLeaderboardUI } from './leaderboard.js';
import { saveCloudCollapsed } from './preferences.js';
import { populateTaskPointsSelect } from './niptoTasks.js';
import { enableDragSort } from './dragSort.js';
import { saveCloudPreference } from './preferences.js';


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
        locationFilter: 'location'
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
    // Preserve expanded subtasks
    const expandedTasks = new Set();
    container.querySelectorAll('.chore-card').forEach(card => {
        const subTasksContainer = card.querySelector('.subtasks-container');
        if (subTasksContainer && subTasksContainer.style.display !== 'none') {
            const taskIdAttr = card.getAttribute('data-task-id');
            if (taskIdAttr) expandedTasks.add(taskIdAttr);
        }
    });

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
            else key = task[viewBy] || 'Uncategorized';
            (grouped[key] = grouped[key] || []).push(task);
        }
    });
    const activeUser = state.activeUsers[0] || 'default';
    let keys = Object.keys(grouped);
    
    const savedOrder = state.userPrefs.todoSortOrder || [];
    keys.sort(function (a, b) {
            const idxA = savedOrder.indexOf(a);
            const idxB = savedOrder.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            
            // Special rule: always push '⚡ Quick Add' to the bottom
            if (a === '⚡ Quick Add' && b !== '⚡ Quick Add') return 1;
            if (b === '⚡ Quick Add' && a !== '⚡ Quick Add') return -1;
            
            return a.localeCompare(b);
        });
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
            const aIsIndividual = (a.assignees || []).length === 1;
            const bIsIndividual = (b.assignees || []).length === 1;
            if (aIsIndividual && !bIsIndividual) return -1;
            if (!aIsIndividual && bIsIndividual) return 1;
            return 0;
        });
        grouped[key].forEach(function (task) {
            const card = document.createElement('div');
            card.className = 'chore-card ' + (task.completed ? 'completed' : '');
            card.setAttribute('data-task-id', task.id);
            let totalPoints = 0;
            let hasValidPoints = false;
            let subTasksList = '';
            
            if (task.subTasks && task.subTasks.length > 0) {
                task.subTasks.forEach(st => {
                    const isCompleted = st.completed;
                    let stPtsDisplay = '';
                    if (st.linkedNiptoTask && st.linkedNiptoTask !== 'null') {
                        const lti = state.tasks.find(t => t.uid === st.linkedNiptoTask);
                        if (lti) {
                            const stPts = Math.ceil(lti.value / state.currentSplitDivisor);
                            totalPoints += stPts;
                            hasValidPoints = true;
                            stPtsDisplay = `<span style="color: var(--primary); font-size: 10px; font-weight: bold; margin-left: 5px;">⭐ ${stPts} pts</span>`;
                        }
                    }
                    const completedByStHtml = (st.completed && st.completedBy && st.completedBy.length > 0) ?
                        `<span style="color: var(--success); font-size: 10px; margin-left: 5px;">(by ${st.completedBy.map(uid => (ALL_USERS.find(u => u.uid === uid) || {}).name).join(', ')})</span>` : '';
                    
                    subTasksList += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px dashed rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" ${isCompleted ? 'checked' : ''} onclick="toggleSubTaskStatus('${task.id}', '${st.id}', this.checked, '${st.linkedNiptoTask || ''}')" style="cursor: pointer; width: 16px; height: 16px;">
                            <span style="font-size: 13px; ${isCompleted ? 'text-decoration: line-through; color: var(--text-muted);' : 'color: var(--text-main);'}">${escapeHtml(st.name)}</span>
                            ${completedByStHtml}
                        </div>
                        ${stPtsDisplay}
                    </div>`;
                });
            } else if (task.linkedNiptoTask && task.linkedNiptoTask !== 'null') {
                const linkedTaskInfo = state.tasks.find(t => t.uid === task.linkedNiptoTask);
                if (linkedTaskInfo) {
                    totalPoints = Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor);
                    hasValidPoints = true;
                }
            }
            
            let pointsDisplay = '';
            if (hasValidPoints) {
                pointsDisplay = '<span style="color: var(--primary); font-size: 11px; font-weight: bold; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">&#11088; ' + totalPoints + ' pts</span>';
            }

            let assigneesHtml = '';
            if (task.assignees && task.assignees.length > 0) {
                assigneesHtml = task.assignees.map(function (uid) {
                    const u = ALL_USERS.find(function (user) { return user.uid === uid; });
                    return u ? '<span style="color: ' + u.color + '; font-size: 11px; font-weight: bold; margin-right: 4px; background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">&#128100; ' + u.name + '</span>' : '';
                }).join('');
            }
            let completedByHtml = '';
            if (task.completed && task.completedBy && task.completedBy.length > 0) {
                completedByHtml = task.completedBy.map(function (uid) {
                    const u = ALL_USERS.find(function (user) { return user.uid === uid; });
                    return u ? '<span style="color: ' + u.color + '; font-size: 11px; font-weight: bold; margin-right: 4px; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--success);">&#9989; Done by: ' + u.name + '</span>' : '';
                }).join('');
            }
            const linkedTaskArg = task.linkedNiptoTask ? "'" + task.linkedNiptoTask + "'" : 'null';
            
            let subTasksHtml = '';
            let expandBtn = '';
            if (subTasksList) {
                const completedCount = task.subTasks.filter(st => st.completed).length;
                const totalCount = task.subTasks.length;
                expandBtn = `<button class="chore-btn" onclick="this.closest('.chore-card').querySelector('.subtasks-container').style.display = this.closest('.chore-card').querySelector('.subtasks-container').style.display === 'none' ? 'block' : 'none';" style="font-size: 11px; font-weight: bold; padding: 2px 6px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color);">🔽 ${completedCount}/${totalCount} Sub-tasks</button>`;
                const displayStyle = expandedTasks.has(task.id) ? 'block' : 'none';
                subTasksHtml = `<div class="subtasks-container chore-desc" style="display: ${displayStyle}; margin-top: 8px;">${subTasksList}</div>`;
            }

            card.innerHTML =
                '<div class="chore-header">' +
                '<div class="chore-title-area">' +
                '<div class="chore-title" style="' + (task.completed ? 'text-decoration: line-through; color: var(--text-muted);' : '') + '">' + task.name + '</div>' +
                '<div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">' +
                '<span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">&#128193; ' + (task.category || 'None') + '</span>' +
                '<span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">&#128205; ' + (task.location || 'N/A') + '</span>' +
                assigneesHtml +
                completedByHtml +
                pointsDisplay +
                expandBtn +
                '</div>' +
                '</div>' +
                '<div class="chore-actions">' +
                '<button class="chore-btn complete-btn" onclick="toggleTaskStatus(\'' + task.id + '\', ' + task.completed + ', ' + linkedTaskArg + ')" title="Mark Complete/Incomplete">' + (task.completed ? '&#9194;' : '&#9989;') + '</button>' +
                '<button class="chore-btn" onclick="editTask(\'' + task.id + '\')" title="Edit">&#9999;&#65039;</button>' +
                '<button class="chore-btn delete-btn" onclick="deleteTask(\'' + task.id + '\')" title="Delete">&#128465;&#65039;</button>' +
                '</div>' +
                '</div>' +
                subTasksHtml +
                (task.notes ? '<div class="chore-desc" style="display: block; margin-top: 8px; white-space: pre-wrap; word-break: break-word;">' + escapeHtml(task.notes) + '</div>' : '');
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
    document.getElementById('taskNotes').value = '';
    populateTodoAssignees([]);
    updateTaskDatalists();
    populateTaskPointsSelect('');
    populateSubTaskFields([]);
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
    document.getElementById('taskNotes').value = task.notes || '';
    populateTodoAssignees(task.assignees || []);
    updateTaskDatalists();
    populateTaskPointsSelect(task.linkedNiptoTask || '');
    populateSubTaskFields(task.subTasks || []);
    document.getElementById('taskModal').style.display = 'flex';
}

// Creates or updates a task from the modal fields.
export async function saveTask() {
    const id = document.getElementById('taskId').value;
    const assignees = Array.from(document.querySelectorAll('.todo-assignee-cb:checked')).map(cb => cb.value);

    const existingTask = id && state.todoTasksData ? state.todoTasksData.find(t => t.id === id) : null;
    const existingSubTasks = existingTask ? (existingTask.subTasks || []) : [];

    const subTasks = [];
    document.querySelectorAll('.subtask-field-row').forEach(row => {
        const subId = row.querySelector('.subtask-id').value;
        const name = row.querySelector('.subtask-name').value.trim();
        const pts = row.querySelector('.subtask-points').value || null;
        if (name) {
            const existing = existingSubTasks.find(st => st.id === subId);
            if (existing) {
                subTasks.push({ ...existing, name: name, linkedNiptoTask: pts });
            } else {
                subTasks.push({ id: subId, name: name, linkedNiptoTask: pts, completed: false, completedBy: [], completedActivityUids: [] });
            }
        }
    });

    const taskData = {
        name: document.getElementById('taskName').value.trim(),
        category: document.getElementById('taskCategory').value.trim(),
        location: document.getElementById('taskLocation').value.trim(),
        linkedNiptoTask: document.getElementById('taskPoints').value || null,
        notes: document.getElementById('taskNotes').value.trim(),
        assignees: assignees,
        subTasks: subTasks
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

// Deletes a to-do task after confirmation, cleaning up any linked Nipto activity
export async function deleteTask(id) {
    if (confirm("Are you sure you want to delete this task?")) {
        const todo = state.todoTasksData ? state.todoTasksData.find(t => t.id === id) : null;
        if (todo && todo.completedActivityUids && todo.completedActivityUids.length > 0) {
            for (const actUid of todo.completedActivityUids) {
                try { await api.deleteActivityFromNipto(actUid); } catch(e) { console.warn("Failed to delete activity on task delete:", e); }
            }
            await updateLeaderboardUI();
        }
        await api.deleteFirestoreDocument('custom_tasks', id);
    }
}

// Toggles completion; awards points to Nipto to whoever marked it off (active user)
export async function toggleTaskStatus(taskId, currentStatus, linkedNiptoTask) {
    const todo = state.todoTasksData ? state.todoTasksData.find(t => t.id === taskId) : null;
    const isCompleted = Boolean(currentStatus === true || currentStatus === 'true' || (todo && todo.completed === true));
    const niptoTaskId = (linkedNiptoTask && linkedNiptoTask !== 'null' && linkedNiptoTask !== 'undefined')
        ? linkedNiptoTask
        : (todo ? todo.linkedNiptoTask : null);

    if (!isCompleted) {
        // Completing the task
        if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return; }
        
        // The person that marked it off gets the points, regardless of who it was assigned to
        const doerUids = (state.activeUsers && state.activeUsers.length > 0) ? [...state.activeUsers] : [];
        if (doerUids.length === 0) {
            alert("Please select who completed this task at the top of the dashboard first!");
            return;
        }

        let targetDate = state.currentMode === 'live'
            ? new Date()
            : new Date(document.getElementById('taskDate')?.value || new Date());
        if (isNaN(targetDate.getTime())) targetDate = new Date();

        const taskName = todo ? todo.name : 'To-Do Task';

        if (niptoTaskId && niptoTaskId !== 'null') {
            try {
                let activityUids = [];
                let totalPointsAwarded = 0;
                
                // If it has sub-tasks, complete all incomplete subtasks instead of the main task points
                let updatedSubTasks = todo.subTasks ? [...todo.subTasks] : null;
                if (updatedSubTasks && updatedSubTasks.length > 0) {
                    for (let i = 0; i < updatedSubTasks.length; i++) {
                        let st = updatedSubTasks[i];
                        if (!st.completed) {
                            st.completed = true;
                            st.completedBy = doerUids;
                            st.completedAt = targetDate.toISOString();
                            if (st.linkedNiptoTask && st.linkedNiptoTask !== 'null') {
                                const subUids = await api.logActivityToNipto(st.linkedNiptoTask, st.completedAt, doerUids);
                                st.completedActivityUids = subUids || [];
                                await api.saveActivityLabels(subUids, `${taskName} - ${st.name}`);
                                const stObj = state.tasks ? state.tasks.find(t => t.uid === st.linkedNiptoTask) : null;
                                if (stObj) totalPointsAwarded += stObj.value;
                            } else {
                                st.completedActivityUids = [];
                            }
                        }
                    }
                } else if (niptoTaskId && niptoTaskId !== 'null') {
                    // Normal main task point awarding
                    activityUids = await api.logActivityToNipto(niptoTaskId, targetDate.toISOString(), doerUids);
                    await api.saveActivityLabels(activityUids, taskName);
                    const tObj = state.tasks ? state.tasks.find(t => t.uid === niptoTaskId) : null;
                    if (tObj) totalPointsAwarded += tObj.value;
                }

                // 3. Mark complete in Firestore with the doer who completed it
                await api.updateFirestoreDocument('custom_tasks', taskId, {
                    completed: true,
                    subTasks: updatedSubTasks || [],
                    completedActivityUids: activityUids,
                    completedBy: doerUids,
                    completedAt: targetDate.toISOString()
                });

                // 4. Update leaderboard and show celebratory toast
                await updateLeaderboardUI();
                const ptsPerUser = Math.ceil(totalPointsAwarded / Math.max(1, doerUids.length));
                const doerNames = doerUids.map(uid => {
                    const u = ALL_USERS.find(user => user.uid === uid);
                    return u ? u.name : 'Unknown';
                }).join(', ');
                showToast(niptoTaskId || ('todo_' + taskId), taskName, ptsPerUser, doerNames);
            } catch (error) {
                console.error("Error awarding points:", error);
                alert("Error awarding points: " + error.message);
            }
        } else {
            // Completed without points linked (or has subtasks but none linked to points)
            let updatedSubTasks = todo.subTasks ? [...todo.subTasks] : null;
            if (updatedSubTasks && updatedSubTasks.length > 0) {
                updatedSubTasks.forEach(st => {
                    if (!st.completed) {
                        st.completed = true;
                        st.completedBy = doerUids;
                        st.completedAt = targetDate.toISOString();
                        st.completedActivityUids = [];
                    }
                });
            }
            await api.updateFirestoreDocument('custom_tasks', taskId, {
                completed: true,
                subTasks: updatedSubTasks || [],
                completedActivityUids: [],
                completedBy: doerUids,
                completedAt: targetDate.toISOString()
            });
            const doerNames = doerUids.map(uid => {
                const u = ALL_USERS.find(user => user.uid === uid);
                return u ? u.name : 'Unknown';
            }).join(', ');
            showToast('todo_' + taskId, taskName, 0, doerNames);
        }
    } else {
        // Uncompleting the task: remove any linked activities from Nipto
        if (todo && todo.completedActivityUids && todo.completedActivityUids.length > 0) {
            for (const actUid of todo.completedActivityUids) {
                try { await api.deleteActivityFromNipto(actUid); } catch(e) { console.warn("Delete activity on uncomplete error:", e); }
            }
        }
        let updatedSubTasks = todo ? (todo.subTasks ? [...todo.subTasks] : null) : null;
        if (updatedSubTasks && updatedSubTasks.length > 0) {
            for (let i = 0; i < updatedSubTasks.length; i++) {
                let st = updatedSubTasks[i];
                if (st.completed) {
                    if (st.completedActivityUids && st.completedActivityUids.length > 0) {
                        for (const actUid of st.completedActivityUids) {
                            try { await api.deleteActivityFromNipto(actUid); } catch(e) {}
                        }
                    }
                    st.completed = false;
                    st.completedBy = [];
                    st.completedAt = null;
                    st.completedActivityUids = [];
                }
            }
        }
        await updateLeaderboardUI();
        await api.updateFirestoreDocument('custom_tasks', taskId, {
            completed: false,
            subTasks: updatedSubTasks || [],
            completedActivityUids: [],
            completedActivityUid: null,
            completedBy: null,
            completedAt: null
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
        ${pts ? `<span style="color: var(--primary); font-weight: bold;">${pts}</span>` : ''}
        </div>
        </div>
        `;
        container.appendChild(card);
    });
}

export function addSubTaskField(name = '', linkedTask = '', id = '') {
    const container = document.getElementById('subTasksContainer');
    if (container.innerHTML.includes('No sub-tasks added.')) {
        container.innerHTML = '';
    }
    
    const div = document.createElement('div');
    div.className = 'subtask-field-row';
    div.style = 'display: flex; gap: 8px; align-items: center;';
    
    // Copy options from main taskPoints dropdown
    const pointOptions = document.getElementById('taskPoints').innerHTML;
    const subtaskId = id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'sub_' + Math.random().toString(36).substring(2, 15));
    
    div.innerHTML = `
        <input type="hidden" class="subtask-id" value="${subtaskId}">
        <input type="text" class="subtask-name" placeholder="Sub-task description" value="${escapeHtml(name)}" style="flex: 2; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 13px;">
        <select class="subtask-points" style="flex: 1; padding: 8px; border-radius: 6px; border: 1px solid var(--primary); font-size: 13px;">
            ${pointOptions}
        </select>
        <button type="button" class="action-btn" onclick="this.parentElement.remove(); if(document.getElementById('subTasksContainer').children.length === 0) document.getElementById('subTasksContainer').innerHTML = '<div style=\\'font-size: 12px; color: var(--text-muted); font-style: italic; text-align: center;\\'>No sub-tasks added.</div>';" style="padding: 4px 8px; font-size: 16px; color: var(--danger); border-color: transparent;">🗑️</button>
    `;
    
    // Set selected points
    if (linkedTask) {
        div.querySelector('.subtask-points').value = linkedTask;
    }
    
    container.appendChild(div);
}

export function populateSubTaskFields(subTasks = []) {
    const container = document.getElementById('subTasksContainer');
    container.innerHTML = '';
    if (!subTasks || subTasks.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); font-style: italic; text-align: center;">No sub-tasks added.</div>';
        return;
    }
    subTasks.forEach(st => addSubTaskField(st.name, st.linkedNiptoTask, st.id));
}

export async function toggleSubTaskStatus(taskId, subTaskId, isComplete, linkedNiptoTask) {
    const task = state.todoTasksData.find(t => t.id === taskId);
    if (!task) return;
    const subTaskIndex = task.subTasks.findIndex(st => st.id === subTaskId);
    if (subTaskIndex === -1) return;
    const st = task.subTasks[subTaskIndex];
    
    st.completed = isComplete;
    if (isComplete) {
        const doerUids = state.activeUsers && state.activeUsers.length > 0 ? state.activeUsers : [state.users[0]?.uid];
        st.completedBy = doerUids;
        st.completedAt = new Date().toISOString();
        if (linkedNiptoTask && linkedNiptoTask !== 'null') {
            const activityUids = await api.logActivityToNipto(linkedNiptoTask, st.completedAt, doerUids);
            st.completedActivityUids = activityUids || [];
        } else {
            st.completedActivityUids = [];
        }
    } else {
        st.completedBy = [];
        st.completedAt = null;
        if (st.completedActivityUids && st.completedActivityUids.length > 0) {
            for (let actId of st.completedActivityUids) {
                await api.deleteActivityFromNipto(actId);
            }
            st.completedActivityUids = [];
        }
    }
    
    // Check if all subtasks are complete
    const allComplete = task.subTasks.every(s => s.completed);
    if (allComplete && !task.completed) {
        task.completed = true;
        task.completedBy = state.activeUsers && state.activeUsers.length > 0 ? state.activeUsers : [state.users[0]?.uid];
        task.completedAt = new Date().toISOString();
        if (task.linkedNiptoTask && task.linkedNiptoTask !== 'null') {
             const activityUids = await api.logActivityToNipto(task.linkedNiptoTask, task.completedAt, task.completedBy);
             task.completedActivityUids = activityUids || [];
        }
    } else if (!allComplete && task.completed) {
        task.completed = false;
        task.completedBy = [];
        task.completedAt = null;
        if (task.completedActivityUids && task.completedActivityUids.length > 0) {
             for (let actId of task.completedActivityUids) {
                 await api.deleteActivityFromNipto(actId);
             }
             task.completedActivityUids = [];
        }
    }
    
    await api.updateFirestoreDocument('custom_tasks', taskId, {
        subTasks: task.subTasks,
        completed: task.completed,
        completedBy: task.completedBy || [],
        completedAt: task.completedAt || null,
        completedActivityUids: task.completedActivityUids || []
    });
    
    if (isComplete && linkedNiptoTask && linkedNiptoTask !== 'null') {
        updateLeaderboardUI();
        const stObj = state.tasks ? state.tasks.find(t => t.uid === linkedNiptoTask) : null;
        if (stObj) {
            const doerUids = state.activeUsers && state.activeUsers.length > 0 ? state.activeUsers : [state.users[0]?.uid];
            const ptsPerUser = Math.ceil(stObj.value / Math.max(1, doerUids.length));
            const doerNames = doerUids.map(uid => {
                const u = ALL_USERS ? ALL_USERS.find(user => user.uid === uid) : {name: 'Unknown'};
                return u ? u.name : 'Unknown';
            }).join(', ');
            showToast(linkedNiptoTask, st.name, ptsPerUser, doerNames);
        }
    }
}
