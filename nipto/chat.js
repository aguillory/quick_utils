// chat.js — Family Messages feature
// Real-time chat stored in Firestore. Soft-deletes and edit history are
// preserved in the DB (viewable via chat-admin.html), never shown in the panel.
import { state, ALL_USERS } from './state.js';
const CHAT_COLLECTION = 'chat_messages';
const READS_COLLECTION = 'chat_reads';
const BASE_TITLE = document.title || 'Unified Nipto Dashboard';
let chatMessagesCache = [];   // all messages (incl. deleted) from the live listener
let lastReads = {};           // { userUid: FirestoreTimestamp }
let unreadCount = 0;
let listenersStarted = false;
let lastReadWrite = 0;        // throttle for read-receipt writes
/* ---------------- Helpers ---------------- */
function getCurrentUser() {
    const uid = (state.activeUsers && state.activeUsers.length) ? state.activeUsers[0] : null;
    return ALL_USERS.find(u => u.uid === uid) || null;
}
// Sending (and editing/deleting) requires a single, unambiguous person
function canSend() {
    return !state.isTogetherMode && !!getCurrentUser();
}
function isMessagesTabOpen() {
    const pane = document.getElementById('pane-messages');
    return !!pane && pane.style.display !== 'none';
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
    if (state.isTogetherMode) { el.textContent = '🤝 Together (sending disabled)'; return; }
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
            ? 'Type a message… (Enter to send, Shift+Enter for new line)'
            : '🤝 Together mode is on — select a single person to send messages';
    }
    if (btn) btn.disabled = !allowed;
}
function updateTitleBar() {
    document.title = (unreadCount > 0)
        ? `(${unreadCount > 99 ? '99+' : unreadCount}) ${BASE_TITLE}`
        : BASE_TITLE;
}
/* ---------------- Live listeners ---------------- */
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
/* ---------------- Unread badge + title bar ---------------- */
function updateUnreadBadge() {
    const badge = document.getElementById('chatBadge');
    const me = getCurrentUser();
    if (!me) {
        unreadCount = 0;
        if (badge) badge.style.display = 'none';
        updateTitleBar();
        return;
    }
    const last = lastReads[me.uid];
    const lastMs = (last && typeof last.toMillis === 'function') ? last.toMillis() : 0;
    unreadCount = chatMessagesCache.filter(m =>
        !m.deleted && m.senderUid !== me.uid && msgMillis(m) > lastMs
    ).length;
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
    updateTitleBar();
}
async function markAllRead() {
    const me = getCurrentUser();
    if (!me || unreadCount === 0) return;
    const now = Date.now();
    if (now - lastReadWrite < 2000) return; // throttle writes
    lastReadWrite = now;
    try {
        await window.getNiptoCollection(READS_COLLECTION).doc(me.uid).set({
            lastRead: window.firebase.firestore.FieldValue.serverTimestamp(),
            name: me.name
        }, { merge: true });
    } catch (e) { console.error('Failed to update read receipt:', e); }
}
/* ---------------- Rendering ---------------- */
function renderChat() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    updateSenderLabel();
    updateChatInputState();
    const me = getCurrentUser();
    const visible = chatMessagesCache.filter(m => !m.deleted);
    if (!visible.length) {
        container.innerHTML = '<div class="chat-empty">No messages yet. Say hi! 👋</div>';
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
        // Only the sender can edit/delete — and not while Together mode is active
        const showActions = mine && !state.isTogetherMode;
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        html += `
        <div class="chat-row ${mine ? 'sent' : 'received'}">
            ${mine ? '' : `<div class="chat-sender chat-sender-${m.senderUid}">${escapeHtml(m.senderName || '?')}</div>`}
            <div class="chat-bubble chat-bubble-${m.senderUid}">${escapeHtml(m.text)}</div>
            <div class="chat-meta">
                <span>${time}</span>
                ${m.edited ? '<span class="chat-edited">(edited)</span>' : ''}
                ${showActions ? `
                <button class="chat-msg-btn" title="Edit" onclick="editChatMessage('${m.id}')">✏️</button>
                <button class="chat-msg-btn" title="Delete" onclick="deleteChatMessage('${m.id}')">🗑️</button>` : ''}
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
/* ---------------- Actions (exported; bound to window in dashboard.js) ---------------- */
export async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (!canSend()) {
        alert(state.isTogetherMode
            ? 'Sending is disabled in Together mode. Select a single person at the top first.'
            : 'Select whose profile is active at the top first!');
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
    } catch (e) {
        console.error('Failed to send message:', e);
        input.value = text; // give them their text back on failure
        alert('Message failed to send. Check your connection and try again.');
    }
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
                text: m.text, // the version being replaced
                editedAt: new Date().toISOString(),
                editedByUid: me.uid,
                editedByName: me.name
            })
        });
    } catch (e) { console.error('Failed to edit message:', e); }
}
/* ---------------- Hooks called by dashboard.js ---------------- */
// Called when the Messages tab is opened
export function onChatTabOpened() {
    renderChat();
    scrollChatToBottom();
    markAllRead();
    updateUnreadBadge();
}
// Called whenever the active user / Together mode changes
export function refreshChatUser() {
    renderChat();
    updateUnreadBadge();
    updateChatInputState();
}
/* ---------------- Init (called once from dashboard.js startup) ---------------- */
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
    // Activity while the Messages tab is open keeps unreads cleared
    ['click', 'keydown', 'touchstart', 'focus'].forEach(evt => {
        window.addEventListener(evt, () => {
            if (isMessagesTabOpen() && document.visibilityState === 'visible') markAllRead();
        }, { passive: true });
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isMessagesTabOpen()) markAllRead();
    });
    // Start the live listeners once Firebase anonymous auth is ready
    window.firebase.auth().onAuthStateChanged(user => {
        if (user) startChatListeners();
    });
}