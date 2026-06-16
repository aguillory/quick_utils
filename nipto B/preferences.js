// preferences.js
// Cloud-synced user preferences (theme, history view, sort orders, collapsed sections).
import { state } from './state.js';

state.userPrefs = { theme: 'boring', historyView: 'everyone', niptoSortOrder: [], todoSortOrder: [], collapsed: {} };

// Loads a user's saved preferences from Firestore into state.
export async function loadCloudPreferences(uid) {
    if (!uid || state.isTogetherMode) return;
    try {
        const doc = await window.db.collection('user_preferences').doc(uid).get();
        if (doc.exists) {
            state.userPrefs = { ...state.userPrefs, ...doc.data() };
        } else {
            state.userPrefs = { theme: 'boring', historyView: 'everyone', niptoSortOrder: [], todoSortOrder: [], collapsed: {} };
        }
    } catch (e) {
        console.error("Error loading cloud prefs:", e);
    }
}

// Saves a single preference key/value to Firestore and local state.
export function saveCloudPreference(key, value) {
    const uid = state.activeUsers[0];
    if (!uid || state.isTogetherMode) return;
    state.userPrefs[key] = value;
    window.db.collection('user_preferences').doc(uid).set({ [key]: value }, { merge: true });
}

// Saves the collapsed/expanded state of a category section.
export function saveCloudCollapsed(catKey, isCollapsed) {
    const uid = state.activeUsers[0];
    if (!uid || state.isTogetherMode) return;
    if (!state.userPrefs.collapsed) state.userPrefs.collapsed = {};
    state.userPrefs.collapsed[catKey] = isCollapsed;
    window.db.collection('user_preferences').doc(uid).set({ collapsed: state.userPrefs.collapsed }, { merge: true });
}