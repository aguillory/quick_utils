// dashboard.js
import { state, ALL_USERS, saveUserState } from './state.js';
import * as api from './api.js';

// --- INIT & USER STATE LOGIC ---
function initUsers() {
    populateTogetherCheckboxes();
    const stored = localStorage.getItem("nipto_merged_users");
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed.isTogetherMode) {
                setTogetherState(parsed.users);
            } else if (parsed.users && parsed.users.length === 1) {
                setActiveUser(parsed.users[0], true);
            } else {
                setActiveUser(ALL_USERS[0].uid, true);
            }
        } catch (e) { setActiveUser(ALL_USERS[0].uid, true); }
    } else {
        setActiveUser(ALL_USERS[0].uid, true);
    }
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
        document.getElementById('addTaskSection').style.display = 'block';

        if (state.isViewAllMode) toggleViewAll();

        renderTasks();
        renderChores();
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

        document.getElementById('addTaskSection').style.display = 'none';
        cancelAddTask();

        renderTasks();
        renderChores();
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
async function logTask(buttonElement, taskUid, taskName) {
    if (buttonElement.classList.contains('success')) return false;
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return false; }
    
    if (state.activeUsers.length === 0) {
        alert("No users selected! Please select someone at the top of the dashboard.");
        return false;
    }

    const statusDiv = document.getElementById('status');
    buttonElement.disabled = true;

    let targetDate;
    if (state.currentMode === 'live') {
        targetDate = new Date(); 
    } else {
        const dateInput = document.getElementById('taskDate').value;
        if (!dateInput) {
            statusDiv.innerText = "Error: Please select a valid custom date/time.";
            statusDiv.style.color = 'var(--danger)';
            buttonElement.disabled = false; return false;
        }
        targetDate = new Date(dateInput);
    }

    let namesString = state.activeUsers.map(uid => ALL_USERS.find(u=>u.uid===uid).name).join(', ');
    statusDiv.innerText = `Logging: ${taskName} for ${namesString}...`;
    statusDiv.style.color = 'var(--text-main)';

    try {
        await api.logActivityToNipto(taskUid, targetDate.toISOString());
        
        updateLeaderboardUI();
        statusDiv.innerText = `Successfully logged for ${namesString}!`;
        statusDiv.style.color = 'var(--success)';
        
        buttonElement.classList.add('success');
        if(!buttonElement.querySelector('.chore-title')) {
            buttonElement.innerHTML += '<br><span style="font-size:12px;">✓ Logged</span>';
        }
        
        setTimeout(() => {
            buttonElement.classList.remove('success');
            buttonElement.disabled = false;
            buttonElement.innerHTML = buttonElement.getAttribute('data-original-html') || buttonElement.innerHTML;
            statusDiv.innerText = "";
            statusDiv.style.color = 'var(--text-main)';
        }, 3000);
        
        return true;
    } catch (error) {
        statusDiv.innerText = `Error: ${error.message}`;
        statusDiv.style.color = 'var(--danger)';
        buttonElement.disabled = false;
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
            renderChores();
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
    const success = await logTask(btnElement, taskUid, taskName);
    if (success) await togglePinTask(taskUid); 
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

    let activeUser = state.activeUsers[0] || 'default';
    let savedOrder = JSON.parse(localStorage.getItem(`nipto_sort_order_${activeUser}`) || '[]');
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

        // Track collapsibility per user
        const isCatCollapsed = localStorage.getItem(`nipto_merged_cat_${activeUser}_${category}`) === 'true';

        const orderControls = `<span class="sort-controls" style="font-size: 14px; margin-left: 10px; opacity: 0.5;">
            <button onclick="moveCategory('${category}', -1, 'nipto', event)" style="cursor:pointer; background:none; border:none;" title="Move Up">▲</button>
            <button onclick="moveCategory('${category}', 1, 'nipto', event)" style="cursor:pointer; background:none; border:none;" title="Move Down">▼</button>
        </span>`;

        const header = document.createElement('h3');
        header.className = 'category-header collapsible-header';
        header.innerHTML = `${category} ${orderControls} <span class="toggle-icon ${isCatCollapsed ? 'collapsed' : ''}" style="margin-left: auto;">▼</span>`;
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        
        header.onclick = (e) => {
            if(e.target.tagName === 'BUTTON') return;
            const collapsed = gridWrapper.classList.toggle('collapsed');
            header.querySelector('.toggle-icon').classList.toggle('collapsed', collapsed);
            localStorage.setItem(`nipto_merged_cat_${category}`, collapsed);
        };
        section.appendChild(header);

        const gridWrapper = document.createElement('div');
        gridWrapper.className = `collapsible-content ${isCatCollapsed ? 'collapsed' : ''}`;
        
        header.onclick = (e) => {
            if(e.target.tagName === 'BUTTON') return;
            const collapsed = gridWrapper.classList.toggle('collapsed');
            header.querySelector('.toggle-icon').classList.toggle('collapsed', collapsed);
            
            // FIX: Save using the personalized activeUser key!
            localStorage.setItem(`nipto_merged_cat_${activeUser}_${category}`, collapsed);
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
            } else {
                btn.innerHTML = taskContentHtml;
                
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

// --- ASSIGNED CHORES ---
function renderChores() {
    const container = document.getElementById('choresContainer');
    container.innerHTML = '';
    
    let visibleChores = state.customChores.filter(c => c.assignees && state.activeUsers.some(uid => c.assignees.includes(uid)));
    visibleChores.sort((a, b) => (a.completed === b.completed) ? 0 : a.completed ? 1 : -1);

    if (visibleChores.length === 0) {
        container.innerHTML = '<div class="empty-history" style="margin-top: 10px;">No assigned tasks.</div>';
        return;
    }

    visibleChores.forEach(chore => {
        const linkedTask = state.tasks.find(t => t.uid === chore.linkedNiptoTask);
        const basePoints = linkedTask ? linkedTask.value : 0;
        const displayPoints = basePoints > 0 ? Math.ceil(basePoints / state.currentSplitDivisor) : '?';
        
        const assigneesHtml = chore.assignees.map(uid => {
            const user = ALL_USERS.find(u => u.uid === uid);
            const name = user ? user.name : "Unknown";
            const color = user ? user.color : "var(--text-main)"; 
            return `<span style="color: ${color}; font-size: 11px; font-weight: bold; margin-right: 6px; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${name}</span>`;
        }).join('');

        const card = document.createElement('div');
        card.className = `chore-card ${chore.completed ? 'completed' : ''}`;
        
        let actionHtml = '';
        if (state.isEditMode) {
            actionHtml = `<button class="chore-btn delete-btn" onclick="deleteChoreDB('${chore.uid}')" title="Delete Task permanently">🗑️</button>`;
        } else {
            if (chore.completed) {
                let uidsJson = JSON.stringify(chore.completedActivityUids || []).replace(/"/g, '&quot;'); 
                let legacyUid = chore.completedActivityUid || "null";
                actionHtml = `<button class="chore-btn undo-btn" onclick="undoChore('${chore.uid}', '${legacyUid}', '${uidsJson}')" title="Undo Complete">↩️</button>`;
            } else {
                actionHtml = `<button class="chore-btn complete-btn" onclick="completeChore('${chore.uid}', '${chore.linkedNiptoTask}')" title="Mark Complete">✅</button>`;
            }
        }

        let completedUiHtml = '';
        if (chore.completed && chore.completedInfo) {
            const formattedDate = new Date(chore.completedInfo.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const eachText = chore.completedInfo.names.includes(',') ? 'each' : '';
            completedUiHtml = `
                <div class="chore-completion-info">
                    <b>✓ Logged by:</b> ${chore.completedInfo.names}<br>
                    <b>🕒 When:</b> ${formattedDate}<br>
                    <b>⭐ Awarded:</b> +${chore.completedInfo.pointsEach} pts ${eachText}
                </div>`;
        }

        card.innerHTML = `
            <div class="chore-header">
                <div class="chore-title-area" onclick="document.getElementById('desc-${chore.uid}').classList.toggle('open'); document.getElementById('icon-${chore.uid}').classList.toggle('open');">
                    <div class="chore-title">${chore.title} <span class="chore-expand-icon" id="icon-${chore.uid}">▼</span></div>
                    <div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;">${assigneesHtml}</div>
                    <div class="chore-points">+${displayPoints} pts</div>
                </div>
                <div class="chore-actions">${actionHtml}</div>
            </div>
            ${completedUiHtml}
            <div class="chore-desc" id="desc-${chore.uid}">
                ${chore.description ? chore.description.replace(/\n/g, '<br>') : '<i>No additional details</i>'}
                ${state.isEditMode ? `<br><span style="font-size:11px; color:var(--primary); margin-top:5px; display:block;">Linked Task: ${linkedTask ? linkedTask.name : 'Unknown'}</span>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

async function completeChore(choreUid, linkedTaskUid) {
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return; }
    if (state.activeUsers.length === 0) { alert("Select at least one user first!"); return; }

    try {
        let targetDate = state.currentMode === 'live' ? new Date() : new Date(document.getElementById('taskDate').value);
        const exactFormatString = targetDate.toISOString();
        const baseTask = state.tasks.find(t => t.uid === linkedTaskUid);
        const pointsGiven = baseTask && baseTask.value > 0 ? Math.ceil(baseTask.value / state.currentSplitDivisor) : 0;

        const activityUids = await api.logActivityToNipto(linkedTaskUid, exactFormatString);
        let namesString = state.activeUsers.map(uid => ALL_USERS.find(u=>u.uid===uid).name).join(', ');

        await api.updateFirestoreDocument('custom_chores', choreUid, {
            completed: true, completedActivityUids: activityUids,
            completedInfo: { names: namesString, date: exactFormatString, pointsEach: pointsGiven }
        });

        await api.loadChoresFromFirestore();
        renderChores();
        updateLeaderboardUI();
    } catch (error) { alert("Error completing task: " + error.message); }
}

async function undoChore(choreUid, legacyActivityUid, activityUidsJson) {
    if (!state.apiToken) { document.getElementById('pinModal').style.display = 'flex'; return; }
    if (!confirm("Undo this task and remove the points from Nipto?")) return;
    try {
        let uidsToDelete = [];
        if (activityUidsJson && activityUidsJson !== "undefined") uidsToDelete = JSON.parse(activityUidsJson.replace(/&quot;/g, '"'));
        if (uidsToDelete.length === 0 && legacyActivityUid && legacyActivityUid !== "null") uidsToDelete = [legacyActivityUid];

        for (const uid of uidsToDelete) {
            await api.deleteActivityFromNipto(uid);
        }
        
        await api.updateFirestoreDocument('custom_chores', choreUid, {
            completed: false, completedActivityUid: null, completedActivityUids: [], completedInfo: window.firebase.firestore.FieldValue.delete()
        });
        
        await api.loadChoresFromFirestore();
        renderChores();
        updateLeaderboardUI();
    } catch (error) { alert("Error undoing task: " + error.message); }
}

async function deleteChoreDB(choreUid) {
    if (!confirm("Permanently delete this custom task from the database? (This does not remove past points)")) return;
    try {
        await api.deleteFirestoreDocument('custom_chores', choreUid);
        await api.loadChoresFromFirestore();
        renderChores();
    } catch (error) { alert("Error deleting task."); }
}

function promptAddTask() {
    if (state.hasEnteredTaskPin) { showAddTaskForm(); return; }
    const pin = prompt("Enter 4-Digit PIN to create a Custom Task:");
    if (pin === "9876") { state.hasEnteredTaskPin = true; showAddTaskForm(); } 
    else if (pin !== null) { alert("Incorrect PIN."); }
}

function showAddTaskForm() {
    document.getElementById('showAddTaskBtn').style.display = 'none';
    document.getElementById('addTaskForm').style.display = 'flex';
    const assigneesContainer = document.getElementById('choreAssignees');
    assigneesContainer.innerHTML = '';
    ALL_USERS.forEach(u => {
        assigneesContainer.innerHTML += `<label style="font-size: 13px; display: flex; align-items: center; gap: 4px;"><input type="checkbox" value="${u.uid}" class="chore-assignee-cb"> ${u.name}</label>`;
    });

    const linkedTaskSelect = document.getElementById('choreLinkedTask');
    linkedTaskSelect.innerHTML = '<option value="">-- Select Linked Nipto Task --</option>';
    const assignedTasks = [
        { uid: "4qN36U3lrNdyjFet2vcU", name: "Assigned task 5pt" }, { uid: "mDjzDiyY340KyT3Jz9Bu", name: "Assigned task 10pt" }, { uid: "8AfJBroeX8WLoweUOLS7", name: "Assigned task 15pt" }
        // ... (Truncated array for brevity, keep your original full array here)
    ];
    assignedTasks.forEach(t => linkedTaskSelect.innerHTML += `<option value="${t.uid}">${t.name}</option>`);
}

function cancelAddTask() {
    document.getElementById('showAddTaskBtn').style.display = 'block';
    document.getElementById('addTaskForm').style.display = 'none';
    document.getElementById('choreTitle').value = '';
    document.getElementById('choreDesc').value = '';
}

async function saveNewChore() {
    const title = document.getElementById('choreTitle').value.trim();
    const desc = document.getElementById('choreDesc').value.trim();
    const linkedTask = document.getElementById('choreLinkedTask').value;
    const assignees = Array.from(document.querySelectorAll('.chore-assignee-cb:checked')).map(cb => cb.value);

    if (!title || !linkedTask || assignees.length === 0) {
        alert("Please provide a title, assign at least one person, and link a Nipto task."); return;
    }

    try {
        await api.addFirestoreDocument('custom_chores', {
            title: title, description: desc, linkedNiptoTask: linkedTask, assignees: assignees,
            completed: false, completedActivityUid: null, completedActivityUids: []
        });
        cancelAddTask(); 
        await api.loadChoresFromFirestore(); 
        renderChores();
    } catch (error) { alert("Failed to save the custom task."); }
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
            localStorage.setItem(`todo_cat_${activeUser}_${key}`, collapsed);
        };

        section.appendChild(header);
        grouped[key].sort((a, b) => (a.completed === b.completed) ? 0 : a.completed ? 1 : -1);

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

function openTaskModal() {
    document.getElementById('taskModalTitle').innerText = "Add Task";
    document.getElementById('taskId').value = '';
    document.getElementById('taskName').value = '';
    document.getElementById('taskCategory').value = '';
    document.getElementById('taskLocation').value = '';
    document.getElementById('taskPriority').value = 'Medium';
    document.getElementById('taskPoints').value = '';
    document.getElementById('taskNotes').value = '';
    populateTodoAssignees([]); // Clear assignees
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
    document.getElementById('taskPoints').value = task.linkedNiptoTask || '';
    document.getElementById('taskNotes').value = task.notes || '';
    populateTodoAssignees(task.assignees || []); // Load saved assignees
    
    document.getElementById('taskModal').style.display = 'flex';
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
                completedBy: state.activeUsers 
            });
            updateLeaderboardUI();
        } catch (error) { alert("Error awarding points: " + error.message); }
    } else {
        await api.updateFirestoreDocument('custom_tasks', taskId, { completed: !currentStatus });
    }
}


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
    document.getElementById('tab-nipto').style.backgroundColor = tabName === 'nipto' ? 'var(--primary)' : 'var(--card-bg)';
    document.getElementById('tab-nipto').style.color = tabName === 'nipto' ? 'white' : 'var(--text-main)';
    
    document.getElementById('tab-todo').style.backgroundColor = tabName === 'todo' ? 'var(--primary)' : 'var(--card-bg)';
    document.getElementById('tab-todo').style.color = tabName === 'todo' ? 'white' : 'var(--text-main)';

    document.getElementById('pane-nipto').style.display = tabName === 'nipto' ? 'block' : 'none';
    document.getElementById('pane-todo').style.display = tabName === 'todo' ? 'block' : 'none';
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

function setHistoryView(mode, skipSave = false) {
    state.historyViewMode = mode;
    
    const btnBoys = document.getElementById('htBoys');
    const btnEveryone = document.getElementById('htEveryone');
    
    if (btnBoys) btnBoys.classList.toggle('active', mode === 'boys');
    if (btnEveryone) btnEveryone.classList.toggle('active', mode === 'everyone');
    
    updateHistoryDisplay();

    // Save the preference to the active person's profile
    if (!skipSave) {
        let activeUser = state.activeUsers[0] || 'default';
        localStorage.setItem(`history_view_${activeUser}`, mode);
    }
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
    'tactical': 'blackops.css'
};

let currentTheme = localStorage.getItem('nipto_theme') || 'boring';
if (currentTheme === 'fun') currentTheme = 'pixel';

function initTheme() { applyTheme(currentTheme); }

function toggleThemeMenu() {
    const menu = document.getElementById('themeMenu');
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
}

function setActiveUser(uid, skipSave = false) {
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
            el.classList.add('active');
            el.classList.remove('inactive');
        } else {
            el.classList.add('inactive');
            el.classList.remove('active');
        }
    });
    
    const togEl = document.getElementById('toggle-together');
    togEl.classList.add('inactive');
    togEl.classList.remove('active');

    // Load User's Specific Theme Preference
    let userTheme = localStorage.getItem(`nipto_theme_${uid}`);
    if (!userTheme) {
        // Fallback to old global theme if they don't have one set
        userTheme = localStorage.getItem('nipto_theme') || 'boring';
        localStorage.setItem(`nipto_theme_${uid}`, userTheme);
    }
    applyTheme(userTheme);
// Load User's Specific History View Preference
    let savedHistoryView = localStorage.getItem(`history_view_${uid}`);
    if (!savedHistoryView) {
        // Default to 'everyone' if they haven't set a preference yet
        savedHistoryView = 'everyone'; 
    }
    setHistoryView(savedHistoryView, true); // true prevents it from saving redundantly on load
    if(!skipSave) saveUserState();
    updateFloatingIndicator();
    renderTasks();
    renderPinnedTasks();
    renderChores();
    renderTodoTasks(); // Re-render to apply user-specific collapsed state and sort order
}

function setTheme(themeId) {
    const activeUid = state.activeUsers[0];
    if (state.isTogetherMode || !activeUid) {
        alert("Please select a specific person first to save their theme preference.");
        return;
    }
    
    localStorage.setItem(`nipto_theme_${activeUid}`, themeId);
    applyTheme(themeId);
    document.getElementById('themeMenu').style.display = 'none';
}

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
        renderTasks();
        renderPinnedTasks();
        renderChores();
        updateLeaderboardUI();
        
        // Listen to todo tasks
        window.db.collection('custom_tasks').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
            state.todoTasksData = [];
            snapshot.forEach(doc => state.todoTasksData.push({ id: doc.id, ...doc.data() }));
            renderTodoTasks(); 
        });
    },
    () => { document.getElementById('pinModal').style.display = 'flex'; },
    (error) => { console.error("Database Auth Failed."); }
);

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
window.completeChore = completeChore;
window.undoChore = undoChore;
window.deleteChoreDB = deleteChoreDB;
window.promptAddTask = promptAddTask;
window.saveNewChore = saveNewChore;
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

window.moveCategory = function(category, direction, type, event) {
    event.stopPropagation(); // Prevent the collapse toggle
    let activeUser = state.activeUsers[0] || 'default';
    let storageKey = `${type}_sort_order_${activeUser}`;
    
    // Attempt to load saved order, or pull current visible order from DOM
    let savedOrder = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (savedOrder.length === 0) {
        const containerId = type === 'todo' ? 'todoContainer' : 'mainContainer';
        const container = document.getElementById(containerId);
        // Extract category names currently on screen
        savedOrder = Array.from(container.querySelectorAll('.category-header'))
            .map(el => el.childNodes[0].textContent.trim());
    }
    
    const idx = savedOrder.indexOf(category);
    if (idx === -1) return;
    
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= savedOrder.length) return; 
    
    // Swap array items
    [savedOrder[idx], savedOrder[newIdx]] = [savedOrder[newIdx], savedOrder[idx]];
    
    localStorage.setItem(storageKey, JSON.stringify(savedOrder));
    
    // Re-render the appropriate view
    if (type === 'todo') renderTodoTasks();
    else renderTasks();
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