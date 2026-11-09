// chat.js — Household Messages feature & Home Assistant Webhook Integration
// Real-time chat stored in Firestore with smart burst concatenation (last 10m)
// and adult push notifications via Home Assistant script.notify_router bridge.

import { state, ALL_USERS, NIPTO_PUBLIC_URL } from './state.js';
import * as api from './api.js';

export { NIPTO_PUBLIC_URL };

const CHAT_COLLECTION = 'chat_messages';
const READS_COLLECTION = 'chat_reads';
const BASE_TITLE = document.title || 'Unified Nipto Dashboard';

let chatMessagesCache = [];   // all messages (incl. deleted) from the live listener
let lastReads = {};           // { userUid: FirestoreTimestamp }
let unreadCount = 0;
let listenersStarted = false;
let lastReadWrite = 0;        // throttle for read-receipt writes

function getCurrentUser() {
    const uid = (state.activeUsers && state.activeUsers.length) ? state.activeUsers[0] : null;
    return ALL_USERS.find(u => u.uid === uid) || null;
}

function canSend() {
    return !state.isTogetherMode && !!getCurrentUser();
}

function isMessagesTabOpen() {
    const pane = document.getElementById('pane-hub');
    const sidebar = document.getElementById('householdHubSidebar');
    return (pane && pane.style.display !== 'none') || (sidebar && sidebar.offsetParent !== null);
}

function msgMillis(m) {
    return (m.createdAt && typeof m.createdAt.toMillis === 'function') ? m.createdAt.toMillis() : Date.now();
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function updateSenderLabel() {
    const el = document.getElementById('chatSenderName');
    if (!el) return;
    if (state.isTogetherMode) { el.textContent = 'Together (sending disabled)'; return; }
    const me = getCurrentUser();
    el.textContent = me ? me.name : '—';
}

function updateChatInputState() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    const allowed = canSend();
    if (input) {
        input.disabled = !allowed;
        input.placeholder = allowed
            ? 'Type a message... (Enter to send)'
            : 'Select a single person above to send messages';
    }
    if (btn) btn.disabled = !allowed;
}

function updateTitleBar() {
    document.title = (unreadCount > 0)
        ? `(${unreadCount > 99 ? '99+' : unreadCount}) ${BASE_TITLE}`
        : BASE_TITLE;
}

// ---------------- Live listeners ----------------
function startChatListeners() {
    if (listenersStarted || !window.db) return;
    listenersStarted = true;

    window.getNiptoCollection(CHAT_COLLECTION).orderBy('createdAt', 'asc').onSnapshot(snap => {
        chatMessagesCache = [];
        snap.forEach(doc => chatMessagesCache.push({ id: doc.id, ...doc.data() }));
        renderChat();
        updateUnreadBadge();
        if (isMessagesTabOpen() && document.visibilityState === 'visible') markAllRead();
    }, err => console.error('Chat listener error:', err));

    window.getNiptoCollection(READS_COLLECTION).onSnapshot(snap => {
        lastReads = {};
        snap.forEach(doc => { lastReads[doc.id] = doc.data().lastRead || null; });
        updateUnreadBadge();
    }, err => console.error('Chat reads listener error:', err));
}

// ---------------- Unread badge ----------------
function updateUnreadBadge() {
    const badge = document.getElementById('chatBadge');
    const navBadge = document.getElementById('navChatBadge');
    const me = getCurrentUser();
    if (!me) {
        unreadCount = 0;
        if (badge) badge.style.display = 'none';
        if (navBadge) navBadge.style.display = 'none';
        updateTitleBar();
        return;
    }
    const last = lastReads[me.uid];
    const lastMs = (last && typeof last.toMillis === 'function') ? last.toMillis() : 0;
    unreadCount = chatMessagesCache.filter(m =>
        !m.deleted && m.senderUid !== me.uid && msgMillis(m) > lastMs
    ).length;

    const countText = unreadCount > 99 ? '99+' : String(unreadCount);
    if (badge) {
        badge.textContent = countText;
        badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
    if (navBadge) {
        navBadge.textContent = countText;
        navBadge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }
    updateTitleBar();
}

async function markAllRead() {
    const me = getCurrentUser();
    if (!me || unreadCount === 0) return;
    const now = Date.now();
    if (now - lastReadWrite < 2000) return;
    lastReadWrite = now;
    try {
        await window.getNiptoCollection(READS_COLLECTION).doc(me.uid).set({
            lastRead: window.firebase.firestore.FieldValue.serverTimestamp(),
            name: me.name
        }, { merge: true });
    } catch (e) { console.error('Failed to update read receipt:', e); }
}

// ---------------- Rendering ----------------
export function renderChat() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    updateSenderLabel();
    updateChatInputState();
    const me = getCurrentUser();
    const visible = chatMessagesCache.filter(m => !m.deleted);

    if (!visible.length) {
        container.innerHTML = '<div class="chat-empty">No messages yet. Say hello!</div>';
        return;
    }
    const nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 150;
    let html = '';
    let lastDay = '';
    const todayKey = new Date().toDateString();

    visible.forEach(m => {
        const d = new Date(msgMillis(m));
        const dayKey = d.toDateString();
        if (dayKey !== lastDay) {
            const label = (dayKey === todayKey) ? 'Today'
                : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            html += `<div class="chat-day-divider">${label}</div>`;
            lastDay = dayKey;
        }
        const mine = me && m.senderUid === me.uid;
        const showActions = mine && !state.isTogetherMode;
        const senderUser = ALL_USERS.find(u => u.uid === m.senderUid);
        const color = senderUser ? senderUser.color : 'var(--text-muted)';
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

        html += `
        <div class="chat-row ${mine ? 'sent' : 'received'}">
            ${mine ? '' : `<div class="chat-sender" style="color: ${color}">${escapeHtml(m.senderName || '?')}</div>`}
            <div class="chat-bubble" ${mine ? '' : `style="border-left-color: ${color}"`}>${escapeHtml(m.text)}</div>
            <div class="chat-meta">
                <span>${time}</span>
                ${m.edited ? '<span class="chat-edited">(edited)</span>' : ''}
                ${showActions ? `
                <button class="chat-msg-btn" title="Edit" onclick="editChatMessage('${m.id}')">&#x270E;</button>
                <button class="chat-msg-btn" title="Delete" onclick="deleteChatMessage('${m.id}')">&#x1F5D1;</button>` : ''}
            </div>
        </div>`;
    });

    container.innerHTML = html;
    if (nearBottom) container.scrollTop = container.scrollHeight;
}

function scrollChatToBottom() {
    const container = document.getElementById('chatMessages');
    if (container) container.scrollTop = container.scrollHeight;
}

// ---------------- Actions & Home Assistant Dispatch ----------------
export async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (!canSend()) {
        alert(state.isTogetherMode
            ? 'Sending is disabled in Together mode. Select a single person first.'
            : 'Select your profile at the top first!');
        return;
    }
    const me = getCurrentUser();
    input.value = '';

    try {
        await window.getNiptoCollection(CHAT_COLLECTION).add({
            text: text,
            senderUid: me.uid,
            senderName: me.name,
            createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
            deleted: false,
            edited: false,
            editHistory: []
        });
        scrollChatToBottom();

        // Smart burst concatenation & Home Assistant notification routing
        dispatchChatNotification(me, text);
    } catch (e) {
        console.error('Failed to send message:', e);
        input.value = text;
        alert('Message failed to send. Check your connection.');
    }
}

// Concatenates unread messages from last 10 minutes and dispatches to HA
function dispatchChatNotification(sender, newText) {
    const adultProfiles = state.notificationPreferences?.adults || {};
    const targetEntities = [];
    const isDirectPing = /@[A-Za-z]+/.test(newText);

    Object.keys(adultProfiles).forEach(uid => {
        if (uid === sender.uid) return; // Never notify sender
        const adult = adultProfiles[uid];
        if (!adult || !adult.haTarget) return;

        const mode = adult.chatMode || 'all_messages';
        if (mode === 'all_messages') {
            targetEntities.push(adult.haTarget);
        } else if (mode === 'ping_only') {
            const pingRegex = new RegExp(`@${adult.name}\\b`, 'i');
            if (pingRegex.test(newText)) {
                targetEntities.push(adult.haTarget);
            }
        }
    });

    if (targetEntities.length === 0) return;

    // Gather messages from last 10 minutes from this sender
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    const burstTexts = [];

    chatMessagesCache.forEach(m => {
        if (!m.deleted && m.senderUid === sender.uid && msgMillis(m) >= tenMinutesAgo) {
            burstTexts.push(m.text);
        }
    });
    burstTexts.push(newText);

    let concatenated = burstTexts.join(' | ');
    if (concatenated.length > 240) {
        concatenated = concatenated.slice(0, 237) + '...';
    }

    const payload = {
        targets: targetEntities,
        title: `Nipto Chat: ${sender.name}`,
        message: concatenated,
        tag: "nipto_chat_buffer",
        cooldown_seconds: 90,
        critical: isDirectPing,
        dashboard_path: (state.integrationsConfig?.publicAppUrl || NIPTO_PUBLIC_URL)
    };

    api.dispatchHomeAssistantNotification(payload);
}

export async function deleteChatMessage(msgId) {
    const m = chatMessagesCache.find(x => x.id === msgId);
    if (!m) return;
    const me = getCurrentUser();
    if (!canSend() || !me || m.senderUid !== me.uid) {
        alert('You can only delete your own messages.');
        return;
    }
    if (!confirm('Delete this message?')) return;
    try {
        await window.getNiptoCollection(CHAT_COLLECTION).doc(msgId).update({
            deleted: true,
            deletedAt: new Date().toISOString(),
            deletedByUid: me.uid,
            deletedByName: me.name
        });
    } catch (e) { console.error('Failed to delete message:', e); }
}

export async function editChatMessage(msgId) {
    const m = chatMessagesCache.find(x => x.id === msgId);
    if (!m) return;
    const me = getCurrentUser();
    if (!canSend() || !me || m.senderUid !== me.uid) {
        alert('You can only edit your own messages.');
        return;
    }
    const newText = prompt('Edit message:', m.text);
    if (newText === null) return;
    const trimmed = newText.trim();
    if (!trimmed || trimmed === m.text) return;
    try {
        await window.getNiptoCollection(CHAT_COLLECTION).doc(msgId).update({
            text: trimmed,
            edited: true,
            editHistory: window.firebase.firestore.FieldValue.arrayUnion({
                text: m.text,
                editedAt: new Date().toISOString(),
                editedByUid: me.uid,
                editedByName: me.name
            })
        });
    } catch (e) { console.error('Failed to edit message:', e); }
}

// Quick @Ping pill insertion
export function insertChatPing(name) {
    const input = document.getElementById('chatInput');
    if (input) {
        const val = input.value;
        const spacer = (val.length > 0 && !val.endsWith(' ')) ? ' ' : '';
        input.value = `${val}${spacer}@${name} `;
        input.focus();
    }
}

export function onChatTabOpened() {
    renderChat();
    scrollChatToBottom();
    markAllRead();
    updateUnreadBadge();
}

export function refreshChatUser() {
    renderChat();
    updateUnreadBadge();
    updateChatInputState();
}

export function initChat() {
    const input = document.getElementById('chatInput');
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }
    updateSenderLabel();
    updateChatInputState();

    ['click', 'keydown', 'touchstart', 'focus'].forEach(evt => {
        window.addEventListener(evt, () => {
            if (isMessagesTabOpen() && document.visibilityState === 'visible') markAllRead();
        }, { passive: true });
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isMessagesTabOpen()) markAllRead();
    });

    window.firebase.auth().onAuthStateChanged(user => {
        if (user) startChatListeners();
    });
}

// Bind to window for HTML onclicks
window.insertChatPing = insertChatPing;
window.sendChatMessage = sendChatMessage;
window.editChatMessage = editChatMessage;
window.deleteChatMessage = deleteChatMessage;
