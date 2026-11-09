// state.js
// Centralized reactive state for the Nipto web application.

export const ALL_USERS = [];
export const NIPTO_PUBLIC_URL = "https://aguillory.github.io/quick_utils/nipto/common.html";

export const state = {
    activeUsers: [],
    isTogetherMode: false,
    currentSplitDivisor: 1,
    historyViewMode: 'all',
    currentMode: 'live',
    
    // Core data arrays
    tasks: [],             // Nipto repeatable chores from Firestore
    customChores: [],
    allWeekActivities: [],
    todoTasksData: [],     // Active To-Dos from Firestore
    routines: [],          // Routines from Firestore
    
    // Week browsing & history
    selectedWeekUid: 'current',
    weeksList: [],
    historicalActivitiesCache: {},
    currentWeekScores: {},
    activityLabels: {},

    // Edit & display mode tracking
    isEditMode: false,
    isViewAllMode: false,
    tempEditPrefs: new Set(),
    hasEnteredTaskPin: false,
    apiToken: localStorage.getItem("nipto_api_token") || "",

    // Phase 3 & 4 new state extensions
    allowanceLedger: {
        ayden: { unpaidPoints: 0, payoutHistory: [] },
        dj: { unpaidPoints: 0, payoutHistory: [] }
    },
    integrationsConfig: {
        geminiApiKey: "",
        geminiModel: "gemini-3.8-flash",
        haWebhookUrl: "https://zbd3yezedhldtsyc2joff0uhgmklnahn.ui.nabu.casa/api/webhook/nipto_notify_bridge",
        publicAppUrl: "https://aguillory.github.io/quick_utils/nipto/common.html"
    },
    notificationPreferences: {
        adults: {
            "Llb9JjyTDvMnn8SJWfizXgthxl83": {
                name: "Alyssa",
                haTarget: "notify.mobile_app_alyssa_phone",
                chatMode: "all_messages",
                directAssignmentAlerts: true,
                morningDigest: true,
                eveningDigest: true
            },
            "cHnAKABalRf0gETPsDt9EiJLyZd2": {
                name: "Devyn",
                haTarget: "notify.mobile_app_devyn_s_phone",
                chatMode: "ping_only",
                directAssignmentAlerts: true,
                morningDigest: false,
                eveningDigest: true
            },
            "2pxnC1oGlZbLQLmu9UJJVPYOEmZ2": {
                name: "Carrina",
                haTarget: "notify.mobile_app_carrina_phone",
                chatMode: "all_messages",
                directAssignmentAlerts: true,
                morningDigest: true,
                eveningDigest: true
            },
            "TilLpLRDz4VWel79jVevmu3JsIH3": {
                name: "Kenny",
                haTarget: "",
                chatMode: "muted",
                directAssignmentAlerts: false,
                morningDigest: false,
                eveningDigest: false
            }
        }
    },
    recentCompletions: [],
    
    // Filter state
    scheduleFilter: 'me',           // 'me' (default) | 'all' | uid
    hideCompletedRoutines: false,
    todoView: 'my_actionable',      // 'my_actionable' (default) | 'shared' | 'projects' | 'all'
    todoPersonFilter: 'all',        // 'all' | 'me' | 'unassigned' | uid
    todoBucketFilter: 'all',        // 'all' | 'actionable' | 'project_idea'
    todoFrictionFilter: 'all',      // 'all' | 'quick' | 'low_brain' | 'deep_focus'
    
    // Bulk triage selection
    selectedTodoIds: new Set(),
    selectedRoutineIds: new Set(),
    
    // Gemini Brain Dump staging
    brainDumpStaging: []
};

export function saveUserState() {
    localStorage.setItem("nipto_merged_users", JSON.stringify({
        isTogetherMode: state.isTogetherMode,
        users: state.activeUsers
    }));
}
