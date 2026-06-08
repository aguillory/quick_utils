// state.js

export const ALL_USERS = [
    { uid: "NMRQaRQbvCwBaJbiMFId", name: "Ayden", color: "var(--user-ayden)" },
    { uid: "RMNUTP8VOHD9PDzNjf0g", name: "DJ", color: "var(--user-dj)" },
    { uid: "Llb9JjyTDvMnn8SJWfizXgthxl83", name: "Alyssa", color: "var(--user-alyssa)"},
    { uid: "cHnAKABalRf0gETPsDt9EiJLyZd2", name: "Devyn", color: "var(--user-devyn)"},
    { uid: "2pxnC1oGlZbLQLmu9UJJVPYOEmZ2", name: "Carrina", color: "var(--user-carrina)"}
];

export const state = {
    activeUsers: ["NMRQaRQbvCwBaJbiMFId"],
    isTogetherMode: false,
    currentSplitDivisor: 1,
    historyViewMode: 'boys',
    currentMode: 'live',
    
    // Data arrays
    tasks: [],
    customChores: [],
    allWeekActivities: [],
    todoTasksData: [], // Replaces tasksData
    
    // Edit mode tracking
    isEditMode: false,
    isViewAllMode: false,
    tempEditPrefs: new Set(),
    hasEnteredTaskPin: false,
    apiToken: localStorage.getItem("nipto_api_token") || ""
};

export function saveUserState() {
    localStorage.setItem("nipto_merged_users", JSON.stringify({
        isTogetherMode: state.isTogetherMode,
        users: state.activeUsers
    }));
}