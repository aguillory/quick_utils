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
    customCategories: [],  // User-created categories in combobox

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

    // User preferences (cloud-synced & local cache)
    userPrefs: {
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
    },

    // Boys' Allowance Ledger (1 pt = $0.05 / 5 pts = $0.25)
    allowanceLedger: {
        ayden: { unpaidPoints: 0, payoutHistory: [] },
        dj: { unpaidPoints: 0, payoutHistory: [] }
    },

    // Integrations Config (Gemini AI & Home Assistant Webhook)
    integrationsConfig: {
        geminiApiKey: "",
        geminiModel: "gemini-3.8-flash",
        haWebhookUrl: "",
        haWebhookToken: "",
        publicAppUrl: "https://aguillory.github.io/quick_utils/nipto/common.html"
    },

    // Adult Notification Preferences (Alyssa, Devyn, Carrina have phones connected; Kenny does not)
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

    // "Done This Week" & Historical Week Browsing State
    doneWeekOffset: 0,               // 0 = This Week (Mon-Sun local), -1 = Last Week, etc.
    recentCompletions: [],
    persistedDailyCompletions: [],   // Persisted daily_completions items for the active week
    weeklyActivitiesForDone: [],     // Nipto activities for the active week
    weeklyCompletionsCache: {},      // Cache keyed by weekKey (Monday YYYY-MM-DD)
    completedThisWeek: [],           // Merged & deduplicated completions for the active week
    completedToday: [],              // Backward-compatible alias to completedThisWeek

    // Filter & sort state
    scheduleFilter: 'me',            // 'me' (default) | 'all' | uid
    hideCompletedRoutines: false,
    todoView: 'all',                 // 'all' (default) | 'my_actionable' | 'shared' | 'projects'
    todoPersonFilter: 'all',         // 'all' | 'me' | 'shared_anyone' | 'unassigned' | uid
    todoBucketFilter: 'all',         // 'all' | 'actionable' | 'project_idea'
    todoTypeFilter: 'all',           // 'all' (default) | 'todo' | 'project' | 'routine'
    todoCategoryFilter: 'all',       // 'all' | specific category
    todoPriorityFilter: 'all',       // 'all' | 'high' | 'medium' | 'low'
    todoFrictionFilter: 'all',       // 'all' | 'quick' | 'low_brain' | 'deep_focus'
    todoSort: 'priority',            // 'priority' | 'points' | 'category' | 'age' | 'oldest' | 'alpha' | 'friction'
    todoGroupBy: 'none',             // 'none' (default) | 'category'
    manageSubtab: 'todos',           // 'todos' | 'routines'
    manageSearchQuery: '',
    bulkTypeFilter: 'all',           // 'all' | 'todo' | 'project' | 'routine'
    bulkCategoryFilter: 'all',       // 'all' | category name
    bulkPriorityFilter: 'all',       // 'all' | 'high' | 'medium' | 'low'
    bulkOwnershipFilter: 'all',      // 'all' | 'me' | 'individual' | 'shared' | 'unassigned'
    bulkSortBy: 'default',           // 'default' | 'priority' | 'points' | 'category' | 'title'

    // Bulk triage selection
    selectedTodoIds: new Set(),
    selectedRoutineIds: new Set(),

    // Gemini Brain Dump staging
    brainDumpMode: 'create',
    brainDumpStaging: [],
    rambleStaging: [],
    staleCurrentIndex: 0
};

export function saveUserState() {
    localStorage.setItem("nipto_merged_users", JSON.stringify({
        isTogetherMode: state.isTogetherMode,
        users: state.activeUsers
    }));
}
