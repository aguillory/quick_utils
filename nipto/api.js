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

export async function logActivityToNipto(taskUid, targetDateStr) {
    const data = await fetchNipto(
        `mutation CreateActivity($done: String!, $doers: [String!], $date: Date) { createActivity(done: $done, doers: $doers, date: $date) { uid } }`, 
        { done: taskUid, doers: state.activeUsers, date: targetDateStr }
    );
    
    let activityUids = [];
    if (data && data.createActivity) {
        if (Array.isArray(data.createActivity)) activityUids = data.createActivity.map(a => a.uid);
        else if (data.createActivity.uid) activityUids = [data.createActivity.uid];
    }
    return activityUids;
}

export async function deleteActivityFromNipto(activityUid) {
    await fetchNipto(`mutation DeleteActivity($uid: String!) { deleteActivity(uid: $uid) { uid } }`, { uid: activityUid });
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