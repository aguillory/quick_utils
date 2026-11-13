// preferences.js
// Cloud-synced user preferences (theme, history view, sort orders, filters, collapsed sections).
import { state } from './state.js';

const userPrefsCache = new Map();

function getDefaultUserPrefs() {
    return {
        theme: 'boring',
        historyView: 'everyone',
        niptoSortOrder: [],
        customSortOrder: [],
        todoSortOrder: [],
        todoSort: 'priority',
        todoGroupBy: 'none',
        todoTypeFilter: 'all',
        todoCategoryFilter: 'all',
        todoPriorityFilter: 'all',
        todoPersonFilter: 'all',
        todoBucketFilter: 'all',
        todoFrictionFilter: 'all',
        todoView: 'all',
        collapsed: {},
        collapsedSections: {},
        bulkCollapsedSections: {}
    };
}

function normalizeUserPrefs(raw = {}) {
    const prefs = { ...getDefaultUserPrefs(), ...(raw || {}) };
    if (!raw?.todoPersonFilter && raw?.todoAssigneeFilter) {
        prefs.todoPersonFilter = raw.todoAssigneeFilter;
    }
    if (prefs.todoGroupBy !== 'category') {
        prefs.todoGroupBy = 'none';
    }
    return prefs;
}

state.userPrefs = normalizeUserPrefs(state.userPrefs);

// Loads a user's saved preferences from Firestore into state with per-session & local cache.
export async function loadCloudPreferences(uid) {
    if (!uid || state.isTogetherMode) return;

    if (userPrefsCache.has(uid)) {
        state.userPrefs = normalizeUserPrefs(userPrefsCache.get(uid));
        applyPrefsToState(uid);
        return;
    }

    // Fast-path: local storage cache for instant UI rendering (scoped strictly to this uid)
    try {
        const cached = localStorage.getItem(`nipto_user_prefs_${uid}`);
        if (cached) {
            const parsed = JSON.parse(cached);
            state.userPrefs = normalizeUserPrefs(parsed);
            applyPrefsToState(uid);
        } else {
            state.userPrefs = getDefaultUserPrefs();
            applyPrefsToState(uid);
        }
    } catch (e) {
        state.userPrefs = getDefaultUserPrefs();
        applyPrefsToState(uid);
    }

    try {
        const doc = await window.getNiptoCollection('user_preferences').doc(uid).get();
        const docData = doc.exists ? (doc.data() || {}) : {};
        userPrefsCache.set(uid, docData);
        state.userPrefs = normalizeUserPrefs(docData);
        try {
            localStorage.setItem(`nipto_user_prefs_${uid}`, JSON.stringify(state.userPrefs));
        } catch (e) {}
        applyPrefsToState(uid);
    } catch (e) {
        console.error("Error loading cloud prefs:", e);
    }
}

// Applies stored preferences to the reactive state (resets all fields to prevent cross-user leakage)
function applyPrefsToState(uid) {
    const p = state.userPrefs || getDefaultUserPrefs();
    state.todoSort = p.todoSort || 'priority';
    state.todoGroupBy = (p.todoGroupBy === 'category') ? 'category' : 'none';
    state.todoTypeFilter = p.todoTypeFilter || 'all';
    state.todoCategoryFilter = p.todoCategoryFilter || 'all';
    state.todoPriorityFilter = p.todoPriorityFilter || 'all';
    state.todoPersonFilter = p.todoPersonFilter || 'all';
    state.todoBucketFilter = p.todoBucketFilter || 'all';
    state.todoFrictionFilter = p.todoFrictionFilter || 'all';
    state.todoView = p.todoView || 'all';

    // Reconcile per-user shown/hidden Nipto dashboard tasks if saved in user_preferences
    if (uid && Array.isArray(p.dashboardTaskUids) && p.dashboardTaskUids.length > 0 && Array.isArray(state.tasks)) {
        const allowedSet = new Set(p.dashboardTaskUids);
        state.tasks.forEach(task => {
            const users = Array.isArray(task.dashboardUsers) ? [...task.dashboardUsers] : [];
            const hasUid = users.includes(uid);
            const shouldHaveUid = allowedSet.has(task.uid);
            if (shouldHaveUid && !hasUid) {
                users.push(uid);
                task.dashboardUsers = users;
            } else if (!shouldHaveUid && hasUid) {
                task.dashboardUsers = users.filter(id => id !== uid);
            }
        });
    }
}

function updateCachedPrefs(uid, patch) {
    const prevRaw = userPrefsCache.get(uid) || {};
    userPrefsCache.set(uid, { ...prevRaw, ...patch });
    try {
        localStorage.setItem(`nipto_user_prefs_${uid}`, JSON.stringify(state.userPrefs));
    } catch (e) {}
}

// Saves a single preference key/value to Firestore, local state, and caches.
export function saveCloudPreference(key, value) {
    const uid = state.activeUsers[0];
    if (!uid || state.isTogetherMode) return;
    state.userPrefs[key] = value;
    updateCachedPrefs(uid, { [key]: value });
    window.getNiptoCollection('user_preferences').doc(uid).set({ [key]: value }, { merge: true });
}

// Saves multiple preference fields in a single Firestore write.
export function saveCloudPreferencesBatch(updates = {}) {
    const uid = state.activeUsers[0];
    if (!uid || state.isTogetherMode || !updates || typeof updates !== 'object') return;
    Object.assign(state.userPrefs, updates);
    updateCachedPrefs(uid, updates);
    window.getNiptoCollection('user_preferences').doc(uid).set(updates, { merge: true });
}

// Saves the collapsed/expanded state of a category section.
export function saveCloudCollapsed(catKey, isCollapsed) {
    const uid = state.activeUsers[0];
    if (!uid || state.isTogetherMode) return;
    if (!state.userPrefs.collapsed) state.userPrefs.collapsed = {};
    state.userPrefs.collapsed[catKey] = isCollapsed;
    updateCachedPrefs(uid, { collapsed: state.userPrefs.collapsed });
    window.getNiptoCollection('user_preferences').doc(uid).set({ collapsed: state.userPrefs.collapsed }, { merge: true });
}
