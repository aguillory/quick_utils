// api.js
import { state, ALL_USERS } from './state.js';

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
    const snapshot = await window.db.collection('nipto_tasks').get();
    state.tasks = snapshot.docs.map(doc => ({
        uid: doc.id,
        name: doc.data().name,
        value: doc.data().value || 0,
        category: doc.data().group || "📌",
        dashboardUsers: doc.data().dashboardUsers || [],
        pinnedUsers: doc.data().pinnedUsers || []
    }));
}

export async function loadChoresFromFirestore() {
    const snapshot = await window.db.collection('custom_chores').get();
    state.customChores = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
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
        } else if (activity.user) {
            if (activity.user.name && activity.user.name.toLowerCase() === 'kenny') {
                const kennyObj = ALL_USERS.find(u => u.name.toLowerCase() === 'kenny');
                if (kennyObj && (kennyObj.uid === 'TilLpLRDz4VWel79jVevmu3JsIH3' || !kennyObj.uid || kennyObj.uid.startsWith('KENNY_UID'))) {
                    kennyObj.uid = activity.user.uid;
                    localStorage.setItem("nipto_kenny_uid", activity.user.uid);
                    window.KENNY_UID = activity.user.uid;
                    points[activity.user.uid] = awardedPts;
                    console.info(`[Nipto User Discovery] Auto-resolved Kenny UID: ${activity.user.uid}`);
                    const oldToggle = document.getElementById('toggle-TilLpLRDz4VWel79jVevmu3JsIH3');
                    if (oldToggle) {
                        oldToggle.id = `toggle-${activity.user.uid}`;
                        oldToggle.setAttribute('onclick', `setActiveUser('${activity.user.uid}')`);
                    }
                    const oldPts = document.getElementById('points-TilLpLRDz4VWel79jVevmu3JsIH3');
                    if (oldPts) oldPts.id = `points-${activity.user.uid}`;
                }
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
    return { points, activities };
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
    pingActivitySignal();
    return activityUids;
}

export async function deleteActivityFromNipto(activityUid) {
    await fetchNipto(`mutation DeleteActivity($uid: String!) { deleteActivity(uid: $uid) { uid } }`, { uid: activityUid });
    pingActivitySignal();
}

export async function updateFirestoreDocument(collection, docId, data) {
    await window.db.collection(collection).doc(docId).update(data);
}

export async function deleteFirestoreDocument(collection, docId) {
    await window.db.collection(collection).doc(docId).delete();
}

export async function addFirestoreDocument(collection, data) {
    await window.db.collection(collection).add({
        ...data,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
    });
}

export async function loadRoutinesFromFirestore() {
    try {
        const snapshot = await window.db.collection('routines').get();
        state.routines = [];
        snapshot.forEach(doc => {
            state.routines.push({ uid: doc.id, ...doc.data() });
        });
    } catch (error) {
        console.error("Error loading routines:", error);
    }
}

// Notifies all other open dashboards that Nipto activity data changed,
// so their leaderboards/history refresh automatically.
function pingActivitySignal() {
    try {
        window.__localActivityPingAt = Date.now(); // lets this device ignore its own echo
        window.db.collection('sync_signals').doc('activity').set({
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
        const firebaseSnapshot = await window.db.collection('nipto_tasks').get();
        
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
            const docRef = window.db.collection('nipto_tasks').doc(task.uid);
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
            const docRef = window.db.collection('nipto_tasks').doc(orphanId);
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
    try {
        const snapshot = await window.db.collection('activity_labels').get();
        state.activityLabels = {};
        snapshot.forEach(doc => { state.activityLabels[doc.id] = doc.data().name; });
    } catch (e) {
        console.error("Error loading activity labels:", e);
        state.activityLabels = state.activityLabels || {};
    }
}

// Stores the real (routine/to-do) name against each Nipto activity UID it created.
export async function saveActivityLabels(activityUids, name) {
    if (!activityUids || !activityUids.length || !name) return;
    if (!state.activityLabels) state.activityLabels = {};
    const batch = window.db.batch();
    activityUids.forEach(uid => {
        batch.set(window.db.collection('activity_labels').doc(uid), { name });
        state.activityLabels[uid] = name;
    });
    try { await batch.commit(); } catch (e) { console.error("Error saving activity labels:", e); }
}