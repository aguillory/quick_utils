// leaderboard.js
// Weekly leaderboard, crown indicator, and task history display with prior week browsing.
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { saveCloudPreference } from './preferences.js';
import { syncRoutinesWithNiptoHistory } from './routines.js';

// Formats a date range into a compact human-friendly string (e.g. "Oct 12 - Oct 19")
function formatWeekDateRange(startStr, endStr) {
    if (!startStr) return "";
    const s = new Date(startStr);
    const e = endStr ? new Date(endStr) : new Date(s.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sMonth = s.toLocaleDateString(undefined, { month: 'short' });
    const sDay = s.getDate();
    const eMonth = e.toLocaleDateString(undefined, { month: 'short' });
    const eDay = e.getDate();
    if (sMonth === eMonth) {
        return `${sMonth} ${sDay} - ${eDay}`;
    }
    return `${sMonth} ${sDay} - ${eMonth} ${eDay}`;
}

// Determines the date range for the current week based on the last ended week or Monday calculation
function getCurrentWeekDateRange() {
    if (state.weeksList && state.weeksList.length > 0) {
        const lastEnded = state.weeksList[0];
        const s = new Date(lastEnded.endDate);
        const e = new Date(s.getTime() + 7 * 24 * 60 * 60 * 1000);
        return formatWeekDateRange(s, e);
    }
    const now = new Date();
    const day = now.getDay();
    const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(now.getFullYear(), now.getMonth(), diffToMon);
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7);
    return formatWeekDateRange(mon, sun);
}

// Populates the week selector dropdown in the left sidebar
export async function populateWeekSelector() {
    const select = document.getElementById('weekSelect');
    if (!select) return;

    if (!state.weeksList || state.weeksList.length === 0) {
        await api.getWeeksList();
    }

    const currentRange = getCurrentWeekDateRange();
    let html = `<option value="current">This Week (${currentRange})</option>`;

    if (state.weeksList && state.weeksList.length > 0) {
        state.weeksList.forEach((w, index) => {
            const range = formatWeekDateRange(w.startDate, w.endDate);
            let label;
            if (index === 0) {
                label = `Last Week (${range})`;
            } else {
                const weekNum = w.uid ? w.uid.slice(-2).replace(/^0+/, '') : '';
                label = weekNum ? `Week ${weekNum} (${range})` : range;
            }
            html += `<option value="${w.uid}">${label}</option>`;
        });
    }

    select.innerHTML = html;
    select.value = state.selectedWeekUid || 'current';
    updateWeekNavButtons();
}

// Updates the enabled/disabled state of the prev/next week buttons
function updateWeekNavButtons() {
    const select = document.getElementById('weekSelect');
    const prevBtn = document.getElementById('btnPrevWeek');
    const nextBtn = document.getElementById('btnNextWeek');
    if (!select || !prevBtn || !nextBtn) return;

    const idx = select.selectedIndex;
    nextBtn.disabled = (idx <= 0);
    prevBtn.disabled = (idx >= select.options.length - 1);
}

// Navigates week backwards (delta = -1) or forwards (delta = 1)
export function navigateWeek(delta) {
    const select = document.getElementById('weekSelect');
    if (!select) return;
    const targetIdx = select.selectedIndex - delta;
    if (targetIdx >= 0 && targetIdx < select.options.length) {
        select.selectedIndex = targetIdx;
        changeSelectedWeek(select.value);
    }
}

// Resets selection back to the current active week
export function resetToCurrentWeek() {
    const select = document.getElementById('weekSelect');
    if (select) select.value = 'current';
    changeSelectedWeek('current');
}

// Draws user points, top crown, and medals for the given points map
export function drawLeaderboard(points, isPriorWeek = false, weekTitle = '') {
    ALL_USERS.forEach(user => {
        const el = document.getElementById(`points-${user.uid}`);
        if (el) {
            const userPts = points[user.uid] || 0;
            el.innerText = userPts + " pts";
        }
    });

    document.querySelectorAll('.leader-crown').forEach(el => el.remove());

    let topUser = null;
    let maxPts = 0;
    ALL_USERS.forEach(user => {
        let userPts = points[user.uid] || 0;
        if (userPts > maxPts) { maxPts = userPts; topUser = user.uid; }
    });

    if (topUser && maxPts > 0) {
        const topUserElement = document.getElementById(`toggle-${topUser}`);
        if (topUserElement) topUserElement.innerHTML += '<div class="leader-crown">👑</div>';
    }

    let sortedUsers = ALL_USERS.map(u => ({ name: u.name, pts: points[u.uid] || 0, color: u.color })).sort((a, b) => b.pts - a.pts);
    let leaderboardHtml = sortedUsers.map((u, index) => {
        let medal = index === 0 ? '🥇 1.' : index === 1 ? '🥈 2. ' : index === 2 ? '🥉 3.' : `${index + 1}.`;
        return `<div><span style="color: var(--text-muted); margin-right: 3px;">${medal}</span> <span style="color: ${u.color}; font-weight: 800;">${u.name}: ${u.pts} pts</span></div>`;
    }).join('<div style="width: 1px; background: var(--border-color); margin: 0 10px;"></div>');

    if (isPriorWeek && weekTitle) {
        leaderboardHtml = `<div style="font-size:11px; color:var(--primary); font-weight:bold; margin-right:8px; display:flex; align-items:center;">📅 ${weekTitle}:</div>` + leaderboardHtml;
    }

    const adultContainer = document.getElementById('leaderboard-container');
    if (adultContainer) adultContainer.innerHTML = leaderboardHtml;
}

// Switches week view between current and any historical week
export async function changeSelectedWeek(weekUid) {
    state.selectedWeekUid = weekUid;
    const select = document.getElementById('weekSelect');
    if (select && select.value !== weekUid) select.value = weekUid;
    updateWeekNavButtons();

    const titleEl = document.getElementById('activityPanelTitle');
    const badgeEl = document.getElementById('weekArchiveBadge');
    const badgeText = document.getElementById('weekArchiveText');

    if (weekUid === 'current') {
        if (titleEl) titleEl.innerText = "This Week's Activity";
        if (badgeEl) badgeEl.classList.remove('visible');

        if (state.currentWeekScores) {
            drawLeaderboard(state.currentWeekScores, false);
        }
        updateHistoryDisplay();
    } else {
        const weekObj = state.weeksList ? state.weeksList.find(w => w.uid === weekUid) : null;
        const weekNum = weekUid.slice(-2).replace(/^0+/, '');
        const dateRange = weekObj ? formatWeekDateRange(weekObj.startDate, weekObj.endDate) : '';
        const weekLabel = `Week ${weekNum} (${dateRange})`;

        if (titleEl) titleEl.innerText = `Week ${weekNum} Activity`;
        if (badgeEl) {
            badgeEl.classList.add('visible');
            if (badgeText) badgeText.innerText = `📅 Archive: ${weekLabel}`;
        }

        if (weekObj && weekObj.scores) {
            const priorPoints = {};
            ALL_USERS.forEach(u => priorPoints[u.uid] = 0);
            weekObj.scores.forEach(s => {
                if (s.user && s.user.uid) priorPoints[s.user.uid] = s.score;
                else if (s.user && s.user.name) {
                    const u = ALL_USERS.find(user => user.name.toLowerCase() === s.user.name.toLowerCase() || s.user.name.toLowerCase().startsWith(user.name.toLowerCase()));
                    if (u) priorPoints[u.uid] = s.score;
                }
            });
            drawLeaderboard(priorPoints, true, `Week ${weekNum}`);
        }

        await updateHistoryDisplay();
    }
}

// Fetches weekly points, draws leaderboard/crown, and refreshes history.
export async function updateLeaderboardUI() {
    try {
        const { points } = await api.getWeeklyPointsData();
        state.currentWeekScores = { ...points };

        await populateWeekSelector();

        if (!state.selectedWeekUid || state.selectedWeekUid === 'current') {
            drawLeaderboard(points, false);
            updateHistoryDisplay();
        } else {
            changeSelectedWeek(state.selectedWeekUid);
        }

        syncRoutinesWithNiptoHistory();
    } catch (error) {
        if (error.message === "Token Expired") document.getElementById('pinModal').style.display = 'flex';
        console.error("Error drawing points:", error);
        document.getElementById('historyContainer').innerHTML = "<div class='empty-history'>Error loading history.</div>";
    }
}

// Filters activities by the current history view and renders them.
export async function updateHistoryDisplay() {
    const isPriorWeek = state.selectedWeekUid && state.selectedWeekUid !== 'current';

    if (!isPriorWeek) {
        let filteredActivities = state.allWeekActivities || [];
        if (state.historyViewMode === 'boys') {
            filteredActivities = filteredActivities.filter(act => {
                const uName = (act.user && act.user.name) ? act.user.name.toLowerCase() : "";
                return uName.includes("ayden") || uName.includes("dj");
            });
        }
        renderHistory(filteredActivities, false);
    } else {
        const container = document.getElementById('historyContainer');
        if (container) container.innerHTML = '<div class="empty-history">Loading week activities...</div>';

        const weekObj = state.weeksList ? state.weeksList.find(w => w.uid === state.selectedWeekUid) : null;
        const activities = await api.loadHistoricalActivitiesForWeek(
            state.selectedWeekUid,
            weekObj ? weekObj.startDate : null,
            weekObj ? weekObj.endDate : null
        );

        let filtered = activities;
        if (state.historyViewMode === 'boys') {
            filtered = activities.filter(act => {
                const uName = (act.user && act.user.name) ? act.user.name.toLowerCase() : "";
                return uName.includes("ayden") || uName.includes("dj");
            });
        }
        renderHistory(filtered, true);
    }
}

// Renders the activity history list.
function renderHistory(activities, isPriorWeek = false) {
    const container = document.getElementById('historyContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!activities || activities.length === 0) {
        container.innerHTML = `<div class="empty-history">${isPriorWeek ? 'No recorded tasks found for this week.' : 'No tasks found.'}</div>`;
        return;
    }
    const labels = state.activityLabels || {};

    activities.sort((a, b) => b.parsedDate - a.parsedDate);
    const timeOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit' };

    activities.forEach(act => {
        let knownUser = null;
        if (act.user && act.user.uid) {
            knownUser = ALL_USERS.find(u => u.uid === act.user.uid);
        }
        if (!knownUser && act.user && act.user.name) {
            const uName = act.user.name.toLowerCase();
            knownUser = ALL_USERS.find(u => u.name.toLowerCase() === uName || uName.startsWith(u.name.toLowerCase()));
        }

        let userName = knownUser ? knownUser.name : (act.user && act.user.name ? act.user.name : "Family");
        let color = knownUser ? knownUser.color : 'var(--text-muted)';

        // Special friendly display for shared boy tasks or family tasks
        if (!knownUser && act.user && act.user.name) {
            const rawName = act.user.name;
            if (rawName.includes("Ayden") && rawName.includes("DJ")) {
                userName = "Ayden & DJ";
                color = "var(--user-ayden)";
            } else if (rawName.toLowerCase() === "family") {
                userName = "Family";
                color = "var(--primary, #03dac6)";
            }
        }

        const customLabel = (act.uid && labels[act.uid]) ? labels[act.uid] : (act.label || null);
        let taskName = act.task && act.task.name ? act.task.name : (act.taskName || "Activity");

        if (customLabel) {
            const sub = (act.task && act.task.name && act.task.name !== customLabel) ? `(${act.task.name})` : '';
            taskName = `${customLabel} ${sub ? `<span style="font-size:10px; color:var(--text-muted);">${sub}</span>` : ''}`;
        }

        const taskValue = act.awardedPts !== undefined ? act.awardedPts : (act.task ? act.task.value : (act.taskValue || 0));

        const itemDiv = document.createElement('div');
        itemDiv.className = 'history-item';

        const deleteBtnHtml = isPriorWeek 
            ? '' 
            : `<button class="delete-activity-btn" onclick="deleteTaskActivity('${act.uid}', this)" title="Delete Activity">🗑️</button>`;

        itemDiv.innerHTML = `
        <div class="history-item-content">
            <div class="history-task-name">${taskName}</div>
            <div class="history-details">
                <span style="color: ${color}; font-weight: bold;">${userName} (+${taskValue})</span>
                <span>${act.parsedDate.toLocaleDateString(undefined, timeOptions)}</span>
            </div>
        </div>
        ${deleteBtnHtml}
        `;
        container.appendChild(itemDiv);
    });
}

// Sets the history view mode (everyone / boys) and saves the preference.
export async function setHistoryView(mode, skipSave = false) {
    state.historyViewMode = mode;
    const btnBoys = document.getElementById('htBoys');
    const btnEveryone = document.getElementById('htEveryone');
    if (btnBoys) btnBoys.classList.toggle('active', mode === 'boys');
    if (btnEveryone) btnEveryone.classList.toggle('active', mode === 'everyone');

    await updateHistoryDisplay();
    if (!skipSave) saveCloudPreference('historyView', mode);
}
