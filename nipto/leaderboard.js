// leaderboard.js
// Weekly leaderboard, crown indicator, and task history display.
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { saveCloudPreference } from './preferences.js';
import { syncRoutinesWithNiptoHistory } from './routines.js';

// Fetches weekly points, draws leaderboard/crown, and refreshes history.
export async function updateLeaderboardUI() {
    try {
        const { points } = await api.getWeeklyPointsData();

        ALL_USERS.forEach(user => {
            const el = document.getElementById(`points-${user.uid}`);
            if (el) el.innerText = points[user.uid] + " pts";
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

        let sortedUsers = ALL_USERS.map(u => ({ name: u.name, pts: points[u.uid], color: u.color })).sort((a, b) => b.pts - a.pts);
        let leaderboardHtml = sortedUsers.map((u, index) => {
            let medal = index === 0 ? '🥇 1.' : index === 1 ? '🥈 2. ' : index === 2 ? '🥉 3.' : `${index + 1}.`;
            return `<div><span style="color: var(--text-muted); margin-right: 3px;">${medal}</span> <span style="color: ${u.color}; font-weight: 800;">${u.name}: ${u.pts} pts</span></div>`;
        }).join('<div style="width: 1px; background: var(--border-color); margin: 0 10px;"></div>');

        const adultContainer = document.getElementById('leaderboard-container');
        if (adultContainer) adultContainer.innerHTML = leaderboardHtml;

        updateHistoryDisplay();
        syncRoutinesWithNiptoHistory();
    } catch (error) {
        if (error.message === "Token Expired") document.getElementById('pinModal').style.display = 'flex';
        console.error("Error drawing points:", error);
        document.getElementById('historyContainer').innerHTML = "<div class='empty-history'>Error loading history.</div>";
    }
}

// Filters activities by the current history view and renders them.
export function updateHistoryDisplay() {
    let filteredActivities = state.allWeekActivities;
    if (state.historyViewMode === 'boys') {
        filteredActivities = state.allWeekActivities.filter(act =>
            act.user && (act.user.uid === "NMRQaRQbvCwBaJbiMFId" || act.user.uid === "RMNUTP8VOHD9PDzNjf0g")
        );
    }
    renderHistory(filteredActivities);
}

// Renders the activity history list.
function renderHistory(activities) {
    const container = document.getElementById('historyContainer');
    container.innerHTML = '';
    if (activities.length === 0) {
        container.innerHTML = '<div class="empty-history">No tasks found.</div>'; return;
    }
    const labels = state.activityLabels || {};

    activities.sort((a, b) => b.parsedDate - a.parsedDate);
    const timeOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit' };

    activities.forEach(act => {
        const knownUser = ALL_USERS.find(u => u.uid === (act.user && act.user.uid));
        const userName = knownUser ? knownUser.name : (act.user && act.user.name ? act.user.name : "Unknown User");
        let taskName = act.task ? act.task.name : "Deleted Task";
if (labels[act.uid] && /^assigned task/i.test(taskName)) {
    taskName = `${labels[act.uid]} <span style="font-size:10px; color:var(--text-muted);">(${act.task.name})</span>`;
}
        const taskValue = act.awardedPts !== undefined ? act.awardedPts : (act.task ? act.task.value : 0);
        const color = knownUser ? knownUser.color : 'var(--text-muted)';

        const itemDiv = document.createElement('div');
        itemDiv.className = 'history-item';
        itemDiv.innerHTML = `
        <div class="history-item-content">
        <div class="history-task-name">${taskName}</div>
        <div class="history-details">
        <span style="color: ${color}; font-weight: bold;">${userName} (+${taskValue})</span>
        <span>${act.parsedDate.toLocaleDateString(undefined, timeOptions)}</span>
        </div>
        </div>
        <button class="delete-activity-btn" onclick="deleteTaskActivity('${act.uid}', this)" title="Delete Activity">🗑️</button>
        `;
        container.appendChild(itemDiv);
    });
}

// Sets the history view mode (everyone / boys) and saves the preference.
export function setHistoryView(mode, skipSave = false) {
    state.historyViewMode = mode;
    const btnBoys = document.getElementById('htBoys');
    const btnEveryone = document.getElementById('htEveryone');
    if (btnBoys) btnBoys.classList.toggle('active', mode === 'boys');
    if (btnEveryone) btnEveryone.classList.toggle('active', mode === 'everyone');

    updateHistoryDisplay();
    if (!skipSave) saveCloudPreference('historyView', mode);
}