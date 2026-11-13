// users.js
// Active user management, compact navbar pill, and user dropdown menu.

import { state, ALL_USERS, saveUserState } from './state.js';
import { loadCloudPreferences } from './preferences.js';
import { applyTheme } from './theme.js';
import { renderTasks } from './niptoTasks.js';
import { renderTodoTasks } from './todos.js';
import { renderRollingSchedule } from './routines.js';
import { renderDoneTodayFeed } from './leaderboard.js';
import { refreshChatUser } from './chat.js';

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export async function initUsers() {
    renderUserDropdownMenu();
    const stored = localStorage.getItem("nipto_merged_users");
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed.isTogetherMode) {
                setTogetherState(parsed.users);
            } else if (parsed.users && parsed.users.length === 1) {
                await setActiveUser(parsed.users[0], true);
            } else {
                await setActiveUser(ALL_USERS[0]?.uid || '', true);
            }
        } catch (e) {
            await setActiveUser(ALL_USERS[0]?.uid || '', true);
        }
    } else {
        await setActiveUser(ALL_USERS[0]?.uid || '', true);
    }
}

export function renderUserDropdownMenu() {
    const menu = document.getElementById('userDropdownMenu');
    if (!menu) return;

    let html = `<div style="padding: 6px; display: flex; flex-direction: column; gap: 4px;">`;

    ALL_USERS.forEach(u => {
        const pts = state.currentWeekScores?.[u.uid] || 0;
        const isCurrent = !state.isTogetherMode && state.activeUsers[0] === u.uid;
        html += `
        <div class="user-dropdown-item ${isCurrent ? 'active' : ''}" onclick="selectUserFromDropdown('${u.uid}')" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 6px; cursor: pointer; transition: background 0.15s; ${isCurrent ? 'background: rgba(37, 99, 235, 0.1); font-weight: bold;' : ''}">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; border-radius: 50%; background: ${u.color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800;">
                    ${u.name.charAt(0)}
                </div>
                <span style="font-size: 14px; color: var(--text-main);">${escapeHtml(u.name)}</span>
            </div>
            <span style="font-size: 12px; color: var(--text-muted); font-weight: 700;">${pts} pts</span>
        </div>
        `;
    });

    html += `
        <div style="height: 1px; background: var(--border-color); margin: 4px 0;"></div>
        <div class="user-dropdown-item ${state.isTogetherMode ? 'active' : ''}" onclick="toggleTogetherMode()" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 6px; cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">&#x1F91D;</span>
                <span style="font-size: 14px; color: var(--text-main); font-weight: 600;">Together Mode</span>
            </div>
            <span style="font-size: 11px; color: var(--text-muted);">(Split Points)</span>
        </div>
    </div>
    `;

    menu.innerHTML = html;
}

export function toggleUserDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('userDropdownMenu');
    if (!menu) return;
    const isVisible = menu.style.display === 'block';
    menu.style.display = isVisible ? 'none' : 'block';
}

// Global click outside to close dropdown
document.addEventListener('click', (e) => {
    const menu = document.getElementById('userDropdownMenu');
    const pill = document.getElementById('activeUserPill');
    if (menu && menu.style.display === 'block') {
        if (!menu.contains(e.target) && !pill?.contains(e.target)) {
            menu.style.display = 'none';
        }
    }
});

export async function selectUserFromDropdown(uid) {
    const menu = document.getElementById('userDropdownMenu');
    if (menu) menu.style.display = 'none';
    await setActiveUser(uid);
}

export async function setActiveUser(uid, skipSave = false) {
    state.isTogetherMode = false;
    state.activeUsers = [uid];
    state.currentSplitDivisor = 1;

    renderActiveUserPill();
    renderUserDropdownMenu();

    await loadCloudPreferences(uid);
    applyTheme(state.userPrefs.theme || 'boring');

    if (!skipSave) saveUserState();

    renderTasks();
    renderTodoTasks();
    renderRollingSchedule();
    renderDoneTodayFeed();
    refreshChatUser();
}

export function renderActiveUserPill() {
    const pill = document.getElementById('activeUserPill');
    if (!pill) return;

    if (state.isTogetherMode) {
        pill.innerHTML = `
            <div style="width: 24px; height: 24px; border-radius: 50%; background: var(--text-muted); color: white; display: flex; align-items: center; justify-content: center; font-size: 12px;">
                &#x1F91D;
            </div>
            <span style="font-size: 13px; font-weight: 700; color: var(--text-main);">Together</span>
            <span style="font-size: 10px; color: var(--text-muted);">&#x25BC;</span>
        `;
        return;
    }

    const currentUid = state.activeUsers[0];
    const user = ALL_USERS.find(u => u.uid === currentUid) || ALL_USERS[0];
    if (!user) return;

    const userPts = state.currentWeekScores?.[user.uid] || 0;

    pill.innerHTML = `
        <div style="width: 24px; height: 24px; border-radius: 50%; background: ${user.color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800;">
            ${user.name.charAt(0)}
        </div>
        <span style="font-size: 13px; font-weight: 700; color: var(--text-main);">${escapeHtml(user.name)}</span>
        <span class="pts-badge" style="font-size: 11px;">${userPts} pts</span>
        <span style="font-size: 10px; color: var(--text-muted);">&#x25BC;</span>
    `;
}

export function toggleTogetherMode() {
    const menu = document.getElementById('userDropdownMenu');
    if (menu) menu.style.display = 'none';

    state.isTogetherMode = true;
    if (state.activeUsers.length <= 1) {
        state.activeUsers = ALL_USERS.slice(0, 2).map(u => u.uid);
    }
    state.currentSplitDivisor = Math.max(1, state.activeUsers.length);

    renderActiveUserPill();
    renderUserDropdownMenu();
    saveUserState();

    renderTasks();
    renderTodoTasks();
    renderRollingSchedule();
    renderDoneTodayFeed();
    refreshChatUser();
}

function setTogetherState(uids) {
    state.activeUsers = uids;
    state.isTogetherMode = true;
    state.currentSplitDivisor = Math.max(1, uids.length);
    renderActiveUserPill();
}

// Bind to window for HTML onclicks
window.setActiveUser = setActiveUser;
window.toggleUserDropdown = toggleUserDropdown;
window.selectUserFromDropdown = selectUserFromDropdown;
window.toggleTogetherMode = toggleTogetherMode;
window.renderActiveUserPill = renderActiveUserPill;
window.renderUserDropdownMenu = renderUserDropdownMenu;
