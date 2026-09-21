// state.js

export const ALL_USERS = [];


export const state = {
    activeUsers: [],
    isTogetherMode: false,
    currentSplitDivisor: 1,
    historyViewMode: 'all',
    currentMode: 'live',
    
    // Data arrays
    tasks: [],
    customChores: [],
    allWeekActivities: [],
    todoTasksData: [], 
    routines: [],
    
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
state.activityLabels = {};
