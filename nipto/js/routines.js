// routines.js
// 3-Column Routine Board: Past (Missed), Current (Today), Upcoming (Next 3 Days)
// Clean row-based rendering, compact assignee pills, and admin dismiss without points.

import { state, ALL_USERS, NIPTO_PUBLIC_URL } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { updateLeaderboardUI, rebuildCompletedToday, renderDoneTodayFeed } from './leaderboard.js';
import { getLocalTodayKey, registerCustomCategory } from './utils.js';

export { NIPTO_PUBLIC_URL };

const DAILY_CARE_ROUTINE_SLUGS = new Set([
    "feed orion",
    "check kevin's water",
    "check kevins water",
    "feed turtle",
    "collect eggs"
]);

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Format local YYYY-MM-DD
function toLocalDateKey(d) {
    return getLocalTodayKey(d);
}

// Determines if a routine runs every single day.
// Rule: Daily routines ONLY ever exist on Today's board—never in Past (Missed) or Upcoming.
export function isDailyRoutine(task) {
    if (!task) return false;

    // 1. Check known daily animal care titles/slugs first ("Feed Orion", "Check Kevin's Water", etc.)
    const rawTitle = String(task.name || task.title || '').trim().toLowerCase().replace(/[\u2018\u2019]/g, "'");
    if (DAILY_CARE_ROUTINE_SLUGS.has(rawTitle)) {
        return true;
    }

    const sched = (task.schedule && typeof task.schedule === 'object') ? task.schedule : null;
    const schedType = String((sched && sched.type) || (typeof task.schedule === 'string' ? task.schedule : '') || task.frequency || task.recurrence || '').trim().toLowerCase();

    // 2. Explicit daily schedule type takes immediate precedence over any stale properties
    if (schedType === 'daily' || schedType === 'everyday' || schedType === 'every day') {
        return true;
    }

    // 3. Weekly schedule check: normalize daysOfWeek to unique valid day numbers (0..6)
    const rawDays = (sched && (sched.daysOfWeek || sched.days)) || task.daysOfWeek || task.days;
    const uniqueDays = Array.isArray(rawDays)
        ? Array.from(new Set(rawDays.map(d => Number(d)).filter(d => !isNaN(d) && d >= 0 && d <= 6)))
        : null;

    if (schedType === 'weekly') {
        // If 1 to 6 specific days are selected, it is a weekly routine (not daily)
        if (uniqueDays && uniqueDays.length > 0 && uniqueDays.length < 7) {
            return false;
        }
        // If all 7 days are selected (or daysOfWeek was left empty by AI staging), treat as daily
        return true;
    }

    // 4. Custom interval schedule check (ONLY inspect interval value when schedule type is 'interval';
    // NEVER read task.value which stores Nipto chore points!)
    if (schedType === 'interval') {
        const intervalVal = Number(
            (sched && (sched.interval ?? sched.repeatEvery ?? sched.every ?? sched.intervalValue ?? sched.value)) ??
            (task.interval ?? task.repeatEvery ?? task.every ?? 1)
        );
        const unitVal = String(
            (sched && (sched.unit || sched.intervalUnit)) || task.unit || task.intervalUnit || 'days'
        ).trim().toLowerCase();

        if (['weeks', 'week', 'months', 'month', 'years', 'year'].includes(unitVal)) {
            return false;
        }
        if (!isNaN(intervalVal) && intervalVal > 1) {
            return false;
        }
        return true;
    }

    // 5. If days array is present without an explicit schedType
    if (uniqueDays) {
        if (uniqueDays.length > 0 && uniqueDays.length < 7) {
            return false;
        }
        if (uniqueDays.length >= 7) {
            return true;
        }
    }

    // 6. Check recurrence/timeOfDay strings (including 'afternoon' and 'midnight')
    const checkStringForDaily = (val) => {
        if (!val || typeof val !== 'string') return false;
        const s = val.trim().toLowerCase();
        const dailyKeywords = [
            'daily', 'every day', 'everyday', '1d', '1 day', 'day',
            '2x daily', 'twice daily', 'morning', 'afternoon', 'evening',
            'am', 'pm', 'night', 'midnight', 'noon', 'anytime'
        ];
        return dailyKeywords.some(kw => s.includes(kw));
    };

    const stringProps = [
        task.schedule, task.frequency, task.recurrence,
        task.timeOfDay, task.repeat, task.times, task.resetType,
        sched ? sched.type : null,
        sched ? sched.frequency : null,
        sched ? sched.recurrence : null,
        sched ? sched.timeOfDay : null,
        sched ? sched.resetType : null
    ];
    for (const prop of stringProps) {
        if (checkStringForDaily(prop)) {
            return true;
        }
    }

    if (/\b(daily|every day|everyday|morning|afternoon|evening|night|am|pm|twice daily|2x daily)\b/i.test(rawTitle)) {
        return true;
    }

    // 7. Default for any routine item not explicitly restricted to <7 weekly days or >1 interval
    return true;
}

// Compact assignee label for a routine card or row
export function formatRoutineAssignees(routine, compact = true) {
    const assignees = routine.assignees || [];
    const baseClass = "routine-assignee-pill";

    if (!assignees.length || assignees.length >= ALL_USERS.length) {
        return `<span class="${baseClass} shared-pill" title="Anyone can do">&#x1F465;</span>`;
    }

    if (assignees.length >= 3) {
        const fullNames = assignees.map(uid => {
            const u = ALL_USERS.find(user => user.uid === uid);
            return u ? u.name : 'Unknown';
        }).join(', ');
        return `<span class="${baseClass} shared-pill" title="${escapeHtml(fullNames)}">&#x1F465;</span>`;
    }

    if (routine.completionType === 'individual') {
        const myUids = state.activeUsers.filter(uid => assignees.includes(uid));
        if (myUids.length > 0) {
            return myUids.map(uid => {
                const u = ALL_USERS.find(user => user.uid === uid);
                return u ? `<span class="${baseClass}" style="color: ${u.color};">&#x1F464; ${escapeHtml(u.name)}</span>` : '';
            }).join(' ');
        }
        return `<span class="${baseClass}">&#x1F464; Individual</span>`;
    }

    const names = assignees.map(uid => {
        const u = ALL_USERS.find(user => user.uid === uid);
        return u ? escapeHtml(u.name) : 'Unknown';
    });
    return `<span class="${baseClass}">&#x1F465; ${names.join(' or ')}</span>`;
}

// ==========================================
// 3-COLUMN ROUTINE BOARD ENGINE
// ==========================================
export function setScheduleFilter(filterVal) {
    state.scheduleFilter = filterVal;
    renderRollingSchedule();
}

export function toggleHideCompletedRoutines() {
    state.hideCompletedRoutines = !state.hideCompletedRoutines;
    renderRollingSchedule();
}

// Determines if a routine applies to a given JS Date object.
// Enforces the strict rule that daily routines ONLY apply to Today.
function routineAppliesToDate(routine, targetDate) {
    if (!routine || !targetDate) return false;

    const todayKey = toLocalDateKey(new Date());
    const targetKey = toLocalDateKey(targetDate);

    // STRICT DAILY GUARD: Daily routines can ONLY ever apply to todayKey
    if (isDailyRoutine(routine)) {
        return targetKey === todayKey;
    }

    const sched = (routine.schedule && typeof routine.schedule === 'object') ? routine.schedule : { type: 'daily' };
    const dayOfWeek = targetDate.getDay(); // 0 = Sun, 1 = Mon ...

    if (sched.type === 'weekly') {
        const rawDays = sched.daysOfWeek || routine.daysOfWeek || [];
        const days = rawDays.map(d => Number(d)).filter(d => !isNaN(d));
        return days.includes(dayOfWeek);
    }

    if (sched.type === 'interval') {
        const intervalVal = Math.max(1, Number(sched.value || sched.interval || 1));
        const unit = String(sched.unit || 'days').toLowerCase();
        let stepDays = intervalVal;
        if (unit.startsWith('week')) stepDays = intervalVal * 7;
        else if (unit.startsWith('month')) stepDays = intervalVal * 30;

        if (stepDays <= 1) {
            return targetKey === todayKey;
        }

        // Anchor interval calculation to most recent completion date or createdAt
        const compKeys = routine.completionsByDate ? Object.keys(routine.completionsByDate).sort() : [];
        const anchorStr = compKeys.length > 0
            ? `${compKeys[compKeys.length - 1]}T00:00:00`
            : (routine.createdAt || `${todayKey}T00:00:00`);
        const anchorDate = new Date(anchorStr);
        if (isNaN(anchorDate.getTime())) return targetKey === todayKey;

        anchorDate.setHours(0, 0, 0, 0);
        const checkDate = new Date(targetDate.getTime());
        checkDate.setHours(0, 0, 0, 0);

        const diffDays = Math.round((checkDate.getTime() - anchorDate.getTime()) / 86400000);
        if (compKeys.length > 0) {
            return diffDays > 0 && (diffDays % stepDays === 0);
        }
        return diffDays >= 0 && (diffDays % stepDays === 0);
    }

    return targetKey === todayKey;
}

// Filter matching helper
function routineMatchesFilter(r, filter, activeUid) {
    if (!filter || filter === 'all') return true;
    if (filter === 'me') {
        if (!r.assignees || r.assignees.length === 0) return true;
        return r.assignees.includes(activeUid);
    }
    if (!r.assignees || r.assignees.length === 0) return true;
    return r.assignees.includes(filter);
}

export function renderRollingSchedule() {
    const container = document.getElementById('rollingScheduleContainer');
    if (!container) return;

    const routines = state.routines || [];
    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeUserObj = ALL_USERS.find(u => u.uid === activeUid);
    const activeName = activeUserObj ? activeUserObj.name : 'Active';

    if (!state.scheduleFilter) state.scheduleFilter = 'me';
    const filter = state.scheduleFilter;

    // 1. Build Filter Pills HTML
    let filterHtml = `
    <div class="routine-filter-bar">
        <span class="filter-label">Filter Routines:</span>
        <button class="filter-pill ${filter === 'me' ? 'active' : ''}" onclick="setScheduleFilter('me')">Me (${escapeHtml(activeName)})</button>
        <button class="filter-pill ${filter === 'all' ? 'active' : ''}" onclick="setScheduleFilter('all')">All</button>
    `;
    ALL_USERS.forEach(u => {
        filterHtml += `<button class="filter-pill ${filter === u.uid ? 'active' : ''}" onclick="setScheduleFilter('${u.uid}')">${escapeHtml(u.name)}</button>`;
    });
    filterHtml += `</div>`;

    // 2. Date references
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = toLocalDateKey(today);

    // ------------------------------------------
    // COLUMN 1: Past (Missed) - Past 3 days (-1, -2, -3)
    // Daily routines are strictly excluded.
    // ------------------------------------------
    const pastDays = [-1, -2, -3].map(offset => {
        const d = new Date(today);
        d.setDate(today.getDate() + offset);
        return {
            offset,
            dateObj: d,
            dateKey: toLocalDateKey(d),
            dayName: d.toLocaleDateString(undefined, { weekday: 'short' }),
            dateStr: `${d.getMonth() + 1}/${d.getDate()}`
        };
    });

    const missedItems = [];
    pastDays.forEach(day => {
        routines.forEach(r => {
            if (isDailyRoutine(r)) return;
            if (!routineMatchesFilter(r, filter, activeUid)) return;
            if (!routineAppliesToDate(r, day.dateObj)) return;

            const comp = r.completionsByDate ? r.completionsByDate[day.dateKey] : null;
            if (!comp) {
                missedItems.push({
                    routine: r,
                    dateKey: day.dateKey,
                    dayName: day.dayName,
                    dateStr: day.dateStr
                });
            }
        });
    });

    missedItems.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

    // ------------------------------------------
    // COLUMN 2: Current (Today) - Displayed ONCE
    // ------------------------------------------
    const todayItems = [];
    routines.forEach(r => {
        if (!routineMatchesFilter(r, filter, activeUid)) return;
        if (!routineAppliesToDate(r, today)) return;

        const comp = r.completionsByDate ? r.completionsByDate[todayKey] : null;
        const isDone = !!comp;
        todayItems.push({
            routine: r,
            isDone,
            comp
        });
    });

    todayItems.sort((a, b) => {
        if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
        return (a.routine.name || '').localeCompare(b.routine.name || '');
    });

    const completedTodayCount = todayItems.filter(item => item.isDone).length;

    // ------------------------------------------
    // COLUMN 3: Upcoming (Next 3 Days) - (+1, +2, +3)
    // Daily routines are strictly excluded.
    // ------------------------------------------
    const upcomingDays = [1, 2, 3].map(offset => {
        const d = new Date(today);
        d.setDate(today.getDate() + offset);
        return {
            offset,
            dateObj: d,
            dateKey: toLocalDateKey(d),
            dayName: d.toLocaleDateString(undefined, { weekday: 'short' }),
            dateStr: `${d.getMonth() + 1}/${d.getDate()}`
        };
    });

    const upcomingItems = [];
    upcomingDays.forEach(day => {
        routines.forEach(r => {
            if (isDailyRoutine(r)) return;
            if (!routineMatchesFilter(r, filter, activeUid)) return;
            if (!routineAppliesToDate(r, day.dateObj)) return;

            upcomingItems.push({
                routine: r,
                dateKey: day.dateKey,
                dayName: day.dayName,
                dateStr: day.dateStr
            });
        });
    });

    upcomingItems.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    // ------------------------------------------
    // BUILD 3-COLUMN BOARD HTML
    // ------------------------------------------
    let boardHtml = `<div class="routine-board-grid">`;

    // ===== COLUMN 1: PAST (MISSED) =====
    boardHtml += `
    <div class="routine-board-col routine-col-past">
        <div class="routine-col-header">
            <div style="display: flex; align-items: center; gap: 6px;">
                <span class="routine-col-title">Past (Missed)</span>
                <span class="routine-count-badge ${missedItems.length > 0 ? 'alert' : ''}">${missedItems.length}</span>
            </div>
            ${missedItems.length > 0 ? `
                <button type="button" class="btn-clear-all-missed" onclick="clearAllMissedRoutines()" title="Dismiss all missed routines without awarding points">
                    Clear All
                </button>
            ` : ''}
        </div>
        <div class="routine-col-body">
    `;

    if (missedItems.length === 0) {
        boardHtml += `<div class="empty-col-msg">&#x2714; No missed routines in past 3 days</div>`;
    } else {
        const missedGroups = {};
        missedItems.forEach(item => {
            if (!missedGroups[item.dateKey]) {
                const d = new Date(item.dateKey + 'T12:00:00');
                const fullDateStr = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
                missedGroups[item.dateKey] = {
                    dateKey: item.dateKey,
                    fullDateStr: fullDateStr,
                    dayName: item.dayName,
                    items: []
                };
            }
            missedGroups[item.dateKey].items.push(item);
        });

        const sortedMissedKeys = Object.keys(missedGroups).sort((a, b) => b.localeCompare(a));
        sortedMissedKeys.forEach(dKey => {
            const grp = missedGroups[dKey];
            boardHtml += `
            <div class="routine-day-divider">
                <span class="routine-day-divider-title">${grp.fullDateStr}</span>
                <span class="routine-day-divider-count">${grp.items.length}</span>
            </div>
            `;

            grp.items.forEach(item => {
                const r = item.routine;
                const linkedTask = state.tasks?.find(t => t.uid === r.linkedNiptoTask);
                const pts = r.points !== undefined && r.points !== null ? r.points : (linkedTask ? linkedTask.value : 0);
                const assigneesLabel = formatRoutineAssignees(r, true);

                boardHtml += `
                <div class="routine-board-row">
                    <button type="button" class="item-checkbox" onclick="completeRoutineForDate('${r.uid}', '${item.dateKey}', true)" title="Mark done for ${item.dayName} (awards points)" aria-label="Mark done for ${item.dayName}"></button>
                    <div class="routine-row-info">
                        <div class="routine-row-title-line">
                            <span class="missed-day-badge">${item.dayName}</span>
                            <span class="routine-row-name">${escapeHtml(r.name)}</span>
                        </div>
                        <div class="routine-row-meta">
                            ${assigneesLabel}
                            ${pts > 0 ? `<span class="pts-badge">+${pts} pts</span>` : ''}
                        </div>
                    </div>
                    <div class="routine-row-actions">
                        <button type="button" class="chore-btn" onclick="editRoutine('${r.uid}')" title="Edit Routine" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x270E;</button>
                        <button type="button" class="chore-btn delete-btn" onclick="deleteRoutine('${r.uid}')" title="Delete Routine" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x1F5D1;</button>
                        <button type="button" class="btn-dismiss-missed" onclick="completeRoutineForDate('${r.uid}', '${item.dateKey}', false)" title="Dismiss without points" aria-label="Dismiss">&times;</button>
                    </div>
                </div>
                `;
            });
        });
    }
    boardHtml += `</div></div>`;

    // ===== COLUMN 2: CURRENT (TODAY) =====
    const hideCompleted = !!state.hideCompletedRoutines;
    const visibleTodayItems = hideCompleted ? todayItems.filter(item => !item.isDone) : todayItems;

    boardHtml += `
    <div class="routine-board-col routine-col-today">
        <div class="routine-col-header">
            <div style="display: flex; align-items: center; gap: 6px;">
                <span class="routine-col-title">&#x1F4C5; Current (Today)</span>
                <span class="routine-count-badge highlight">${completedTodayCount}/${todayItems.length}</span>
            </div>
            <button type="button" class="filter-pill ${hideCompleted ? 'active' : ''}" onclick="toggleHideCompletedRoutines()" style="font-size: 11px; padding: 2px 8px;">
                ${hideCompleted ? 'Show All' : 'Hide Done'}
            </button>
        </div>
        <div class="routine-col-body">
    `;

    if (todayItems.length === 0) {
        boardHtml += `<div class="empty-col-msg">No routines scheduled for today</div>`;
    } else if (visibleTodayItems.length === 0 && hideCompleted) {
        boardHtml += `<div class="empty-col-msg">&#x2714; All ${todayItems.length} routines completed!</div>`;
    } else {
        visibleTodayItems.forEach(item => {
            const r = item.routine;
            const isDone = item.isDone;
            const comp = item.comp;
            const doneByName = isDone ? (comp?.completedByName || 'Someone') : '';
            const withoutPts = isDone && comp?.withoutPoints;

            const linkedTask = state.tasks?.find(t => t.uid === r.linkedNiptoTask);
            const pts = r.points !== undefined && r.points !== null ? r.points : (linkedTask ? linkedTask.value : 0);
            const assigneesLabel = formatRoutineAssignees(r, true);

            boardHtml += `
            <div class="routine-board-row ${isDone ? 'is-completed' : ''}">
                <button type="button" class="item-checkbox ${isDone ? 'checked' : ''}" onclick="${isDone ? `undoRoutineForDate('${r.uid}', '${todayKey}')` : `completeRoutineForDate('${r.uid}', '${todayKey}', true)`}" title="${isDone ? 'Completed - click to undo' : 'Mark done today (awards points)'}" aria-label="${isDone ? 'Undo completion' : 'Mark complete'}">
                    ${isDone ? '&#x2714;' : ''}
                </button>
                <div class="routine-row-info">
                    <div class="routine-row-title-line">
                        <span class="routine-row-name ${isDone ? 'completed-text' : ''}">${escapeHtml(r.name)}</span>
                    </div>
                    <div class="routine-row-meta">
                        ${assigneesLabel}
                        ${pts > 0 ? `<span class="pts-badge">+${pts} pts</span>` : ''}
                        ${isDone ? `<span class="completed-by-tag">&#x2714; ${escapeHtml(doneByName)}${withoutPts ? ' (No pts)' : ''}</span>` : ''}
                    </div>
                </div>
                <div class="routine-row-actions">
                    <button type="button" class="chore-btn" onclick="editRoutine('${r.uid}')" title="Edit Routine" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x270E;</button>
                    <button type="button" class="chore-btn delete-btn" onclick="deleteRoutine('${r.uid}')" title="Delete Routine" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x1F5D1;</button>
                </div>
            </div>
            `;
        });
    }
    boardHtml += `</div></div>`;

    // ===== COLUMN 3: UPCOMING (NEXT 3 DAYS) =====
    boardHtml += `
    <div class="routine-board-col routine-col-upcoming">
        <div class="routine-col-header">
            <div style="display: flex; align-items: center; gap: 6px;">
                <span class="routine-col-title">Upcoming (Next 3 Days)</span>
                <span class="routine-count-badge">${upcomingItems.length}</span>
            </div>
            <span style="font-size: 11px; color: var(--text-muted);">Non-daily only</span>
        </div>
        <div class="routine-col-body">
    `;

    if (upcomingItems.length === 0) {
        boardHtml += `<div class="empty-col-msg">No upcoming non-daily routines</div>`;
    } else {
        const upcomingGroups = {};
        upcomingItems.forEach(item => {
            if (!upcomingGroups[item.dateKey]) {
                const d = new Date(item.dateKey + 'T12:00:00');
                const fullDateStr = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
                upcomingGroups[item.dateKey] = {
                    dateKey: item.dateKey,
                    fullDateStr: fullDateStr,
                    dayName: item.dayName,
                    items: []
                };
            }
            upcomingGroups[item.dateKey].items.push(item);
        });

        const sortedUpcomingKeys = Object.keys(upcomingGroups).sort((a, b) => a.localeCompare(b));
        sortedUpcomingKeys.forEach(dKey => {
            const grp = upcomingGroups[dKey];
            boardHtml += `
            <div class="routine-day-divider">
                <span class="routine-day-divider-title">${grp.fullDateStr}</span>
                <span class="routine-day-divider-count">${grp.items.length}</span>
            </div>
            `;

            grp.items.forEach(item => {
                const r = item.routine;
                const linkedTask = state.tasks?.find(t => t.uid === r.linkedNiptoTask);
                const pts = r.points !== undefined && r.points !== null ? r.points : (linkedTask ? linkedTask.value : 0);
                const assigneesLabel = formatRoutineAssignees(r, true);

                boardHtml += `
                <div class="routine-board-row is-upcoming-row">
                    <span class="upcoming-day-badge">${item.dayName}</span>
                    <div class="routine-row-info">
                        <div class="routine-row-title-line">
                            <span class="routine-row-name">${escapeHtml(r.name)}</span>
                        </div>
                        <div class="routine-row-meta">
                            ${assigneesLabel}
                            ${pts > 0 ? `<span class="pts-badge">+${pts} pts</span>` : ''}
                        </div>
                    </div>
                    <div class="routine-row-actions">
                        <button type="button" class="chore-btn" onclick="editRoutine('${r.uid}')" title="Edit Routine" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x270E;</button>
                        <button type="button" class="chore-btn delete-btn" onclick="deleteRoutine('${r.uid}')" title="Delete Routine" style="font-size: 13px; opacity: 0.6; padding: 2px 4px;">&#x1F5D1;</button>
                    </div>
                </div>
                `;
            });
        });
    }
    boardHtml += `</div></div>`;
    boardHtml += `</div>`; // Close .routine-board-grid

    container.innerHTML = filterHtml + boardHtml;
}

// Clear all currently displayed missed non-daily routines without awarding points
export async function clearAllMissedRoutines() {
    const routines = state.routines || [];
    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const filter = state.scheduleFilter || 'me';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pastDays = [-1, -2, -3].map(offset => {
        const d = new Date(today);
        d.setDate(today.getDate() + offset);
        return {
            dateObj: d,
            dateKey: toLocalDateKey(d)
        };
    });

    const missedToClear = [];
    pastDays.forEach(day => {
        routines.forEach(r => {
            if (isDailyRoutine(r)) return;
            if (!routineMatchesFilter(r, filter, activeUid)) return;
            if (!routineAppliesToDate(r, day.dateObj)) return;

            const comp = r.completionsByDate ? r.completionsByDate[day.dateKey] : null;
            if (!comp) {
                missedToClear.push({ routineId: r.uid, dateKey: day.dateKey });
            }
        });
    });

    if (missedToClear.length === 0) return;
    if (!window.confirm(`Dismiss all ${missedToClear.length} missed item(s) without awarding points?`)) return;

    const creditedUid = activeUid || ALL_USERS[0].uid;
    const creditedName = ALL_USERS.find(u => u.uid === creditedUid)?.name || 'Admin';

    const updatesByRoutine = {};
    missedToClear.forEach(item => {
        const r = routines.find(rt => rt.uid === item.routineId);
        if (!r) return;
        if (!updatesByRoutine[item.routineId]) {
            updatesByRoutine[item.routineId] = {
                routine: r,
                completions: { ...(r.completionsByDate || {}) }
            };
        }
        updatesByRoutine[item.routineId].completions[item.dateKey] = {
            completedAt: new Date().toISOString(),
            completedByUid: creditedUid,
            completedByName: creditedName,
            withoutPoints: true
        };
    });

    try {
        const savePromises = Object.keys(updatesByRoutine).map(rId => {
            const data = updatesByRoutine[rId];
            data.routine.completionsByDate = data.completions;
            return api.updateFirestoreDocument('routines', rId, {
                completionsByDate: data.completions
            });
        });

        await Promise.all(savePromises);
        showToast("admin_clear", `Dismissed ${missedToClear.length} missed item(s) (no points).`, 0, creditedName);
        rebuildCompletedToday();
        renderDoneTodayFeed();
        renderRollingSchedule();
        updateLeaderboardUI();
    } catch (err) {
        console.error("Error clearing missed routines:", err);
        alert("Failed to clear missed routines: " + err.message);
    }
}

// Retroactive Check-off & Point Attribution (or admin dismiss when awardPoints = false)
export async function completeRoutineForDate(routineId, dateKey, awardPoints = true) {
    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine) return;

    let creditedUid = '';
    let creditedName = 'User';
    if (routine.assignees && routine.assignees.length === 1) {
        creditedUid = routine.assignees[0];
    } else {
        creditedUid = state.activeUsers[0] || ALL_USERS[0].uid;
    }
    const userObj = ALL_USERS.find(u => u.uid === creditedUid);
    if (userObj) creditedName = userObj.name;

    const nowIso = new Date().toISOString();
    const completions = routine.completionsByDate ? { ...routine.completionsByDate } : {};
    completions[dateKey] = {
        completedAt: nowIso,
        completedByUid: creditedUid,
        completedByName: creditedName,
        withoutPoints: !awardPoints
    };

    try {
        await api.updateFirestoreDocument('routines', routineId, {
            completionsByDate: completions
        });
        routine.completionsByDate = completions;

        const linkedTask = state.tasks?.find(t => t.uid === routine.linkedNiptoTask);
        const routinePts = routine.points !== undefined && routine.points !== null ? routine.points : (linkedTask ? linkedTask.value : 0);

        if (awardPoints) {
            if (routine.linkedNiptoTask && state.apiToken) {
                const backdatedDateIso = new Date(`${dateKey}T12:00:00`).toISOString();
                await api.logActivityToNipto(routine.linkedNiptoTask, backdatedDateIso, [creditedUid]);
                showToast(routine.linkedNiptoTask, routine.name, routinePts, creditedName);
            } else if (routinePts > 0) {
                api.awardAllowancePoints(creditedUid, routinePts);
                showToast("routine_done", routine.name, routinePts, creditedName);
            } else {
                showToast("routine_done", routine.name, 0, creditedName);
            }
        } else {
            showToast("admin_clear", `Dismissed "${routine.name}" on ${dateKey} (no points)`, 0, creditedName);
        }

        const compId = `routine_${routineId}_${dateKey}`;
        if (awardPoints) {
            await api.recordDailyCompletion({
                id: compId,
                itemId: routineId,
                sourceType: 'routine',
                title: routine.name,
                user: creditedName,
                userUid: creditedUid,
                points: routinePts,
                completedAt: nowIso,
                dateKey: dateKey
            });
        } else {
            await api.removeDailyCompletion(compId, dateKey);
        }

        rebuildCompletedToday();
        renderDoneTodayFeed();
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

        const compId = `routine_${routineId}_${dateKey}`;
        await api.removeDailyCompletion(compId, dateKey);

        rebuildCompletedToday();
        renderDoneTodayFeed();
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
    document.querySelectorAll('.routine-day-cb').forEach(cb => { cb.checked = false; });
    document.getElementById('routineIntervalValue').value = '1';
    document.getElementById('routineIntervalUnit').value = 'days';

    const catEl = document.getElementById('routineCategory');
    if (catEl) catEl.value = 'Home';

    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeName = ALL_USERS.find(u => u.uid === activeUid)?.name || 'Alyssa';
    const createdByEl = document.getElementById('routineCreatedBy');
    if (createdByEl) createdByEl.value = activeName;
    const timeOfDayEl = document.getElementById('routineTimeOfDay');
    if (timeOfDayEl) timeOfDayEl.value = 'Anytime';
    const pointsEl = document.getElementById('routinePoints');
    if (pointsEl) pointsEl.value = '15';
    const btnDel = document.getElementById('btnDeleteRoutine');
    if (btnDel) btnDel.style.display = 'none';

    populateRoutineAssignees([]);
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
    document.getElementById('routineType').value = routine.completionType || 'shared';

    const catEl = document.getElementById('routineCategory');
    if (catEl) catEl.value = routine.category || 'Home';

    const freq = isDailyRoutine(routine) ? 'daily' : (routine.schedule?.type || 'daily');
    document.getElementById('routineFrequency').value = freq;

    if (freq === 'daily') {
        document.getElementById('routineDailyReset').value = routine.schedule?.resetType || 'midnight';
        if (routine.schedule?.resetType === 'specific') {
            document.getElementById('routineSpecificTimes').value = (routine.schedule?.specificTimes || []).join(', ');
        }
        document.querySelectorAll('.routine-day-cb').forEach(cb => { cb.checked = false; });
    } else if (freq === 'weekly') {
        const days = (routine.schedule?.daysOfWeek || []).map(d => Number(d));
        document.querySelectorAll('.routine-day-cb').forEach(cb => {
            cb.checked = days.includes(parseInt(cb.value, 10));
        });
    } else if (freq === 'interval') {
        document.getElementById('routineIntervalValue').value = routine.schedule?.value || 1;
        document.getElementById('routineIntervalUnit').value = routine.schedule?.unit || 'days';
    }

    const timeOfDayEl = document.getElementById('routineTimeOfDay');
    if (timeOfDayEl) timeOfDayEl.value = routine.timeOfDay || routine.schedule?.timeOfDay || 'Anytime';

    const createdByEl = document.getElementById('routineCreatedBy');
    if (createdByEl) createdByEl.value = routine.createdBy || 'Alyssa';

    const linkedTask = state.tasks?.find(t => t.uid === routine.linkedNiptoTask);
    const pts = routine.points !== undefined && routine.points !== null ? routine.points : (linkedTask ? linkedTask.value : 0);
    const pointsEl = document.getElementById('routinePoints');
    if (pointsEl) pointsEl.value = pts;

    const btnDel = document.getElementById('btnDeleteRoutine');
    if (btnDel) btnDel.style.display = 'inline-block';

    populateRoutineAssignees(routine.assignees || []);
    toggleRoutineFrequencyFields();
    document.getElementById('routineModal').style.display = 'flex';
}

export async function deleteRoutineFromModal() {
    const id = document.getElementById('routineId').value;
    if (!id) return;
    closeRoutineModal();
    await deleteRoutine(id);
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

export async function saveRoutine() {
    const name = document.getElementById('routineName').value.trim();
    if (!name) { alert("Routine Name is required!"); return; }

    const assignees = Array.from(document.querySelectorAll('.routine-assignee-cb:checked')).map(cb => cb.value);
    if (assignees.length === 0) { alert("Assign the routine to at least one person!"); return; }

    let freq = document.getElementById('routineFrequency').value;
    const timeOfDayVal = document.getElementById('routineTimeOfDay')?.value || 'Anytime';
    const pointsVal = parseInt(document.getElementById('routinePoints')?.value, 10) || 0;
    const rawCat = document.getElementById('routineCategory')?.value.trim() || 'Home';
    const categoryVal = registerCustomCategory(rawCat) || 'Home';

    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const activeName = ALL_USERS.find(u => u.uid === activeUid)?.name || 'Alyssa';
    const createdByVal = document.getElementById('routineCreatedBy')?.value || activeName;

    let scheduleData = { type: freq, timeOfDay: timeOfDayVal };

    if (freq === 'daily') {
        const resetType = document.getElementById('routineDailyReset').value;
        scheduleData.resetType = resetType;
        if (resetType === 'specific') {
            const times = document.getElementById('routineSpecificTimes').value;
            scheduleData.specificTimes = times.split(',').map(t => t.trim()).filter(Boolean).sort();
        }
    } else if (freq === 'weekly') {
        const days = Array.from(document.querySelectorAll('.routine-day-cb:checked')).map(cb => parseInt(cb.value, 10));
        if (days.length === 0) { alert("Select at least one day of the week!"); return; }
        if (days.length === 7) {
            scheduleData.type = 'daily';
            scheduleData.resetType = 'midnight';
        } else {
            scheduleData.daysOfWeek = days;
        }
    } else if (freq === 'interval') {
        const val = parseInt(document.getElementById('routineIntervalValue').value, 10) || 1;
        const unit = document.getElementById('routineIntervalUnit').value || 'days';
        if (val === 1 && unit === 'days') {
            scheduleData.type = 'daily';
            scheduleData.resetType = 'midnight';
        } else {
            scheduleData.value = val;
            scheduleData.unit = unit;
        }
    }

    const id = document.getElementById('routineId').value;
    const routine = id ? state.routines.find(r => r.uid === id) : null;

    const routineData = {
        name: name,
        category: categoryVal,
        completionType: document.getElementById('routineType').value,
        assignees: assignees,
        schedule: scheduleData,
        timeOfDay: timeOfDayVal,
        points: pointsVal,
        createdBy: createdByVal,
        linkedNiptoTask: routine?.linkedNiptoTask || null
    };

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
        if (window.renderTodoTasks) window.renderTodoTasks();
        if (window.renderBulkTriageList) window.renderBulkTriageList();
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
        if (window.renderTodoTasks) window.renderTodoTasks();
        if (window.renderBulkTriageList) window.renderBulkTriageList();
    } catch (e) {
        alert("Error deleting routine: " + e.message);
    }
}

// Public aliases for backward compatibility
export function renderRoutines() {
    renderRollingSchedule();
}

export function renderSidebarRoutines() {
    renderRollingSchedule();
}

// Window bindings for inline HTML onclick handlers
if (typeof window !== 'undefined') {
    window.isDailyRoutine = isDailyRoutine;
    window.setScheduleFilter = setScheduleFilter;
    window.toggleHideCompletedRoutines = toggleHideCompletedRoutines;
    window.clearAllMissedRoutines = clearAllMissedRoutines;
    window.completeRoutineForDate = completeRoutineForDate;
    window.undoRoutineForDate = undoRoutineForDate;
    window.openRoutineModal = openRoutineModal;
    window.closeRoutineModal = closeRoutineModal;
    window.editRoutine = editRoutine;
    window.saveRoutine = saveRoutine;
    window.deleteRoutineFromModal = deleteRoutineFromModal;
    window.deleteRoutine = deleteRoutine;
    window.toggleRoutineFrequencyFields = toggleRoutineFrequencyFields;
    window.renderRollingSchedule = renderRollingSchedule;
    window.renderRoutines = renderRoutines;
}
