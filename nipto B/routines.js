// routines.js
// Routines: the add/edit modal, scheduling engine, main + sidebar rendering,
// complete/skip/delete actions, and background sync with Nipto history.
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { updateLeaderboardUI } from './leaderboard.js';

// Builds a compact assignee label for a routine card.
export function formatRoutineAssignees(routine, compact = false) {
    const assignees = routine.assignees || [];
    const fontSize = compact ? '10px' : '11px';
    const baseStyle = `font-size: ${fontSize}; font-weight: bold; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color);`;

    if (assignees.length >= ALL_USERS.length) {
        return `<span style="color: var(--text-muted); ${baseStyle}">👥 Anyone</span>`;
    }

    if (routine.completionType === 'individual') {
        const myUids = state.activeUsers.filter(uid => assignees.includes(uid));
        if (myUids.length > 0) {
            return myUids.map(uid => {
                const u = ALL_USERS.find(user => user.uid === uid);
                return u ? `<span style="color: ${u.color}; ${baseStyle}">👤 ${u.name}</span>` : '';
            }).join(' ');
        }
        return `<span style="color: var(--text-muted); ${baseStyle}">👤 Individual</span>`;
    }

    const names = assignees.map(uid => {
        const u = ALL_USERS.find(user => user.uid === uid);
        return u ? u.name : 'Unknown';
    });
    return `<span style="color: var(--text-muted); ${baseStyle}">👥 ${names.join(' or ')}</span>`;
}

// Opens the modal for creating a new routine.
export function openRoutineModal() {
    document.getElementById('routineModalTitle').innerText = "Add Routine";
    document.getElementById('routineId').value = '';
    document.getElementById('routineName').value = '';
    document.getElementById('routineType').value = 'shared';
    document.getElementById('routineFrequency').value = 'daily';
    document.getElementById('routineDailyReset').value = 'midnight';
    document.getElementById('routineSpecificTimes').value = '';
    document.querySelectorAll('.routine-day-cb').forEach(cb => cb.checked = false);
    document.getElementById('routineIntervalValue').value = '1';
    document.getElementById('routineIntervalUnit').value = 'months';
    document.getElementById('routineOverdueValue').value = '14';
    document.getElementById('routineOverdueUnit').value = 'hours';
    populateRoutineAssignees([]);
    populateRoutinePointsSelect();
    toggleRoutineFrequencyFields();
    document.getElementById('routineModal').style.display = 'flex';
}

// Closes the routine modal.
export function closeRoutineModal() {
    document.getElementById('routineModal').style.display = 'none';
}

// Opens the modal pre-filled to edit an existing routine.
export function editRoutine(routineId) {
    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine) return;

    document.getElementById('routineModalTitle').innerText = "Edit Routine";
    document.getElementById('routineId').value = routine.uid;
    document.getElementById('routineName').value = routine.name;
    document.getElementById('routineType').value = routine.completionType;
    document.getElementById('routineFrequency').value = routine.schedule.type;

    const freq = routine.schedule.type;
    if (freq === 'daily') {
        document.getElementById('routineDailyReset').value = routine.schedule.resetType || 'midnight';
        if (routine.schedule.resetType === 'specific') {
            document.getElementById('routineSpecificTimes').value = (routine.schedule.specificTimes || []).join(', ');
        }
    } else if (freq === 'weekly') {
        document.querySelectorAll('.routine-day-cb').forEach(cb => {
            cb.checked = (routine.schedule.daysOfWeek || []).includes(parseInt(cb.value));
        });
    } else if (freq === 'interval') {
        document.getElementById('routineIntervalValue').value = routine.schedule.value || 1;
        document.getElementById('routineIntervalUnit').value = routine.schedule.unit || 'months';
    }

    populateRoutineAssignees(routine.assignees || []);
    populateRoutinePointsSelect();
    document.getElementById('routinePoints').value = routine.linkedNiptoTask || '';

    toggleRoutineFrequencyFields();

    if (routine.overdueAfterHours != null) {
        const hours = routine.overdueAfterHours;
        if (hours >= 24 && hours % 24 === 0) {
            document.getElementById('routineOverdueValue').value = hours / 24;
            document.getElementById('routineOverdueUnit').value = 'days';
        } else {
            document.getElementById('routineOverdueValue').value = hours;
            document.getElementById('routineOverdueUnit').value = 'hours';
        }
        document.getElementById('overdueHint').textContent = 'Using your custom setting';
    }

    document.getElementById('routineModal').style.display = 'flex';
}

// Shows/hides frequency-specific fields and refreshes overdue defaults.
export function toggleRoutineFrequencyFields() {
    const freq = document.getElementById('routineFrequency').value;
    const dailyReset = document.getElementById('routineDailyReset').value;

    document.getElementById('freqDailyFields').style.display = freq === 'daily' ? 'block' : 'none';
    document.getElementById('freqWeeklyFields').style.display = freq === 'weekly' ? 'block' : 'none';
    document.getElementById('freqIntervalFields').style.display = freq === 'interval' ? 'block' : 'none';
    document.getElementById('dailySpecificTimes').style.display = (freq === 'daily' && dailyReset === 'specific') ? 'block' : 'none';

    updateOverdueDefaults();
}

// Builds the assignee checkboxes in the routine modal.
function populateRoutineAssignees(selectedUids = []) {
    const container = document.getElementById('routineAssignees');
    container.innerHTML = '';
    ALL_USERS.forEach(u => {
        const isChecked = selectedUids.includes(u.uid) ? 'checked' : '';
        container.innerHTML += `
        <label style="font-size: 13px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
        <input type="checkbox" value="${u.uid}" class="routine-assignee-cb" ${isChecked}> ${u.name}
        </label>`;
    });
}

// Builds the grouped points dropdown for the routine modal.
function populateRoutinePointsSelect() {
    const select = document.getElementById('routinePoints');
    select.innerHTML = '<option value="">-- No Points --</option>';
    if (!state.tasks || state.tasks.length === 0) return;

    const groupedTasks = state.tasks.reduce((acc, task) => {
        const categoryName = task.category || task.group || 'Uncategorized';
        if (categoryName === "📌") return acc;
        if (!acc[categoryName]) acc[categoryName] = [];
        acc[categoryName].push(task);
        return acc;
    }, {});

    const sortedCategories = Object.keys(groupedTasks).sort((a, b) => a.localeCompare(b));
    sortedCategories.forEach(category => {
        const optGroup = document.createElement('optgroup');
        optGroup.label = category;
        const tasksInCat = groupedTasks[category].sort((a, b) => a.name.localeCompare(b.name));
        tasksInCat.forEach(t => {
            optGroup.innerHTML += `<option value="${t.uid}">${t.name} (${t.value} pts)</option>`;
        });
        select.appendChild(optGroup);
    });
}

// Creates or updates a routine from the modal fields.
export async function saveRoutine() {
    const name = document.getElementById('routineName').value.trim();
    if (!name) { alert("Routine Name is required!"); return; }

    const assignees = Array.from(document.querySelectorAll('.routine-assignee-cb:checked')).map(cb => cb.value);
    if (assignees.length === 0) { alert("Assign the routine to at least one person!"); return; }

    const freq = document.getElementById('routineFrequency').value;
    let scheduleData = { type: freq };

    if (freq === 'daily') {
        const resetType = document.getElementById('routineDailyReset').value;
        scheduleData.resetType = resetType;
        if (resetType === 'specific') {
            const times = document.getElementById('routineSpecificTimes').value;
            scheduleData.specificTimes = times.split(',').map(t => t.trim()).filter(t => t);
            if (scheduleData.specificTimes.length === 0) {
                alert("Please enter at least one valid time (e.g., 05:00)"); return;
            }
            scheduleData.specificTimes.sort();
        }
    } else if (freq === 'weekly') {
        const days = Array.from(document.querySelectorAll('.routine-day-cb:checked')).map(cb => parseInt(cb.value));
        if (days.length === 0) { alert("Select at least one day of the week!"); return; }
        scheduleData.daysOfWeek = days;
    } else if (freq === 'interval') {
        scheduleData.value = parseInt(document.getElementById('routineIntervalValue').value);
        scheduleData.unit = document.getElementById('routineIntervalUnit').value;
    }

    let overdueVal = parseInt(document.getElementById('routineOverdueValue').value) || 14;
    let overdueUnit = document.getElementById('routineOverdueUnit').value;
    let overdueAfterHours = overdueUnit === 'days' ? overdueVal * 24 : overdueVal;

    let routineData = {
        name: name,
        completionType: document.getElementById('routineType').value,
        assignees: assignees,
        schedule: scheduleData,
        linkedNiptoTask: document.getElementById('routinePoints').value || null,
        overdueAfterHours: overdueAfterHours
    };

    const id = document.getElementById('routineId').value;
    try {
        if (id) {
            await api.updateFirestoreDocument('routines', id, routineData);
        } else {
            routineData.createdAt = new Date().toISOString();
            routineData.lastCompleted = {};
            routineData.lastCompletedBy = {};
            await api.addFirestoreDocument('routines', routineData);
        }
        closeRoutineModal();

        await api.loadRoutinesFromFirestore();
        await syncRoutinesWithNiptoHistory();
        renderRoutines();
        renderSidebarRoutines();
    } catch (error) {
        alert("Error saving routine: " + error.message);
    }
}

// Returns the default overdue grace period (hours) for a routine's schedule.
function getDefaultOverdueHours(routine) {
    const schedule = routine.schedule || {};
    switch (schedule.type) {
        case 'daily':
            return schedule.resetType === 'specific' ? 4 : 14;
        case 'weekly':
            return 24;
        case 'interval':
            switch (schedule.unit) {
                case 'days':   return 24;
                case 'weeks':  return 48;
                case 'months': return 168;
                case 'years':  return 336;
                default:       return 24;
            }
        default: return 24;
    }
}

// Evaluates a routine's status (due / overdue / completed) and next due date.
function getRoutineStatus(routine, targetUids) {
    const now = new Date();
    let lastComp = null;
    let compNames = "";
    let pendingNames = [];
    let completedNames = [];
let neverCompleted = false;
    if (routine.completionType === 'shared') {
        lastComp = routine.lastCompleted ? routine.lastCompleted['shared'] : null;
        compNames = routine.lastCompletedBy ? routine.lastCompletedBy['shared'] : "";
    } else {
        let oldest = null;
        let allDone = true;
        let someCompleted = false;

        targetUids.forEach(uid => {
            const lc = routine.lastCompleted ? routine.lastCompleted[uid] : null;
            const uObj = ALL_USERS.find(u => u.uid === uid);
            const name = uObj ? uObj.name : 'Unknown';

            if (!lc) {
                allDone = false;
                pendingNames.push(name);
            } else {
                someCompleted = true;
                completedNames.push(name);
                if (!oldest || new Date(lc) < new Date(oldest)) oldest = lc;
            }
        });

        if (allDone) {
            lastComp = oldest;
            compNames = completedNames.join(', ');
        } else if (someCompleted) {
            return { status: 'due', nextDue: now, isCompleted: false, compNames: "", pendingNames, completedNames };
        } else {
            lastComp = null;
        }
    }

    if (!lastComp) {
    neverCompleted = true;
        if (routine.createdAt) {
            lastComp = routine.createdAt;
            compNames = "";
        } else {
            return { status: 'due', nextDue: now, isCompleted: false, compNames: "", pendingNames: [], completedNames: [] };
        }
    }

    const baseDate = new Date(lastComp);
    if (isNaN(baseDate.getTime())) {
        console.warn("Invalid baseDate in routine:", routine.name, lastComp);
        return { status: 'due', nextDue: now, isCompleted: false, compNames: "", pendingNames: [], completedNames: [] };
    }

    let nextDue = new Date(baseDate);

    if (routine.schedule.type === 'daily') {
        if (routine.schedule.resetType === 'midnight') {
            nextDue.setDate(nextDue.getDate() + 1);
            nextDue.setHours(0, 0, 0, 0);
        } else if (routine.schedule.resetType === 'specific') {
            let foundNext = false;
            let cleanTimes = (routine.schedule.specificTimes || []).map(t => {
                let clean = t.trim().toLowerCase();
                let isPM = clean.includes('pm');
                let isAM = clean.includes('am');
                clean = clean.replace(/[a-z\s]/g, '');
                let parts = clean.split(':').map(Number);
                let h = parts[0] || 0;
                let m = parts[1] || 0;
                if (isPM && h < 12) h += 12;
                if (isAM && h === 12) h = 0;
                return { h, m };
            });
            cleanTimes.sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));

            for (let timeObj of cleanTimes) {
                let candidate = new Date(baseDate);
                candidate.setHours(timeObj.h, timeObj.m, 0, 0);
                if (candidate > baseDate) { nextDue = candidate; foundNext = true; break; }
            }
            if (!foundNext && cleanTimes.length > 0) {
                nextDue.setDate(nextDue.getDate() + 1);
                nextDue.setHours(cleanTimes[0].h, cleanTimes[0].m, 0, 0);
            }
        }
    } else if (routine.schedule.type === 'weekly') {
        nextDue.setDate(nextDue.getDate() + 1);
        nextDue.setHours(0, 0, 0, 0);
        let safety = 0;
        while (!routine.schedule.daysOfWeek.includes(nextDue.getDay()) && safety < 8) {
            nextDue.setDate(nextDue.getDate() + 1);
            safety++;
        }
    } else if (routine.schedule.type === 'interval') {
        const val = routine.schedule.value;
        const unit = routine.schedule.unit;
        if (unit === 'days')   nextDue.setDate(nextDue.getDate() + val);
        if (unit === 'weeks')  nextDue.setDate(nextDue.getDate() + (val * 7));
        if (unit === 'months') nextDue.setMonth(nextDue.getMonth() + val);
        if (unit === 'years')  nextDue.setFullYear(nextDue.getFullYear() + val);
    }

    if (isNaN(nextDue.getTime())) {
        console.warn("Invalid nextDue calculated for routine:", routine.name);
        return { status: 'due', nextDue: now, isCompleted: false, compNames: "", pendingNames: [], completedNames: [] };
    }

    const overdueHours = routine.overdueAfterHours || getDefaultOverdueHours(routine);
    const overdueMs = overdueHours * 60 * 60 * 1000;

    if (now >= nextDue) {
        const isOverdue = (now.getTime() - nextDue.getTime()) > overdueMs;
        return { status: isOverdue ? 'overdue' : 'due', nextDue, isCompleted: false, compNames: "", pendingNames, completedNames };
    } else {
if (neverCompleted) {
            return { status: 'due', nextDue, isCompleted: false, compNames: "", pendingNames, completedNames };
        }
        return { status: 'completed', nextDue, isCompleted: true, compNames, completedAt: baseDate, pendingNames: [], completedNames };
    }
}
// Fills the "All Routines" user-filter dropdown from ALL_USERS.
function populateRoutineUserFilter() {
    const select = document.getElementById('routineUserFilter');
    if (!select) return;
    const current = select.value || 'all';
    select.innerHTML = '<option value="all">Everyone</option>';
    ALL_USERS.forEach(u => {
        select.innerHTML += `<option value="${u.uid}">${u.name}</option>`;
    });
    select.value = current;
}

// Builds one routine card. canComplete gates the ✅/⏭️ actions for the active user.
function buildRoutineCard(r, ev, canComplete) {
    const linkedTaskInfo = state.tasks.find(t => t.uid === r.linkedNiptoTask);
    const ptsDisplay = linkedTaskInfo && linkedTaskInfo.value > 0
        ? `⭐ ${Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor)} pts` : '';
    const assigneesHtml = formatRoutineAssignees(r);

    const card = document.createElement('div');
    card.className = `chore-card ${ev.isCompleted ? 'completed' : ''}`;

    let statusBadge = '';
    if (ev.status === 'overdue') statusBadge = `<span style="color: white; background: var(--danger); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold;">⚠️ Overdue</span>`;
    else if (ev.status === 'due') statusBadge = `<span style="color: white; background: var(--primary); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold;">📅 Due</span>`;

    let completedText = '';
    if (ev.isCompleted) {
        const wasSkipped = ev.compNames && ev.compNames.includes('⏭️');
        const resetLabel = ev.nextDue.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        completedText = `<div style="font-size: 12px; color: ${wasSkipped ? 'var(--text-muted)' : 'var(--success)'}; margin-top: 5px; font-weight: bold;">
            ${wasSkipped ? '⏭️ Skipped' : `✓ Done by ${ev.compNames}`} (Resets ${resetLabel})
        </div>`;
    } else if (r.completionType === 'individual' && ev.completedNames && ev.completedNames.length > 0) {
        const doneStr = ev.completedNames.map(n => `<span style="color: var(--success);">✅ ${n}</span>`).join(' ');
        const pendingStr = ev.pendingNames.map(n => `<span style="color: var(--text-muted);">⏳ ${n}</span>`).join(' ');
        completedText = `<div style="font-size: 12px; margin-top: 5px; display: flex; gap: 8px; flex-wrap: wrap;">${doneStr} ${pendingStr}</div>`;
    }

    let actionButtons = '';
    if (ev.isCompleted) {
        actionButtons += `<button class="chore-btn undo-btn" onclick="undoRoutine('${r.uid}')" title="Undo">↩️</button>`;
    } else if (canComplete) {
        actionButtons += `<button class="chore-btn complete-btn" onclick="completeRoutine('${r.uid}', '${r.linkedNiptoTask}')">✅</button>`;
        actionButtons += `<button class="chore-btn" onclick="skipRoutine('${r.uid}')" title="Skip this occurrence" style="font-size: 14px; opacity: 0.7;">⏭️</button>`;
    } else {
        actionButtons += `<span style="font-size: 10px; color: var(--text-muted); max-width: 90px; text-align:right;">Select an assigned person at the top to complete</span>`;
    }
    actionButtons += `<button class="chore-btn" onclick="editRoutine('${r.uid}')" title="Edit">✏️</button>`;
    actionButtons += `<button class="chore-btn delete-btn" onclick="deleteRoutine('${r.uid}')" title="Delete">🗑️</button>`;

    card.innerHTML = `
    <div class="chore-header">
        <div class="chore-title-area">
            <div class="chore-title" style="${ev.isCompleted ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">
                ${r.completionType === 'shared' ? '🤝' : '👤'} ${r.name}
            </div>
            <div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                ${statusBadge}
                ${assigneesHtml}
                <span style="font-size: 11px; color: var(--text-muted); border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 4px;">↻ ${r.schedule.type}</span>
                ${ptsDisplay ? `<span style="font-size: 11px; color: var(--primary); background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${ptsDisplay}</span>` : ''}
            </div>
            ${completedText}
        </div>
        <div class="chore-actions">${actionButtons}</div>
    </div>`;
    return card;
}

// Sorts evaluated routines: overdue → due → completed, individuals first, then by next due.
function sortEvaluated(list) {
    list.sort((a, b) => {
        if (a.evaluation.status === 'overdue' && b.evaluation.status !== 'overdue') return -1;
        if (a.evaluation.status !== 'overdue' && b.evaluation.status === 'overdue') return 1;
        if (a.evaluation.isCompleted && !b.evaluation.isCompleted) return 1;
        if (!a.evaluation.isCompleted && b.evaluation.isCompleted) return -1;
        const aInd = a.routine.assignees.length === 1;
        const bInd = b.routine.assignees.length === 1;
        if (aInd && !bInd) return -1;
        if (!aInd && bInd) return 1;
        return a.evaluation.nextDue - b.evaluation.nextDue;
    });
    return list;
}

// "My Routines": those assigned to the active user(s), evaluated for them.
export function renderMyRoutines() {
    const container = document.getElementById('myRoutinesContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!state.routines || state.routines.length === 0) {
        container.innerHTML = '<div class="empty-dashboard-msg">No routines set up yet.</div>';
        return;
    }

    let mine = state.routines.filter(r => state.activeUsers.some(uid => r.assignees.includes(uid)));
    if (mine.length === 0) {
        container.innerHTML = '<div class="empty-history" style="margin-top: 10px;">No routines assigned to you.</div>';
        return;
    }

    let evaluated = sortEvaluated(mine.map(r => ({ routine: r, evaluation: getRoutineStatus(r, state.activeUsers) })));
    evaluated.forEach(item => container.appendChild(buildRoutineCard(item.routine, item.evaluation, true)));
}

// "All Routines": every routine, optionally filtered to one person (view only — completion stays gated).
export function renderAllRoutines() {
    const container = document.getElementById('allRoutinesContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!state.routines || state.routines.length === 0) {
        container.innerHTML = '<div class="empty-dashboard-msg">No routines set up yet.</div>';
        return;
    }

    const filterSel = document.getElementById('routineUserFilter');
    const filterUid = filterSel ? filterSel.value : 'all';

    let list = state.routines;
   if (filterUid !== 'all') list = list.filter(r => r.assignees && r.assignees.includes(filterUid));

    if (list.length === 0) {
        container.innerHTML = '<div class="empty-history" style="margin-top: 10px;">No routines for that person.</div>';
        return;
    }

    let evaluated = sortEvaluated(list.map(r => {
        const targets = filterUid !== 'all' ? [filterUid] : r.assignees;
        return { routine: r, evaluation: getRoutineStatus(r, targets) };
    }));

    evaluated.forEach(item => {
        // Gate: only the user(s) selected at the TOP can actually log a completion.
        const canComplete = state.activeUsers.some(uid => item.routine.assignees.includes(uid));
        container.appendChild(buildRoutineCard(item.routine, item.evaluation, canComplete));
    });
}

// Public entry: refresh the dropdown and both sections.
export function renderRoutines() {
    populateRoutineUserFilter();
    renderMyRoutines();
    renderAllRoutines();
}

// Clears the latest completion for the active users (or shared), reverting the routine to due.
export async function undoRoutine(routineId) {
    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine) return;
    if (!confirm(`Undo completion of "${routine.name}"? Points already logged in Nipto are not removed.`)) return;

    let newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
    let newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};

    if (routine.completionType === 'shared') {
        delete newLastCompleted['shared'];
        delete newLastCompletedBy['shared'];
    } else {
        const targets = state.activeUsers.length ? state.activeUsers : Object.keys(newLastCompleted);
        targets.forEach(uid => { delete newLastCompleted[uid]; delete newLastCompletedBy[uid]; });
    }

    try {
        await api.updateFirestoreDocument('routines', routineId, {
            lastCompleted: newLastCompleted,
            lastCompletedBy: newLastCompletedBy
        });
        await api.loadRoutinesFromFirestore();
        renderRoutines();
        renderSidebarRoutines();
    } catch (error) {
        alert("Error undoing routine: " + error.message);
    }
}

// Renders due/overdue routines for the active user in the sidebar.
export function renderSidebarRoutines() {
    const container = document.getElementById('sidebarRoutinesContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!state.routines) return;

    let visibleRoutines = state.routines.filter(r => state.activeUsers.some(uid => r.assignees.includes(uid)));

    let dueRoutines = visibleRoutines
        .map(r => ({ routine: r, evaluation: getRoutineStatus(r, state.activeUsers) }))
        .filter(item => !item.evaluation.isCompleted);

    if (dueRoutines.length === 0) {
        container.innerHTML = '<div class="empty-history" style="margin-top: 10px;">All caught up! 🎉</div>';
        return;
    }

    dueRoutines.sort((a, b) => {
        if (a.evaluation.status === 'overdue' && b.evaluation.status !== 'overdue') return -1;
        if (a.evaluation.status !== 'overdue' && b.evaluation.status === 'overdue') return 1;
        return a.evaluation.nextDue - b.evaluation.nextDue;
    });

    dueRoutines.forEach(item => {
        const r = item.routine;
        const card = document.createElement('div');
        card.className = 'chore-card';

        const assigneesHtml = formatRoutineAssignees(r, true);
        const timeStr = item.evaluation.nextDue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const linkedTaskInfo = state.tasks.find(t => t.uid === r.linkedNiptoTask);
        const pts = linkedTaskInfo && linkedTaskInfo.value > 0
            ? `⭐ ${Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor)} pts` : '';

        card.innerHTML = `
        <div class="chore-header" style="flex-direction: column; align-items: flex-start; gap: 6px;">
            <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                <div class="chore-title" style="font-size: 13px;">${item.evaluation.status === 'overdue' ? '⚠️ ' : ''}${r.name}</div>
                <div style="display: flex; gap: 4px;">
                    <button class="chore-btn complete-btn" style="padding: 4px 8px; font-size: 12px;" onclick="completeRoutine('${r.uid}', '${r.linkedNiptoTask}')">✅</button>
                    <button class="chore-btn" style="padding: 4px 8px; font-size: 12px; opacity: 0.7;" onclick="skipRoutine('${r.uid}')" title="Skip">⏭️</button>
                </div>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; flex-wrap: wrap;">
                ${assigneesHtml}
                <span>🕒 ${timeStr}</span>
                ${pts ? `<span style="color: var(--primary); font-weight: bold;">${pts}</span>` : ''}
            </div>
        </div>
        `;
        container.appendChild(card);
    });
}

// Sets sensible overdue defaults in the modal based on frequency.
export function updateOverdueDefaults() {
    const freq = document.getElementById('routineFrequency').value;
    const resetType = document.getElementById('routineDailyReset').value;
    const valueInput = document.getElementById('routineOverdueValue');
    const unitSelect = document.getElementById('routineOverdueUnit');
    const hint = document.getElementById('overdueHint');
    if (!valueInput || !unitSelect || !hint) return;

    if (freq === 'daily') {
        if (resetType === 'specific') {
            valueInput.value = 4; unitSelect.value = 'hours';
            hint.textContent = 'Default: 4 hours after each scheduled time';
        } else {
            valueInput.value = 14; unitSelect.value = 'hours';
            hint.textContent = 'Default: 14 hours (~2pm if not done by midnight reset)';
        }
    } else if (freq === 'weekly') {
        valueInput.value = 1; unitSelect.value = 'days';
        hint.textContent = 'Default: 1 day after the scheduled day';
    } else if (freq === 'interval') {
        const unit = document.getElementById('routineIntervalUnit').value;
        switch (unit) {
            case 'days':   valueInput.value = 1;  unitSelect.value = 'days'; hint.textContent = 'Default: 1 day after due'; break;
            case 'weeks':  valueInput.value = 2;  unitSelect.value = 'days'; hint.textContent = 'Default: 2 days after due'; break;
            case 'months': valueInput.value = 7;  unitSelect.value = 'days'; hint.textContent = 'Default: 7 days after due'; break;
            case 'years':  valueInput.value = 14; unitSelect.value = 'days'; hint.textContent = 'Default: 14 days after due'; break;
            default:       valueInput.value = 1;  unitSelect.value = 'days';
        }
    }
}

// Marks a routine complete for the active users and awards linked points.
export async function completeRoutine(routineId, linkedNiptoTask) {
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return; }
    if (state.activeUsers.length === 0) { alert("Select at least one user first!"); return; }

    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine) return;

    let targetDate = state.currentMode === 'live' ? new Date() : new Date(document.getElementById('taskDate').value);
    let namesString = state.activeUsers.map(uid => ALL_USERS.find(u => u.uid === uid).name).join(', ');

    try {
        if (linkedNiptoTask && linkedNiptoTask !== "null") {
    const activityUids = await api.logActivityToNipto(linkedNiptoTask, targetDate.toISOString()); // capture
    await api.saveActivityLabels(activityUids, routine.name);                                     // NEW
    const tObj = state.tasks.find(t => t.uid === linkedNiptoTask);
    if (tObj) showToast(linkedNiptoTask, routine.name, Math.ceil(tObj.value / state.currentSplitDivisor), namesString);
}

        let newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
        let newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};

        if (routine.completionType === 'shared') {
            newLastCompleted['shared'] = targetDate.toISOString();
            newLastCompletedBy['shared'] = namesString;
        } else {
            state.activeUsers.forEach(uid => {
                newLastCompleted[uid] = targetDate.toISOString();
                newLastCompletedBy[uid] = ALL_USERS.find(u => u.uid === uid).name;
            });
        }

        await api.updateFirestoreDocument('routines', routineId, {
            lastCompleted: newLastCompleted,
            lastCompletedBy: newLastCompletedBy
        });

        await api.loadRoutinesFromFirestore();
        renderRoutines();
        renderSidebarRoutines();
        updateLeaderboardUI();
    } catch (error) {
        alert("Error completing routine: " + error.message);
    }
}

// Permanently deletes a routine after confirmation.
export async function deleteRoutine(routineId) {
    if (confirm("Are you sure you want to permanently delete this routine?")) {
        await api.deleteFirestoreDocument('routines', routineId);
        await api.loadRoutinesFromFirestore();
        renderRoutines();
        renderSidebarRoutines();
    }
}

// Advances a routine to its next occurrence without awarding points.
export async function skipRoutine(routineId) {
    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine) return;
    if (!confirm(`Skip "${routine.name}"? No points will be awarded and it will advance to the next occurrence.`)) return;

    const now = new Date();
    let newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
    let newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};

    if (routine.completionType === 'shared') {
        newLastCompleted['shared'] = now.toISOString();
        newLastCompletedBy['shared'] = '⏭️ Skipped';
    } else {
        if (state.activeUsers.length === 0) { alert("Select at least one user first!"); return; }
        state.activeUsers.forEach(uid => {
            newLastCompleted[uid] = now.toISOString();
            const uObj = ALL_USERS.find(u => u.uid === uid);
            newLastCompletedBy[uid] = `⏭️ Skipped by ${uObj ? uObj.name : 'Someone'}`;
        });
    }

    try {
        await api.updateFirestoreDocument('routines', routineId, {
            lastCompleted: newLastCompleted,
            lastCompletedBy: newLastCompletedBy
        });

        await api.loadRoutinesFromFirestore();
        renderRoutines();
        renderSidebarRoutines();

        const statusDiv = document.getElementById('status');
        if (statusDiv) {
            statusDiv.innerText = `⏭️ Skipped: ${routine.name}`;
            statusDiv.style.color = 'var(--text-muted)';
            setTimeout(() => { statusDiv.innerText = ''; }, 3000);
        }
    } catch (error) {
        alert("Error skipping routine: " + error.message);
    }
}

// Reconciles routine completion state against logged Nipto history.
export async function syncRoutinesWithNiptoHistory() {
    if (!state.routines || !state.allWeekActivities) return;

    let requiresDbUpdate = false;

    for (const routine of state.routines) {
        if (!routine.linkedNiptoTask) continue;

        const linkedObj = state.tasks.find(t => t.uid === routine.linkedNiptoTask);

        const matchingActivities = state.allWeekActivities.filter(act => {
            const historicalTaskId = (act.task && (act.task.uid || act.task.id)) || act.taskId || act.task_id;
            if (historicalTaskId && historicalTaskId === routine.linkedNiptoTask) return true;
            if (linkedObj && act.task && act.task.name === linkedObj.name) return true;
            return false;
        });

        if (matchingActivities.length === 0) continue;

        matchingActivities.sort((a, b) => a.parsedDate - b.parsedDate);

        let newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
        let newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};
        let updatedThisRoutine = false;

        for (const act of matchingActivities) {
            const actDateStr = act.parsedDate.toISOString();
            const actUserUid = (act.user && (act.user.uid || act.user.id)) || act.userId || "unknown";
            const actUserName = (act.user && act.user.name) ? act.user.name : "Someone";

            if (routine.completionType === 'shared') {
                const currentSharedDate = newLastCompleted['shared'];
                if (!currentSharedDate || new Date(actDateStr) > new Date(currentSharedDate)) {
                    newLastCompleted['shared'] = actDateStr;
                    newLastCompletedBy['shared'] = actUserName;
                    updatedThisRoutine = true;
                }
            } else {
                const currentUserDate = newLastCompleted[actUserUid];
                if (!currentUserDate || new Date(actDateStr) > new Date(currentUserDate)) {
                    newLastCompleted[actUserUid] = actDateStr;
                    newLastCompletedBy[actUserUid] = actUserName;
                    updatedThisRoutine = true;
                }
            }
        }

        if (updatedThisRoutine) {
            routine.lastCompleted = newLastCompleted;
            routine.lastCompletedBy = newLastCompletedBy;
            requiresDbUpdate = true;

            api.updateFirestoreDocument('routines', routine.uid, {
                lastCompleted: newLastCompleted,
                lastCompletedBy: newLastCompletedBy
            }).catch(err => console.error("History auto-sync error:", err));
        }
    }

    if (requiresDbUpdate) {
        renderRoutines();
        renderSidebarRoutines();
    }
}