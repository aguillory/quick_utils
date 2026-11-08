// routines.js
// 7-Day Rolling Schedule (-3 Days | TODAY | +3 Days), Time-of-Day Buckets,
// Retroactive Check-Off with Backdated Points, and Admin Clear (No Points).

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

// Compact assignee label for a routine card
export function formatRoutineAssignees(routine, compact = false) {
    const assignees = routine.assignees || [];
    const fontSize = compact ? '10px' : '11px';
    const baseStyle = `font-size: ${fontSize}; font-weight: bold; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color);`;

    if (!assignees.length || assignees.length >= ALL_USERS.length) {
        return `<span style="color: var(--text-muted); ${baseStyle}">&#x1F465; Anyone</span>`;
    }

    if (routine.completionType === 'individual') {
        const myUids = state.activeUsers.filter(uid => assignees.includes(uid));
        if (myUids.length > 0) {
            return myUids.map(uid => {
                const u = ALL_USERS.find(user => user.uid === uid);
                return u ? `<span style="color: ${u.color}; ${baseStyle}">&#x1F464; ${escapeHtml(u.name)}</span>` : '';
            }).join(' ');
        }
        return `<span style="color: var(--text-muted); ${baseStyle}">&#x1F464; Individual</span>`;
    }

    const names = assignees.map(uid => {
        const u = ALL_USERS.find(user => user.uid === uid);
        return u ? escapeHtml(u.name) : 'Unknown';
    });
    return `<span style="color: var(--text-muted); ${baseStyle}">&#x1F465; ${names.join(' or ')}</span>`;
}

// ==========================================
// 7-DAY ROLLING SCHEDULE ENGINE
// ==========================================
export function setScheduleFilter(filterVal) {
    state.scheduleFilter = filterVal;
    renderRollingSchedule();
}

// Determines if routine applies to a given JS Date object
function routineAppliesToDate(routine, targetDate) {
    const sched = routine.schedule || { type: 'daily' };
    const dayOfWeek = targetDate.getDay(); // 0 = Sun, 1 = Mon ...
    
    if (sched.type === 'daily') return true;
    if (sched.type === 'weekly') {
        const days = sched.daysOfWeek || [];
        return days.includes(dayOfWeek);
    }
    if (sched.type === 'interval') {
        return true;
    }
    return true;
}

// Infers time-of-day bucket ("Morning", "Afternoon", "Evening", "Anytime")
function getRoutineTimeOfDay(routine) {
    if (routine.timeOfDay) return routine.timeOfDay;
    if (routine.schedule?.timeOfDay) return routine.schedule.timeOfDay;
    if (routine.schedule?.specificTimes && routine.schedule.specificTimes.length > 0) {
        const first = routine.schedule.specificTimes[0].trim();
        const hour = parseInt(first.split(':')[0], 10);
        if (!isNaN(hour)) {
            if (hour < 12) return 'Morning';
            if (hour < 17) return 'Afternoon';
            return 'Evening';
        }
    }
    return 'Anytime';
}

// Format local YYYY-MM-DD
function toLocalDateKey(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function renderRollingSchedule() {
    const container = document.getElementById('rollingScheduleContainer');
    if (!container) return;

    const routines = state.routines || [];
    const activeUid = state.activeUsers[0] || '';
    const filter = state.scheduleFilter || 'all';

    // 1. Build Filter Pills HTML
    let filterHtml = `
    <div class="filter-pills-row" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; align-items: center;">
        <span style="font-size: 12px; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Filter Routines:</span>
        <button class="filter-pill ${filter === 'all' ? 'active' : ''}" onclick="setScheduleFilter('all')">All</button>
        <button class="filter-pill ${filter === 'me' ? 'active' : ''}" onclick="setScheduleFilter('me')">Me (${ALL_USERS.find(u => u.uid === activeUid)?.name || 'Active'})</button>
    `;
    ALL_USERS.forEach(u => {
        filterHtml += `<button class="filter-pill ${filter === u.uid ? 'active' : ''}" onclick="setScheduleFilter('${u.uid}')">${escapeHtml(u.name)}</button>`;
    });
    filterHtml += `</div>`;

    // 2. Compute 7 rolling days: -3, -2, -1, 0, 1, 2, 3
    const daysData = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let offset = -3; offset <= 3; offset++) {
        const d = new Date(today);
        d.setDate(today.getDate() + offset);
        const dateKey = toLocalDateKey(d);
        
        let label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        let badge = '';
        if (offset === 0) badge = 'TODAY';
        else if (offset === -1) badge = 'Yesterday';
        else if (offset === 1) badge = 'Tomorrow';
        else if (offset < 0) badge = `${offset} Days`;
        else badge = `+${offset} Days`;

        daysData.push({
            offset,
            dateObj: d,
            dateKey,
            label,
            badge,
            isToday: offset === 0,
            isPast: offset < 0,
            isFuture: offset > 0
        });
    }

    // 3. Render 7-column grid
    let gridHtml = `<div class="rolling-schedule-grid">`;

    daysData.forEach(day => {
        const colClass = `schedule-day-col ${day.isToday ? 'is-today' : ''} ${day.isPast ? 'is-past' : ''} ${day.isFuture ? 'is-future' : ''}`;
        
        gridHtml += `
        <div class="${colClass}">
            <div class="schedule-day-header">
                <span class="schedule-day-badge">${day.badge}</span>
                <span class="schedule-day-title">${day.label}</span>
            </div>
            <div class="schedule-day-body">
        `;

        // Filter routines for this day and user filter
        const dayRoutines = routines.filter(r => {
            if (!routineAppliesToDate(r, day.dateObj)) return false;
            if (filter === 'me') {
                return !r.assignees || !r.assignees.length || r.assignees.includes(activeUid);
            } else if (filter !== 'all') {
                return !r.assignees || !r.assignees.length || r.assignees.includes(filter);
            }
            return true;
        });

        if (dayRoutines.length === 0) {
            gridHtml += `<div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 12px 0;">No routines</div>`;
        } else {
            // Group by buckets: Morning, Afternoon, Evening, Anytime
            const buckets = ['Morning', 'Afternoon', 'Evening', 'Anytime'];
            buckets.forEach(bucket => {
                const bucketRoutines = dayRoutines.filter(r => getRoutineTimeOfDay(r) === bucket);
                if (bucketRoutines.length > 0) {
                    gridHtml += `<div class="bucket-header">${bucket}</div>`;
                    bucketRoutines.forEach(r => {
                        const comp = r.completionsByDate ? r.completionsByDate[day.dateKey] : null;
                        const isDone = !!comp;
                        const withoutPts = isDone && comp.withoutPoints;
                        const doneByName = isDone ? (comp.completedByName || 'Someone') : '';
                        
                        const linkedTask = state.tasks?.find(t => t.uid === r.linkedNiptoTask);
                        const pts = linkedTask ? linkedTask.value : 0;
                        const assigneesLabel = formatRoutineAssignees(r, true);

                        gridHtml += `
                        <div class="routine-slot ${isDone ? 'is-completed' : ''}">
                            <div class="routine-slot-info">
                                <div class="routine-slot-title" style="${isDone ? 'text-decoration: line-through; opacity: 0.7;' : ''}">
                                    ${escapeHtml(r.name)}
                                </div>
                                <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap; margin-top: 3px;">
                                    ${assigneesLabel}
                                    ${pts > 0 ? `<span class="pts-badge">+${pts} pts</span>` : ''}
                                </div>
                                ${isDone ? `
                                    <div style="font-size: 10px; color: var(--success); font-weight: 700; margin-top: 2px;">
                                        &#x2714; Done by ${escapeHtml(doneByName)}${withoutPts ? ' (No pts)' : ''}
                                    </div>
                                ` : ''}
                            </div>
                            <div class="routine-slot-actions">
                        `;

                        if (day.isFuture) {
                            // Read-only future preview
                            gridHtml += `<span style="font-size: 10px; color: var(--text-muted);">Upcoming</span>`;
                        } else if (isDone) {
                            // Undo button for this specific day
                            gridHtml += `
                                <button type="button" class="btn-undo-routine" onclick="undoRoutineForDate('${r.uid}', '${day.dateKey}')" title="Undo this day's completion">&#x21A9;</button>
                            `;
                        } else {
                            // Check-off button + Admin Clear (No Pts) button
                            gridHtml += `
                                <button type="button" class="btn-check-routine" onclick="completeRoutineForDate('${r.uid}', '${day.dateKey}', true)" title="Mark Done (awards points)">
                                    &#x2714;
                                </button>
                                <button type="button" class="btn-clear-routine" onclick="completeRoutineForDate('${r.uid}', '${day.dateKey}', false)" title="Admin: Clear Without Points">
                                    &#x2716; No Pts
                                </button>
                            `;
                        }

                        gridHtml += `
                            </div>
                        </div>
                        `;
                    });
                }
            });
        }

        gridHtml += `
            </div>
        </div>
        `;
    });

    gridHtml += `</div>`;

    container.innerHTML = filterHtml + gridHtml;
}

// Retroactive Check-off & Backdated Point Attribution
export async function completeRoutineForDate(routineId, dateKey, awardPoints = true) {
    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine) return;

    // Determine assignee to credit
    let creditedUid = '';
    let creditedName = 'User';
    if (routine.assignees && routine.assignees.length === 1) {
        creditedUid = routine.assignees[0];
    } else {
        creditedUid = state.activeUsers[0] || ALL_USERS[0].uid;
    }
    const userObj = ALL_USERS.find(u => u.uid === creditedUid);
    if (userObj) creditedName = userObj.name;

    const completions = routine.completionsByDate ? { ...routine.completionsByDate } : {};
    completions[dateKey] = {
        completedAt: new Date().toISOString(),
        completedByUid: creditedUid,
        completedByName: creditedName,
        withoutPoints: !awardPoints
    };

    try {
        await api.updateFirestoreDocument('routines', routineId, {
            completionsByDate: completions
        });
        routine.completionsByDate = completions;

        // If awarding points and linked Nipto task exists, backdate points to that date noon!
        if (awardPoints && routine.linkedNiptoTask && state.apiToken) {
            const backdatedDateIso = new Date(`${dateKey}T12:00:00`).toISOString();
            await api.logActivityToNipto(routine.linkedNiptoTask, backdatedDateIso, [creditedUid]);
            const taskObj = state.tasks?.find(t => t.uid === routine.linkedNiptoTask);
            const pts = taskObj ? taskObj.value : 0;
            showToast(routine.linkedNiptoTask, routine.name, pts, creditedName);
        } else if (!awardPoints) {
            showToast("admin_clear", `Cleared "${routine.name}" on ${dateKey} (No points)`, 0, creditedName);
        }

        renderRollingSchedule();
        updateLeaderboardUI();
    } catch (err) {
        console.error("Error completing routine for date:", err);
        alert("Failed to complete routine: " + err.message);
    }
}

// Reverts a specific date's completion
export async function undoRoutineForDate(routineId, dateKey) {
    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine || !routine.completionsByDate) return;

    const completions = { ...routine.completionsByDate };
    delete completions[dateKey];

    try {
        await api.updateFirestoreDocument('routines', routineId, {
            completionsByDate: completions
        });
        routine.completionsByDate = completions;
        renderRollingSchedule();
        updateLeaderboardUI();
    } catch (err) {
        console.error("Error undoing routine:", err);
        alert("Failed to undo routine: " + err.message);
    }
}

// Opens the modal for creating a new routine
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

export function closeRoutineModal() {
    document.getElementById('routineModal').style.display = 'none';
}

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
    document.getElementById('routineModal').style.display = 'flex';
}

export function toggleRoutineFrequencyFields() {
    const freq = document.getElementById('routineFrequency').value;
    const dailyReset = document.getElementById('routineDailyReset').value;

    document.getElementById('freqDailyFields').style.display = freq === 'daily' ? 'block' : 'none';
    document.getElementById('freqWeeklyFields').style.display = freq === 'weekly' ? 'block' : 'none';
    document.getElementById('freqIntervalFields').style.display = freq === 'interval' ? 'block' : 'none';
    document.getElementById('dailySpecificTimes').style.display = (freq === 'daily' && dailyReset === 'specific') ? 'block' : 'none';
}

function populateRoutineAssignees(selectedUids = []) {
    const container = document.getElementById('routineAssignees');
    if (!container) return;
    container.innerHTML = '';
    ALL_USERS.forEach(u => {
        const isChecked = selectedUids.includes(u.uid) ? 'checked' : '';
        container.innerHTML += `
        <label style="font-size: 13px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" value="${u.uid}" class="routine-assignee-cb" ${isChecked}> ${escapeHtml(u.name)}
        </label>`;
    });
}

function populateRoutinePointsSelect() {
    const select = document.getElementById('routinePoints');
    if (!select) return;
    select.innerHTML = '<option value="">-- No Points --</option>';
    if (!state.tasks || state.tasks.length === 0) return;

    const groupedTasks = state.tasks.reduce((acc, task) => {
        const categoryName = task.category || task.group || 'Uncategorized';
        if (categoryName === "General" || categoryName === "Pinned") return acc;
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
            optGroup.innerHTML += `<option value="${t.uid}">${escapeHtml(t.name)} (${t.value} pts)</option>`;
        });
        select.appendChild(optGroup);
    });
}

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

    let routineData = {
        name: name,
        completionType: document.getElementById('routineType').value,
        assignees: assignees,
        schedule: scheduleData,
        timeOfDay: scheduleData.timeOfDay || 'Anytime',
        linkedNiptoTask: document.getElementById('routinePoints').value || null
    };

    const id = document.getElementById('routineId').value;
    try {
        if (id) {
            await api.updateFirestoreDocument('routines', id, routineData);
        } else {
            routineData.createdAt = new Date().toISOString();
            routineData.completionsByDate = {};
            await api.addFirestoreDocument('routines', routineData);
        }
        closeRoutineModal();
        await api.loadRoutinesFromFirestore();
        renderRollingSchedule();
    } catch (error) {
        alert("Error saving routine: " + error.message);
    }
}

export async function deleteRoutine(routineId) {
    if (!confirm("Are you sure you want to delete this routine?")) return;
    try {
        await api.deleteFirestoreDocument('routines', routineId);
        await api.loadRoutinesFromFirestore();
        renderRollingSchedule();
    } catch (e) {
        alert("Error deleting routine: " + e.message);
    }
}

// Public unified renderer
export function renderRoutines() {
    renderRollingSchedule();
}

// Backward-compatibility export for legacy callers
export function renderSidebarRoutines() {
    renderRollingSchedule();
}
