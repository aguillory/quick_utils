// preferences.js
// Cloud-synced user preferences (theme, history view, sort orders, filters, collapsed sections).
import { state } from './state.js';

state.userPrefs = {
    theme: 'boring',
    historyView: 'everyone',
    niptoSortOrder: [],
    customSortOrder: [],
    todoSortOrder: [],
    todoSort: 'priority',
    todoGroupBy: 'category',
    todoTypeFilter: 'all',
    todoCategoryFilter: 'all',
    todoPriorityFilter: 'all',
    todoPersonFilter: 'all',
    collapsed: {},
    collapsedSections: {},
    bulkCollapsedSections: {},
    ...(state.userPrefs || {})
};

// Loads a user's saved preferences from Firestore into state with local cache fallback.
export async function loadCloudPreferences(uid) {
    if (!uid || state.isTogetherMode) return;

    // Fast-path: local storage cache for instant UI rendering
    try {
        const cached = localStorage.getItem(`nipto_user_prefs_${uid}`);
        if (cached) {
            const parsed = JSON.parse(cached);
            state.userPrefs = { ...state.userPrefs, ...parsed };
            applyPrefsToState(uid);
        }
    } catch (e) {
        // non-blocking cache error
    }

    try {
        const doc = await window.getNiptoCollection('user_preferences').doc(uid).get();
        if (doc.exists) {
            state.userPrefs = { ...state.userPrefs, ...doc.data() };
            // Update local cache
            localStorage.setItem(`nipto_user_prefs_${uid}`, JSON.stringify(state.userPrefs));
            applyPrefsToState(uid);
        }
    } catch (e) {
        console.error("Error loading cloud prefs:", e);
    }
}

// Applies stored preferences to the reactive state
function applyPrefsToState(uid) {
    if (state.userPrefs.todoSort) state.todoSort = state.userPrefs.todoSort;
    if (state.userPrefs.todoGroupBy) state.todoGroupBy = state.userPrefs.todoGroupBy;
    if (state.userPrefs.todoTypeFilter) state.todoTypeFilter = state.userPrefs.todoTypeFilter;
    if (state.userPrefs.todoCategoryFilter) state.todoCategoryFilter = state.userPrefs.todoCategoryFilter;
    if (state.userPrefs.todoPriorityFilter) state.todoPriorityFilter = state.userPrefs.todoPriorityFilter;
    if (state.userPrefs.todoPersonFilter) state.todoPersonFilter = state.userPrefs.todoPersonFilter;
    if (state.userPrefs.todoBucketFilter) state.todoBucketFilter = state.userPrefs.todoBucketFilter;
    if (state.userPrefs.todoFrictionFilter) state.todoFrictionFilter = state.userPrefs.todoFrictionFilter;
    if (state.userPrefs.todoView) state.todoView = state.userPrefs.todoView;

    // Reconcile per-user shown/hidden Nipto dashboard tasks if saved in user_preferences
    if (uid && Array.isArray(state.userPrefs.dashboardTaskUids) && state.userPrefs.dashboardTaskUids.length > 0 && Array.isArray(state.tasks)) {
        const allowedSet = new Set(state.userPrefs.dashboardTaskUids);
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

// Saves a single preference key/value to Firestore, local state, and local cache.
export function saveCloudPreference(key, value) {
    const uid = state.activeUsers[0];
    if (!uid || state.isTogetherMode) return;
    state.userPrefs[key] = value;
    try {
        localStorage.setItem(`nipto_user_prefs_${uid}`, JSON.stringify(state.userPrefs));
    } catch (e) {}
    window.getNiptoCollection('user_preferences').doc(uid).set({ [key]: value }, { merge: true });
}

// Saves the collapsed/expanded state of a category section.
export function saveCloudCollapsed(catKey, isCollapsed) {
    const uid = state.activeUsers[0];
    if (!uid || state.isTogetherMode) return;
    if (!state.userPrefs.collapsed) state.userPrefs.collapsed = {};
    state.userPrefs.collapsed[catKey] = isCollapsed;
    try {
        localStorage.setItem(`nipto_user_prefs_${uid}`, JSON.stringify(state.userPrefs));
    } catch (e) {}
    window.getNiptoCollection('user_preferences').doc(uid).set({ collapsed: state.userPrefs.collapsed }, { merge: true });
}
