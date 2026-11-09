// api.js
import { state, ALL_USERS, NIPTO_PUBLIC_URL } from './state.js';

const NIPTO_URL = "https://nipto.app/graphql";

// Core Nipto Fetch Wrapper
export async function fetchNipto(query, variables = {}) {
    if (!state.apiToken) throw new Error("Unauthorized: Missing Token");

    const response = await fetch(NIPTO_URL, {
        method: 'POST',
        headers: { 'Authorization': state.apiToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables })
    });

    const data = await response.json();
    if (data.errors) {
        if (data.errors[0].message.toLowerCase().includes("unauthorized") || data.errors[0].message.toLowerCase().includes("token")) {
            localStorage.removeItem("nipto_api_token");
            state.apiToken = "";
            throw new Error("Token Expired"); 
        }
        throw new Error(data.errors[0].message || "GraphQL Error");
    }
    return data.data;
}

// Core Nipto MCP Fetch Wrapper (for historical activities and official tools)
export async function fetchNiptoMcp(toolName, args = {}) {
    if (!state.apiToken) throw new Error("Unauthorized: Missing Token");

    const response = await fetch("https://nipto.app/mcp", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${state.apiToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
                name: toolName,
                arguments: args
            }
        })
    });

    const data = await response.json();
    if (data.error) {
        throw new Error(data.error.message || "MCP Error");
    }
    const rawText = data.result?.content?.[0]?.text;
    if (!rawText) return null;
    const jsonStart = rawText.indexOf('{');
    if (jsonStart === -1) return null;
    return JSON.parse(rawText.slice(jsonStart));
}

// Check Authentication
export function checkAuth(onSuccess, onRequirePin, onFail) {
    window.firebase.auth().onAuthStateChanged((user) => {
        if (user) {
            if (state.apiToken) {
                if (onSuccess) onSuccess();
            } else {
                if (onRequirePin) onRequirePin();
            }
        } else {
            window.firebase.auth().signInAnonymously().catch((error) => {
                console.error("Firebase Auth Error:", error);
                if (onFail) onFail(error);
            });
        }
    });
}

// Firestore Loaders
export async function loadTasksFromFirestore() {
    const snapshot = await window.getNiptoCollection('nipto_tasks').get();
    state.tasks = snapshot.docs.map(doc => ({
        uid: doc.id,
        name: doc.data().name,
        value: doc.data().value || 0,
        category: doc.data().group || "General",
        dashboardUsers: doc.data().dashboardUsers || [],
        pinnedUsers: doc.data().pinnedUsers || []
    }));
}

export async function loadUsersFromFirestore() {
    const snapshot = await window.getNiptoCollection('users').orderBy('order', 'asc').get();
    ALL_USERS.length = 0; // Clear it out
    if (snapshot.empty) {
        console.info("Migrating initial users to Firestore...");
        const initialUsers = [
            { uid: "NMRQaRQbvCwBaJbiMFId", name: "Ayden", color: "var(--user-ayden)", order: 1 },
            { uid: "RMNUTP8VOHD9PDzNjf0g", name: "DJ", color: "var(--user-dj)", order: 2 },
            { uid: "Llb9JjyTDvMnn8SJWfizXgthxl83", name: "Alyssa", color: "var(--user-alyssa)", order: 3 },
            { uid: "cHnAKABalRf0gETPsDt9EiJLyZd2", name: "Devyn", color: "var(--user-devyn)", order: 4 },
            { uid: "2pxnC1oGlZbLQLmu9UJJVPYOEmZ2", name: "Carrina", color: "var(--user-carrina)", order: 5 },
            { uid: "TilLpLRDz4VWel79jVevmu3JsIH3", name: "Kenny", color: "var(--user-kenny)", order: 6 }
        ];
        for (const u of initialUsers) {
            await window.getNiptoCollection('users').doc(u.uid).set({
                name: u.name, color: u.color, order: u.order
            });
            ALL_USERS.push(u);
        }
    } else {
        snapshot.forEach(doc => {
            ALL_USERS.push({ uid: doc.id, ...doc.data() });
        });
    }
}

// Data Fetchers
export async function getWeeklyPointsData() {
    if (!state.apiToken) throw new Error("Missing Token");
    const QUERY = `{ activities { uid date user { uid name } task { name value } } }`;

    const data = await fetchNipto(QUERY);
    if (!data.activities) throw new Error("No activities data found.");

    let points = {};
    ALL_USERS.forEach(u => points[u.uid] = 0);
    
    const activities = [];
    data.activities.forEach(activity => {
        let awardedPts = (activity.task && activity.task.value) ? activity.task.value : 0;
        if (activity.user && points[activity.user.uid] !== undefined) {
            points[activity.user.uid] += awardedPts;
        } else if (activity.user && activity.user.name) {
            const matchedUser = ALL_USERS.find(u => u.name.toLowerCase() === activity.user.name.toLowerCase());
            if (matchedUser && matchedUser.uid !== activity.user.uid) {
                console.info(`[Nipto User Discovery] Auto-resolved ${matchedUser.name} UID to: ${activity.user.uid}`);
                points[activity.user.uid] = (points[matchedUser.uid] || 0) + awardedPts;
                delete points[matchedUser.uid];
                
                const oldUid = matchedUser.uid;
                matchedUser.uid = activity.user.uid;
                
                window.getNiptoCollection('users').doc(oldUid).delete();
                window.getNiptoCollection('users').doc(activity.user.uid).set({
                    name: matchedUser.name,
                    color: matchedUser.color,
                    order: matchedUser.order || 99
                });
                
                const oldToggle = document.getElementById(`toggle-${oldUid}`);
                if (oldToggle) {
                    oldToggle.id = `toggle-${activity.user.uid}`;
                    oldToggle.setAttribute('onclick', `setActiveUser('${activity.user.uid}')`);
                }
                const oldPts = document.getElementById(`points-${oldUid}`);
                if (oldPts) oldPts.id = `points-${activity.user.uid}`;
            } else if (!ALL_USERS.some(u => u.uid === activity.user.uid)) {
                console.info(`[Nipto User Discovery] Found unlisted user in activity: ${activity.user.name} (UID: ${activity.user.uid})`);
            }
        }
        activities.push({
            ...activity,
            parsedDate: new Date(activity.date),
            awardedPts: awardedPts 
        });
    });

    state.allWeekActivities = activities;
    state.currentWeekScores = { ...points };
    archiveActivitiesToFirestore(activities);
    return { points, activities };
}

// Fetches the list of past weeks from Nipto GraphQL API
export async function getWeeksList() {
    if (!state.apiToken) return [];
    try {
        const QUERY = `{ weeks(limit: 52, sort: DESC) { uid startDate endDate scores { user { uid name } score } } }`;
        const data = await fetchNipto(QUERY);
        state.weeksList = (data && data.weeks) ? data.weeks : [];
        return state.weeksList;
    } catch (e) {
        console.warn("Could not fetch weeks list from Nipto:", e);
        return state.weeksList || [];
    }
}

// Determines the week UID for a given Date
export function getWeekUidForDate(date) {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    if (state.weeksList && state.weeksList.length > 0) {
        const matched = state.weeksList.find(w => d >= new Date(w.startDate) && d <= new Date(w.endDate));
        if (matched) return matched.uid;
    }
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    const weekNr = 1 + Math.ceil((firstThursday - target) / 604800000);
    const year = target.getFullYear();
    return `${year}${String(weekNr).padStart(2, '0')}`;
}

// Archives live activities to Firestore activities_history for historical browsing
export async function archiveActivitiesToFirestore(activities) {
    if (!activities || !activities.length) return;
    try {
        const batch = window.db.batch();
        const labels = state.activityLabels || {};
        let count = 0;
        activities.forEach(act => {
            if (!act || !act.uid) return;
            const docRef = window.getNiptoCollection('activities_history').doc(act.uid);
            const label = labels[act.uid] || act.label || "";
            const actDate = act.parsedDate || (act.date ? new Date(act.date) : new Date());
            const weekUid = act.weekUid || getWeekUidForDate(actDate);
            const pts = (act.awardedPts !== undefined) ? act.awardedPts : ((act.task && act.task.value) ? act.task.value : 0);
            
            let uName = (act.user && act.user.name) ? act.user.name : "Unknown";
            if (uName === "Alyssa M") uName = "Alyssa";
            const knownUser = ALL_USERS.find(u => (act.user && act.user.uid && u.uid === act.user.uid) || (uName && u.name.toLowerCase() === uName.toLowerCase()));
            const userUid = (act.user && act.user.uid) ? act.user.uid : (knownUser ? knownUser.uid : "");
            const userName = (knownUser ? knownUser.name : uName) || "Unknown";

            const dataToSave = {
                uid: act.uid,
                date: actDate.toISOString(),
                userName: userName,
                userUid: userUid,
                taskName: (act.task && act.task.name) ? act.task.name : "",
                taskValue: (act.task && act.task.value) ? act.task.value : pts,
                awardedPts: pts,
                label: label,
                weekUid: weekUid || ""
            };
            batch.set(docRef, dataToSave, { merge: true });
            count++;

            // Also keep in-memory cache synchronized immediately
            if (weekUid) {
                if (!state.historicalActivitiesCache[weekUid]) state.historicalActivitiesCache[weekUid] = [];
                const existingIdx = state.historicalActivitiesCache[weekUid].findIndex(a => a.uid === act.uid);
                const cacheItem = {
                    uid: act.uid,
                    date: dataToSave.date,
                    parsedDate: actDate,
                    user: { uid: dataToSave.userUid, name: dataToSave.userName },
                    task: { name: dataToSave.taskName, value: dataToSave.taskValue },
                    awardedPts: pts,
                    label: label,
                    weekUid: weekUid
                };
                if (existingIdx >= 0) {
                    state.historicalActivitiesCache[weekUid][existingIdx] = cacheItem;
                } else {
                    state.historicalActivitiesCache[weekUid].unshift(cacheItem);
                }
            }
        });
        if (count > 0) await batch.commit();
    } catch (e) {
        console.warn("Failed to archive activities to Firestore:", e);
    }
}

// Pre-warms recent activities history in memory in the background
export async function prefetchActivitiesHistory() {
    try {
        if (!state.weeksList || state.weeksList.length === 0) {
            await getWeeksList();
        }
        const recentWeeks = (state.weeksList || []).slice(0, 2).map(w => w.uid);
        for (const wUid of recentWeeks) {
            if (!state.historicalActivitiesCache[wUid]) {
                await loadHistoricalActivitiesForWeek(wUid);
            }
        }
    } catch (e) {
        console.warn("Could not prefetch activities history:", e);
    }
}

// Loads historical activities for a prior week directly from official Nipto MCP (authoritative, reflects all deletions)
// with fallback to Firestore activities_history if offline.
export async function loadHistoricalActivitiesForWeek(weekUid, startDate, endDate) {
    if (state.historicalActivitiesCache[weekUid] && state.historicalActivitiesCache[weekUid].length > 0) {
        return state.historicalActivitiesCache[weekUid];
    }
    
    let activities = [];

    // 1. Primary authoritative source: Nipto MCP list_activities
    // Nipto MCP is the direct upstream source of truth—if a task was completed and then deleted,
    // it will NOT be returned by Nipto MCP, ensuring deleted tasks never linger with positive points.
    if (weekUid && weekUid !== 'all') {
        try {
            const mcpData = await fetchNiptoMcp('list_activities', { week: weekUid });
            if (mcpData && mcpData.activities) {
                const labels = state.activityLabels || {};
                mcpData.activities.forEach(act => {
                    let uName = act.member?.name || "";
                    if (uName === "Alyssa M") uName = "Alyssa";
                    const uObj = ALL_USERS.find(u => u.uid === act.member?.uid || (uName && u.name.toLowerCase() === uName.toLowerCase()));
                    const finalName = (uObj ? uObj.name : uName) || "Unknown";
                    const finalUid = act.member?.uid || (uObj ? uObj.uid : "");
                    const customLabel = labels[act.uid] || "";
                    const pts = (act.eggs !== undefined) ? act.eggs : (act.task?.value || 0);

                    activities.push({
                        uid: act.uid,
                        date: act.date,
                        parsedDate: new Date(act.date),
                        user: { uid: finalUid, name: finalName },
                        task: { uid: act.task?.uid, name: act.task?.name || "Activity", value: pts },
                        awardedPts: pts,
                        label: customLabel,
                        weekUid: weekUid
                    });
                });
            }
        } catch (mcpErr) {
            console.warn(`[Nipto MCP] Could not fetch activities for week ${weekUid}, falling back to Firestore:`, mcpErr);
        }
    }

    // 2. Fallback: Query Firestore activities_history only if MCP failed or returned no activities
    if (activities.length === 0 && weekUid && weekUid !== 'all') {
        try {
            const snapshot = await window.getNiptoCollection('activities_history')
                .where('weekUid', '==', weekUid)
                .get();

            if (snapshot && !snapshot.empty) {
                snapshot.forEach(doc => {
                    const data = doc.data();
                    let uName = data.userName || "";
                    if (uName === "Alyssa M") uName = "Alyssa";
                    const knownUser = ALL_USERS.find(u => (data.userUid && u.uid === data.userUid) || (uName && u.name.toLowerCase() === uName.toLowerCase()));
                    const userUid = data.userUid || (knownUser ? knownUser.uid : "");
                    const userName = (knownUser ? knownUser.name : uName) || "Unknown";
                    const label = (state.activityLabels && state.activityLabels[data.uid || doc.id]) || data.label || "";
                    const pts = (data.awardedPts !== undefined) ? data.awardedPts : (data.taskValue || 0);

                    activities.push({
                        uid: data.uid || doc.id,
                        date: data.date,
                        parsedDate: new Date(data.date),
                        user: { uid: userUid, name: userName },
                        task: { name: data.taskName || "Activity", value: pts },
                        awardedPts: pts,
                        label: label,
                        weekUid: data.weekUid || weekUid
                    });
                });
            }
        } catch (fsErr) {
            console.warn(`Firestore fallback error for week ${weekUid}:`, fsErr);
        }
    }

    // 3. Fallback date range filter if weekUid wasn't specified but dates were
    if (activities.length === 0 && startDate && endDate) {
        try {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const snapshot = await window.getNiptoCollection('activities_history')
                .where('date', '>=', start.toISOString())
                .where('date', '<=', end.toISOString())
                .get();

            if (snapshot && !snapshot.empty) {
                snapshot.forEach(doc => {
                    const data = doc.data();
                    let uName = data.userName || "";
                    if (uName === "Alyssa M") uName = "Alyssa";
                    const knownUser = ALL_USERS.find(u => (data.userUid && u.uid === data.userUid) || (uName && u.name.toLowerCase() === uName.toLowerCase()));
                    const userUid = data.userUid || (knownUser ? knownUser.uid : "");
                    const userName = (knownUser ? knownUser.name : uName) || "Unknown";
                    const label = (state.activityLabels && state.activityLabels[data.uid || doc.id]) || data.label || "";
                    const pts = (data.awardedPts !== undefined) ? data.awardedPts : (data.taskValue || 0);

                    activities.push({
                        uid: data.uid || doc.id,
                        date: data.date,
                        parsedDate: new Date(data.date),
                        user: { uid: userUid, name: userName },
                        task: { name: data.taskName || "Activity", value: pts },
                        awardedPts: pts,
                        label: label,
                        weekUid: data.weekUid || weekUid
                    });
                });
            }
        } catch (e) { /* ignore */ }
    }

    activities.sort((a, b) => b.parsedDate - a.parsedDate);
    state.historicalActivitiesCache[weekUid] = activities;
    return activities;
}

export async function logActivityToNipto(taskUid, targetDateStr, doers = null) {
    const activeDoers = (doers && doers.length > 0) ? doers : state.activeUsers;
    const data = await fetchNipto(
        `mutation CreateActivity($done: String!, $doers: [String!], $date: Date) { createActivity(done: $done, doers: $doers, date: $date) { uid } }`, 
        { done: taskUid, doers: activeDoers, date: targetDateStr }
    );
    
    let activityUids = [];
    if (data && data.createActivity) {
        if (Array.isArray(data.createActivity)) activityUids = data.createActivity.map(a => a.uid);
        else if (data.createActivity.uid) activityUids = [data.createActivity.uid];
    }

    if (activityUids.length > 0) {
        try {
            const tObj = state.tasks ? state.tasks.find(t => t.uid === taskUid) : null;
            const taskVal = tObj ? tObj.value : 0;
            const ptsPerUser = Math.ceil(taskVal / Math.max(1, activeDoers.length));
            const targetDate = new Date(targetDateStr || Date.now());
            const weekUid = getWeekUidForDate(targetDate);

            const activitiesToArchive = activityUids.map((uid, index) => {
                const doerUid = activeDoers[index] || activeDoers[0] || "";
                const userObj = ALL_USERS.find(u => u.uid === doerUid);
                // Also award to boys' allowance ledger if Ayden or DJ
                awardAllowancePoints(doerUid, ptsPerUser);
                return {
                    uid: uid,
                    date: targetDate.toISOString(),
                    user: { uid: doerUid, name: userObj ? userObj.name : "Unknown" },
                    task: { uid: taskUid, name: tObj ? tObj.name : "Task", value: ptsPerUser },
                    awardedPts: ptsPerUser,
                    weekUid: weekUid
                };
            });
            archiveActivitiesToFirestore(activitiesToArchive);
        } catch (e) {
            console.warn("Could not immediately archive logged activity:", e);
        }
    }

    pingActivitySignal();
    return activityUids;
}

export async function deleteActivityFromNipto(activityUid) {
    await fetchNipto(`mutation DeleteActivity($uid: String!) { deleteActivity(uid: $uid) { uid } }`, { uid: activityUid });
    
    // 1. Immediately remove from live memory cache for current week
    if (state.allWeekActivities) {
        state.allWeekActivities = state.allWeekActivities.filter(a => a.uid !== activityUid);
    }

    // 2. Remove from all historical in-memory caches
    if (state.historicalActivitiesCache) {
        Object.keys(state.historicalActivitiesCache).forEach(wUid => {
            state.historicalActivitiesCache[wUid] = state.historicalActivitiesCache[wUid].filter(a => a.uid !== activityUid);
        });
    }

    // 3. Delete from Firestore activities_history
    try {
        await window.getNiptoCollection('activities_history').doc(activityUid).delete();
    } catch (e) { /* ignore */ }

    pingActivitySignal();
}

export async function updateFirestoreDocument(collection, docId, data) {
    await window.getNiptoCollection(collection).doc(docId).update(data);
}

export async function deleteFirestoreDocument(collection, docId) {
    await window.getNiptoCollection(collection).doc(docId).delete();
}

export async function addFirestoreDocument(collection, data) {
    await window.getNiptoCollection(collection).add({
        ...data,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
    });
}

export async function loadRoutinesFromFirestore() {
    const snapshot = await window.getNiptoCollection('routines').get();
    state.routines = [];
    snapshot.forEach(doc => {
        state.routines.push({ uid: doc.id, ...doc.data() });
    });
}

// Notifies all other open dashboards that Nipto activity data changed,
// so their leaderboards/history refresh automatically.
function pingActivitySignal() {
    try {
        window.__localActivityPingAt = Date.now(); // lets this device ignore its own echo
        window.getNiptoCollection('sync_signals').doc('activity').set({
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.warn('Sync ping failed:', e));
    } catch (e) { /* non-critical, never block logging */ }
}


export async function syncNiptoTasks() {
    // 1. Updated to match the IDs in common.html
    const statusText = document.getElementById('status');
    const syncBtn = document.getElementById('syncNiptoBtn');
    
    // 2. Pull the already decoded token from localStorage
    const apiToken = localStorage.getItem("nipto_api_token");

    if (!apiToken) {
        statusText.innerText = "Error: Please unlock the dashboard first.";
        statusText.style.color = "#cf6679";
        document.getElementById('pinModal').style.display = 'flex';
        return;
    }

    syncBtn.disabled = true;
    statusText.innerText = "Connecting to Nipto API...";
    statusText.style.color = "#e0e0e0";

    const QUERY = `
        query GetTasks {
          tasks {
            uid
            group
            name
            value
          }
        }
    `;

    try {
        const response = await fetch(NIPTO_URL, {
            method: 'POST',
            headers: {
                'Authorization': apiToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: QUERY })
        });

        const jsonData = await response.json();

        if (jsonData.errors) {
            throw new Error(jsonData.errors[0].message || "GraphQL Error from Nipto");
        }

        const tasks = jsonData.data.tasks;
        if (!tasks || tasks.length === 0) {
            throw new Error("No tasks returned from Nipto.");
        }

        statusText.innerText = `Found ${tasks.length} live tasks. Syncing to Firebase...`;

        const activeNiptoTaskIds = new Set(tasks.map(task => task.uid));
        const firebaseSnapshot = await window.getNiptoCollection('nipto_tasks').get();
        
        const uidsToDelete = [];
        firebaseSnapshot.forEach(doc => {
            if (!activeNiptoTaskIds.has(doc.id)) {
                uidsToDelete.push(doc.id);
            }
        });

        let batch = window.db.batch();
        let operationCount = 0;
        let totalSynced = 0;
        let totalDeleted = 0;

        for (const task of tasks) {
            const docRef = window.getNiptoCollection('nipto_tasks').doc(task.uid);
            batch.set(docRef, task, { merge: true });
            operationCount++;
            totalSynced++;

            if (operationCount === 490) {
                await batch.commit();
                batch = window.db.batch(); 
                operationCount = 0;
            }
        }

        for (const orphanId of uidsToDelete) {
            const docRef = window.getNiptoCollection('nipto_tasks').doc(orphanId);
            batch.delete(docRef);
            operationCount++;
            totalDeleted++;

            if (operationCount === 490) {
                await batch.commit();
                batch = window.db.batch(); 
                operationCount = 0;
            }
        }

        if (operationCount > 0) {
            await batch.commit();
        }

        statusText.innerText = `Success! Synced ${totalSynced} tasks and removed ${totalDeleted} deleted tasks.`;
        statusText.style.color = "var(--success, #03dac6)";
        
        // Clear success message after 4 seconds
        setTimeout(() => {
            if (statusText.innerText.includes("Success!")) {
                statusText.innerText = "";
            }
        }, 4000);

    } catch (error) {
        console.error("Error syncing Nipto tasks:", error);
        statusText.innerText = `Error: ${error.message}`;
        statusText.style.color = "var(--danger, #cf6679)";
    } finally {
        syncBtn.disabled = false;
    }
}



// Loads the activityUid → real-name map used to relabel generic "assigned task" history rows.
export async function loadActivityLabelsFromFirestore() {
    const snapshot = await window.getNiptoCollection('activity_labels').get();
    state.activityLabels = {};
    snapshot.forEach(doc => { state.activityLabels[doc.id] = doc.data().name; });
}

// Stores the real (routine/to-do) name against each Nipto activity UID it created.
export async function saveActivityLabels(activityUids, name) {
    if (!activityUids || !activityUids.length || !name) return;
    if (!state.activityLabels) state.activityLabels = {};
    const batch = window.db.batch();
    activityUids.forEach(uid => {
        batch.set(window.getNiptoCollection('activity_labels').doc(uid), { name });
        batch.set(window.getNiptoCollection('activities_history').doc(uid), { label: name }, { merge: true });
        state.activityLabels[uid] = name;

        // Also keep in-memory historical activities cache in sync
        Object.keys(state.historicalActivitiesCache).forEach(wUid => {
            const cached = state.historicalActivitiesCache[wUid].find(a => a.uid === uid);
            if (cached) cached.label = name;
        });
    });
    try { await batch.commit(); } catch (e) { console.error("Error saving activity labels:", e); }
}

// ==========================================
// ALLOWANCE LEDGER (AYDEN & DJ: 1 PT = $0.01)
// ==========================================
const AYDEN_UID = "NMRQaRQbvCwBaJbiMFId";
const DJ_UID = "RMNUTP8VOHD9PDzNjf0g";

export async function loadAllowanceLedgerFromFirestore() {
    try {
        const doc = await window.getNiptoCollection('allowance_ledger').doc('boys').get();
        if (doc.exists) {
            const data = doc.data();
            state.allowanceLedger = {
                ayden: { unpaidPoints: data.ayden?.unpaidPoints || 0, payoutHistory: data.ayden?.payoutHistory || [] },
                dj: { unpaidPoints: data.dj?.unpaidPoints || 0, payoutHistory: data.dj?.payoutHistory || [] }
            };
        } else {
            state.allowanceLedger = {
                ayden: { unpaidPoints: 0, payoutHistory: [] },
                dj: { unpaidPoints: 0, payoutHistory: [] }
            };
            await window.getNiptoCollection('allowance_ledger').doc('boys').set(state.allowanceLedger);
        }
    } catch (e) {
        console.warn("Error loading allowance ledger:", e);
    }
    return state.allowanceLedger;
}

export async function saveAllowanceLedgerToFirestore() {
    try {
        await window.getNiptoCollection('allowance_ledger').doc('boys').set(state.allowanceLedger, { merge: true });
    } catch (e) {
        console.error("Error saving allowance ledger:", e);
    }
}

export async function awardAllowancePoints(userUid, points) {
    if (!points || points <= 0) return;
    let modified = false;
    if (userUid === AYDEN_UID) {
        state.allowanceLedger.ayden.unpaidPoints = (state.allowanceLedger.ayden.unpaidPoints || 0) + points;
        modified = true;
    } else if (userUid === DJ_UID) {
        state.allowanceLedger.dj.unpaidPoints = (state.allowanceLedger.dj.unpaidPoints || 0) + points;
        modified = true;
    }
    if (modified) {
        await saveAllowanceLedgerToFirestore();
        if (window.renderAllowanceUI) window.renderAllowanceUI();
    }
}

export async function payoutAllowance(boyKey, paidByName = "Admin") {
    const boy = state.allowanceLedger[boyKey];
    if (!boy || boy.unpaidPoints <= 0) return;
    const unpaid = boy.unpaidPoints;
    const dollars = (unpaid * 0.01).toFixed(2);
    const entry = {
        id: "payout_" + Date.now(),
        timestamp: new Date().toISOString(),
        points: unpaid,
        amount: parseFloat(dollars),
        paidBy: paidByName
    };
    boy.payoutHistory = boy.payoutHistory || [];
    boy.payoutHistory.unshift(entry);
    boy.unpaidPoints = 0;
    await saveAllowanceLedgerToFirestore();
    if (window.renderAllowanceUI) window.renderAllowanceUI();
    return entry;
}

export async function adjustAllowancePoints(boyKey, deltaPoints, note = "", adjustedByName = "Admin") {
    const boy = state.allowanceLedger[boyKey];
    if (!boy) return;
    const prev = boy.unpaidPoints || 0;
    const next = Math.max(0, prev + deltaPoints);
    boy.unpaidPoints = next;
    const entry = {
        id: "adj_" + Date.now(),
        timestamp: new Date().toISOString(),
        deltaPoints: deltaPoints,
        newBalance: next,
        note: note,
        adjustedBy: adjustedByName
    };
    boy.payoutHistory = boy.payoutHistory || [];
    boy.payoutHistory.unshift(entry);
    await saveAllowanceLedgerToFirestore();
    if (window.renderAllowanceUI) window.renderAllowanceUI();
    return entry;
}

// ==========================================
// CONFIG & INTEGRATIONS (GEMINI & HOME ASSISTANT)
// ==========================================
export async function loadIntegrationsConfigFromFirestore() {
    try {
        const doc = await window.getNiptoCollection('config').doc('integrations').get();
        if (doc.exists) {
            state.integrationsConfig = { ...state.integrationsConfig, ...doc.data() };
        } else {
            await window.getNiptoCollection('config').doc('integrations').set(state.integrationsConfig);
        }
    } catch (e) {
        console.warn("Error loading integrations config:", e);
    }
    return state.integrationsConfig;
}

export async function saveIntegrationsConfigToFirestore(cfg) {
    state.integrationsConfig = { ...state.integrationsConfig, ...cfg };
    try {
        await window.getNiptoCollection('config').doc('integrations').set(state.integrationsConfig, { merge: true });
    } catch (e) {
        console.error("Error saving integrations config:", e);
    }
}

// ==========================================
// NOTIFICATION PREFERENCES (ADULTS)
// ==========================================
export async function loadNotificationPreferencesFromFirestore() {
    try {
        const doc = await window.getNiptoCollection('preferences').doc('notifications').get();
        if (doc.exists) {
            state.notificationPreferences = { ...state.notificationPreferences, ...doc.data() };
        } else {
            await window.getNiptoCollection('preferences').doc('notifications').set(state.notificationPreferences);
        }
    } catch (e) {
        console.warn("Error loading notification preferences:", e);
    }
    return state.notificationPreferences;
}

export async function saveNotificationPreferencesToFirestore(prefs) {
    state.notificationPreferences = { ...state.notificationPreferences, ...prefs };
    try {
        await window.getNiptoCollection('preferences').doc('notifications').set(state.notificationPreferences, { merge: true });
    } catch (e) {
        console.error("Error saving notification preferences:", e);
    }
}

// ==========================================
// HOME ASSISTANT WEBHOOK DISPATCH
// ==========================================
export async function dispatchHomeAssistantNotification(payload) {
    const url = state.integrationsConfig?.haWebhookUrl;
    if (!url) {
        console.warn("Home Assistant Webhook URL not configured.");
        return false;
    }
    const publicUrl = state.integrationsConfig?.publicAppUrl || NIPTO_PUBLIC_URL;
    if (payload.dashboard_path && !payload.dashboard_path.startsWith('http')) {
        payload.dashboard_path = publicUrl;
    }
    if (Array.isArray(payload.actions)) {
        payload.actions = payload.actions.map(act => {
            if (act.uri && !act.uri.startsWith('http')) {
                const queryStr = act.uri.includes('?') ? act.uri.slice(act.uri.indexOf('?')) : '';
                act.uri = `${publicUrl}${queryStr}`;
            }
            return act;
        });
    }
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return res.ok;
    } catch (err) {
        console.error("Failed to POST to Home Assistant webhook:", err);
        return false;
    }
}

// ==========================================
// FIRESTORE-FIRST LEADERBOARD LOADER
// ==========================================
export async function loadWeeklyPointsFromFirestore() {
    // Computes weekly points from cached currentWeekScores or activities_history
    if (Object.keys(state.currentWeekScores || {}).length > 0) {
        return { points: state.currentWeekScores, activities: state.allWeekActivities || [] };
    }
    let points = {};
    ALL_USERS.forEach(u => { points[u.uid] = 0; });
    try {
        const now = new Date();
        const day = now.getDay();
        const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(now.getFullYear(), now.getMonth(), diffToMon, 0, 0, 0);
        const snapshot = await window.getNiptoCollection('activities_history')
            .where('date', '>=', mon.toISOString())
            .get();
        const activities = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const pts = data.awardedPts || data.taskValue || 0;
            if (data.userUid && points[data.userUid] !== undefined) {
                points[data.userUid] += pts;
            }
            activities.push({
                uid: doc.id,
                date: data.date,
                parsedDate: new Date(data.date),
                user: { uid: data.userUid, name: data.userName },
                task: { name: data.taskName, value: pts },
                awardedPts: pts,
                label: data.label || ""
            });
        });
        state.currentWeekScores = { ...points };
        state.allWeekActivities = activities;
        return { points, activities };
    } catch (e) {
        console.warn("Could not aggregate weekly points from Firestore cache:", e);
        return { points, activities: [] };
    }
}

