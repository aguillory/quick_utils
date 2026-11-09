// leaderboard.js
// Weekly leaderboard, Boys' Allowance Bank (Ayden & DJ: 1 pt = $0.01),
// and Done Today live activity feed.

import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const AYDEN_UID = "NMRQaRQbvCwBaJbiMFId";
const DJ_UID = "RMNUTP8VOHD9PDzNjf0g";

// ==========================================
// WEEKLY LEADERBOARD & ALLOWANCE BANK
// ==========================================
export function drawLeaderboard(points, isPriorWeek = false, weekTitle = '') {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    let sortedUsers = ALL_USERS.map(u => ({
        uid: u.uid,
        name: u.name,
        pts: points[u.uid] || 0,
        color: u.color
    })).sort((a, b) => b.pts - a.pts);

    let html = `<div class="leaderboard-ranking-list" style="display: flex; flex-direction: column; gap: 8px;">`;

    sortedUsers.forEach((u, index) => {
        let rankBadge = `${index + 1}.`;
        if (index === 0) rankBadge = '&#x1F947; 1.';
        else if (index === 1) rankBadge = '&#x1F948; 2.';
        else if (index === 2) rankBadge = '&#x1F949; 3.';

        html += `
        <div class="leaderboard-rank-row" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-radius: 8px; background: var(--bg-color); border: 1px solid var(--border-color);">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 13px; font-weight: 800; color: var(--text-muted); width: 24px;">${rankBadge}</span>
                <span style="color: ${u.color}; font-weight: 800; font-size: 14px;">${escapeHtml(u.name)}</span>
            </div>
            <span style="font-size: 14px; font-weight: 800; color: var(--text-main);">${u.pts} pts</span>
        </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;

    renderAllowanceUI();
    renderDoneTodayFeed();
}

// Renders the Boys' Allowance Bank (Ayden & DJ only)
export function renderAllowanceUI() {
    const container = document.getElementById('allowanceCardsContainer');
    if (!container) return;

    const ledger = state.allowanceLedger || { ayden: { unpaidPoints: 0, payoutHistory: [] }, dj: { unpaidPoints: 0, payoutHistory: [] } };
    const aydenUnpaid = ledger.ayden?.unpaidPoints || 0;
    const djUnpaid = ledger.dj?.unpaidPoints || 0;
    const aydenDollars = (aydenUnpaid * 0.01).toFixed(2);
    const djDollars = (djUnpaid * 0.01).toFixed(2);

    let html = `
    <div class="allowance-bank-box" style="margin-top: 15px; padding: 12px; border-radius: 10px; background: rgba(37, 99, 235, 0.04); border: 1px solid rgba(37, 99, 235, 0.2);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h4 style="margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--primary);">
                &#x1F4B0; Boys' Allowance Bank (1 pt = $0.01)
            </h4>
            <button class="action-btn" onclick="togglePayoutHistory()" style="padding: 2px 8px; font-size: 11px;">
                History &#x25BC;
            </button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px;">
            <!-- Ayden Card -->
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                <div>
                    <span style="font-weight: 800; font-size: 13px; color: var(--user-ayden);">Ayden</span>
                    <div style="font-size: 12px; font-weight: 700; color: var(--text-main); margin-top: 2px;">
                        Owed: <span style="color: var(--success); font-weight: 800;">$${aydenDollars}</span> (${aydenUnpaid} pts)
                    </div>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button class="action-btn save-mode" onclick="payoutBoy('ayden')" style="padding: 4px 8px; font-size: 11px; background: var(--success);" title="Mark Ayden Paid Up">
                        &#x2714; Paid Up
                    </button>
                    <button class="action-btn" onclick="openAllowanceAdjustModal('ayden')" style="padding: 4px 8px; font-size: 11px;" title="Adjust points">
                        +/-
                    </button>
                </div>
            </div>

            <!-- DJ Card -->
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                <div>
                    <span style="font-weight: 800; font-size: 13px; color: var(--user-dj);">DJ</span>
                    <div style="font-size: 12px; font-weight: 700; color: var(--text-main); margin-top: 2px;">
                        Owed: <span style="color: var(--success); font-weight: 800;">$${djDollars}</span> (${djUnpaid} pts)
                    </div>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button class="action-btn save-mode" onclick="payoutBoy('dj')" style="padding: 4px 8px; font-size: 11px; background: var(--success);" title="Mark DJ Paid Up">
                        &#x2714; Paid Up
                    </button>
                    <button class="action-btn" onclick="openAllowanceAdjustModal('dj')" style="padding: 4px 8px; font-size: 11px;" title="Adjust points">
                        +/-
                    </button>
                </div>
            </div>
        </div>

        <!-- Collapsible Payout History -->
        <div id="allowancePayoutHistory" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-color); max-height: 200px; overflow-y: auto;">
            <div style="font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Payout & Adjustment History</div>
            ${renderPayoutHistoryRows(ledger)}
        </div>
    </div>
    `;

    container.innerHTML = html;
}

function renderPayoutHistoryRows(ledger) {
    const combined = [];
    (ledger.ayden?.payoutHistory || []).forEach(p => combined.push({ boy: 'Ayden', ...p }));
    (ledger.dj?.payoutHistory || []).forEach(p => combined.push({ boy: 'DJ', ...p }));

    combined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (combined.length === 0) {
        return '<div style="font-size: 11px; color: var(--text-muted); font-style: italic;">No payouts recorded yet.</div>';
    }

    return combined.slice(0, 10).map(item => {
        const d = new Date(item.timestamp);
        const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        if (item.amount !== undefined) {
            return `
            <div style="font-size: 11px; display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid rgba(0,0,0,0.03);">
                <span><strong>${item.boy}</strong> paid <strong>$${item.amount.toFixed(2)}</strong> (${item.points} pts)</span>
                <span style="color: var(--text-muted);">${dateStr}</span>
            </div>
            `;
        } else {
            return `
            <div style="font-size: 11px; display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid rgba(0,0,0,0.03);">
                <span><strong>${item.boy}</strong> adjust: ${item.deltaPoints > 0 ? '+' : ''}${item.deltaPoints} pts (${item.note || 'Manual'})</span>
                <span style="color: var(--text-muted);">${dateStr}</span>
            </div>
            `;
        }
    }).join('');
}

export function togglePayoutHistory() {
    const el = document.getElementById('allowancePayoutHistory');
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

export async function payoutBoy(boyKey) {
    const boyName = boyKey === 'ayden' ? 'Ayden' : 'DJ';
    const ledger = state.allowanceLedger || {};
    const boy = ledger[boyKey];
    if (!boy || boy.unpaidPoints <= 0) {
        alert(`${boyName} does not have any unpaid points to pay out.`);
        return;
    }

    const dollars = (boy.unpaidPoints * 0.01).toFixed(2);
    if (!confirm(`Mark ${boyName} as paid up for $${dollars} (${boy.unpaidPoints} pts)?`)) return;

    const currentUserName = ALL_USERS.find(u => u.uid === state.activeUsers[0])?.name || 'Admin';
    await api.payoutAllowance(boyKey, currentUserName);
    showToast("payout", `${boyName} paid up: $${dollars}!`, 0, currentUserName);
}

export function openAllowanceAdjustModal(boyKey) {
    const modal = document.getElementById('allowanceAdjustModal');
    if (!modal) return;
    document.getElementById('allowanceAdjustBoyKey').value = boyKey;
    document.getElementById('allowanceAdjustBoyName').textContent = boyKey === 'ayden' ? 'Ayden' : 'DJ';
    document.getElementById('allowanceAdjustDelta').value = '';
    document.getElementById('allowanceAdjustNote').value = '';
    modal.style.display = 'flex';
}

export function closeAllowanceAdjustModal() {
    const modal = document.getElementById('allowanceAdjustModal');
    if (modal) modal.style.display = 'none';
}

export async function submitAllowanceAdjust() {
    const boyKey = document.getElementById('allowanceAdjustBoyKey').value;
    const delta = parseInt(document.getElementById('allowanceAdjustDelta').value, 10);
    const note = document.getElementById('allowanceAdjustNote').value.trim();

    if (isNaN(delta) || delta === 0) {
        alert("Please enter a valid non-zero point adjustment (e.g. +50 or -20).");
        return;
    }

    const currentUserName = ALL_USERS.find(u => u.uid === state.activeUsers[0])?.name || 'Admin';
    await api.adjustAllowancePoints(boyKey, delta, note, currentUserName);
    closeAllowanceAdjustModal();
    showToast("adjust", `Adjusted ${boyKey === 'ayden' ? 'Ayden' : 'DJ'} by ${delta > 0 ? '+' : ''}${delta} pts`, 0, currentUserName);
}

// ==========================================
// RECENTLY COMPLETED / DONE TODAY FEED
// ==========================================
let doneTodayView = 'everyone'; // 'everyone' | 'me'

export function setDoneTodayView(mode) {
    doneTodayView = mode;
    const btnEv = document.getElementById('btnDoneEveryone');
    const btnMe = document.getElementById('btnDoneMe');
    if (btnEv && btnMe) {
        if (mode === 'everyone') {
            btnEv.classList.add('active');
            btnMe.classList.remove('active');
        } else {
            btnMe.classList.add('active');
            btnEv.classList.remove('active');
        }
    }
    renderDoneTodayFeed();
}

// Merges & deduplicates completed items from all 4 live sources for today
export function rebuildCompletedToday() {
    const todayKey = api.getLocalTodayKey();
    const compMap = new Map();

    // 1. Persisted daily completions from Firestore daily doc
    (state.persistedDailyCompletions || []).forEach(it => {
        if (it && it.id) {
            compMap.set(it.id, { ...it });
        }
    });

    // 2. Routines completed today (excluding dismissed/withoutPoints)
    (state.routines || []).forEach(r => {
        if (r.completionsByDate && r.completionsByDate[todayKey]) {
            const comp = r.completionsByDate[todayKey];
            if (!comp.withoutPoints) {
                const compId = `routine_${r.uid}_${todayKey}`;
                const linkedTask = (state.tasks || []).find(t => t.uid === r.linkedNiptoTask);
                const routinePts = r.points !== undefined && r.points !== null ? r.points : (linkedTask ? linkedTask.value : 0);
                const doerUid = comp.completedByUid || (r.assignees && r.assignees.length === 1 ? r.assignees[0] : '');
                const userObj = ALL_USERS.find(u => u.uid === doerUid);
                const userName = comp.completedByName || userObj?.name || 'User';

                if (!compMap.has(compId)) {
                    compMap.set(compId, {
                        id: compId,
                        itemId: r.uid,
                        sourceType: 'routine',
                        title: r.name,
                        user: userName,
                        userUid: doerUid,
                        points: routinePts,
                        completedAt: comp.completedAt || new Date().toISOString(),
                        dateKey: todayKey
                    });
                }
            }
        }
    });

    // 3. To-Dos and Subtasks completed today
    (state.todoTasksData || []).forEach(t => {
        if (t.completed && t.completedAt) {
            const taskDateKey = api.getLocalTodayKey(new Date(t.completedAt));
            if (taskDateKey === todayKey) {
                const compId = `todo_${t.id}`;
                if (!compMap.has(compId)) {
                    const doerUid = t.completedBy?.[0] || t.assignees?.[0] || '';
                    const userObj = ALL_USERS.find(u => u.uid === doerUid);
                    compMap.set(compId, {
                        id: compId,
                        itemId: t.id,
                        sourceType: 'todo',
                        title: t.name,
                        user: userObj?.name || (t.completedBy?.[0] ? 'User' : 'Someone'),
                        userUid: doerUid,
                        points: t.points || 0,
                        completedAt: t.completedAt,
                        dateKey: todayKey
                    });
                }
            }
        }
        if (Array.isArray(t.subTasks)) {
            t.subTasks.forEach(st => {
                if (st.completed && st.completedAt) {
                    const subDateKey = api.getLocalTodayKey(new Date(st.completedAt));
                    if (subDateKey === todayKey) {
                        const compId = `subtask_${t.id}_${st.id}`;
                        if (!compMap.has(compId)) {
                            const doerName = st.completedBy || st.createdBy || 'Someone';
                            const userObj = ALL_USERS.find(u => u.name.toLowerCase() === doerName.toLowerCase());
                            compMap.set(compId, {
                                id: compId,
                                itemId: st.id,
                                sourceType: 'subtask',
                                title: `${t.name}: ${st.name || st.text || 'Subtask'}`,
                                user: userObj ? userObj.name : doerName,
                                userUid: userObj ? userObj.uid : '',
                                points: 0,
                                completedAt: st.completedAt,
                                dateKey: todayKey
                            });
                        }
                    }
                }
            });
        }
    });

    // 4. Live Nipto Chore activities for today
    (state.allWeekActivities || []).forEach(act => {
        const actDate = act.parsedDate || (act.date ? new Date(act.date) : null);
        if (actDate && api.getLocalTodayKey(actDate) === todayKey) {
            const compId = `nipto_${act.uid}`;
            if (!compMap.has(compId)) {
                compMap.set(compId, {
                    id: compId,
                    itemId: act.uid,
                    sourceType: 'nipto',
                    title: act.label || act.task?.name || 'Activity',
                    user: act.user?.name || 'Unknown',
                    userUid: act.user?.uid || '',
                    points: act.awardedPts || act.task?.value || 0,
                    completedAt: act.date || actDate.toISOString(),
                    dateKey: todayKey
                });
            }
        }
    });

    const items = Array.from(compMap.values());
    items.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
    state.completedToday = items;
    return items;
}

export function renderDoneTodayFeed() {
    const container = document.getElementById('doneTodayFeed');
    if (!container) return;

    const activeUid = state.activeUsers[0] || '';
    const activeUserObj = ALL_USERS.find(u => u.uid === activeUid);
    const activeName = (activeUserObj ? activeUserObj.name : '').toLowerCase();
    const items = state.completedToday || [];

    // Filter by view: everyone vs just me
    let filtered = items;
    if (doneTodayView === 'me' && (activeUid || activeName)) {
        filtered = items.filter(it => {
            const itUid = (it.userUid || '').toLowerCase();
            const itUser = (it.user || '').toLowerCase();
            const matchesUid = activeUid && itUid === activeUid.toLowerCase();
            const matchesName = activeName && itUser === activeName;
            return matchesUid || matchesName;
        });
    }

    filtered.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

    if (filtered.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); font-style: italic; padding: 10px 0; text-align: center;">No tasks completed today yet.</div>';
        return;
    }

    let html = `<div style="display: flex; flex-direction: column; gap: 6px;">`;

    filtered.forEach(it => {
        const timeStr = it.completedAt ? new Date(it.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
        const userObj = ALL_USERS.find(u => u.uid === it.userUid);
        const color = userObj ? userObj.color : 'var(--text-muted)';
        const userName = it.user || userObj?.name || 'Someone';

        let typeIcon = '&#x2714;';
        if (it.sourceType === 'routine') typeIcon = '&#x21BB;';
        else if (it.sourceType === 'todo') typeIcon = '&#x1F4CB;';
        else if (it.sourceType === 'subtask') typeIcon = '&#x25AA;';

        html += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-radius: 6px; background: var(--bg-color); border: 1px solid var(--border-color); font-size: 12px;">
            <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                <span style="color: var(--success); font-weight: bold;">${typeIcon}</span>
                <div style="min-width: 0;">
                    <div style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(it.title)}</div>
                    <div style="font-size: 10px; color: var(--text-muted);">
                        <strong style="color: ${color};">${escapeHtml(userName)}</strong>${timeStr ? ` &bull; ${timeStr}` : ''}
                    </div>
                </div>
            </div>
            ${it.points > 0 ? `<span class="pts-badge" style="font-size: 10px; flex-shrink: 0;">+${it.points} pts</span>` : ''}
        </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}

// Unified public updater
export async function updateLeaderboardUI() {
    try {
        const { points } = await api.loadWeeklyPointsFromFirestore();
        state.currentWeekScores = { ...points };
        drawLeaderboard(points, false);
        rebuildCompletedToday();
        renderDoneTodayFeed();
    } catch (e) {
        console.warn("Leaderboard UI update fallback:", e);
    }
}

// Bind to window for HTML onclicks
window.renderAllowanceUI = renderAllowanceUI;
window.togglePayoutHistory = togglePayoutHistory;
window.payoutBoy = payoutBoy;
window.openAllowanceAdjustModal = openAllowanceAdjustModal;
window.closeAllowanceAdjustModal = closeAllowanceAdjustModal;
window.submitAllowanceAdjust = submitAllowanceAdjust;
window.setDoneTodayView = setDoneTodayView;
window.rebuildCompletedToday = rebuildCompletedToday;
window.renderDoneTodayFeed = renderDoneTodayFeed;
