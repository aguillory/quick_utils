// todos.js
// Active To-Dos: Single compact toolbar row (All Types / To-Dos / Projects / Routines),
// Unified data model (type, points, priority, description, lastReviewedAt),
// Collapsible category accordions, quiet non-overwhelming cards,
// gentle task blindness refresher, and Direct Assignment Alerts to Home Assistant.

import { state, ALL_USERS, NIPTO_PUBLIC_URL } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { updateLeaderboardUI, rebuildCompletedToday, renderDoneTodayFeed } from './leaderboard.js';
import { getLocalTodayKey, registerCustomCategory } from './utils.js';
import { saveCloudPreference, saveCloudCollapsed } from './preferences.js';
import { completeRoutineForDate, undoRoutineForDate, editRoutine, deleteRoutine, formatRoutineAssignees, isRoutineCompletedOnDate } from './routines.js';
import { callGeminiWithFallback, DEFAULT_GEMINI_MODEL } from './braindump.js';

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
// 1. DATA MODEL CONSOLIDATION & NORMALIZATION
// ==========================================
export function normalizeTask(t) {
    if (!t) return {};

    // 1. Unified type: 'todo' (default) | 'project' | 'routine'
    let type = t.type;
    if (!type || !['todo', 'project', 'routine'].includes(type)) {
        const b = (t.bucket || '').toLowerCase();
        if (b === 'project' || b === 'projects' || b === 'project_idea') {
            type = 'project';
        } else {
            type = 'todo';
        }
    }

    // 2. Default points: default to 5
    const points = (t.points !== undefined && t.points !== null && t.points !== '' && !isNaN(Number(t.points)))
        ? Number(t.points)
        : 5;

    // 3. Priority: 'high' | 'medium' (default) | 'low'
    const pri = (t.priority || '').toLowerCase();
    const priority = ['high', 'medium', 'low'].includes(pri) ? pri : 'medium';

    // 4. Description: support description, fallback to notes
    const description = (t.description !== undefined && t.description !== null)
        ? t.description
        : (t.notes || '');

    // 5. Stale tracking: lastReviewedAt / updatedAt
    const nowIso = new Date().toISOString();
    const lastReviewedAt = t.lastReviewedAt || t.updatedAt || t.createdAt || nowIso;
    const updatedAt = t.updatedAt || t.createdAt || nowIso;

    return {
        ...t,
        type,
        points,
        priority,
        description,
        lastReviewedAt,
        updatedAt
    };
}

// ==========================================
// 2. GENTLE STALE DETECTION ("TASK BLINDNESS")
// ==========================================
export function isTaskStale(task) {
    if (!task || task.completed) return false;
    const norm = normalizeTask(task);
    // Strict criteria:
    // 1. type === 'todo' ONLY (never project or routine)
    if (norm.type !== 'todo') return false;
    // 2. priority !== 'low' ONLY (never flag low-priority items)
    if (norm.priority === 'low') return false;
    // 3. 21+ days since last reviewed or updated
    const reviewStr = norm.lastReviewedAt || norm.updatedAt || norm.createdAt;
    if (!reviewStr) return false;
    const reviewDate = new Date(reviewStr);
    if (isNaN(reviewDate.getTime())) return false;

    const diffDays = (Date.now() - reviewDate.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 21;
}

export function getStaleTasks() {
    return (state.todoTasksData || []).filter(isTaskStale);
}

// ==========================================
// 3. FILTER & SORT HANDLERS (PERSISTED TO FIRESTORE)
// ==========================================
export function setTodoView(view) {
    state.todoView = view;
    if (view === 'projects') {
        state.todoTypeFilter = 'project';
    } else if (view === 'my_actionable' || view === 'shared') {
        state.todoTypeFilter = 'todo';
    } else {
        state.todoTypeFilter = 'all';
    }
    saveCloudPreference('todoTypeFilter', state.todoTypeFilter);
    saveCloudPreference('todoView', view);
    renderTodoTasks();
}

export function setTodoTypeFilter(val) {
    state.todoTypeFilter = val;
    saveCloudPreference('todoTypeFilter', val);
    renderTodoTasks();
}

export function setTodoCategoryFilter(val) {
    state.todoCategoryFilter = val;
    saveCloudPreference('todoCategoryFilter', val);
    renderTodoTasks();
}

export function setTodoPersonFilter(val) {
    state.todoPersonFilter = val;
    saveCloudPreference('todoPersonFilter', val);
    renderTodoTasks();
}

export function setTodoPriorityFilter(val) {
    state.todoPriorityFilter = val;
    saveCloudPreference('todoPriorityFilter', val);
    renderTodoTasks();
}

export function setTodoFrictionFilter(val) {
    state.todoFrictionFilter = val;
    saveCloudPreference('todoFrictionFilter', val);
    renderTodoTasks();
}

export function setTodoBucketFilter(val) {
    state.todoBucketFilter = val;
    if (val === 'project_idea' || val === 'project' || val === 'projects') {
        state.todoTypeFilter = 'project';
    } else if (val === 'actionable') {
        state.todoTypeFilter = 'todo';
    } else {
        state.todoTypeFilter = 'all';
    }
    saveCloudPreference('todoTypeFilter', state.todoTypeFilter);
    saveCloudPreference('todoBucketFilter', val);
    renderTodoTasks();
}

export function setTodoSort(val) {
    state.todoSort = val;
    saveCloudPreference('todoSort', val);
    renderTodoTasks();
}

export function setTodoGroupBy(val) {
    state.todoGroupBy = val;
    saveCloudPreference('todoGroupBy', val);
    renderTodoTasks();
}

export function toggleCategoryCollapse(catKey) {
    if (!state.userPrefs.collapsed) state.userPrefs.collapsed = {};
    const currentlyCollapsed = !!state.userPrefs.collapsed[catKey];
    const nextState = !currentlyCollapsed;
    state.userPrefs.collapsed[catKey] = nextState;
    saveCloudCollapsed(catKey, nextState);
    renderTodoTasks();
}

export function toggleTaskDescription(taskId, event) {
    if (event) event.stopPropagation();
    const box = document.getElementById(`todo-desc-${taskId}`);
    const btn = document.getElementById(`todo-desc-btn-${taskId}`);
    if (!box) return;
    const isHidden = box.style.display === 'none' || !box.style.display;
    box.style.display = isHidden ? 'block' : 'none';
    if (btn) {
        btn.innerHTML = isHidden ? '&#x1F4DD; Details &#x25B4;' : '&#x1F4DD; Details &#x25BE;';
    }
}

export function toggleSubtasksList(taskId) {
    const el = document.getElementById(`subtasks-list-${taskId}`);
    const arrow = document.getElementById(`subtasks-arrow-${taskId}`);
    if (!el) return;
    const isHidden = el.style.display === 'none' || !el.style.display;
    el.style.display = isHidden ? 'flex' : 'none';
    if (arrow) arrow.innerHTML = isHidden ? '&#x25B4;' : '&#x25BE;';
}

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

function formatTodoAssigneePill(task) {
    const assignees = task.assignees || [];
    if (assignees.length === 0) {
        return `<span class="todo-pill shared-pill" title="Anyone can do">&#x1F465;</span>`;
    }
    if (assignees.length >= 3) {
        const fullNames = assignees.map(uid => {
            const u = ALL_USERS.find(user => user.uid === uid);
            return u ? u.name : 'Unknown';
        }).join(', ');
        return `<span class="todo-pill shared-pill" title="${escapeHtml(fullNames)}">&#x1F465;</span>`;
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
    if (!u) return `<span class="todo-pill shared-pill" title="Anyone can do">&#x1F465;</span>`;
    return `<span class="todo-pill" style="color: ${u.color}; font-weight: 700;">&#x1F464; ${escapeHtml(u.name)}</span>`;
}

export function toggleMainSectionCollapse(sectionKey) {
    if (!state.userPrefs.collapsedSections) state.userPrefs.collapsedSections = {};
    const curr = !!state.userPrefs.collapsedSections[sectionKey];
    state.userPrefs.collapsedSections[sectionKey] = !curr;
    saveCloudPreference('collapsedSections', state.userPrefs.collapsedSections);
    renderTodoTasks();
}

// ==========================================
// 4. MAIN TO-DOS RENDERER
// ==========================================
export function renderTodoTasks() {
    const container = document.getElementById('todoContainer');
    if (!container) return;

    const tasks = (state.todoTasksData || []).map(normalizeTask);
    const routines = state.routines || [];
    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeUserObj = ALL_USERS.find(u => u.uid === activeUid);
    const activeName = activeUserObj ? activeUserObj.name : 'Active';

    if (!state.todoTypeFilter) state.todoTypeFilter = 'all';
    if (!state.todoSort) state.todoSort = 'priority';
    if (!state.todoGroupBy) state.todoGroupBy = 'category';
    if (!state.todoCategoryFilter) state.todoCategoryFilter = 'all';
    if (!state.todoPersonFilter) state.todoPersonFilter = 'all';
    if (!state.todoPriorityFilter) state.todoPriorityFilter = 'all';

    const currentType = state.todoTypeFilter;
    const currentSort = state.todoSort;
    const currentGroupBy = state.todoGroupBy;
    const personFilter = state.todoPersonFilter;
    const categoryFilter = state.todoCategoryFilter;
    const priorityFilter = state.todoPriorityFilter;
    const collapsedSections = state.userPrefs.collapsedSections || {};

    const uniqueCategories = Array.from(new Set([
        ...tasks.map(t => t.category || 'General').filter(Boolean),
        ...routines.map(r => r.category || 'Home').filter(Boolean)
    ])).sort();

    function matchesOwnership(item) {
        if (personFilter === 'all') return true;
        const assignees = item.assignees || [];
        if (personFilter === 'me') {
            return assignees.includes(activeUid);
        } else if (personFilter === 'shared_anyone') {
            return assignees.length === 0 || assignees.length > 1;
        } else if (personFilter === 'unassigned') {
            return assignees.length === 0;
        } else {
            return assignees.includes(personFilter);
        }
    }

    function matchesCategory(item) {
        if (categoryFilter === 'all') return true;
        const cat = (item.category || 'General').toLowerCase();
        return cat === categoryFilter.toLowerCase();
    }

    function matchesPriority(item) {
        if (priorityFilter === 'all') return true;
        const p = (item.priority || 'medium').toLowerCase();
        return p === priorityFilter.toLowerCase();
    }

    function matchesFriction(item) {
        if (!state.todoFrictionFilter || state.todoFrictionFilter === 'all') return true;
        return item.frictionTag === state.todoFrictionFilter;
    }

    function getPriorityWeight(p) {
        if (!p) return 2;
        const lp = p.toLowerCase();
        if (lp === 'high') return 3;
        if (lp === 'medium') return 2;
        if (lp === 'low') return 1;
        return 2;
    }

    function sortTaskList(list) {
        return list.slice().sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;

            if (currentSort === 'priority') {
                const pA = getPriorityWeight(a.priority);
                const pB = getPriorityWeight(b.priority);
                if (pA !== pB) return pB - pA;
                return (b.points || 5) - (a.points || 5);
            } else if (currentSort === 'points') {
                const ptA = a.points || 5;
                const ptB = b.points || 5;
                if (ptA !== ptB) return ptB - ptA;
                return getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
            } else if (currentSort === 'category') {
                const cA = (a.category || 'General').toLowerCase();
                const cB = (b.category || 'General').toLowerCase();
                if (cA !== cB) return cA.localeCompare(cB);
                return getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
            } else if (currentSort === 'age') {
                return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
            }
            return 0;
        });
    }

    function sortRoutineList(list) {
        const todayKey = getLocalTodayKey();
        return list.slice().sort((a, b) => {
            const aDone = isRoutineCompletedOnDate(a, todayKey);
            const bDone = isRoutineCompletedOnDate(b, todayKey);
            if (aDone !== bDone) return aDone ? 1 : -1;

            if (currentSort === 'priority') {
                const pA = getPriorityWeight(a.priority);
                const pB = getPriorityWeight(b.priority);
                if (pA !== pB) return pB - pA;
                return api.getRoutinePoints(b) - api.getRoutinePoints(a);
            } else if (currentSort === 'points') {
                return api.getRoutinePoints(b) - api.getRoutinePoints(a);
            } else if (currentSort === 'category') {
                return (a.category || 'Home').localeCompare(b.category || 'Home');
            } else {
                return (a.name || '').localeCompare(b.name || '');
            }
        });
    }

    const staleTasks = getStaleTasks();
    let staleBannerHtml = '';
    if (staleTasks.length > 0) {
        staleBannerHtml = `
        <div class="stale-refresher-banner" onclick="openStaleRefresherModal()" title="Click to gently review sitting tasks">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">&#x2728;</span>
                <span style="font-size: 13px; font-weight: 600; color: var(--text-main);">
                    <strong>${staleTasks.length} To-Do${staleTasks.length > 1 ? 's have' : ' has'}</strong> been sitting a while &mdash; Review?
                </span>
            </div>
            <button type="button" class="action-btn" onclick="openStaleRefresherModal(); event.stopPropagation();" style="padding: 4px 10px; font-size: 12px; font-weight: 700; background: var(--card-bg); border: 1px solid var(--border-color);">
                Review List &#x2192;
            </button>
        </div>
        `;
    }

    let toolbarHtml = `
    ${staleBannerHtml}
    <div class="todo-toolbar-row" style="margin-bottom: 16px;">
        <div class="todo-view-pills">
            <button class="filter-pill ${currentType === 'all' ? 'active' : ''}" onclick="setTodoTypeFilter('all')" title="View To-Dos, Projects, and Routines in 3 stacked sections">
                All Types
            </button>
            <button class="filter-pill ${currentType === 'todo' ? 'active' : ''}" onclick="setTodoTypeFilter('todo')" title="Actionable daily/immediate to-dos">
                &#x26A1; To-Dos
            </button>
            <button class="filter-pill ${currentType === 'project' ? 'active' : ''}" onclick="setTodoTypeFilter('project')" title="Projects, someday goals, and brainstormed ideas">
                &#x1F4A1; Projects / Ideas
            </button>
            <button class="filter-pill ${currentType === 'routine' ? 'active' : ''}" onclick="setTodoTypeFilter('routine')" title="Recurring routines">
                &#x21BB; Routines
            </button>
        </div>

        <div class="todo-secondary-filters" style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
            ${currentType === 'todo' ? `
            <button class="filter-pill" onclick="setTodoGroupBy('${currentGroupBy === 'category' ? 'ownership' : 'category'}')" title="Toggle between Collapsible Categories and Ownership layout" style="font-size: 11px; padding: 4px 8px;">
                ${currentGroupBy === 'category' ? '&#x1F4C1; By Category' : '&#x1F464; By Ownership'}
            </button>
            ` : ''}

            <select class="todo-compact-select" onchange="setTodoSort(this.value)" title="Sort tasks">
                <option value="priority" ${currentSort === 'priority' ? 'selected' : ''}>Sort: Priority (High&rarr;Low)</option>
                <option value="points" ${currentSort === 'points' ? 'selected' : ''}>Sort: Points</option>
                <option value="category" ${currentSort === 'category' ? 'selected' : ''}>Sort: Category</option>
                <option value="age" ${currentSort === 'age' ? 'selected' : ''}>Sort: Newest</option>
            </select>

            <select class="todo-compact-select" onchange="setTodoCategoryFilter(this.value)" title="Filter by Category">
                <option value="all" ${categoryFilter === 'all' ? 'selected' : ''}>Category: All</option>
                ${uniqueCategories.map(cat => `<option value="${escapeHtml(cat)}" ${categoryFilter.toLowerCase() === cat.toLowerCase() ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}
            </select>

            <select class="todo-compact-select" onchange="setTodoPriorityFilter(this.value)" title="Filter by Priority">
                <option value="all" ${priorityFilter === 'all' ? 'selected' : ''}>Priority: All</option>
                <option value="high" ${priorityFilter === 'high' ? 'selected' : ''}>&#x1F525; High</option>
                <option value="medium" ${priorityFilter === 'medium' ? 'selected' : ''}>&#x26A1; Medium</option>
                <option value="low" ${priorityFilter === 'low' ? 'selected' : ''}>&#x1F53D; Low</option>
            </select>

            <select class="todo-compact-select" onchange="setTodoPersonFilter(this.value)" title="Filter by Ownership">
                <option value="all" ${personFilter === 'all' ? 'selected' : ''}>Owner: All</option>
                <option value="me" ${personFilter === 'me' ? 'selected' : ''}>Me (${escapeHtml(activeName)})</option>
                <option value="shared_anyone" ${personFilter === 'shared_anyone' ? 'selected' : ''}>Shared / Anyone</option>
                ${ALL_USERS.map(u => `<option value="${u.uid}" ${personFilter === u.uid ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
            </select>
        </div>
    </div>
    `;

    const filteredTasks = tasks.filter(t => matchesOwnership(t) && matchesCategory(t) && matchesPriority(t) && matchesFriction(t));
    const todosList = sortTaskList(filteredTasks.filter(t => t.type === 'todo'));
    const projectsList = sortTaskList(filteredTasks.filter(t => t.type === 'project'));

    const filteredRoutines = routines.filter(r => matchesOwnership(r) && matchesCategory(r) && matchesPriority(r) && matchesFriction(r));
    const routinesList = sortRoutineList(filteredRoutines);

    function renderCard(t) {
        const isCompleted = !!t.completed;
        const assigneePill = formatTodoAssigneePill(t);
        const pri = t.priority || 'medium';
        const priorityClass = `priority-${pri}`;
        const isAssignedToMe = (t.assignees && t.assignees.length === 1 && t.assignees[0] === activeUid);

        let priorityPill = '';
        if (pri === 'high') {
            priorityPill = `<span class="todo-pill priority-pill high" title="High Priority">&#x1F525; High</span>`;
        } else if (pri === 'low') {
            priorityPill = `<span class="todo-pill priority-pill low" title="Low Priority">&#x1F53D; Low</span>`;
        } else {
            priorityPill = `<span class="todo-pill priority-pill medium" title="Medium Priority">&#x26A1; Med</span>`;
        }

        let frictionPill = '';
        if (t.frictionTag === 'quick') {
            frictionPill = `<span class="todo-pill friction-pill" title="Quick (<5m)">&#x26A1; &lt;5m</span>`;
        } else if (t.frictionTag === 'low_brain') {
            frictionPill = `<span class="todo-pill friction-pill" title="Low Brain">&#x1F9E0; Low Brain</span>`;
        } else if (t.frictionTag === 'deep_focus') {
            frictionPill = `<span class="todo-pill friction-pill" title="Deep Focus">&#x1F3AF; Deep Focus</span>`;
        }

        let creatorPill = '';
        if (t.createdBy) {
            creatorPill = `<span class="todo-pill creator-pill" title="Created by ${escapeHtml(t.createdBy)}">&#x270D;&#xFE0F; ${escapeHtml(t.createdBy)}</span>`;
        }

        const projectBadge = t.type === 'project'
            ? `<span class="todo-pill project-pill">&#x1F4A1; Project</span>`
            : '';

        let categoryBadge = '';
        if (t.category && currentGroupBy !== 'category') {
            categoryBadge = `<span class="todo-pill" style="color: var(--text-muted);">&#x1F4C1; ${escapeHtml(t.category)}</span>`;
        }

        const pts = t.points || 5;
        const ptsDisplay = `<span class="pts-badge">+${pts} pts</span>`;

        let descButton = '';
        let descBox = '';
        if (t.description) {
            descButton = `
            <button type="button" id="todo-desc-btn-${t.id}" class="todo-desc-toggle" onclick="toggleTaskDescription('${t.id}', event)" title="Toggle details / description">
                &#x1F4DD; Details &#x25BE;
            </button>
            `;
            descBox = `
            <div id="todo-desc-${t.id}" class="todo-desc-box" style="display: none;">
                ${escapeHtml(t.description)}
            </div>
            `;
        }

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
                        </label>
                    `).join('')}
                </div>
            </div>
            `;
        }

        return `
        <div class="todo-card ${priorityClass} ${isCompleted ? 'completed' : ''} ${isAssignedToMe ? 'is-assigned-to-me' : ''}">
            <div class="todo-card-top">
                <div class="todo-card-main-line">
                    <button type="button" class="item-checkbox ${isCompleted ? 'checked' : ''}" onclick="toggleTaskStatus('${t.id}', ${isCompleted})" title="${isCompleted ? 'Completed - click to undo' : 'Mark task complete'}" aria-label="${isCompleted ? 'Mark incomplete' : 'Mark complete'}">
                        ${isCompleted ? '&#x2714;' : ''}
                    </button>
                    <span class="todo-title ${isCompleted ? 'completed-text' : ''}">
                        ${pri === 'high' ? '<span class="priority-dot high">&#x25CF;</span> ' : (pri === 'low' ? '<span class="priority-dot low">&#x25CF;</span> ' : '')}${escapeHtml(t.name)}
                    </span>
                    <div class="todo-card-actions">
                        <button class="chore-btn" onclick="editTask('${t.id}')" title="Edit Task" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x270E;</button>
                        <button class="chore-btn delete-btn" onclick="deleteTask('${t.id}')" title="Delete Task" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x1F5D1;</button>
                    </div>
                </div>

                <div class="todo-badges-row">
                    ${assigneePill}
                    ${projectBadge}
                    ${categoryBadge}
                    ${ptsDisplay}
                    ${priorityPill}
                    ${frictionPill}
                    ${creatorPill}
                    ${descButton}
                </div>

                ${descBox}
                ${subtasksSection}
            </div>
        </div>
        `;
    }

    function renderRoutineCard(r) {
        const todayKey = getLocalTodayKey();
        const isCompletedToday = isRoutineCompletedOnDate(r, todayKey);
        const pri = r.priority || 'medium';
        const priorityClass = `priority-${pri}`;
        const assignees = r.assignees || [];
        const isAssignedToMe = (assignees.length === 1 && assignees[0] === activeUid);
        const pts = api.getRoutinePoints(r);
        const sched = r.schedule || {};
        const freqLabel = sched.type === 'weekly' ? 'Weekly' : (sched.type === 'interval' ? 'Interval' : 'Daily');
        const comp = r.completionsByDate ? r.completionsByDate[todayKey] : null;
        const doneByName = comp?.completedByName || '';

        let priorityPill = '';
        if (pri === 'high') priorityPill = `<span class="todo-pill priority-pill high" title="High Priority">&#x1F525; High</span>`;
        else if (pri === 'low') priorityPill = `<span class="todo-pill priority-pill low" title="Low Priority">&#x1F53D; Low</span>`;
        else priorityPill = `<span class="todo-pill priority-pill medium" title="Medium Priority">&#x26A1; Med</span>`;

        let creatorPill = '';
        if (r.createdBy) creatorPill = `<span class="todo-pill creator-pill" title="Created by ${escapeHtml(r.createdBy)}">&#x270D;&#xFE0F; ${escapeHtml(r.createdBy)}</span>`;

        return `
        <div class="todo-card ${priorityClass} ${isCompletedToday ? 'completed' : ''} ${isAssignedToMe ? 'is-assigned-to-me' : ''}">
            <div class="todo-card-top">
                <div class="todo-card-main-line">
                    <button type="button" class="item-checkbox ${isCompletedToday ? 'checked' : ''}"
                        onclick="${isCompletedToday ? `undoRoutineForDate('${r.uid}', '${todayKey}')` : `completeRoutineForDate('${r.uid}', '${todayKey}', true)`}"
                        title="${isCompletedToday ? 'Completed today - click to undo' : 'Mark routine done today (awards points)'}"
                        aria-label="${isCompletedToday ? 'Undo completion' : 'Mark complete'}">
                        ${isCompletedToday ? '&#x2714;' : ''}
                    </button>
                    <span class="todo-title ${isCompletedToday ? 'completed-text' : ''}">
                        ${pri === 'high' ? '<span class="priority-dot high">&#x25CF;</span> ' : (pri === 'low' ? '<span class="priority-dot low">&#x25CF;</span> ' : '')}${escapeHtml(r.name)}
                    </span>
                    <div class="todo-card-actions">
                        <button class="chore-btn" onclick="editRoutine('${r.uid}')" title="Edit Routine" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x270E;</button>
                        <button class="chore-btn delete-btn" onclick="deleteRoutine('${r.uid}')" title="Delete Routine" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x1F5D1;</button>
                    </div>
                </div>

                <div class="todo-badges-row">
                    ${formatRoutineAssignees(r, true)}
                    <span class="todo-pill" style="color: var(--primary);">&#x21BB; ${freqLabel}</span>
                    ${r.category ? `<span class="todo-pill" style="color: var(--text-muted);">&#x1F4C1; ${escapeHtml(r.category)}</span>` : ''}
                    <span class="pts-badge">+${pts} pts</span>
                    ${priorityPill}
                    ${creatorPill}
                    ${isCompletedToday ? `<span class="completed-by-tag">&#x2714; ${escapeHtml(doneByName)}</span>` : ''}
                </div>
            </div>
        </div>
        `;
    }

    let bodyHtml = '';

    if (currentType === 'all') {
        const isTodosCollapsed = !!collapsedSections['todos'];
        const isProjectsCollapsed = !!collapsedSections['projects'];
        const isRoutinesCollapsed = !!collapsedSections['routines'];

        bodyHtml = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
            <div class="todo-section-container">
                <div class="todo-section-header" onclick="toggleMainSectionCollapse('todos')" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                    <h4 class="todo-section-title" style="margin: 0; display: flex; align-items: center; gap: 8px;">
                        <span>&#x26A1; To-Dos</span>
                        <span class="todo-section-count">${todosList.length}</span>
                    </h4>
                    <span class="section-collapse-arrow" style="font-size: 12px; color: var(--text-muted);">${isTodosCollapsed ? '&#x25B6;' : '&#x25BC;'}</span>
                </div>
                <div style="display: ${isTodosCollapsed ? 'none' : 'block'}; margin-top: 10px;">
                    ${todosList.length > 0
                        ? `<div class="todo-grid">${todosList.map(renderCard).join('')}</div>`
                        : `<div class="empty-section-muted">No to-dos matching current filters.</div>`
                    }
                </div>
            </div>

            <div class="todo-section-container">
                <div class="todo-section-header" onclick="toggleMainSectionCollapse('projects')" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                    <h4 class="todo-section-title" style="margin: 0; display: flex; align-items: center; gap: 8px;">
                        <span>&#x1F4A1; Projects / Ideas</span>
                        <span class="todo-section-count">${projectsList.length}</span>
                    </h4>
                    <span class="section-collapse-arrow" style="font-size: 12px; color: var(--text-muted);">${isProjectsCollapsed ? '&#x25B6;' : '&#x25BC;'}</span>
                </div>
                <div style="display: ${isProjectsCollapsed ? 'none' : 'block'}; margin-top: 10px;">
                    ${projectsList.length > 0
                        ? `<div class="todo-grid">${projectsList.map(renderCard).join('')}</div>`
                        : `<div class="empty-section-muted">No projects matching current filters.</div>`
                    }
                </div>
            </div>

            <div class="todo-section-container">
                <div class="todo-section-header" onclick="toggleMainSectionCollapse('routines')" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                    <h4 class="todo-section-title" style="margin: 0; display: flex; align-items: center; gap: 8px;">
                        <span>&#x21BB; Routines</span>
                        <span class="todo-section-count">${routinesList.length}</span>
                    </h4>
                    <span class="section-collapse-arrow" style="font-size: 12px; color: var(--text-muted);">${isRoutinesCollapsed ? '&#x25B6;' : '&#x25BC;'}</span>
                </div>
                <div style="display: ${isRoutinesCollapsed ? 'none' : 'block'}; margin-top: 10px;">
                    ${routinesList.length > 0
                        ? `<div class="todo-grid">${routinesList.map(renderRoutineCard).join('')}</div>`
                        : `<div class="empty-section-muted">No routines matching current filters.</div>`
                    }
                </div>
            </div>
        </div>
        `;
    } else if (currentType === 'project') {
        bodyHtml = `
        <div class="todo-section-container">
            <div class="todo-section-header">
                <h4 class="todo-section-title">
                    <span>&#x1F4A1; Projects / Ideas</span>
                    <span class="todo-section-count">${projectsList.length}</span>
                </h4>
            </div>
            ${projectsList.length > 0
                ? `<div class="todo-grid" style="margin-top: 10px;">${projectsList.map(renderCard).join('')}</div>`
                : `<div class="empty-section-muted" style="margin-top: 10px;">No projects matching current filters.</div>`
            }
        </div>
        `;
    } else if (currentType === 'routine') {
        bodyHtml = `
        <div class="todo-section-container">
            <div class="todo-section-header">
                <h4 class="todo-section-title">
                    <span>&#x21BB; Routines</span>
                    <span class="todo-section-count">${routinesList.length}</span>
                </h4>
            </div>
            ${routinesList.length > 0
                ? `<div class="todo-grid" style="margin-top: 10px;">${routinesList.map(renderRoutineCard).join('')}</div>`
                : `<div class="empty-section-muted" style="margin-top: 10px;">No routines matching current filters.</div>`
            }
        </div>
        `;
    } else {
        // currentType === 'todo'
        if (currentGroupBy === 'category') {
            const collapsedPrefs = state.userPrefs.collapsed || {};
            const groups = {};
            todosList.forEach(t => {
                const cat = t.category || 'General';
                if (!groups[cat]) groups[cat] = [];
                groups[cat].push(t);
            });

            const categoryKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b));

            bodyHtml = `
            <div class="category-accordions-container" style="display: flex; flex-direction: column; gap: 12px;">
                ${categoryKeys.map(catKey => {
                    const catTasks = sortTaskList(groups[catKey]);
                    const isCollapsed = !!collapsedPrefs[catKey];
                    const activeCount = catTasks.filter(t => !t.completed).length;
                    const totalCount = catTasks.length;

                    return `
                    <div class="category-accordion-item ${isCollapsed ? 'collapsed' : ''}" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden;">
                        <div class="category-accordion-header" onclick="toggleCategoryCollapse('${escapeHtml(catKey)}')" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; cursor: pointer; user-select: none; background: var(--bg-color);">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="category-accordion-arrow" style="font-size: 11px; color: var(--text-muted); transition: transform 0.2s;">
                                    ${isCollapsed ? '&#x25B6;' : '&#x25BC;'}
                                </span>
                                <span style="font-size: 14px; font-weight: 800; color: var(--text-main);">
                                    &#x1F4C1; ${escapeHtml(catKey)}
                                </span>
                                <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); background: var(--card-bg); padding: 2px 7px; border-radius: 12px; border: 1px solid var(--border-color);">
                                    ${activeCount}${activeCount !== totalCount ? `/${totalCount}` : ''}
                                </span>
                            </div>
                            <span style="font-size: 11px; color: var(--text-muted);">
                                ${isCollapsed ? 'Click to show' : 'Click to hide'}
                            </span>
                        </div>

                        <div class="category-accordion-body" style="padding: 12px; display: ${isCollapsed ? 'none' : 'block'};">
                            <div class="todo-grid">
                                ${catTasks.map(renderCard).join('')}
                            </div>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
            `;
        } else {
            // By Ownership (Fixed: Individual tasks go to individualTasks, Shared tasks go to sharedTasks)
            const individualTasks = [];
            const sharedTasks = [];

            todosList.forEach(t => {
                const isShared = !t.assignees || t.assignees.length === 0 || t.assignees.length > 1;
                if (isShared) {
                    sharedTasks.push(t);
                } else {
                    individualTasks.push(t);
                }
            });

            let individualSectionTitle = `Assigned to Individuals`;
            if (personFilter === 'me') {
                individualSectionTitle = `Assigned to Me (${escapeHtml(activeName)})`;
            } else if (personFilter !== 'all' && personFilter !== 'shared_anyone') {
                const u = ALL_USERS.find(user => user.uid === personFilter);
                individualSectionTitle = `Assigned to ${u ? escapeHtml(u.name) : 'User'}`;
            }

            bodyHtml = `
            <div class="todo-section-container">
                <div class="todo-section-header">
                    <h4 class="todo-section-title">
                        <span>&#x1F464; ${individualSectionTitle}</span>
                        <span class="todo-section-count">${individualTasks.length}</span>
                    </h4>
                </div>
                ${individualTasks.length > 0
                    ? `<div class="todo-grid" style="margin-top: 10px;">${individualTasks.map(renderCard).join('')}</div>`
                    : `<div class="empty-section-muted" style="margin-top: 10px;">&#x1F464; No individual to-dos matching current filters.</div>`
                }
            </div>

            <div class="todo-section-container" style="margin-top: 18px;">
                <div class="todo-section-header shared-header">
                    <h4 class="todo-section-title">
                        <span>&#x1F465; Shared / Anyone Can Do</span>
                        <span class="todo-section-count">${sharedTasks.length}</span>
                    </h4>
                </div>
                ${sharedTasks.length > 0
                    ? `<div class="todo-grid" style="margin-top: 10px;">${sharedTasks.map(renderCard).join('')}</div>`
                    : `<div class="empty-section-muted" style="margin-top: 10px;">&#x1F465; No shared to-dos matching current filters.</div>`
                }
            </div>
            `;
        }
    }

    container.innerHTML = toolbarHtml + bodyHtml;
}

export function renderSidebarTodos() {
    renderTodoTasks();
}

// ==========================================
// 5. STALE TASK REFRESHER MODAL LOGIC
// ==========================================
export function openStaleRefresherModal() {
    const modal = document.getElementById('staleRefresherModal');
    if (!modal) return;
    state.staleCurrentIndex = 0;
    renderStaleRefresherModalContent();
    modal.style.display = 'flex';
}

export function closeStaleRefresherModal() {
    const modal = document.getElementById('staleRefresherModal');
    if (modal) modal.style.display = 'none';
    renderTodoTasks();
}

export function renderStaleRefresherModalContent() {
    const container = document.getElementById('staleModalContentArea');
    if (!container) return;

    const staleTasks = getStaleTasks();
    if (staleTasks.length === 0) {
        container.innerHTML = `
        <div style="text-align: center; padding: 30px 10px;">
            <div style="font-size: 36px; margin-bottom: 10px;">&#x2728;</div>
            <h3 style="margin: 0 0 8px 0; color: var(--text-main);">All Caught Up!</h3>
            <p style="font-size: 13px; color: var(--text-muted); margin: 0 0 16px 0;">
                No to-dos have been sitting untouched for 21+ days. Your list is clear and fresh!
            </p>
            <button class="action-btn save-mode" onclick="closeStaleRefresherModal()">Done</button>
        </div>
        `;
        return;
    }

    if (state.staleCurrentIndex >= staleTasks.length) {
        state.staleCurrentIndex = 0;
    }

    const currentTask = staleTasks[state.staleCurrentIndex];
    const norm = normalizeTask(currentTask);
    const reviewDate = new Date(norm.lastReviewedAt || norm.updatedAt || norm.createdAt);
    const daysOld = Math.floor((Date.now() - reviewDate.getTime()) / (1000 * 60 * 60 * 24));

    container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="font-size: 12px; font-weight: 700; color: var(--text-muted);">
            Item ${state.staleCurrentIndex + 1} of ${staleTasks.length}
        </span>
        <span style="font-size: 11px; background: rgba(245, 158, 11, 0.15); color: #d97706; padding: 2px 8px; border-radius: 10px; font-weight: 700;">
            Untouched for ${daysOld} days
        </span>
    </div>

    <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; margin-bottom: 16px;">
        <div style="font-size: 16px; font-weight: 800; color: var(--text-main); margin-bottom: 6px;">
            ${escapeHtml(norm.name)}
        </div>
        <div style="display: flex; gap: 8px; font-size: 11px; color: var(--text-muted); margin-bottom: 8px; flex-wrap: wrap;">
            <span>Category: <strong>${escapeHtml(norm.category || 'Home')}</strong></span>
            <span>Points: <strong>${norm.points} pts</strong></span>
            <span>Priority: <strong>${escapeHtml(norm.priority)}</strong></span>
        </div>
        ${norm.description ? `
            <div style="font-size: 12px; color: var(--text-main); background: var(--card-bg); padding: 8px; border-radius: 6px; border: 1px solid var(--border-color);">
                ${escapeHtml(norm.description)}
            </div>
        ` : ''}

        <div id="staleInlineEditBox" style="display: none; margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 12px;">
            <label style="font-size: 11px; font-weight: bold; color: var(--text-muted);">Reword Title:</label>
            <input type="text" id="staleInputTitle" value="${escapeHtml(norm.name)}" style="width: 100%; padding: 6px 8px; font-size: 13px; border-radius: 6px; border: 1px solid var(--border-color); box-sizing: border-box; margin-top: 4px;">

            <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); display: block; margin-top: 8px;">Description / Small Steps:</label>
            <textarea id="staleInputDesc" rows="2" style="width: 100%; padding: 6px 8px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); box-sizing: border-box; margin-top: 4px;">${escapeHtml(norm.description)}</textarea>

            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                <button type="button" class="action-btn" onclick="simplifyTaskWithAi('${norm.id}')" id="btnStaleAi" style="font-size: 11px;">
                    &#x2728; Ask AI to Simplify
                </button>
                <button type="button" class="action-btn save-mode" onclick="saveStaleInlineEdit('${norm.id}')" style="font-size: 11px;">
                    Save Reworded Task
                </button>
            </div>
        </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button type="button" class="action-btn" onclick="toggleStaleInlineEdit()" style="padding: 10px; font-size: 12px; font-weight: 700; text-align: center;">
            &#x270E; Reword / Break Down
        </button>
        <button type="button" class="action-btn" onclick="handleStaleAction('${norm.id}', 'snooze')" style="padding: 10px; font-size: 12px; font-weight: 700; text-align: center;">
            &#x23F0; Still Valid (Snooze 21d)
        </button>
        <button type="button" class="action-btn" onclick="handleStaleAction('${norm.id}', 'demote')" style="padding: 10px; font-size: 12px; font-weight: 700; text-align: center;">
            &#x1F53D; Demote to Low Priority
        </button>
        <button type="button" class="action-btn" onclick="handleStaleAction('${norm.id}', 'move_project')" style="padding: 10px; font-size: 12px; font-weight: 700; text-align: center;">
            &#x1F4A1; Move to Projects / Ideas
        </button>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 12px;">
        <button type="button" class="action-btn" onclick="prevStaleCard()" ${state.staleCurrentIndex === 0 ? 'disabled style="opacity: 0.4;"' : ''}>
            &larr; Previous
        </button>
        <button type="button" class="action-btn" onclick="nextStaleCard()" ${state.staleCurrentIndex >= staleTasks.length - 1 ? 'disabled style="opacity: 0.4;"' : ''}>
            Next &rarr;
        </button>
    </div>
    `;
}

export function prevStaleCard() {
    if (state.staleCurrentIndex > 0) {
        state.staleCurrentIndex--;
        renderStaleRefresherModalContent();
    }
}

export function nextStaleCard() {
    const staleTasks = getStaleTasks();
    if (state.staleCurrentIndex < staleTasks.length - 1) {
        state.staleCurrentIndex++;
        renderStaleRefresherModalContent();
    }
}

export function toggleStaleInlineEdit() {
    const box = document.getElementById('staleInlineEditBox');
    if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

export async function saveStaleInlineEdit(taskId) {
    const newTitle = document.getElementById('staleInputTitle')?.value.trim();
    const newDesc = document.getElementById('staleInputDesc')?.value.trim();
    if (!newTitle) { alert("Task title cannot be empty."); return; }

    const nowIso = new Date().toISOString();
    try {
        await api.updateFirestoreDocument('custom_tasks', taskId, {
            name: newTitle,
            description: newDesc,
            notes: newDesc,
            lastReviewedAt: nowIso,
            updatedAt: nowIso
        });
        showToast("stale_ok", `Updated "${newTitle}"!`, 0, "");
        renderStaleRefresherModalContent();
        renderTodoTasks();
    } catch (e) {
        console.error("Error updating stale task:", e);
        alert("Failed to update task: " + e.message);
    }
}

export async function handleStaleAction(taskId, action) {
    const nowIso = new Date().toISOString();
    try {
        if (action === 'snooze') {
            await api.updateFirestoreDocument('custom_tasks', taskId, {
                lastReviewedAt: nowIso,
                updatedAt: nowIso
            });
            showToast("stale_snooze", "Snoozed task for 21 days.", 0, "");
        } else if (action === 'demote') {
            await api.updateFirestoreDocument('custom_tasks', taskId, {
                priority: 'low',
                lastReviewedAt: nowIso,
                updatedAt: nowIso
            });
            showToast("stale_demote", "Demoted to Low Priority.", 0, "");
        } else if (action === 'move_project') {
            await api.updateFirestoreDocument('custom_tasks', taskId, {
                type: 'project',
                bucket: 'project_idea',
                lastReviewedAt: nowIso,
                updatedAt: nowIso
            });
            showToast("stale_proj", "Moved to Projects & Ideas.", 0, "");
        }

        const t = state.todoTasksData?.find(item => item.id === taskId);
        if (t) {
            t.lastReviewedAt = nowIso;
            t.updatedAt = nowIso;
            if (action === 'demote') t.priority = 'low';
            if (action === 'move_project') {
                t.type = 'project';
                t.bucket = 'project_idea';
            }
        }

        renderStaleRefresherModalContent();
        renderTodoTasks();
    } catch (e) {
        console.error("Error executing stale action:", e);
        alert("Action failed: " + e.message);
    }
}

// 1-Click AI Breakdown with Automatic Free-Tier Model Fallback
export async function simplifyTaskWithAi(taskId) {
    const task = state.todoTasksData?.find(t => t.id === taskId);
    if (!task) return;

    const apiKey = (state.integrationsConfig?.geminiApiKey || '').trim();
    if (!apiKey) {
        alert("Please configure Gemini API key in Settings.");
        return;
    }

    const btn = document.getElementById('btnStaleAi');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = "Thinking...";
    }

    try {
        const preferredModel = (state.integrationsConfig?.geminiModel || DEFAULT_GEMINI_MODEL).trim();
        const prompt = `Simplify or break down this sitting household task into 2-3 small actionable steps or a clearer title:
Title: "${task.name}"
Description: "${task.description || task.notes || ''}"
Output JSON: { "suggestedTitle": "...", "suggestedDescription": "..." }`;

        const { data } = await callGeminiWithFallback(
            apiKey,
            preferredModel,
            prompt,
            "You are a concise household task assistant. Return pure JSON only."
        );

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            const parsed = JSON.parse(cleaned);
            const titleInput = document.getElementById('staleInputTitle');
            const descInput = document.getElementById('staleInputDesc');
            if (titleInput && parsed.suggestedTitle) titleInput.value = parsed.suggestedTitle;
            if (descInput && parsed.suggestedDescription) descInput.value = parsed.suggestedDescription;
            showToast("ai_simp", "AI suggested clearer steps! Review and click Save.", 0, "");
        }
    } catch (e) {
        console.error("AI simplify error:", e);
        alert("AI simplification failed: " + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = "&#x2728; Ask AI to Simplify";
        }
    }
}

// ==========================================
// 6. TOGGLE STATUS & SUBTASKS
// ==========================================
export async function toggleTaskStatus(taskId, currentCompleted) {
    const todo = state.todoTasksData?.find(t => t.id === taskId);
    if (!todo) return;

    const nextCompleted = !currentCompleted;
    const nowIso = new Date().toISOString();
    const doerUids = (state.activeUsers && state.activeUsers.length > 0)
        ? [...state.activeUsers]
        : [ALL_USERS[0]?.uid || ''];
    const doerUid = doerUids[0];
    const doerName = doerUids.map(uid => ALL_USERS.find(u => u.uid === uid)?.name || 'Someone').join(', ');

    const prevActivityUids = Array.isArray(todo.completedActivityUids)
        ? [...todo.completedActivityUids]
        : (todo.completedActivityUid ? [todo.completedActivityUid] : []);
    const prevBy = Array.isArray(todo.completedBy) && todo.completedBy.length > 0
        ? [...todo.completedBy]
        : [doerUid];
    const prevCompletedAt = todo.completedAt;

    todo.completed = nextCompleted;
    todo.completedAt = nextCompleted ? nowIso : null;
    todo.completedBy = nextCompleted ? doerUids : [];
    todo.lastReviewedAt = nowIso;
    todo.updatedAt = nowIso;

    try {
        if (nextCompleted) {
            const pts = Number(todo.points) || 5;
            let activityUids = [];
            try {
                activityUids = await api.logCustomPointsToNipto(
                    pts,
                    todo.name,
                    doerUids,
                    nowIso,
                    todo.linkedNiptoTask || null
                );
            } catch (niptoErr) {
                console.warn("Could not log To-Do points to Nipto API:", niptoErr);
            }

            todo.completedActivityUids = activityUids;
            todo.completedActivityUid = activityUids[0] || null;

            await api.updateFirestoreDocument('custom_tasks', taskId, {
                completed: true,
                completedAt: nowIso,
                completedBy: doerUids,
                completedActivityUids: activityUids,
                completedActivityUid: activityUids[0] || null,
                lastReviewedAt: nowIso,
                updatedAt: nowIso
            });

            showToast("todo_done", `Completed "${todo.name}"!`, pts, doerName);
            // Note: logActivityToNipto inside logCustomPointsToNipto already awards allowance points when activityUids.length > 0.
            // Only award directly here as fallback if Nipto API logging did not run.
            if (pts > 0 && activityUids.length === 0) {
                for (const uid of doerUids) {
                    await api.awardAllowancePoints(uid, Math.ceil(pts / Math.max(1, doerUids.length)));
                }
            }
            await api.recordDailyCompletion({
                id: `todo_${taskId}`,
                itemId: taskId,
                sourceType: 'todo',
                title: todo.name,
                user: doerName,
                userUid: doerUid,
                points: pts,
                completedAt: nowIso,
                dateKey: getLocalTodayKey(),
                ...(activityUids.length > 0 ? { activityUids, activityUid: activityUids[0] } : {})
            });
        } else {
            todo.completedActivityUids = [];
            todo.completedActivityUid = null;

            await api.updateFirestoreDocument('custom_tasks', taskId, {
                completed: false,
                completedAt: null,
                completedBy: [],
                completedActivityUids: [],
                completedActivityUid: null,
                lastReviewedAt: nowIso,
                updatedAt: nowIso
            });

            const prevDateKey = prevCompletedAt ? getLocalTodayKey(new Date(prevCompletedAt)) : null;
            if (prevActivityUids.length > 0) {
                for (const actUid of prevActivityUids) {
                    try {
                        await api.deleteActivityFromNipto(actUid);
                        await api.removeDailyCompletion(`nipto_${actUid}`, getLocalTodayKey());
                        if (prevDateKey && prevDateKey !== getLocalTodayKey()) {
                            await api.removeDailyCompletion(`nipto_${actUid}`, prevDateKey);
                        }
                    } catch (delErr) {
                        console.warn(`Could not delete Nipto activity ${actUid}:`, delErr);
                    }
                }
            } else {
                const pts = Number(todo.points) || 5;
                if (pts > 0) {
                    const splitPts = Math.ceil(pts / Math.max(1, prevBy.length));
                    for (const uid of prevBy) {
                        await api.revokeAllowancePoints(uid, splitPts);
                    }
                }
            }

            await api.removeDailyCompletion(`todo_${taskId}`, getLocalTodayKey());
            if (prevDateKey && prevDateKey !== getLocalTodayKey()) {
                await api.removeDailyCompletion(`todo_${taskId}`, prevDateKey);
            }
            showToast("todo_undo", `Unchecked "${todo.name}"`, 0, "");
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
    todo.lastReviewedAt = nowIso;
    todo.updatedAt = nowIso;

    try {
        await api.updateFirestoreDocument('custom_tasks', taskId, {
            subTasks: updated,
            lastReviewedAt: nowIso,
            updatedAt: nowIso
        });

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

// ==========================================
// 7. TASK MODAL (ADD / EDIT TO-DO)
// ==========================================
export function openTaskModal() {
    document.getElementById('taskModalTitle').innerText = "Add Task";
    document.getElementById('taskId').value = '';
    document.getElementById('taskName').value = '';
    document.getElementById('taskCategory').value = 'Home';
    document.getElementById('taskLocation').value = 'Inside';

    const typeEl = document.getElementById('taskType');
    if (typeEl) typeEl.value = 'todo';

    const pointsEl = document.getElementById('taskPoints');
    if (pointsEl) pointsEl.value = '5';

    const priorityEl = document.getElementById('taskPriority');
    if (priorityEl) priorityEl.value = 'medium';

    const frictionEl = document.getElementById('taskFriction');
    if (frictionEl) frictionEl.value = '';

    const descEl = document.getElementById('taskDescription');
    if (descEl) descEl.value = '';

    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeName = ALL_USERS.find(u => u.uid === activeUid)?.name || 'Alyssa';
    const createdByEl = document.getElementById('taskCreatedBy');
    if (createdByEl) createdByEl.value = activeName;

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

    const norm = normalizeTask(task);

    document.getElementById('taskModalTitle').innerText = "Edit Task";
    document.getElementById('taskId').value = norm.id;
    document.getElementById('taskName').value = norm.name || '';
    document.getElementById('taskCategory').value = norm.category || 'Home';
    document.getElementById('taskLocation').value = norm.location || 'Inside';

    const typeEl = document.getElementById('taskType');
    if (typeEl) typeEl.value = norm.type || 'todo';

    const pointsEl = document.getElementById('taskPoints');
    if (pointsEl) pointsEl.value = norm.points || 5;

    const priorityEl = document.getElementById('taskPriority');
    if (priorityEl) priorityEl.value = norm.priority || 'medium';

    const frictionEl = document.getElementById('taskFriction');
    if (frictionEl) frictionEl.value = norm.frictionTag || '';

    const descEl = document.getElementById('taskDescription');
    if (descEl) descEl.value = norm.description || '';

    const createdByEl = document.getElementById('taskCreatedBy');
    if (createdByEl) createdByEl.value = norm.createdBy || 'Alyssa';

    populateTodoAssignees(norm.assignees || []);
    populateSubTaskFields(norm.subTasks || []);
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

export async function saveTask() {
    const id = document.getElementById('taskId')?.value;
    const name = document.getElementById('taskName')?.value.trim();
    if (!name) { alert("Task name is required!"); return; }

    const assignees = Array.from(document.querySelectorAll('.todo-assignee-cb:checked')).map(cb => cb.value);
    const type = document.getElementById('taskType')?.value || 'todo';
    const points = parseInt(document.getElementById('taskPoints')?.value, 10) || 5;
    const priority = document.getElementById('taskPriority')?.value || 'medium';
    const frictionTag = document.getElementById('taskFriction')?.value || '';
    const rawCat = document.getElementById('taskCategory')?.value.trim() || 'Home';
    const category = registerCustomCategory(rawCat) || 'Home';
    const location = document.getElementById('taskLocation')?.value || 'Inside';
    const description = document.getElementById('taskDescription')?.value.trim() || '';

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

    const nowIso = new Date().toISOString();

    const taskData = {
        name,
        type,
        bucket: (type === 'project') ? 'project_idea' : 'actionable',
        points,
        priority,
        category,
        location,
        frictionTag,
        createdBy,
        description,
        notes: description,
        assignees,
        subTasks,
        updatedAt: nowIso,
        lastReviewedAt: nowIso
    };

    try {
        let createdId = id;
        if (id) {
            await api.updateFirestoreDocument('custom_tasks', id, taskData);
        } else {
            taskData.completed = false;
            taskData.createdAt = nowIso;
            const docRef = await window.getNiptoCollection('custom_tasks').add(taskData);
            createdId = docRef.id;

            // Non-blocking Home Assistant notification for Adults with connected phones
            dispatchDirectAssignmentAlerts(taskData, createdId);
        }

        closeTaskModal();
        renderTodoTasks();
    } catch (e) {
        console.error("Error saving task:", e);
        alert("Failed to save task: " + e.message);
    }
}

// Dispatches Home Assistant push notification asynchronously if assigned to an adult with a connected phone
function dispatchDirectAssignmentAlerts(task, taskId) {
    if (!task.assignees || task.assignees.length === 0) return;
    const adultProfiles = state.notificationPreferences?.adults || {};
    const activeUserName = ALL_USERS.find(u => u.uid === state.activeUsers[0])?.name || 'Someone';

    task.assignees.forEach(uid => {
        const profile = adultProfiles[uid];
        const target = (profile?.haTarget || '').trim();
        if (profile && target && target.startsWith('notify.') && profile.directAssignmentAlerts) {
            const appUrl = (state.integrationsConfig?.publicAppUrl || NIPTO_PUBLIC_URL);
            const payload = {
                targets: [target],
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
            void api.dispatchHomeAssistantNotification(payload);
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

if (typeof window !== 'undefined') {
    window.setTodoView = setTodoView;
    window.setTodoTypeFilter = setTodoTypeFilter;
    window.setTodoCategoryFilter = setTodoCategoryFilter;
    window.setTodoPersonFilter = setTodoPersonFilter;
    window.setTodoPriorityFilter = setTodoPriorityFilter;
    window.setTodoFrictionFilter = setTodoFrictionFilter;
    window.setTodoBucketFilter = setTodoBucketFilter;
    window.setTodoSort = setTodoSort;
    window.setTodoGroupBy = setTodoGroupBy;
    window.toggleCategoryCollapse = toggleCategoryCollapse;
    window.toggleMainSectionCollapse = toggleMainSectionCollapse;
    window.toggleTaskDescription = toggleTaskDescription;
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
    window.renderSidebarTodos = renderSidebarTodos;
    window.openStaleRefresherModal = openStaleRefresherModal;
    window.closeStaleRefresherModal = closeStaleRefresherModal;
    window.prevStaleCard = prevStaleCard;
    window.nextStaleCard = nextStaleCard;
    window.toggleStaleInlineEdit = toggleStaleInlineEdit;
    window.saveStaleInlineEdit = saveStaleInlineEdit;
    window.handleStaleAction = handleStaleAction;
    window.simplifyTaskWithAi = simplifyTaskWithAi;
}
