// dashboard.js
import { state, ALL_USERS, saveUserState } from './state.js';
import * as api from './api.js';

// --- INIT & USER STATE LOGIC ---
// ==========================================
// CLOUD PREFERENCES ENGINE
// ==========================================
state.userPrefs = { theme: 'boring', historyView: 'everyone', niptoSortOrder: [], todoSortOrder: [], collapsed: {} };

async function loadCloudPreferences(uid) {
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

function saveCloudPreference(key, value) {
    const uid = state.activeUsers[0];
    if (!uid || state.isTogetherMode) return;
    state.userPrefs[key] = value;
    window.db.collection('user_preferences').doc(uid).set({ [key]: value }, { merge: true });
}

function saveCloudCollapsed(catKey, isCollapsed) {
    const uid = state.activeUsers[0];
    if (!uid || state.isTogetherMode) return;
    if (!state.userPrefs.collapsed) state.userPrefs.collapsed = {};
    state.userPrefs.collapsed[catKey] = isCollapsed;
    window.db.collection('user_preferences').doc(uid).set({ collapsed: state.userPrefs.collapsed }, { merge: true });
}
async function initUsers() {
    populateTogetherCheckboxes();
    const stored = localStorage.getItem("nipto_merged_users");
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed.isTogetherMode) {
                setTogetherState(parsed.users);
                } else if (parsed.users && parsed.users.length === 1) {
                await setActiveUser(parsed.users[0], true);
                } else {
                await setActiveUser(ALL_USERS[0].uid, true);
            }
        } catch (e) { await setActiveUser(ALL_USERS[0].uid, true); }
        } else {
        await setActiveUser(ALL_USERS[0].uid, true);
    }
}

async function setActiveUser(uid, skipSave = false) {
    if (state.isEditMode) {
        alert("Please save your dashboard edits before switching users.");
        return;
    }
    
    state.isTogetherMode = false;
    state.activeUsers = [uid];
    state.currentSplitDivisor = 1;
    document.getElementById('together-drawer').classList.remove('visible');
    
    ALL_USERS.forEach(user => {
        const el = document.getElementById(`toggle-${user.uid}`);
        if (user.uid === uid) {
            el.classList.add('active'); el.classList.remove('inactive');
            } else {
            el.classList.add('inactive'); el.classList.remove('active');
        }
    });
    
    const togEl = document.getElementById('toggle-together');
    togEl.classList.add('inactive');
    togEl.classList.remove('active');
    
    // --- FETCH CLOUD PREFERENCES ---
    await loadCloudPreferences(uid);
    
    let userTheme = state.userPrefs.theme || 'boring';
    applyTheme(userTheme);
    
    let savedHistoryView = state.userPrefs.historyView || 'everyone';
    setHistoryView(savedHistoryView, true); 
    
    if(!skipSave) saveUserState();
    updateFloatingIndicator();
    renderTasks();
    renderPinnedTasks();
    
    renderTodoTasks(); 
    renderRoutines(); 
    renderSidebarRoutines(); 
    renderSidebarTodos(); 
}


function updateFloatingIndicator() {
    const container = document.getElementById('floating-avatars');
    const indBox = document.getElementById('floating-user-indicator');
    container.innerHTML = '';
    
    if (state.activeUsers.length === 0) {
        container.innerHTML = '<span class="floating-avatar" style="background: var(--danger);">No one selected!</span>';
        indBox.style.borderColor = 'var(--danger)';
        return;
    }
    
    let borderColors = [];
    state.activeUsers.forEach(uid => {
        const user = ALL_USERS.find(u => u.uid === uid);
        if (user) {
            borderColors.push(user.color);
            container.innerHTML += `<div class="floating-avatar" style="background: ${user.color};">${user.name}</div>`;
        }
    });
    
    indBox.style.borderColor = state.isTogetherMode ? 'var(--text-muted)' : borderColors[0];
}



function toggleTogetherMode() {
    if (state.isEditMode) {
        alert("You cannot edit the dashboard while in 'Together' mode. Please select a specific person to edit their dashboard.");
        return;
    }
    
    state.isTogetherMode = true;
    
    if (state.activeUsers.length <= 1) {
        state.activeUsers = ["NMRQaRQbvCwBaJbiMFId", "RMNUTP8VOHD9PDzNjf0g"];
        updateTogetherCheckboxes();
    }
    
    ALL_USERS.forEach(user => {
        const el = document.getElementById(`toggle-${user.uid}`);
        el.classList.add('inactive');
        el.classList.remove('active');
    });
    
    const togEl = document.getElementById('toggle-together');
    togEl.classList.remove('inactive');
    togEl.classList.add('active');
    
    document.getElementById('together-drawer').classList.add('visible');
    
    processTogetherSelection(true);
}

function setTogetherState(uids) {
    state.activeUsers = uids;
    updateTogetherCheckboxes();
    toggleTogetherMode();
}

function populateTogetherCheckboxes() {
    const container = document.getElementById('together-checkbox-container');
    container.innerHTML = '';
    ALL_USERS.forEach(u => {
        container.innerHTML += `
        <label class="together-label" style="border-left: 4px solid ${u.color};">
        <input type="checkbox" value="${u.uid}" class="t-check" onchange="processTogetherSelection()">
        ${u.name}
        </label>
        `;
    });
}

function updateTogetherCheckboxes() {
    document.querySelectorAll('.t-check').forEach(cb => {
        cb.checked = state.activeUsers.includes(cb.value);
    });
}

function processTogetherSelection(skipSave = false) {
    const checkboxes = document.querySelectorAll('.t-check:checked');
    state.activeUsers = Array.from(checkboxes).map(cb => cb.value);
    state.currentSplitDivisor = Math.max(1, state.activeUsers.length);
    
    if(!skipSave) saveUserState();
    updateFloatingIndicator();
    renderTasks();
    renderPinnedTasks();
}

// --- DASHBOARD VIEW & EDITING ---
function toggleViewAll() {
    if (state.isEditMode) return;
    state.isViewAllMode = !state.isViewAllMode;
    const btn = document.getElementById('viewAllBtn');
    if (state.isViewAllMode) {
        btn.innerText = "🏠 View My Dashboard";
        btn.style.backgroundColor = "var(--text-muted)";
        btn.style.color = "white";
        } else {
        btn.innerText = "🔍 View All Tasks";
        btn.style.backgroundColor = "";
        btn.style.color = "";
    }
    renderTasks();
}

function getUserPreferences() {
    const prefs = new Set();
    const targetUid = state.activeUsers[0]; 
    state.tasks.forEach(t => {
        if (t.dashboardUsers && t.dashboardUsers.includes(targetUid)) {
            prefs.add(t.uid);
        }
    });
    return prefs;
}

async function toggleEditMode() {
    if (state.isTogetherMode) {
        alert("Please select a specific person's button before clicking Edit Dashboard.");
        return;
    }
    
    const btn = document.getElementById('editBtn');
    const floatingBtn = document.getElementById('floating-save-btn');
    const syncBtn = document.getElementById('syncNiptoBtn');
    const statusDiv = document.getElementById('status');
    const viewAllBtn = document.getElementById('viewAllBtn');
    
    if (!state.isEditMode) {
        state.isEditMode = true;
        btn.innerText = "💾 Save Dashboard";
        btn.classList.add('save-mode');
        
        floatingBtn.style.display = 'block';
        floatingBtn.innerText = "💾 Save Dashboard";
        floatingBtn.disabled = false;
        
        if (syncBtn) syncBtn.style.display = 'inline-block';
        viewAllBtn.style.display = 'none';
        statusDiv.innerText = `EDIT MODE: Modifying dashboard for ${ALL_USERS.find(u=>u.uid === state.activeUsers[0]).name}`;
        statusDiv.style.color = "var(--primary)";
        
        state.tempEditPrefs = getUserPreferences();
        state.hasEnteredTaskPin = false; 
        
        if (state.isViewAllMode) toggleViewAll();
        
        renderTasks();
        
        } else {
        btn.innerText = "⏳ Saving...";
        btn.disabled = true;
        floatingBtn.innerText = "⏳ Saving...";
        floatingBtn.disabled = true;
        if(syncBtn) syncBtn.disabled = true;
        
        await savePreferencesToFirestore();
        
        state.isEditMode = false;
        state.hasEnteredTaskPin = false; 
        btn.innerText = "✏️ Edit Dashboard";
        btn.classList.remove('save-mode');
        btn.disabled = false;
        
        floatingBtn.style.display = 'none';
        
        if(syncBtn) {
            syncBtn.style.display = 'none';
            syncBtn.disabled = false;
        }
        viewAllBtn.style.display = 'inline-block';
        
        statusDiv.innerText = "";
        statusDiv.style.color = "var(--text-main)";
                
        renderTasks();
        
    }
}

async function savePreferencesToFirestore() {
    const targetUid = state.activeUsers[0];
    let batch = window.db.batch();
    let hasChanges = false;
    
    state.tasks.forEach(task => {
        const wantsItOnDash = state.tempEditPrefs.has(task.uid);
        const hasItCurrently = task.dashboardUsers && task.dashboardUsers.includes(targetUid);
        
        if (wantsItOnDash !== hasItCurrently) {
            hasChanges = true;
            let newUsersList = task.dashboardUsers ? [...task.dashboardUsers] : [];
            
            if (wantsItOnDash) newUsersList.push(targetUid);
            else newUsersList = newUsersList.filter(id => id !== targetUid);
            
            task.dashboardUsers = newUsersList;
            const docRef = window.db.collection('nipto_tasks').doc(task.uid);
            batch.update(docRef, { dashboardUsers: newUsersList });
        }
    });
    
    if (hasChanges) {
        try { await batch.commit(); } 
        catch (error) { console.error("Error saving preferences:", error); alert("Failed to save dashboard."); }
    }
}

// --- LEADERBOARD & HISTORY ---
async function updateLeaderboardUI() {
    try {
        const { points } = await api.getWeeklyPointsData();
        
        ALL_USERS.forEach(user => {
            const el = document.getElementById(`points-${user.uid}`);
            if (el) el.innerText = points[user.uid] + " pts";
        });
        
        document.querySelectorAll('.leader-crown').forEach(el => el.remove());
        
        let topUser = null;
        let maxPts = 0;
        
        ALL_USERS.forEach(user => {
            let userPts = points[user.uid] || 0;
            if (userPts > maxPts) {
                maxPts = userPts;
                topUser = user.uid;
            }
        });
        
        if (topUser && maxPts > 0) {
            const topUserElement = document.getElementById(`toggle-${topUser}`);
            if (topUserElement) topUserElement.innerHTML += '<div class="leader-crown">👑</div>';
        }
        
        let sortedUsers = ALL_USERS.map(u => ({ name: u.name, pts: points[u.uid], color: u.color })).sort((a, b) => b.pts - a.pts);
        let leaderboardHtml = sortedUsers.map((u, index) => {
            let medal = index === 0 ? '🥇 1.' : index === 1 ? '🥈 2. ' : index === 2 ? '🥉 3.' : `${index + 1}.`;
            return `<div><span style="color: var(--text-muted); margin-right: 3px;">${medal}</span> <span style="color: ${u.color}; font-weight: 800;">${u.name}: ${u.pts} pts</span></div>`;
        }).join('<div style="width: 1px; background: var(--border-color); margin: 0 10px;"></div>'); 
        
        const adultContainer = document.getElementById('leaderboard-container');
        if(adultContainer) adultContainer.innerHTML = leaderboardHtml;
        
        updateHistoryDisplay();
        syncRoutinesWithNiptoHistory();
        } catch (error) {
        if (error.message === "Token Expired") document.getElementById('pinModal').style.display = 'flex';
        console.error("Error drawing points:", error);
        document.getElementById('historyContainer').innerHTML = "<div class='empty-history'>Error loading history.</div>";
    }
}

function updateHistoryDisplay() {
    let filteredActivities = state.allWeekActivities;
    if (state.historyViewMode === 'boys') {
        filteredActivities = state.allWeekActivities.filter(act => 
            act.user && (act.user.uid === "NMRQaRQbvCwBaJbiMFId" || act.user.uid === "RMNUTP8VOHD9PDzNjf0g")
        );
    }
    renderHistory(filteredActivities);
}

function renderHistory(activities) {
    const container = document.getElementById('historyContainer');
    container.innerHTML = '';
    if (activities.length === 0) {
        container.innerHTML = '<div class="empty-history">No tasks found.</div>'; return;
    }
    
    activities.sort((a, b) => b.parsedDate - a.parsedDate);
    const timeOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit' };
    
    activities.forEach(act => {
        const knownUser = ALL_USERS.find(u => u.uid === (act.user && act.user.uid));
        const userName = knownUser ? knownUser.name : (act.user && act.user.name ? act.user.name : "Unknown User");
        const taskName = act.task ? act.task.name : "Deleted Task";
        const taskValue = act.awardedPts !== undefined ? act.awardedPts : (act.task ? act.task.value : 0);
        const color = knownUser ? knownUser.color : 'var(--text-muted)';
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'history-item';
        itemDiv.innerHTML = `
        <div class="history-item-content">
        <div class="history-task-name">${taskName}</div>
        <div class="history-details">
        <span style="color: ${color}; font-weight: bold;">${userName} (+${taskValue})</span>
        <span>${act.parsedDate.toLocaleDateString(undefined, timeOptions)}</span>
        </div>
        </div>
        <button class="delete-activity-btn" onclick="deleteTaskActivity('${act.uid}', this)" title="Delete Activity">🗑️</button>
        `;
        container.appendChild(itemDiv);
    });
}

// --- TASK LOGGING & NIPTO INTERACTIONS ---
// --- TOAST NOTIFICATIONS ---
const toastTimeouts = {};
const toastCounts = {};

function showToast(taskUid, taskName, points, namesString) {
    let container = document.getElementById('toast-container');
    if (!container) return;
    
    const toastId = `toast-${taskUid}`;
    let existingToast = document.getElementById(toastId);
    
    if (existingToast) {
        // Increment multiplier if tapped rapidly
        toastCounts[taskUid] = (toastCounts[taskUid] || 1) + 1;
        existingToast.innerHTML = `✅ Logged <b>${taskName}</b> for <b>${namesString}</b> (+${points} pts) <span style="background: white; color: var(--success, #22c55e); padding: 2px 6px; border-radius: 10px; font-weight: bold; margin-left: 5px; font-size: 12px;">x${toastCounts[taskUid]}</span>`;
        
        // Reset animation & timeout
        existingToast.style.animation = 'none';
        existingToast.offsetHeight; // Trigger reflow
        existingToast.style.animation = 'slideUpFade 0.2s ease-out';
        
        clearTimeout(toastTimeouts[taskUid]);
        toastTimeouts[taskUid] = setTimeout(() => {
            existingToast.remove();
            delete toastCounts[taskUid];
        }, 3000);
        } else {
        // Create new toast
        toastCounts[taskUid] = 1;
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.style.cssText = 'background: var(--success, #22c55e); color: white; padding: 12px 24px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-size: 14px; animation: slideUpFade 0.3s ease-out; transition: opacity 0.3s, transform 0.3s;';
        toast.innerHTML = `✅ Logged <b>${taskName}</b> for <b>${namesString}</b> (+${points} pts)`;
        container.appendChild(toast);
        
        toastTimeouts[taskUid] = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
            delete toastCounts[taskUid];
        }, 3000);
    }
}

// --- TASK LOGGING & NIPTO INTERACTIONS ---
async function logTask(buttonElement, taskUid, taskName) {
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return false; }
    
    if (state.activeUsers.length === 0) {
        alert("No users selected! Please select someone at the top of the dashboard.");
        return false;
    }
    
    // Immediate Visual Feedback
    buttonElement.style.transition = 'border 0.1s, transform 0.1s';
    buttonElement.style.border = '2px solid var(--success, #22c55e)';
    buttonElement.style.transform = 'scale(0.96)';
    setTimeout(() => { 
        buttonElement.style.border = ''; 
        buttonElement.style.transform = 'scale(1)';
    }, 250);
    
    const statusDiv = document.getElementById('status');
    let targetDate = state.currentMode === 'live' ? new Date() : new Date(document.getElementById('taskDate').value);
    
    if (state.currentMode !== 'live' && !document.getElementById('taskDate').value) {
        statusDiv.innerText = "Error: Please select a valid custom date/time.";
        statusDiv.style.color = 'var(--danger)';
        return false;
    }
    
    let namesString = state.activeUsers.map(uid => ALL_USERS.find(u=>u.uid===uid).name).join(', ');
    const taskObj = state.tasks.find(t => t.uid === taskUid);
    const points = taskObj ? Math.ceil(taskObj.value / state.currentSplitDivisor) : 0;
    
    try {
        const logPromise = api.logActivityToNipto(taskUid, targetDate.toISOString());
        showToast(taskUid, taskName, points, namesString);
        statusDiv.innerText = ""; 
        
        await logPromise; 
        
        // --- INSTANT ROUTINE CROSS-WIRE ---
        if (state.routines) {
            const linkedRoutines = state.routines.filter(r => r.linkedNiptoTask === taskUid);
            let requiresRoutineRender = false;
            
            for (const routine of linkedRoutines) {
                let newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
                let newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};
                
                if (routine.completionType === 'shared') {
                    newLastCompleted['shared'] = targetDate.toISOString();
                    newLastCompletedBy['shared'] = namesString;
                    } else {
                    state.activeUsers.forEach(uid => {
                        newLastCompleted[uid] = targetDate.toISOString();
                        const uObj = ALL_USERS.find(u=>u.uid===uid);
                        newLastCompletedBy[uid] = uObj ? uObj.name : "Unknown";
                    });
                }
                
                routine.lastCompleted = newLastCompleted;
                routine.lastCompletedBy = newLastCompletedBy;
                requiresRoutineRender = true;
                
                // Update Firebase quietly in the background
                api.updateFirestoreDocument('routines', routine.uid, {
                    lastCompleted: newLastCompleted,
                    lastCompletedBy: newLastCompletedBy
                }).catch(e => console.error("Routine auto-update failed:", e));
            }
            
            // Immediately redraw the UI so the routine vanishes from the sidebar
            if (requiresRoutineRender) {
                if (typeof renderRoutines === 'function') renderRoutines();
                if (typeof renderSidebarRoutines === 'function') renderSidebarRoutines();
            }
        }
        // ---------------------------------
        
        updateLeaderboardUI();
        return true;
        } catch (error) {
        statusDiv.innerText = `Error logging ${taskName}: ${error.message}`;
        statusDiv.style.color = 'var(--danger)';
        return false;
    }
}
async function deleteTaskActivity(activityUid, btnElement) {
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return; }
    if (!confirm("Are you sure you want to delete this logged task?")) return;
    
    const statusDiv = document.getElementById('status');
    const originalHtml = btnElement.innerHTML;
    btnElement.disabled = true;
    btnElement.innerHTML = "⏳";
    
    try {
        await api.deleteActivityFromNipto(activityUid);
        
        const linkedChore = state.customChores.find(c => (c.completedActivityUids && c.completedActivityUids.includes(activityUid)) || c.completedActivityUid === activityUid);
        if (linkedChore) {
            await api.updateFirestoreDocument('custom_chores', linkedChore.uid, { 
                completed: false, 
                completedActivityUid: null, 
                completedActivityUids: [], 
                completedInfo: window.firebase.firestore.FieldValue.delete() 
            });
            await api.loadChoresFromFirestore();
            
        }
        
        statusDiv.innerText = `Activity deleted successfully!`;
        statusDiv.style.color = 'var(--success)';
        updateLeaderboardUI();
        setTimeout(() => { statusDiv.innerText = ""; statusDiv.style.color = 'var(--text-main)'; }, 3000);
        
        } catch (error) {
        console.error("Delete Error:", error);
        statusDiv.innerText = `Error: ${error.message}`;
        statusDiv.style.color = 'var(--danger)';
        btnElement.disabled = false;
        btnElement.innerHTML = originalHtml;
    }
}

function handleTaskClick(btn, taskUid, taskName) {
    if (state.isEditMode) {
        if (state.tempEditPrefs.has(taskUid)) {
            state.tempEditPrefs.delete(taskUid);
            btn.classList.remove('selected-pref');
            btn.classList.add('unselected-pref');
            } else {
            state.tempEditPrefs.add(taskUid);
            btn.classList.add('selected-pref');
            btn.classList.remove('unselected-pref');
        }
        } else {
        logTask(btn, taskUid, taskName);
    }
}

async function togglePinTask(taskUid) {
    const task = state.tasks.find(t => t.uid === taskUid);
    if (!task) return;
    
    const targetUid = state.activeUsers[0];
    if(!targetUid) return;
    
    let pinned = task.pinnedUsers ? [...task.pinnedUsers] : [];
    if (pinned.includes(targetUid)) pinned = pinned.filter(id => id !== targetUid);
    else pinned.push(targetUid);
    
    task.pinnedUsers = pinned;
    renderTasks();
    renderPinnedTasks();
    
    try { 
        await api.updateFirestoreDocument('nipto_tasks', taskUid, { pinnedUsers: pinned });
    } catch (error) { console.error("Error updating pin:", error); }
}

async function logPinnedTask(btnElement, taskUid, taskName) {
    await logTask(btnElement, taskUid, taskName);
}

function populateTaskPointsSelect(selectedValue = '') {
    const select = document.getElementById('taskPoints');
    if (!select) return;
    select.innerHTML = '<option value="">-- No Points --</option>';

    if (!state.tasks || state.tasks.length === 0) return;

    // Find all "Assigned task" entries from the synced Nipto database
    const pointTasks = state.tasks.filter(t =>
        t.name && t.name.toLowerCase().startsWith('assigned task')
    );

    // Sort by point value ascending (5, 10, 15, ...)
    pointTasks.sort((a, b) => (a.value || 0) - (b.value || 0));

    pointTasks.forEach(t => {
        const selected = (t.uid === selectedValue) ? 'selected' : '';
        select.innerHTML += `<option value="${t.uid}" ${selected}>${t.value} Points</option>`;
    });
}
// --- RENDER TASKS ---
function renderTasks() {
    const container = document.getElementById('mainContainer');
    container.innerHTML = ''; 
    
    let visibleTasks = [];
    if (state.isEditMode || state.isViewAllMode) {
        visibleTasks = state.tasks;
        } else {
        visibleTasks = state.tasks.filter(t => {
            return state.activeUsers.some(uid => t.dashboardUsers && t.dashboardUsers.includes(uid));
        });
    }
    
    if (visibleTasks.length === 0 && !state.isEditMode) {
        container.innerHTML = '<div class="empty-dashboard-msg">Your dashboard is empty. Click the pencil icon to add tasks!</div>';
        return;
    }
    
    const groupedTasks = visibleTasks.reduce((acc, task) => {
        if (!acc[task.category]) acc[task.category] = [];
        acc[task.category].push(task);
        return acc;
    }, {});
    
    let savedOrder = state.userPrefs.niptoSortOrder || [];
    let keys = Object.keys(groupedTasks);
    
    keys.sort((a, b) => {
        let idxA = savedOrder.indexOf(a);
        let idxB = savedOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });
    
    keys.forEach(category => {
        const section = document.createElement('div');
        section.className = 'category-section';
        
        // Read cloud preference for collapsed state
        const isCatCollapsed = state.userPrefs.collapsed && state.userPrefs.collapsed[`nipto_${category}`] === true;
        
        const orderControls = `<span class="sort-controls" style="font-size: 14px; margin-left: 10px; opacity: 0.5;">
        <button onclick="moveCategory('${category}', -1, 'nipto', event)" style="cursor:pointer; background:none; border:none;" title="Move Up">▲</button>
        <button onclick="moveCategory('${category}', 1, 'nipto', event)" style="cursor:pointer; background:none; border:none;" title="Move Down">▼</button>
        </span>`;
        
        const header = document.createElement('h3');
        header.className = 'category-header collapsible-header';
        header.innerHTML = `${category} ${orderControls} <span class="toggle-icon ${isCatCollapsed ? 'collapsed' : ''}" style="margin-left: auto;">▼</span>`;
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        
        const gridWrapper = document.createElement('div');
        gridWrapper.className = `collapsible-content ${isCatCollapsed ? 'collapsed' : ''}`;
        
        header.onclick = (e) => {
            if(e.target.tagName === 'BUTTON') return;
            const collapsed = gridWrapper.classList.toggle('collapsed');
            header.querySelector('.toggle-icon').classList.toggle('collapsed', collapsed);
            saveCloudCollapsed(`nipto_${category}`, collapsed); // Save to cloud
        };
        
        section.appendChild(header);
        
        const grid = document.createElement('div');
        grid.className = 'task-grid';
        
        groupedTasks[category].forEach(task => {
            const btn = document.createElement('button');
            btn.className = 'task-btn';
            
            const displayValue = Math.ceil(task.value / state.currentSplitDivisor);
            const taskContentHtml = `<span>${task.name}</span><span style="display:block; margin-top:5px; font-weight:bold; color:var(--primary); font-size:13px;">${displayValue} pts</span>`;
            
            if (state.isEditMode) {
                btn.classList.add('edit-mode');
                if (state.tempEditPrefs.has(task.uid)) {
                    btn.classList.add('selected-pref');
                    btn.innerHTML = `${taskContentHtml}<span style="font-size:12px; margin-top:5px; display:block;">✅ Selected</span>`;
                    } else {
                    btn.classList.add('unselected-pref');
                    btn.innerHTML = `${taskContentHtml}<span style="font-size:12px; margin-top:5px; display:block;">❌ Hidden</span>`;
                }
                
                // PIN BUTTON INJECTED ONLY IN EDIT MODE
                const targetUid = state.activeUsers[0];
                const isPinned = targetUid && task.pinnedUsers && task.pinnedUsers.includes(targetUid);
                const pinBtn = document.createElement('button');
                pinBtn.className = `pin-task-btn ${isPinned ? 'active' : ''}`;
                pinBtn.innerHTML = '📌';
                pinBtn.title = isPinned ? "Unpin task" : "Pin task to reminders";
                pinBtn.onclick = (e) => {
                    e.stopPropagation(); 
                    if(state.activeUsers.length > 1) { alert("You can only pin tasks when a single person is selected at the top."); return;}
                    togglePinTask(task.uid);
                };
                btn.appendChild(pinBtn);
                } else {
                btn.innerHTML = taskContentHtml;
            }
            
            btn.setAttribute('data-original-html', btn.innerHTML);
            btn.onclick = () => handleTaskClick(btn, task.uid, task.name);
            grid.appendChild(btn);
        });
        
        gridWrapper.appendChild(grid);
        section.appendChild(gridWrapper);
        container.appendChild(section);
    });
}

function renderPinnedTasks() {
    const container = document.getElementById('pinnedContainer');
    container.innerHTML = '';
    
    const targetUid = state.activeUsers[0]; 
    const myPinnedTasks = state.tasks.filter(t => t.pinnedUsers && t.pinnedUsers.includes(targetUid));
    
    if (myPinnedTasks.length === 0) {
        container.innerHTML = '<div class="empty-history" style="margin-top: 10px;">No pinned tasks.</div>';
        return;
    }
    
    myPinnedTasks.forEach(task => {
        const displayValue = Math.ceil(task.value / state.currentSplitDivisor);
        const card = document.createElement('div');
        card.className = 'chore-card';
        card.innerHTML = `
        <div class="chore-header">
        <div class="chore-title-area">
        <div class="chore-title">📌 ${task.name}</div>
        <div class="chore-points">+${displayValue} pts</div>
        </div>
        <div class="chore-actions">
        <button class="chore-btn complete-btn" onclick="logPinnedTask(this, '${task.uid}', '${task.name}')" title="Log Task">✅</button>
        <button class="chore-btn delete-btn" onclick="togglePinTask('${task.uid}')" title="Unpin">❌</button>
        </div>
        </div>
        `;
        container.appendChild(card);
    });
}


function renderTodoTasks() {
    const container = document.getElementById('todoContainer');
    const viewSelect = document.getElementById('viewSelect');
    const viewBy = viewSelect ? viewSelect.value : 'category';
    container.innerHTML = '';
    
    if (!state.todoTasksData || state.todoTasksData.length === 0) {
        container.innerHTML = '<div class="empty-dashboard-msg" style="padding: 20px; text-align: center; color: var(--text-muted);">No general tasks found. Click "Add Task" to get started.</div>';
        return;
    }
    
    const grouped = state.todoTasksData.reduce((acc, task) => {
        const key = task[viewBy] || 'Uncategorized';
        if (!acc[key]) acc[key] = [];
        acc[key].push(task);
        return acc;
    }, {});
    
    // Sort categories based on User's saved preference
    let activeUser = state.activeUsers[0] || 'default';
    let savedOrder = JSON.parse(localStorage.getItem(`todo_sort_order_${activeUser}`) || '[]');
    let keys = Object.keys(grouped);
    
    keys.sort((a, b) => {
        let idxA = savedOrder.indexOf(a);
        let idxB = savedOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });
    
    keys.forEach(key => {
        const section = document.createElement('div');
        section.className = 'group-section category-section';
        
        // Track collapsibility per user
        const isCatCollapsed = localStorage.getItem(`todo_cat_${activeUser}_${key}`) === 'true';
        
        // Custom Sort Arrows HTML
        const orderControls = `<span class="sort-controls" style="font-size: 14px; margin-left: 10px; opacity: 0.5;">
        <button onclick="moveCategory('${key}', -1, 'todo', event)" style="cursor:pointer; background:none; border:none;" title="Move Up">▲</button>
        <button onclick="moveCategory('${key}', 1, 'todo', event)" style="cursor:pointer; background:none; border:none;" title="Move Down">▼</button>
        </span>`;
        
        const header = document.createElement('h3');
        header.className = 'category-header collapsible-header';
        header.innerHTML = `${key} ${orderControls} <span class="toggle-icon ${isCatCollapsed ? 'collapsed' : ''}" style="margin-left: auto;">▼</span>`;
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.color = 'var(--primary)';
        header.style.textTransform = 'capitalize';
        
        const contentWrapper = document.createElement('div');
        contentWrapper.className = `collapsible-content ${isCatCollapsed ? 'collapsed' : ''}`;
        
        header.onclick = (e) => {
            if(e.target.tagName === 'BUTTON') return; // Ignore clicks on the arrow buttons
            const collapsed = contentWrapper.classList.toggle('collapsed');
            header.querySelector('.toggle-icon').classList.toggle('collapsed', collapsed);
            saveCloudCollapsed("todo_" + key, collapsed)
        };
        
        section.appendChild(header);
        grouped[key].sort((a, b) => {
            // 1. Completed items drop to the bottom
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            
            // 2. Individual tasks above multi-person tasks
            const aIsIndividual = (a.assignees || []).length === 1;
            const bIsIndividual = (b.assignees || []).length === 1;
            if (aIsIndividual && !bIsIndividual) return -1;
            if (!aIsIndividual && bIsIndividual) return 1;
            
            return 0;
        });
        
        grouped[key].forEach(task => {
            const card = document.createElement('div');
            card.className = `chore-card ${task.completed ? 'completed' : ''}`;
            
            // Calculate actual points if linked
            let pointsDisplay = '';
            if (task.linkedNiptoTask && task.linkedNiptoTask !== 'null') {
                const linkedTaskInfo = state.tasks.find(t => t.uid === task.linkedNiptoTask);
                const pts = linkedTaskInfo ? Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor) : '?';
                pointsDisplay = `<span style="color: var(--primary); font-size: 11px; font-weight: bold; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">⭐ ${pts} pts</span>`;
            }
            
            // Build Assignees HTML
            let assigneesHtml = '';
            if (task.assignees && task.assignees.length > 0) {
                assigneesHtml = task.assignees.map(uid => {
                    const u = ALL_USERS.find(user => user.uid === uid);
                    return u ? `<span style="color: ${u.color}; font-size: 11px; font-weight: bold; margin-right: 4px; background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">👤 ${u.name}</span>` : '';
                }).join('');
            }
            
            const linkedTaskArg = task.linkedNiptoTask ? `'${task.linkedNiptoTask}'` : 'null';
            
            card.innerHTML = `
            <div class="chore-header">
            <div class="chore-title-area">
            <div class="chore-title" style="${task.completed ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">${task.name}</div>
            <div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
            <span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">📁 ${task.category || 'None'}</span>
            <span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">📍 ${task.location || 'N/A'}</span>
            <span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">⚡ ${task.priority}</span>
            ${assigneesHtml}
            ${pointsDisplay}
            </div>
            </div>
            <div class="chore-actions">
            <button class="chore-btn complete-btn" onclick="toggleTaskStatus('${task.id}', ${task.completed}, ${linkedTaskArg})" title="Mark Complete/Incomplete">
            ${task.completed ? '⏪' : '✅'}
            </button>
            <button class="chore-btn" onclick="editTask('${task.id}')" title="Edit">✏️</button>
            <button class="chore-btn delete-btn" onclick="deleteTask('${task.id}')" title="Delete">🗑️</button>
            </div>
            </div>
            ${task.notes ? `<div class="chore-desc" style="display: block; margin-top: 8px;">${task.notes}</div>` : ''}
            `;
            contentWrapper.appendChild(card);
        });
        section.appendChild(contentWrapper);
        container.appendChild(section);
    });
}

function updateTaskDatalists() {
    const categories = new Set();
    const locations = new Set();
    
    // Pull from General To-Do Tasks
    if (state.todoTasksData) {
        state.todoTasksData.forEach(task => {
            if (task.category && task.category.trim() !== "") categories.add(task.category.trim());
            if (task.location && task.location.trim() !== "") locations.add(task.location.trim());
        });
    }
    
    // Pull categories from Nipto Tasks
    if (state.tasks) {
        state.tasks.forEach(task => {
            if (task.category && task.category.trim() !== "" && task.category !== "📌") {
                categories.add(task.category.trim());
            }
        });
    }
    
    const catDatalist = document.getElementById('categoryOptions');
    const locDatalist = document.getElementById('locationOptions');
    
    if (catDatalist) {
        catDatalist.innerHTML = Array.from(categories).sort().map(c => `<option value="${c}"></option>`).join('');
    }
    if (locDatalist) {
        locDatalist.innerHTML = Array.from(locations).sort().map(l => `<option value="${l}"></option>`).join('');
    }
}


function openTaskModal() {
    document.getElementById('taskModalTitle').innerText = "Add Task";
    document.getElementById('taskId').value = '';
    document.getElementById('taskName').value = '';
    document.getElementById('taskCategory').value = '';
    document.getElementById('taskLocation').value = '';
    document.getElementById('taskPriority').value = 'Medium';
    document.getElementById('taskNotes').value = '';
    populateTodoAssignees([]);
    updateTaskDatalists();
    populateTaskPointsSelect('');  // NEW: Dynamic population

    document.getElementById('taskModal').style.display = 'flex';
}
function editTask(id) {
    const task = state.todoTasksData.find(t => t.id === id);
    if (!task) return;

    document.getElementById('taskModalTitle').innerText = "Edit Task";
    document.getElementById('taskId').value = task.id;
    document.getElementById('taskName').value = task.name || '';
    document.getElementById('taskCategory').value = task.category || '';
    document.getElementById('taskLocation').value = task.location || '';
    document.getElementById('taskPriority').value = task.priority || 'Medium';
    document.getElementById('taskNotes').value = task.notes || '';
    populateTodoAssignees(task.assignees || []);
    updateTaskDatalists();
    populateTaskPointsSelect(task.linkedNiptoTask || '');  // NEW: Pre-select saved value

    document.getElementById('taskModal').style.display = 'flex';
}

window.populateTaskPointsSelect = populateTaskPointsSelect;
function formatRoutineAssignees(routine, compact = false) {
    const assignees = routine.assignees || [];
    const fontSize = compact ? '10px' : '11px';
    const baseStyle = `font-size: ${fontSize}; font-weight: bold; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color);`;

    // ── EVERYONE assigned → "Anyone" ──
    if (assignees.length >= ALL_USERS.length) {
        return `<span style="color: var(--text-muted); ${baseStyle}">👥 Anyone</span>`;
    }

    // ── INDIVIDUAL: Only show the active user's name ──
    if (routine.completionType === 'individual') {
        const myUids = state.activeUsers.filter(uid => assignees.includes(uid));
        if (myUids.length > 0) {
            return myUids.map(uid => {
                const u = ALL_USERS.find(user => user.uid === uid);
                return u ? `<span style="color: ${u.color}; ${baseStyle}">👤 ${u.name}</span>` : '';
            }).join(' ');
        }
        // Fallback if viewing someone not assigned
        return `<span style="color: var(--text-muted); ${baseStyle}">👤 Individual</span>`;
    }

    // ── SHARED with a subset → "Name or Name or Name" ──
    const names = assignees.map(uid => {
        const u = ALL_USERS.find(user => user.uid === uid);
        return u ? u.name : 'Unknown';
    });
    return `<span style="color: var(--text-muted); ${baseStyle}">👥 ${names.join(' or ')}</span>`;
}
async function saveTask() {
    const id = document.getElementById('taskId').value;
    const assignees = Array.from(document.querySelectorAll('.todo-assignee-cb:checked')).map(cb => cb.value);
    
    const taskData = {
        name: document.getElementById('taskName').value.trim(),
        category: document.getElementById('taskCategory').value.trim(),
        location: document.getElementById('taskLocation').value.trim(),
        priority: document.getElementById('taskPriority').value,
        linkedNiptoTask: document.getElementById('taskPoints').value || null,
        notes: document.getElementById('taskNotes').value.trim(),
        assignees: assignees 
    };
    
    if (!taskData.name) { alert("Task name is required!"); return; }
    
    if (id) {
        await api.updateFirestoreDocument('custom_tasks', id, taskData);
        } else {
        taskData.completed = false;
        await api.addFirestoreDocument('custom_tasks', taskData);
    }
    closeTaskModal();
}

function closeTaskModal() {
    document.getElementById('taskModal').style.display = 'none';
}


async function deleteTask(id) {
    if (confirm("Are you sure you want to delete this task?")) {
        await api.deleteFirestoreDocument('custom_tasks', id);
    }
}

async function toggleTaskStatus(taskId, currentStatus, linkedNiptoTask) {
    if (!currentStatus && linkedNiptoTask && linkedNiptoTask !== 'null') {
        if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return; }
        if (state.activeUsers.length === 0) { alert("Select who completed this task at the top of the dashboard first!"); return; }
        
        let targetDate = state.currentMode === 'live' ? new Date() : new Date(document.getElementById('taskDate').value);
        
        try {
            const activityUids = await api.logActivityToNipto(linkedNiptoTask, targetDate.toISOString());
            await api.updateFirestoreDocument('custom_tasks', taskId, { 
                completed: true,
                completedActivityUids: activityUids,
                completedBy: state.activeUsers,
                completedAt: targetDate.toISOString() // Add this!
            });
            updateLeaderboardUI();
        } catch (error) { alert("Error awarding points: " + error.message); }
        } else {
        // Handling unlinked tasks or un-checking tasks
        await api.updateFirestoreDocument('custom_tasks', taskId, { 
            completed: !currentStatus,
            completedAt: !currentStatus ? new Date().toISOString() : null // Add this!
        });
    }
} // <-- This is the missing closing brace!


// --- UTILS & TIME LOGIC ---
function decodeKey(pin) {
    const masked = "$a#0$*fa-*a07-%%f%-a%*%-f*c8$9c*%8*8";
    const p1 = pin[0], p2 = pin[1], p3 = pin[2], p4 = pin[3];
    return masked.replace(/\*/g, p1).replace(/#/g, p2).replace(/\$/g, p3).replace(/%/g, p4);
}

function savePin(onSuccessCallback) {
    const pin = document.getElementById('pinInput').value;
    if (pin.length !== 4) {
        document.getElementById('pinError').style.display = 'block';
        return;
    }
    state.apiToken = decodeKey(pin);
    localStorage.setItem("nipto_api_token", state.apiToken); 
    document.getElementById('pinModal').style.display = 'none';
    
    if (onSuccessCallback) onSuccessCallback();
}

function switchTab(tabName) {
    // Reset all tabs to inactive styles
    ['nipto', 'routines', 'todo'].forEach(t => {
        const tabBtn = document.getElementById(`tab-${t}`);
        if(tabBtn) {
            tabBtn.style.backgroundColor = 'var(--card-bg)';
            tabBtn.style.color = 'var(--text-main)';
            tabBtn.classList.remove('active');
        }
        const pane = document.getElementById(`pane-${t}`);
        if(pane) pane.style.display = 'none';
    });
    
    // Apply active styles to selected tab
    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) {
        activeBtn.style.backgroundColor = 'var(--primary)';
        activeBtn.style.color = 'white';
        activeBtn.classList.add('active');
    }
    
    const activePane = document.getElementById(`pane-${tabName}`);
    if (activePane) activePane.style.display = 'block';
}

function formatForInput(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const h = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
}

function setMode(mode) {
    if (state.isEditMode) return; 
    state.currentMode = mode;
    if (mode === 'live') {
        document.getElementById('btnLive').classList.add('active');
        document.getElementById('btnCustom').classList.remove('active');
        document.getElementById('customTimeBox').classList.remove('visible');
        } else {
        document.getElementById('btnCustom').classList.add('active');
        document.getElementById('btnLive').classList.remove('active');
        document.getElementById('customTimeBox').classList.add('visible');
        const dateInput = document.getElementById('taskDate');
        if (!dateInput.value) dateInput.value = formatForInput(new Date());
    }
}

function setTimeOffset(minutes) {
    if (state.currentMode === 'live') setMode('custom');
    const dateInput = document.getElementById('taskDate');
    
    let targetDate = dateInput.value ? new Date(dateInput.value) : new Date();
    targetDate.setMinutes(targetDate.getMinutes() + minutes);
    dateInput.value = formatForInput(targetDate);
}



function toggleSection(contentId, iconId, storageKey) {
    const content = document.getElementById(contentId);
    const icon = document.getElementById(iconId);
    if (!content || !icon) return;
    const isCollapsed = content.classList.toggle('collapsed');
    icon.classList.toggle('collapsed', isCollapsed);
    if (storageKey) localStorage.setItem(storageKey, isCollapsed);
}

function initCollapsibles(sectionsArray) {
    sectionsArray.forEach(sec => {
        if (localStorage.getItem(sec.key) === 'true') {
            const content = document.getElementById(sec.content);
            const icon = document.getElementById(sec.icon);
            if (content) content.classList.add('collapsed');
            if (icon) icon.classList.add('collapsed');
        }
    });
}

// --- MULTI-THEME LOGIC ---
const THEMES = {
    'boring': null, 
    'pixel': 'minecraft.css',
    'tactical': 'blackops.css',
    'homestead': 'homestead.css'
};

let currentTheme = localStorage.getItem('nipto_theme') || 'boring';
if (currentTheme === 'fun') currentTheme = 'pixel';

function initTheme() { applyTheme(currentTheme); }

function toggleThemeMenu() {
    const menu = document.getElementById('themeMenu');
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
}


function setTheme(themeId) {
    const activeUid = state.activeUsers[0];
    if (state.isTogetherMode || !activeUid) {
        alert("Please select a specific person first to save their theme preference.");
        return;
    }
    saveCloudPreference('theme', themeId);
    applyTheme(themeId);
    document.getElementById('themeMenu').style.display = 'none';
}

function setHistoryView(mode, skipSave = false) {
    state.historyViewMode = mode;
    const btnBoys = document.getElementById('htBoys');
    const btnEveryone = document.getElementById('htEveryone');
    if (btnBoys) btnBoys.classList.toggle('active', mode === 'boys');
    if (btnEveryone) btnEveryone.classList.toggle('active', mode === 'everyone');
    
    updateHistoryDisplay();
    if (!skipSave) saveCloudPreference('historyView', mode);
}

window.moveCategory = function(category, direction, type, event) {
    event.stopPropagation(); 
    
    let savedOrder = (type === 'todo') ? (state.userPrefs.todoSortOrder || []) : (state.userPrefs.niptoSortOrder || []);
    
    if (savedOrder.length === 0) {
        const containerId = type === 'todo' ? 'todoContainer' : 'mainContainer';
        const container = document.getElementById(containerId);
        savedOrder = Array.from(container.querySelectorAll('.category-header'))
        .map(el => el.childNodes[0].textContent.trim());
    }
    
    const idx = savedOrder.indexOf(category);
    if (idx === -1) return;
    
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= savedOrder.length) return; 
    
    [savedOrder[idx], savedOrder[newIdx]] = [savedOrder[newIdx], savedOrder[idx]];
    
    if (type === 'todo') {
        saveCloudPreference('todoSortOrder', savedOrder);
        renderTodoTasks();
        } else {
        saveCloudPreference('niptoSortOrder', savedOrder);
        renderTasks();
    }
};

function applyTheme(themeId) {
    let link = document.getElementById('dynamic-theme-css');
    if (link) link.remove();
    
    if (THEMES[themeId]) {
        link = document.createElement('link');
        link.id = 'dynamic-theme-css';
        link.rel = 'stylesheet';
        link.href = THEMES[themeId];
        document.head.appendChild(link);
    }
    
    document.querySelectorAll('.theme-option').forEach(btn => btn.classList.remove('active-theme'));
    const activeBtn = document.getElementById(`theme-opt-${themeId}`);
    if (activeBtn) activeBtn.classList.add('active-theme');
}

document.addEventListener('click', function(event) {
    const container = document.querySelector('.theme-selector-container');
    const menu = document.getElementById('themeMenu');
    if (container && !container.contains(event.target) && menu) {
        menu.style.display = 'none';
    }
});


// ==========================================
// INITIALIZATION
// ==========================================
initUsers();
initCollapsibles([
    { content: 'activity-content', icon: 'activity-icon', key: 'nipto_merged_act_collapsed' },
    { content: 'pinned-content', icon: 'pin-icon', key: 'nipto_merged_pin_collapsed' },
    { content: 'assigned-content', icon: 'assign-icon', key: 'nipto_merged_assign_collapsed' }
]);

api.checkAuth(
    async () => { 
        await api.loadTasksFromFirestore(); 
        await api.loadChoresFromFirestore(); 
        await api.loadRoutinesFromFirestore(); 
        
        renderTasks();
        renderPinnedTasks();
        
        renderRoutines(); 
        renderSidebarRoutines(); 
        updateLeaderboardUI();
        
        // The updated snapshot listener belongs INSIDE this first success block
        window.db.collection('custom_tasks').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
            state.todoTasksData = [];
            const now = Date.now();
            const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
            
            snapshot.forEach(doc => {
                const data = doc.data();
                
                // Check if completed and older than 2 days
                if (data.completed && data.completedAt) {
                    const completedTime = new Date(data.completedAt).getTime();
                    if (now - completedTime > TWO_DAYS_MS) {
                        // Delete from DB completely
                        api.deleteFirestoreDocument('custom_tasks', doc.id);
                        return; // Skip adding to the dashboard
                    }
                }
                
                state.todoTasksData.push({ id: doc.id, ...data });
            });
            renderTodoTasks(); 
            renderSidebarTodos(); 
        });
    },
    () => { document.getElementById('pinModal').style.display = 'flex'; },
    (error) => { console.error("Database Auth Failed."); }
); // <-- This was the missing closing parenthesis and semicolon!

// ==========================================
// WINDOW BINDINGS (CRITICAL FOR ES6 MODULES)
// ==========================================
window.setActiveUser = setActiveUser;
window.toggleTogetherMode = toggleTogetherMode;
window.processTogetherSelection = processTogetherSelection;
window.toggleViewAll = toggleViewAll;
window.toggleEditMode = toggleEditMode;
window.deleteTaskActivity = deleteTaskActivity;
window.togglePinTask = togglePinTask;
window.logPinnedTask = logPinnedTask;
window.openTaskModal = openTaskModal;
window.closeTaskModal = closeTaskModal;
window.editTask = editTask;
window.saveTask = saveTask;
window.deleteTask = deleteTask;
window.toggleTaskStatus = toggleTaskStatus;
window.renderTodoTasks = renderTodoTasks;
window.savePin = savePin;
window.switchTab = switchTab;
window.setMode = setMode;
window.setTimeOffset = setTimeOffset;
window.setHistoryView = setHistoryView;
window.toggleSection = toggleSection;
window.toggleThemeMenu = toggleThemeMenu;
window.setTheme = setTheme;
window.updateTaskDatalists = updateTaskDatalists;
window.openRoutineModal = openRoutineModal;
window.closeRoutineModal = closeRoutineModal;
window.toggleRoutineFrequencyFields = toggleRoutineFrequencyFields;
window.saveRoutine = saveRoutine;

// ==========================================
// HTML BUTTON BRIDGES
// ==========================================
window.submitPin = async () => {
    savePin();
    await api.loadTasksFromFirestore();
    renderTasks();
    renderPinnedTasks();
    updateLeaderboardUI();
};

window.runSync = async () => {
    if (typeof syncNiptoTasks === 'function') {
        await syncNiptoTasks();             // 1. Run your sync script
        await api.loadTasksFromFirestore(); // 2. Pull the fresh data
        renderTasks();                      // 3. Redraw the UI
        renderPinnedTasks();
        } else {
        alert("Sync script not loaded.");
    }
};



function populateTodoAssignees(selectedUids = []) {
    const container = document.getElementById('todoAssignees');
    container.innerHTML = '';
    ALL_USERS.forEach(u => {
        const isChecked = selectedUids.includes(u.uid) ? 'checked' : '';
        container.innerHTML += `
        <label style="font-size: 13px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
        <input type="checkbox" value="${u.uid}" class="todo-assignee-cb" ${isChecked}> ${u.name}
        </label>`;
    });
}

// ==========================================
// ROUTINE MODAL LOGIC (PHASE 2)
// ==========================================
function openRoutineModal() {
    document.getElementById('routineModalTitle').innerText = "Add Routine";
    document.getElementById('routineId').value = '';
    document.getElementById('routineName').value = '';
    document.getElementById('routineType').value = 'shared';
    document.getElementById('routineFrequency').value = 'daily';

    document.getElementById('routineDailyReset').value = 'midnight';
    document.getElementById('routineSpecificTimes').value = '';
    document.querySelectorAll('.routine-day-cb').forEach(cb => cb.checked = false);
    document.getElementById('routineIntervalValue').value = '1';
    document.getElementById('routineIntervalUnit').value = 'months';

    // NEW: Reset overdue fields to defaults
    document.getElementById('routineOverdueValue').value = '14';
    document.getElementById('routineOverdueUnit').value = 'hours';

    populateRoutineAssignees([]);
    populateRoutinePointsSelect();
    toggleRoutineFrequencyFields(); // This now also calls updateOverdueDefaults()

    document.getElementById('routineModal').style.display = 'flex';
}

function closeRoutineModal() {
    document.getElementById('routineModal').style.display = 'none';
}

function editRoutine(routineId) {
    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine) return;

    document.getElementById('routineModalTitle').innerText = "Edit Routine";
    document.getElementById('routineId').value = routine.uid;
    document.getElementById('routineName').value = routine.name;
    document.getElementById('routineType').value = routine.completionType;
    document.getElementById('routineFrequency').value = routine.schedule.type;

    const freq = routine.schedule.type;
    if (freq === 'daily') {
        document.getElementById('routineDailyReset').value = routine.schedule.resetType || 'midnight';
        if (routine.schedule.resetType === 'specific') {
            document.getElementById('routineSpecificTimes').value = (routine.schedule.specificTimes || []).join(', ');
        }
    } else if (freq === 'weekly') {
        document.querySelectorAll('.routine-day-cb').forEach(cb => {
            cb.checked = (routine.schedule.daysOfWeek || []).includes(parseInt(cb.value));
        });
    } else if (freq === 'interval') {
        document.getElementById('routineIntervalValue').value = routine.schedule.value || 1;
        document.getElementById('routineIntervalUnit').value = routine.schedule.unit || 'months';
    }

    populateRoutineAssignees(routine.assignees || []);
    populateRoutinePointsSelect();
    document.getElementById('routinePoints').value = routine.linkedNiptoTask || '';

    toggleRoutineFrequencyFields(); // Sets defaults first

    // NEW: Override with saved value if one exists
    if (routine.overdueAfterHours != null) {
        const hours = routine.overdueAfterHours;
        if (hours >= 24 && hours % 24 === 0) {
            document.getElementById('routineOverdueValue').value = hours / 24;
            document.getElementById('routineOverdueUnit').value = 'days';
        } else {
            document.getElementById('routineOverdueValue').value = hours;
            document.getElementById('routineOverdueUnit').value = 'hours';
        }
        document.getElementById('overdueHint').textContent = 'Using your custom setting';
    }

    document.getElementById('routineModal').style.display = 'flex';
}
// Don't forget to bind it to the window!
window.editRoutine = editRoutine;
function toggleRoutineFrequencyFields() {
    const freq = document.getElementById('routineFrequency').value;
    const dailyReset = document.getElementById('routineDailyReset').value;

    document.getElementById('freqDailyFields').style.display = freq === 'daily' ? 'block' : 'none';
    document.getElementById('freqWeeklyFields').style.display = freq === 'weekly' ? 'block' : 'none';
    document.getElementById('freqIntervalFields').style.display = freq === 'interval' ? 'block' : 'none';
    document.getElementById('dailySpecificTimes').style.display = (freq === 'daily' && dailyReset === 'specific') ? 'block' : 'none';

    // NEW: Auto-update overdue defaults when frequency changes
    updateOverdueDefaults();
}

function populateRoutineAssignees(selectedUids = []) {
    const container = document.getElementById('routineAssignees');
    container.innerHTML = '';
    
    // Uses your existing ALL_USERS state
    ALL_USERS.forEach(u => {
        const isChecked = selectedUids.includes(u.uid) ? 'checked' : '';
        container.innerHTML += `
        <label style="font-size: 13px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
        <input type="checkbox" value="${u.uid}" class="routine-assignee-cb" ${isChecked}> ${u.name}
        </label>`;
    });
}

function populateRoutinePointsSelect() {
    const select = document.getElementById('routinePoints');
    select.innerHTML = '<option value="">-- No Points --</option>';
    
    if (!state.tasks || state.tasks.length === 0) return;
    
    // 1. Group all database tasks by their category
    const groupedTasks = state.tasks.reduce((acc, task) => {
        // Fallback to 'Uncategorized' if a task somehow lacks a category
        const categoryName = task.category || task.group || 'Uncategorized';
        
        // Skip the temporary pinned category if it exists
        if (categoryName === "📌") return acc;
        
        if (!acc[categoryName]) {
            acc[categoryName] = [];
        }
        acc[categoryName].push(task);
        return acc;
    }, {});
    
    // 2. Sort the categories alphabetically so the dropdown is organized
    const sortedCategories = Object.keys(groupedTasks).sort((a, b) => a.localeCompare(b));
    
    // 3. Build the <optgroup> for each category
    sortedCategories.forEach(category => {
        const optGroup = document.createElement('optgroup');
        optGroup.label = category;
        
        // Sort the tasks within this specific category alphabetically
        const tasksInCat = groupedTasks[category].sort((a, b) => a.name.localeCompare(b.name));
        
        tasksInCat.forEach(t => {
            optGroup.innerHTML += `<option value="${t.uid}">${t.name} (${t.value} pts)</option>`;
        });
        
        select.appendChild(optGroup);
    });
}
async function saveRoutine() {
    const name = document.getElementById('routineName').value.trim();
    if (!name) { alert("Routine Name is required!"); return; }

    const assignees = Array.from(document.querySelectorAll('.routine-assignee-cb:checked')).map(cb => cb.value);
    if (assignees.length === 0) { alert("Assign the routine to at least one person!"); return; }

    const freq = document.getElementById('routineFrequency').value;
    let scheduleData = { type: freq };

    if (freq === 'daily') {
        const resetType = document.getElementById('routineDailyReset').value;
        scheduleData.resetType = resetType;
        if (resetType === 'specific') {
            const times = document.getElementById('routineSpecificTimes').value;
            scheduleData.specificTimes = times.split(',').map(t => t.trim()).filter(t => t);
            if (scheduleData.specificTimes.length === 0) {
                alert("Please enter at least one valid time (e.g., 05:00)"); return;
            }
            scheduleData.specificTimes.sort();
        }
    } else if (freq === 'weekly') {
        const days = Array.from(document.querySelectorAll('.routine-day-cb:checked')).map(cb => parseInt(cb.value));
        if (days.length === 0) { alert("Select at least one day of the week!"); return; }
        scheduleData.daysOfWeek = days;
    } else if (freq === 'interval') {
        scheduleData.value = parseInt(document.getElementById('routineIntervalValue').value);
        scheduleData.unit = document.getElementById('routineIntervalUnit').value;
    }

    // NEW: Calculate and store the overdue threshold in hours
    let overdueVal = parseInt(document.getElementById('routineOverdueValue').value) || 14;
    let overdueUnit = document.getElementById('routineOverdueUnit').value;
    let overdueAfterHours = overdueUnit === 'days' ? overdueVal * 24 : overdueVal;

    let routineData = {
        name: name,
        completionType: document.getElementById('routineType').value,
        assignees: assignees,
        schedule: scheduleData,
        linkedNiptoTask: document.getElementById('routinePoints').value || null,
        overdueAfterHours: overdueAfterHours   // NEW FIELD
    };

    const id = document.getElementById('routineId').value;
    try {
        if (id) {
            await api.updateFirestoreDocument('routines', id, routineData);
        } else {
            routineData.createdAt = new Date().toISOString();
            routineData.lastCompleted = {};
            routineData.lastCompletedBy = {};
            await api.addFirestoreDocument('routines', routineData);
        }
        closeRoutineModal();

        await api.loadRoutinesFromFirestore();
        if (typeof syncRoutinesWithNiptoHistory === 'function') await syncRoutinesWithNiptoHistory();
        if (typeof renderRoutines === 'function') renderRoutines();
        if (typeof renderSidebarRoutines === 'function') renderSidebarRoutines();
    } catch (error) {
        alert("Error saving routine: " + error.message);
    }
}

// ==========================================
// PHASE 3: ROUTINE ENGINE & RENDERING
// ==========================================

// ==========================================
// OVERDUE THRESHOLD DEFAULTS
// ==========================================
function getDefaultOverdueHours(routine) {
    const schedule = routine.schedule || {};
    switch (schedule.type) {
        case 'daily':
            // Multi-daily (specific times): 4 hours grace after each window
            // Once-daily (midnight): 14 hours grace (overdue by ~2pm)
            return schedule.resetType === 'specific' ? 4 : 14;
        case 'weekly':
            return 24; // 1 day after scheduled day
        case 'interval':
            switch (schedule.unit) {
                case 'days':   return 24;    // 1 day
                case 'weeks':  return 48;    // 2 days
                case 'months': return 168;   // 7 days
                case 'years':  return 336;   // 14 days
                default:       return 24;
            }
        default: return 24;
    }
}function getRoutineStatus(routine, targetUids) {
    const now = new Date();
    let lastComp = null;
    let compNames = "";

    // NEW: Per-person tracking arrays for individual routines
    let pendingNames = [];
    let completedNames = [];

    if (routine.completionType === 'shared') {
        lastComp = routine.lastCompleted ? routine.lastCompleted['shared'] : null;
        compNames = routine.lastCompletedBy ? routine.lastCompletedBy['shared'] : "";
    } else {
        // ── INDIVIDUAL: Check each target user separately ──
        let oldest = null;
        let allDone = true;
        let someCompleted = false;

        targetUids.forEach(uid => {
            const lc = routine.lastCompleted ? routine.lastCompleted[uid] : null;
            const uObj = ALL_USERS.find(u => u.uid === uid);
            const name = uObj ? uObj.name : 'Unknown';

            if (!lc) {
                allDone = false;
                pendingNames.push(name);
            } else {
                someCompleted = true;
                completedNames.push(name);
                if (!oldest || new Date(lc) < new Date(oldest)) oldest = lc;
            }
        });

        if (allDone) {
            // Everyone in the target list has completed
            lastComp = oldest;
            compNames = completedNames.join(', ');
        } else if (someCompleted) {
            // ── KEY FIX: Some people did it, others didn't ──
            // Do NOT fall through to createdAt — this is actively "due" for the remaining users
            return {
                status: 'due',
                nextDue: now,
                isCompleted: false,
                compNames: "",
                pendingNames: pendingNames,
                completedNames: completedNames
            };
        } else {
            // Nobody has done it — will fall to createdAt logic below
            lastComp = null;
        }
    }

    // ── Handle never-completed routines ──
    if (!lastComp) {
        if (routine.createdAt) {
            lastComp = routine.createdAt;
            compNames = "";
        } else {
            return { status: 'due', nextDue: now, isCompleted: false, compNames: "", pendingNames: [], completedNames: [] };
        }
    }

    const baseDate = new Date(lastComp);

    // ── FIX: Defensive check for invalid dates ──
    if (isNaN(baseDate.getTime())) {
        console.warn("Invalid baseDate in routine:", routine.name, lastComp);
        return { status: 'due', nextDue: now, isCompleted: false, compNames: "", pendingNames: [], completedNames: [] };
    }

    let nextDue = new Date(baseDate);

    // ── Calculate next due date based on schedule ──
    if (routine.schedule.type === 'daily') {
        if (routine.schedule.resetType === 'midnight') {
            nextDue.setDate(nextDue.getDate() + 1);
            nextDue.setHours(0, 0, 0, 0);
        } else if (routine.schedule.resetType === 'specific') {
            let foundNext = false;
            let cleanTimes = (routine.schedule.specificTimes || []).map(t => {
                let clean = t.trim().toLowerCase();
                let isPM = clean.includes('pm');
                let isAM = clean.includes('am');
                clean = clean.replace(/[a-z\s]/g, '');
                let parts = clean.split(':').map(Number);
                let h = parts[0] || 0;
                let m = parts[1] || 0;
                if (isPM && h < 12) h += 12;
                if (isAM && h === 12) h = 0;
                return { h, m };
            });
            cleanTimes.sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));

            for (let timeObj of cleanTimes) {
                let candidate = new Date(baseDate);
                candidate.setHours(timeObj.h, timeObj.m, 0, 0);
                if (candidate > baseDate) {
                    nextDue = candidate;
                    foundNext = true;
                    break;
                }
            }
            if (!foundNext && cleanTimes.length > 0) {
                nextDue.setDate(nextDue.getDate() + 1);
                nextDue.setHours(cleanTimes[0].h, cleanTimes[0].m, 0, 0);
            }
        }
    } else if (routine.schedule.type === 'weekly') {
        nextDue.setDate(nextDue.getDate() + 1);
        nextDue.setHours(0, 0, 0, 0);
        let safety = 0;
        while (!routine.schedule.daysOfWeek.includes(nextDue.getDay()) && safety < 8) {
            nextDue.setDate(nextDue.getDate() + 1);
            safety++;
        }
    } else if (routine.schedule.type === 'interval') {
        const val = routine.schedule.value;
        const unit = routine.schedule.unit;
        if (unit === 'days')   nextDue.setDate(nextDue.getDate() + val);
        if (unit === 'weeks')  nextDue.setDate(nextDue.getDate() + (val * 7));
        if (unit === 'months') nextDue.setMonth(nextDue.getMonth() + val);
        if (unit === 'years')  nextDue.setFullYear(nextDue.getFullYear() + val);
    }

    // ── FIX: Catch invalid nextDue from bad schedule math ──
    if (isNaN(nextDue.getTime())) {
        console.warn("Invalid nextDue calculated for routine:", routine.name);
        return { status: 'due', nextDue: now, isCompleted: false, compNames: "", pendingNames: [], completedNames: [] };
    }

    const overdueHours = routine.overdueAfterHours || getDefaultOverdueHours(routine);
    const overdueMs = overdueHours * 60 * 60 * 1000;

    if (now >= nextDue) {
        const isOverdue = (now.getTime() - nextDue.getTime()) > overdueMs;
        return {
            status: isOverdue ? 'overdue' : 'due',
            nextDue,
            isCompleted: false,
            compNames: "",
            pendingNames: pendingNames,
            completedNames: completedNames
        };
    } else {
        return {
            status: 'completed',
            nextDue,
            isCompleted: true,
            compNames,
            completedAt: baseDate,
            pendingNames: [],
            completedNames: completedNames
        };
    }
}

// MAIN TAB RENDERER
function renderRoutines() {
    const container = document.getElementById('routinesContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!state.routines || state.routines.length === 0) {
        container.innerHTML = '<div class="empty-dashboard-msg">No routines set up yet.</div>';
        return;
    }

    let evaluatedRoutines = state.routines.map(r => {
        return { routine: r, evaluation: getRoutineStatus(r, r.assignees) };
    });

    evaluatedRoutines.sort((a, b) => {
        if (a.evaluation.status === 'overdue' && b.evaluation.status !== 'overdue') return -1;
        if (a.evaluation.status !== 'overdue' && b.evaluation.status === 'overdue') return 1;
        if (a.evaluation.isCompleted && !b.evaluation.isCompleted) return 1;
        if (!a.evaluation.isCompleted && b.evaluation.isCompleted) return -1;
        const aIsIndividual = a.routine.assignees.length === 1;
        const bIsIndividual = b.routine.assignees.length === 1;
        if (aIsIndividual && !bIsIndividual) return -1;
        if (!aIsIndividual && bIsIndividual) return 1;
        return a.evaluation.nextDue - b.evaluation.nextDue;
    });

    evaluatedRoutines.forEach(item => {
        const r = item.routine;
        const ev = item.evaluation;
        const linkedTaskInfo = state.tasks.find(t => t.uid === r.linkedNiptoTask);
        const ptsDisplay = linkedTaskInfo && linkedTaskInfo.value > 0
            ? `⭐ ${Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor)} pts` : '';

        // ── NEW: Smart assignee display ──
        const assigneesHtml = formatRoutineAssignees(r);

        const card = document.createElement('div');
        card.className = `chore-card ${ev.isCompleted ? 'completed' : ''}`;

        let statusBadge = '';
        if (ev.status === 'overdue') statusBadge = `<span style="color: white; background: var(--danger); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold;">⚠️ Overdue</span>`;
        else if (ev.status === 'due') statusBadge = `<span style="color: white; background: var(--primary); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold;">📅 Due</span>`;

        // ── NEW: Smart completion / per-person status text ──
        let completedText = '';
        if (ev.isCompleted) {
            const wasSkipped = ev.compNames && ev.compNames.includes('⏭️');
            const resetLabel = ev.nextDue.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
            completedText = `<div style="font-size: 12px; color: ${wasSkipped ? 'var(--text-muted)' : 'var(--success)'}; margin-top: 5px; font-weight: bold;">
                ${wasSkipped ? '⏭️ Skipped' : `✓ Done by ${ev.compNames}`} (Resets ${resetLabel})
            </div>`;
        } else if (r.completionType === 'individual' && ev.completedNames && ev.completedNames.length > 0) {
            // Show per-person breakdown for partially completed individual routines
            const doneStr = ev.completedNames.map(n => `<span style="color: var(--success);">✅ ${n}</span>`).join(' ');
            const pendingStr = ev.pendingNames.map(n => `<span style="color: var(--text-muted);">⏳ ${n}</span>`).join(' ');
            completedText = `<div style="font-size: 12px; margin-top: 5px; display: flex; gap: 8px; flex-wrap: wrap;">
                ${doneStr} ${pendingStr}
            </div>`;
        }

        // ── Action buttons ──
        let primaryActionBtn = '';
        let skipBtn = '';

        if (ev.isCompleted) {
            primaryActionBtn = `<button class="chore-btn undo-btn" onclick="undoRoutine('${r.uid}')" title="Undo">↩️</button>`;
        } else {
            primaryActionBtn = `<button class="chore-btn complete-btn" onclick="completeRoutine('${r.uid}', '${r.linkedNiptoTask}')">✅</button>`;
            skipBtn = `<button class="chore-btn" onclick="skipRoutine('${r.uid}')" title="Skip this occurrence" style="font-size: 14px; opacity: 0.7;">⏭️</button>`;
        }

        let actionsHtml = `
            ${primaryActionBtn}
            ${skipBtn}
            <button class="chore-btn" onclick="editRoutine('${r.uid}')" title="Edit">✏️</button>
            <button class="chore-btn delete-btn" onclick="deleteRoutine('${r.uid}')" title="Delete">🗑️</button>
        `;

        card.innerHTML = `
        <div class="chore-header">
            <div class="chore-title-area">
                <div class="chore-title" style="${ev.isCompleted ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">
                    ${r.completionType === 'shared' ? '🤝' : '👤'} ${r.name}
                </div>
                <div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                    ${statusBadge}
                    ${assigneesHtml}
                    <span style="font-size: 11px; color: var(--text-muted); border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 4px;">↻ ${r.schedule.type}</span>
                    ${ptsDisplay ? `<span style="font-size: 11px; color: var(--primary); background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${ptsDisplay}</span>` : ''}
                </div>
                ${completedText}
            </div>
            <div class="chore-actions">${actionsHtml}</div>
        </div>
        `;
        container.appendChild(card);
    });
}
// SIDEBAR RENDERERS
function renderSidebarRoutines() {
    const container = document.getElementById('sidebarRoutinesContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!state.routines) return;

    let visibleRoutines = state.routines.filter(r =>
        state.activeUsers.some(uid => r.assignees.includes(uid))
    );

    let dueRoutines = visibleRoutines
        .map(r => ({ routine: r, evaluation: getRoutineStatus(r, state.activeUsers) }))
        .filter(item => !item.evaluation.isCompleted);

    if (dueRoutines.length === 0) {
        container.innerHTML = '<div class="empty-history" style="margin-top: 10px;">All caught up! 🎉</div>';
        return;
    }

    // Sort: overdue first, then by next due time
    dueRoutines.sort((a, b) => {
        if (a.evaluation.status === 'overdue' && b.evaluation.status !== 'overdue') return -1;
        if (a.evaluation.status !== 'overdue' && b.evaluation.status === 'overdue') return 1;
        return a.evaluation.nextDue - b.evaluation.nextDue;
    });

    dueRoutines.forEach(item => {
        const r = item.routine;
        const card = document.createElement('div');
        card.className = 'chore-card';

        // ── NEW: Smart assignee display (compact) ──
        const assigneesHtml = formatRoutineAssignees(r, true);

        const timeStr = item.evaluation.nextDue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const linkedTaskInfo = state.tasks.find(t => t.uid === r.linkedNiptoTask);
        const pts = linkedTaskInfo && linkedTaskInfo.value > 0
            ? `⭐ ${Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor)} pts` : '';

        card.innerHTML = `
        <div class="chore-header" style="flex-direction: column; align-items: flex-start; gap: 6px;">
            <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                <div class="chore-title" style="font-size: 13px;">${item.evaluation.status === 'overdue' ? '⚠️ ' : ''}${r.name}</div>
                <div style="display: flex; gap: 4px;">
                    <button class="chore-btn complete-btn" style="padding: 4px 8px; font-size: 12px;" onclick="completeRoutine('${r.uid}', '${r.linkedNiptoTask}')">✅</button>
                    <button class="chore-btn" style="padding: 4px 8px; font-size: 12px; opacity: 0.7;" onclick="skipRoutine('${r.uid}')" title="Skip">⏭️</button>
                </div>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; flex-wrap: wrap;">
                ${assigneesHtml}
                <span>🕒 ${timeStr}</span>
                ${pts ? `<span style="color: var(--primary); font-weight: bold;">${pts}</span>` : ''}
            </div>
        </div>
        `;
        container.appendChild(card);
    });
}
function updateOverdueDefaults() {
    const freq = document.getElementById('routineFrequency').value;
    const resetType = document.getElementById('routineDailyReset').value;
    const valueInput = document.getElementById('routineOverdueValue');
    const unitSelect = document.getElementById('routineOverdueUnit');
    const hint = document.getElementById('overdueHint');

    if (!valueInput || !unitSelect || !hint) return;

    if (freq === 'daily') {
        if (resetType === 'specific') {
            valueInput.value = 4;
            unitSelect.value = 'hours';
            hint.textContent = 'Default: 4 hours after each scheduled time';
        } else {
            valueInput.value = 14;
            unitSelect.value = 'hours';
            hint.textContent = 'Default: 14 hours (~2pm if not done by midnight reset)';
        }
    } else if (freq === 'weekly') {
        valueInput.value = 1;
        unitSelect.value = 'days';
        hint.textContent = 'Default: 1 day after the scheduled day';
    } else if (freq === 'interval') {
        const unit = document.getElementById('routineIntervalUnit').value;
        switch (unit) {
            case 'days':
                valueInput.value = 1; unitSelect.value = 'days';
                hint.textContent = 'Default: 1 day after due';
                break;
            case 'weeks':
                valueInput.value = 2; unitSelect.value = 'days';
                hint.textContent = 'Default: 2 days after due';
                break;
            case 'months':
                valueInput.value = 7; unitSelect.value = 'days';
                hint.textContent = 'Default: 7 days after due';
                break;
            case 'years':
                valueInput.value = 14; unitSelect.value = 'days';
                hint.textContent = 'Default: 14 days after due';
                break;
            default:
                valueInput.value = 1; unitSelect.value = 'days';
        }
    }
}

window.updateOverdueDefaults = updateOverdueDefaults;
function renderSidebarTodos() {
    const container = document.getElementById('sidebarTodosContainer');
    if (!container) return;
    container.innerHTML = '';
    
    if (!state.todoTasksData) return;
    
    let visibleTodos = state.todoTasksData.filter(t => !t.completed && t.assignees && state.activeUsers.some(uid => t.assignees.includes(uid)));
    
    if (visibleTodos.length === 0) {
        container.innerHTML = '<div class="empty-history" style="margin-top: 10px;">No general to-dos assigned.</div>'; return;
    }
    
    visibleTodos.forEach(task => {
        const linkedTaskArg = task.linkedNiptoTask ? `'${task.linkedNiptoTask}'` : 'null';
        const card = document.createElement('div');
        card.className = 'chore-card';
        // Build Assignee Badges
        const assigneesHtml = (task.assignees || []).map(uid => {
            const u = ALL_USERS.find(user => user.uid === uid);
            return u ? `<span style="color: ${u.color}; font-size: 10px; margin-right: 3px;">${u.name}</span>` : '';
        }).join('');
        
        // Get Points
        let pts = '';
        if (task.linkedNiptoTask && task.linkedNiptoTask !== 'null') {
            const linkedTaskInfo = state.tasks.find(t => t.uid === task.linkedNiptoTask);
            if (linkedTaskInfo) pts = `⭐ ${Math.ceil(linkedTaskInfo.value / state.currentSplitDivisor)} pts`;
        }
        
        card.innerHTML = `
        <div class="chore-header" style="flex-direction: column; align-items: flex-start; gap: 6px;">
        <div style="display: flex; justify-content: space-between; width: 100%;">
        <div class="chore-title" style="font-size: 13px;">📋 ${task.name}</div>
        <button class="chore-btn complete-btn" style="padding: 4px 8px; font-size: 12px;" onclick="toggleTaskStatus('${task.id}', ${task.completed}, ${linkedTaskArg})">✅</button>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; flex-wrap: wrap;">
        <span>👥 ${assigneesHtml || 'Anyone'}</span>
        <span style="color: ${task.priority === 'High' ? 'var(--danger)' : 'inherit'}">⚡ ${task.priority || 'Medium'}</span>
        ${pts ? `<span style="color: var(--primary); font-weight: bold;">${pts}</span>` : ''}
        </div>
        </div>
        `;
        container.appendChild(card);
    });
}

// ACTIONS
async function completeRoutine(routineId, linkedNiptoTask) {
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return; }
    if (state.activeUsers.length === 0) { alert("Select at least one user first!"); return; }
    
    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine) return;
    
    let targetDate = state.currentMode === 'live' ? new Date() : new Date(document.getElementById('taskDate').value);
    let namesString = state.activeUsers.map(uid => ALL_USERS.find(u=>u.uid===uid).name).join(', ');
    
    try {
        if (linkedNiptoTask && linkedNiptoTask !== "null") {
            await api.logActivityToNipto(linkedNiptoTask, targetDate.toISOString());
            // Fire the fun UI toast!
            const tObj = state.tasks.find(t => t.uid === linkedNiptoTask);
            if(tObj) showToast(linkedNiptoTask, routine.name, Math.ceil(tObj.value / state.currentSplitDivisor), namesString);
        }
        
        let newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
        let newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};
        
        if (routine.completionType === 'shared') {
            newLastCompleted['shared'] = targetDate.toISOString();
            newLastCompletedBy['shared'] = namesString;
            } else {
            state.activeUsers.forEach(uid => {
                newLastCompleted[uid] = targetDate.toISOString();
                newLastCompletedBy[uid] = ALL_USERS.find(u=>u.uid===uid).name;
            });
        }
        
        await api.updateFirestoreDocument('routines', routineId, {
            lastCompleted: newLastCompleted,
            lastCompletedBy: newLastCompletedBy
        });
        
        await api.loadRoutinesFromFirestore();
        renderRoutines();
        renderSidebarRoutines();
        updateLeaderboardUI();
        } catch (error) {
        alert("Error completing routine: " + error.message);
    }
}

async function deleteRoutine(routineId) {
    if(confirm("Are you sure you want to permanently delete this routine?")) {
        await api.deleteFirestoreDocument('routines', routineId);
        await api.loadRoutinesFromFirestore();
        renderRoutines();
        renderSidebarRoutines();
    }
}

// BIND TO WINDOW
window.completeRoutine = completeRoutine;
window.deleteRoutine = deleteRoutine;
window.renderRoutines = renderRoutines;
window.renderSidebarRoutines = renderSidebarRoutines;
window.renderSidebarTodos = renderSidebarTodos;


// ==========================================
// BACKGROUND ROUTINE HISTORY SYNC
// ==========================================
async function syncRoutinesWithNiptoHistory() {
    if (!state.routines || !state.allWeekActivities) return;
    
    let requiresDbUpdate = false;
    
    for (const routine of state.routines) {
        if (!routine.linkedNiptoTask) continue; 
        
        // Get the actual linked task object so we can match by name if the ID fails
        const linkedObj = state.tasks.find(t => t.uid === routine.linkedNiptoTask);
        
        const matchingActivities = state.allWeekActivities.filter(act => {
            // 1. Try to match by any variation of the Task ID
            const historicalTaskId = (act.task && (act.task.uid || act.task.id)) || act.taskId || act.task_id;
            if (historicalTaskId && historicalTaskId === routine.linkedNiptoTask) return true;
            
            // 2. AGGRESSIVE FALLBACK: Match by exact Task Name if Nipto stripped the ID
            if (linkedObj && act.task && act.task.name === linkedObj.name) return true;
            
            return false;
        });
        
        if (matchingActivities.length === 0) continue;
        
        matchingActivities.sort((a, b) => a.parsedDate - b.parsedDate);
        
        let newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
        let newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};
        let updatedThisRoutine = false;
        
        for (const act of matchingActivities) {
            const actDateStr = act.parsedDate.toISOString();
            const actUserUid = (act.user && (act.user.uid || act.user.id)) || act.userId || "unknown";
            const actUserName = (act.user && act.user.name) ? act.user.name : "Someone";
            
            if (routine.completionType === 'shared') {
                const currentSharedDate = newLastCompleted['shared'];
                if (!currentSharedDate || new Date(actDateStr) > new Date(currentSharedDate)) {
                    newLastCompleted['shared'] = actDateStr;
                    newLastCompletedBy['shared'] = actUserName; 
                    updatedThisRoutine = true;
                }
                } else {
                const currentUserDate = newLastCompleted[actUserUid];
                if (!currentUserDate || new Date(actDateStr) > new Date(currentUserDate)) {
                    newLastCompleted[actUserUid] = actDateStr;
                    newLastCompletedBy[actUserUid] = actUserName;
                    updatedThisRoutine = true;
                }
            }
        }
        
        if (updatedThisRoutine) {
            routine.lastCompleted = newLastCompleted;
            routine.lastCompletedBy = newLastCompletedBy;
            requiresDbUpdate = true;
            
            api.updateFirestoreDocument('routines', routine.uid, {
                lastCompleted: newLastCompleted,
                lastCompletedBy: newLastCompletedBy
            }).catch(err => console.error("History auto-sync error:", err));
        }
    }
    
    if (requiresDbUpdate) {
        if (typeof renderRoutines === 'function') renderRoutines();
        if (typeof renderSidebarRoutines === 'function') renderSidebarRoutines();
    }
}

window.refreshDashboard = async () => {
    const btn = document.getElementById('refreshBtn');
    if (btn) { btn.innerText = "⏳ Syncing..."; btn.disabled = true; }
    
    try {
        await api.loadTasksFromFirestore();
        await api.loadChoresFromFirestore();
        await api.loadRoutinesFromFirestore();
        await updateLeaderboardUI(); 
        
        renderTasks();
        renderPinnedTasks();
        
        renderRoutines();
        renderSidebarRoutines();
        if (typeof renderTodoTasks === 'function') renderTodoTasks();
        if (typeof renderSidebarTodos === 'function') renderSidebarTodos();
        } catch (e) {
        console.error("Refresh failed:", e);
    }
    
    if (btn) { btn.innerText = "🔄 Refresh"; btn.disabled = false; }
};
async function skipRoutine(routineId) {
    const routine = state.routines.find(r => r.uid === routineId);
    if (!routine) return;

    if (!confirm(`Skip "${routine.name}"? No points will be awarded and it will advance to the next occurrence.`)) return;

    const now = new Date();
    let newLastCompleted = routine.lastCompleted ? { ...routine.lastCompleted } : {};
    let newLastCompletedBy = routine.lastCompletedBy ? { ...routine.lastCompletedBy } : {};

    if (routine.completionType === 'shared') {
        newLastCompleted['shared'] = now.toISOString();
        newLastCompletedBy['shared'] = '⏭️ Skipped';
    } else {
        // Skip only for the currently selected users
        if (state.activeUsers.length === 0) {
            alert("Select at least one user first!");
            return;
        }
        state.activeUsers.forEach(uid => {
            newLastCompleted[uid] = now.toISOString();
            const uObj = ALL_USERS.find(u => u.uid === uid);
            newLastCompletedBy[uid] = `⏭️ Skipped by ${uObj ? uObj.name : 'Someone'}`;
        });
    }

    try {
        await api.updateFirestoreDocument('routines', routineId, {
            lastCompleted: newLastCompleted,
            lastCompletedBy: newLastCompletedBy
        });

        await api.loadRoutinesFromFirestore();
        renderRoutines();
        renderSidebarRoutines();

        // Quick status feedback
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
            statusDiv.innerText = `⏭️ Skipped: ${routine.name}`;
            statusDiv.style.color = 'var(--text-muted)';
            setTimeout(() => { statusDiv.innerText = ''; }, 3000);
        }
    } catch (error) {
        alert("Error skipping routine: " + error.message);
    }
}

// BIND TO WINDOW
window.skipRoutine = skipRoutine;