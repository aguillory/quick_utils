// api.js
import { state, ALL_USERS, NIPTO_PUBLIC_URL } from './state.js';
import { getLocalTodayKey, getLocalWeekBounds, isDateInLocalWeek } from './utils.js';
export { getLocalTodayKey, getLocalWeekBounds, isDateInLocalWeek };

const NIPTO_URL = "https://nipto.app/graphql";
const KNOWN_DAILY_ROUTINE_SLUGS = new Set([
    "feed orion",
    "check kevin's water",
    "check kevins water",
    "feed turtle",
    "collect eggs"
]);

// Core Nipto Fetch Wrapper (Only invoked on explicit task logging or manual Sync button)
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

// Firestore Loaders (Strictly Firestore-first per AGENTS.md)
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
    ALL_USERS.length = 0;
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

// Normalizes a routine document and repairs corrupted daily schedules (e.g. "Feed Orion", "Check Kevin's Water")
export function normalizeAndHealRoutineDoc(rawDoc) {
    if (!rawDoc) return rawDoc;
    const r = { ...rawDoc };
    const cleanName = (r.name || r.title || '').trim().toLowerCase().replace(/[\u2018\u2019]/g, "'");
    const isKnownDailyCare = KNOWN_DAILY_ROUTINE_SLUGS.has(cleanName);

    let sched = (r.schedule && typeof r.schedule === 'object')
        ? { ...r.schedule }
        : { type: typeof r.schedule === 'string' ? r.schedule.toLowerCase() : 'daily' };

    const rawDays = Array.isArray(sched.daysOfWeek) ? sched.daysOfWeek : (Array.isArray(r.daysOfWeek) ? r.daysOfWeek : null);
    const uniqueDays = rawDays
        ? Array.from(new Set(rawDays.map(d => Number(d)).filter(d => !isNaN(d) && d >= 0 && d <= 6)))
        : null;

    let needsFirestoreRepair = false;

    // Repair 1: Known daily animal care routines or explicit daily type with polluted daysOfWeek / unit
    if (
        isKnownDailyCare ||
        sched.type === 'daily' ||
        (sched.type === 'weekly' && (!uniqueDays || uniqueDays.length === 0 || uniqueDays.length === 7)) ||
        (sched.type === 'interval' && Number(sched.value || sched.interval || 1) === 1 && String(sched.unit || 'days').toLowerCase().startsWith('day'))
    ) {
        if (sched.type !== 'daily' || (Array.isArray(sched.daysOfWeek) && sched.daysOfWeek.length > 0 && sched.daysOfWeek.length < 7)) {
            needsFirestoreRepair = true;
        }
        sched.type = 'daily';
        sched.resetType = sched.resetType || 'midnight';
        sched.timeOfDay = sched.timeOfDay || r.timeOfDay || 'Anytime';
        delete sched.daysOfWeek;
        delete sched.days;
        delete sched.unit;
        delete sched.value;
        delete r.daysOfWeek;
        delete r.days;
    } else if (sched.type === 'weekly' && uniqueDays && uniqueDays.length > 0 && uniqueDays.length < 7) {
        sched.daysOfWeek = uniqueDays.sort((a, b) => a - b);
    }

    r.schedule = sched;
    if (!r.category) r.category = 'Home';

    if (needsFirestoreRepair && r.uid && window.db) {
        window.getNiptoCollection('routines').doc(r.uid).update({
            schedule: sched,
            daysOfWeek: window.firebase.firestore.FieldValue.delete()
        }).catch(err => console.warn(`Could not auto-heal routine ${r.name}:`, err));
    }

    return r;
}

export async function loadRoutinesFromFirestore() {
    const snapshot = await window.getNiptoCollection('routines').get();
    state.routines = [];
    snapshot.forEach(doc => {
        const normalized = normalizeAndHealRoutineDoc({ uid: doc.id, ...doc.data() });
        state.routines.push(normalized);
    });
    return state.routines;
}

export async function loadTodosFromFirestore() {
    try {
        const snapshot = await window.getNiptoCollection('custom_tasks').orderBy('createdAt', 'desc').get();
        state.todoTasksData = [];
        snapshot.forEach(doc => {
            state.todoTasksData.push({ id: doc.id, ...doc.data() });
        });
        return state.todoTasksData;
    } catch (e) {
        console.error("Error loading todos from Firestore:", e);
        state.todoTasksData = [];
        return [];
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

            const taskUid = (act.task && act.task.uid) ? act.task.uid : (act.taskUid || "");
            const dataToSave = {
                uid: act.uid,
                taskUid: taskUid,
                date: actDate.toISOString(),
                dateKey: getLocalTodayKey(actDate),
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

            if (weekUid) {
                if (!state.historicalActivitiesCache[weekUid]) state.historicalActivitiesCache[weekUid] = [];
                const existingIdx = state.historicalActivitiesCache[weekUid].findIndex(a => a.uid === act.uid);
                const cacheItem = {
                    uid: act.uid,
                    taskUid: taskUid,
                    date: dataToSave.date,
                    parsedDate: actDate,
                    user: { uid: dataToSave.userUid, name: dataToSave.userName },
                    task: { uid: taskUid, name: dataToSave.taskName, value: dataToSave.taskValue },
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
                awardAllowancePoints(doerUid, ptsPerUser);
                const actRecord = {
                    uid: uid,
                    taskUid: taskUid,
                    date: targetDate.toISOString(),
                    parsedDate: targetDate,
                    dateKey: getLocalTodayKey(targetDate),
                    user: { uid: doerUid, name: userObj ? userObj.name : "Unknown" },
                    task: { uid: taskUid, name: tObj ? tObj.name : "Task", value: ptsPerUser },
                    awardedPts: ptsPerUser,
                    weekUid: weekUid
                };
                if (isDateInLocalWeek(targetDate, getLocalWeekBounds(new Date(), 0))) {
                    state.allWeekActivities.unshift(actRecord);
                    state.currentWeekScores[doerUid] = (state.currentWeekScores[doerUid] || 0) + ptsPerUser;
                    if ((state.doneWeekOffset || 0) === 0 && state.weeklyActivitiesForDone) {
                        state.weeklyActivitiesForDone.unshift(actRecord);
                    }
                }
                return actRecord;
            });
            await archiveActivitiesToFirestore(activitiesToArchive);
        } catch (e) {
            console.warn("Could not immediately archive logged activity:", e);
        }
    }

    pingActivitySignal();
    return activityUids;
}

export async function deleteActivityFromNipto(activityUid) {
    await fetchNipto(`mutation DeleteActivity($uid: String!) { deleteActivity(uid: $uid) { uid } }`, { uid: activityUid });

    if (state.allWeekActivities) {
        const removed = state.allWeekActivities.find(a => a.uid === activityUid);
        if (removed && removed.user?.uid && removed.awardedPts) {
            state.currentWeekScores[removed.user.uid] = Math.max(0, (state.currentWeekScores[removed.user.uid] || 0) - removed.awardedPts);
            await revokeAllowancePoints(removed.user.uid, removed.awardedPts);
        }
        state.allWeekActivities = state.allWeekActivities.filter(a => a.uid !== activityUid);
    }
    if (state.weeklyActivitiesForDone) {
        state.weeklyActivitiesForDone = state.weeklyActivitiesForDone.filter(a => a.uid !== activityUid);
    }
    if (state.historicalActivitiesCache) {
        Object.keys(state.historicalActivitiesCache).forEach(wUid => {
            state.historicalActivitiesCache[wUid] = state.historicalActivitiesCache[wUid].filter(a => a.uid !== activityUid);
        });
    }

    try {
        await window.getNiptoCollection('activities_history').doc(activityUid).delete();
    } catch (e) { /* ignore */ }

    pingActivitySignal();
}

/**
 * Clamps and normalizes custom point values onto 5-point steps in [5..100].
 */
export function clampStep5Points(val, fallback = 5) {
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.min(100, Math.max(5, Math.round(num / 5) * 5));
}

/**
 * Returns true if a Nipto task entry is one of the generic "Assigned task #pts" buckets.
 */
export function isGenericAssignedTask(taskObj) {
    if (!taskObj) return false;
    if (taskObj.group === '\u2705' || taskObj.category === '\u2705') return true;
    return /^assigned tasks?\b/i.test((taskObj.name || '').trim());
}

/**
 * Resolves the canonical generic "Assigned task #pts" entry in state.tasks for a step-5 point value.
 * Prefers uid 'UHWcbLzvgPQZTqWeAHOc' when pts === 55.
 */
export function findGenericAssignedTaskByPoints(pts) {
    const targetPts = clampStep5Points(pts, 5);
    const tasksPool = state.tasks || [];
    let genericPool = tasksPool.filter(t => isGenericAssignedTask(t) && Number(t.value) > 0);
    if (genericPool.length === 0) {
        genericPool = tasksPool.filter(t => Number(t.value) > 0);
    }
    if (genericPool.length === 0) return null;

    if (targetPts === 55) {
        const preferred55 = genericPool.find(t => t.uid === 'UHWcbLzvgPQZTqWeAHOc');
        if (preferred55) return preferred55;
    }

    const exact = genericPool.find(t => Number(t.value) === targetPts);
    if (exact) return exact;

    let nearest = genericPool[0];
    let minDiff = Math.abs(Number(nearest.value) - targetPts);
    for (const cand of genericPool) {
        const diff = Math.abs(Number(cand.value) - targetPts);
        if (diff < minDiff) {
            minDiff = diff;
            nearest = cand;
        }
    }
    return nearest || null;
}

/**
 * Single canonical routine point resolver.
 * Precedence: positive routine.points -> positive linked Nipto task value -> 5 (clamped step-5 in [5..100]).
 */
export function getRoutinePoints(r) {
    const linkedTask = (state.tasks || []).find(t => t.uid === r?.linkedNiptoTask);
    const hasExplicitPts = r?.points !== undefined && r?.points !== null && r?.points !== '' && Number(r.points) > 0;
    const raw = hasExplicitPts
        ? Number(r.points)
        : (linkedTask && Number(linkedTask.value) > 0 ? Number(linkedTask.value) : 5);
    return clampStep5Points(raw, 5);
}

/**
 * Finds the best matching generic point-value task in state.tasks for a given points value
 * (or uses linkedNiptoTaskUid if non-generic and matching pts), logs the activity to Nipto via GraphQL,
 * saves the To-Do's title to saveActivityLabels(activityUids, taskTitle),
 * and returns the array of created Nipto activity UIDs.
 */
export async function logCustomPointsToNipto(points, taskTitle, doerUids = null, dateIso = null, linkedNiptoTaskUid = null) {
    if (!state.apiToken) return [];
    const rawPoints = Number(points);
    if (!Number.isFinite(rawPoints) || rawPoints <= 0) return [];
    const pts = clampStep5Points(rawPoints, 5);

    const activeDoers = (Array.isArray(doerUids) && doerUids.length > 0)
        ? doerUids
        : (state.activeUsers && state.activeUsers.length > 0 ? state.activeUsers : []);
    if (activeDoers.length === 0) return [];

    const targetIso = dateIso || new Date().toISOString();
    const tasksPool = state.tasks || [];

    // 1. Only use explicit linkedNiptoTaskUid when it exists in state.tasks, matches pts, and is NOT a generic bucket
    const linkedTask = linkedNiptoTaskUid ? tasksPool.find(t => t.uid === linkedNiptoTaskUid) : null;
    if (linkedTask && Number(linkedTask.value) === pts && !isGenericAssignedTask(linkedTask)) {
        const uids = await logActivityToNipto(linkedTask.uid, targetIso, activeDoers);
        if (uids.length > 0 && taskTitle) {
            await saveActivityLabels(uids, taskTitle);
        }
        return uids;
    }

    // 2. Otherwise resolve deterministically via generic "Assigned task #pts" buckets
    const chosenTask = findGenericAssignedTaskByPoints(pts);
    if (!chosenTask) return [];

    const createdUids = await logActivityToNipto(chosenTask.uid, targetIso, activeDoers);
    if (createdUids && createdUids.length > 0 && taskTitle) {
        await saveActivityLabels(createdUids, taskTitle);
    }

    return createdUids || [];
}

// Scans completed custom_tasks and routines for items stored as completed without corresponding Nipto API activity,
// and automatically logs them to Nipto and awards their points once unlocked.
export async function repairMissingNiptoPoints() {
    if (!state.apiToken) return { repairedCount: 0, totalPoints: 0 };

    let repairedCount = 0;
    let totalPoints = 0;
    const nowIso = new Date().toISOString();

    try {
        // 1. Repair completed custom_tasks (To-Dos) lacking Nipto activity UIDs
        const todoSnap = await window.getNiptoCollection('custom_tasks').where('completed', '==', true).get();
        for (const doc of todoSnap.docs) {
            const data = doc.data();
            const actUids = Array.isArray(data.completedActivityUids) ? data.completedActivityUids : (data.completedActivityUid ? [data.completedActivityUid] : []);
            if (actUids.length === 0) {
                const pts = Number(data.points) || 5;
                const doerUids = (Array.isArray(data.completedBy) && data.completedBy.length > 0)
                    ? data.completedBy
                    : (Array.isArray(data.assignees) && data.assignees.length > 0 ? data.assignees : [state.activeUsers[0] || ALL_USERS[0].uid]);
                const compDateIso = data.completedAt || nowIso;

                console.log(`[Points Repair] Logging missing To-Do to Nipto: "${data.name}" (${pts} pts) for [${doerUids.join(', ')}]`);
                try {
                    const createdUids = await logCustomPointsToNipto(pts, data.name, doerUids, compDateIso, data.linkedNiptoTask || null);
                    if (createdUids && createdUids.length > 0) {
                        await doc.ref.update({
                            points: pts,
                            completedActivityUids: createdUids,
                            completedActivityUid: createdUids[0] || null,
                            repairedAt: nowIso
                        });
                        repairedCount++;
                        totalPoints += pts;

                        // Also ensure daily_completions record exists and has non-zero points
                        const dateKey = getLocalTodayKey(new Date(compDateIso));
                        const doerName = doerUids.map(u => ALL_USERS.find(usr => usr.uid === u)?.name || 'Someone').join(', ');
                        await recordDailyCompletion({
                            id: `todo_${doc.id}`,
                            itemId: doc.id,
                            sourceType: 'todo',
                            title: data.name,
                            user: doerName,
                            userUid: doerUids[0],
                            points: pts,
                            completedAt: compDateIso,
                            dateKey: dateKey
                        });
                    }
                } catch (e) {
                    console.warn(`[Points Repair] Failed to log To-Do "${data.name}":`, e);
                }
            }
        }

        // 2. Repair routine completions completed without points (or without Nipto activity)
        const routineSnap = await window.getNiptoCollection('routines').get();
        for (const rDoc of routineSnap.docs) {
            const rData = rDoc.data();
            const completions = rData.completionsByDate || {};
            let routineModified = false;
            const updatedCompletions = { ...completions };

            for (const [dateKey, comp] of Object.entries(completions)) {
                // Focus on completions from this week or current month that have a linked Nipto task but no activity logged
                if (comp && comp.withoutPoints === false && rData.linkedNiptoTask && dateKey >= '2026-11-01') {
                    // Check if an activity exists in activities_history for this routine + dateKey + user
                    const doerUid = comp.completedByUid || (Array.isArray(rData.assignees) ? rData.assignees[0] : ALL_USERS[0].uid);
                    const alreadyArchived = (state.allWeekActivities || []).some(a => {
                        const aDateKey = a.date ? getLocalTodayKey(new Date(a.date)) : '';
                        return aDateKey === dateKey && (a.task?.uid === rData.linkedNiptoTask || a.task?.name === rData.name);
                    });

                    if (!alreadyArchived && !comp.niptoActivityUid) {
                        const pts = getRoutinePoints(rData);
                        const compIso = comp.completedAt || new Date(`${dateKey}T12:00:00`).toISOString();
                        console.log(`[Points Repair] Logging routine completion to Nipto: "${rData.name}" (${pts} pts) on ${dateKey}`);
                        try {
                            const uids = await logActivityToNipto(rData.linkedNiptoTask, compIso, [doerUid]);
                            if (uids && uids.length > 0) {
                                updatedCompletions[dateKey] = {
                                    ...comp,
                                    niptoActivityUid: uids[0],
                                    repairedAt: nowIso
                                };
                                routineModified = true;
                                repairedCount++;
                                totalPoints += pts;
                            }
                        } catch (re) {
                            console.warn(`[Points Repair] Failed to log routine "${rData.name}" on ${dateKey}:`, re);
                        }
                    }
                }
            }

            if (routineModified) {
                await rDoc.ref.update({
                    completionsByDate: updatedCompletions,
                    updatedAt: nowIso
                });
            }
        }

        if (repairedCount > 0) {
            console.log(`[Points Repair Complete] Successfully repaired ${repairedCount} chores, awarding ${totalPoints} points.`);
            pingActivitySignal();
        }
    } catch (err) {
        console.error("[Points Repair] Error scanning/repairing missing points:", err);
    }

    return { repairedCount, totalPoints };
}

let isReconcilingNipto = false;
let lastReconcileTime = 0;

/**
 * Reconciles external chore completions from the official Nipto app into Firestore.
 * Queries Nipto GraphQL for recent activities, cross-checks against Firestore activities_history,
 * and backfills any missing activities into activities_history, daily_completions, and allowance ledger.
 */
export async function reconcileNiptoActivitiesToFirestore(force = false, lookbackDays = 14) {
    if (isReconcilingNipto) {
        console.log("[Nipto Reconcile] Sync already in progress, skipping.");
        return { reconciledCount: 0, newPoints: 0 };
    }

    const now = Date.now();
    if (!force && (now - lastReconcileTime < 45000)) {
        return { reconciledCount: 0, newPoints: 0 };
    }

    const apiToken = localStorage.getItem("nipto_api_token") || state.apiToken;
    if (!apiToken) {
        console.warn("[Nipto Reconcile] Skipped: No API token available (unlock required).");
        return { reconciledCount: 0, newPoints: 0 };
    }

    isReconcilingNipto = true;
    lastReconcileTime = now;

    let reconciledCount = 0;
    let newPoints = 0;

    try {
        const QUERY = `
            query GetRecentActivities {
                activities {
                    uid
                    date
                    draft
                    user {
                        uid
                        name
                    }
                    task {
                        uid
                        name
                        value
                    }
                }
            }
        `;

        const data = await fetchNipto(QUERY);
        const activities = (data && Array.isArray(data.activities)) ? data.activities : [];
        const effectiveDays = (typeof lookbackDays === 'number' && lookbackDays > 0) ? lookbackDays : 14;
        const cutoffMs = Date.now() - effectiveDays * 86400000;
        const recentActivities = activities.filter(act => {
            if (!act || !act.uid || act.draft || !act.date) return false;
            const actMs = new Date(act.date).getTime();
            return !isNaN(actMs) && actMs >= cutoffMs;
        });

        if (recentActivities.length === 0) {
            isReconcilingNipto = false;
            return { reconciledCount: 0, newPoints: 0 };
        }

        // Determine date range for single-pass lookup against Firestore activities_history (bounded to lookbackDays)
        let oldestMs = Date.now();
        recentActivities.forEach(a => {
            const d = new Date(a.date).getTime();
            if (!isNaN(d) && d >= cutoffMs && d < oldestMs) oldestMs = d;
        });
        const boundedStartMs = Math.max(cutoffMs, oldestMs) - 24 * 60 * 60 * 1000;
        const minDateIso = new Date(boundedStartMs).toISOString();

        const existingSnap = await window.getNiptoCollection('activities_history')
            .where('date', '>=', minDateIso)
            .get();

        const existingUids = new Set(existingSnap.docs.map(doc => doc.id));

        // Filter activities within the lookback window that do not yet exist in Firestore
        const missingActivities = recentActivities.filter(act => !existingUids.has(act.uid));

        if (missingActivities.length === 0) {
            isReconcilingNipto = false;
            return { reconciledCount: 0, newPoints: 0 };
        }

        console.log(`[Nipto Reconcile] Found ${missingActivities.length} activities in Nipto not yet recorded in Firestore.`);

        const currentWeekBounds = getLocalWeekBounds(new Date(), 0);
        const labels = state.activityLabels || {};
        let batch = window.db.batch();
        let opCount = 0;
        const dailyItemsByDateKey = {};

        for (const act of missingActivities) {
            const actDate = act.date ? new Date(act.date) : new Date();
            const dateKey = getLocalTodayKey(actDate);
            const weekUid = getWeekUidForDate(actDate);
            const pts = (act.task && act.task.value) ? act.task.value : 0;

            let uName = (act.user && act.user.name) ? act.user.name : "Unknown";
            if (uName === "Alyssa M") uName = "Alyssa";
            const knownUser = ALL_USERS.find(u => (act.user && act.user.uid && u.uid === act.user.uid) || (uName && u.name.toLowerCase() === uName.toLowerCase()));
            const userUid = (act.user && act.user.uid) ? act.user.uid : (knownUser ? knownUser.uid : "");
            const userName = (knownUser ? knownUser.name : uName) || "Unknown";
            const taskName = (act.task && act.task.name) ? act.task.name : "Activity";
            const taskUid = (act.task && act.task.uid) ? act.task.uid : "";
            const customLabel = labels[act.uid] || "";

            // 1. Write to activities_history
            const actDocRef = window.getNiptoCollection('activities_history').doc(act.uid);
            const historyRecord = {
                uid: act.uid,
                taskUid: taskUid,
                date: actDate.toISOString(),
                dateKey: dateKey,
                userName: userName,
                userUid: userUid,
                taskName: taskName,
                taskValue: pts,
                awardedPts: pts,
                label: customLabel,
                weekUid: weekUid || "",
                reconciledFromNipto: true
            };
            batch.set(actDocRef, historyRecord, { merge: true });
            opCount++;

            // 2. Queue for daily_completions under canonical nipto_{actUid} key
            const dailyItemId = `nipto_${act.uid}`;
            const dailyEntry = {
                id: dailyItemId,
                itemId: taskUid || act.uid,
                sourceType: 'nipto',
                title: taskName,
                points: pts,
                user: userName,
                userUid: userUid,
                completedAt: actDate.toISOString(),
                dateKey: dateKey,
                activityUid: act.uid
            };

            if (!dailyItemsByDateKey[dateKey]) dailyItemsByDateKey[dateKey] = {};
            dailyItemsByDateKey[dateKey][dailyItemId] = dailyEntry;

            // Update in-memory daily completions cache
            if (!state.persistedDailyCompletions) state.persistedDailyCompletions = [];
            const existingIdx = state.persistedDailyCompletions.findIndex(it => it.id === dailyItemId);
            if (existingIdx !== -1) {
                state.persistedDailyCompletions[existingIdx] = { ...state.persistedDailyCompletions[existingIdx], ...dailyEntry };
            } else {
                state.persistedDailyCompletions.unshift(dailyEntry);
            }

            // 3. Award allowance points if this is current week and user is Ayden or DJ
            if (pts > 0 && isDateInLocalWeek(actDate, currentWeekBounds)) {
                if (userUid === AYDEN_UID || userUid === DJ_UID) {
                    await awardAllowancePoints(userUid, pts);
                }
            }

            // 4. Update in-memory week state if within current week
            if (isDateInLocalWeek(actDate, currentWeekBounds)) {
                const inMemoryRecord = {
                    uid: act.uid,
                    taskUid: taskUid,
                    date: actDate.toISOString(),
                    parsedDate: actDate,
                    dateKey: dateKey,
                    user: { uid: userUid, name: userName },
                    task: { uid: taskUid, name: taskName, value: pts },
                    awardedPts: pts,
                    label: customLabel,
                    weekUid: weekUid
                };
                if (!state.allWeekActivities.some(a => a.uid === act.uid)) {
                    state.allWeekActivities.unshift(inMemoryRecord);
                }
                if ((state.doneWeekOffset || 0) === 0 && state.weeklyActivitiesForDone && !state.weeklyActivitiesForDone.some(a => a.uid === act.uid)) {
                    state.weeklyActivitiesForDone.unshift(inMemoryRecord);
                }
                if (userUid) {
                    state.currentWeekScores[userUid] = (state.currentWeekScores[userUid] || 0) + pts;
                }
            }

            // 5. Check if this activity matches a linked routine (non-generic task only)
            if (taskUid && !isGenericAssignedTask({ uid: taskUid, name: taskName })) {
                const matchingRoutine = (state.routines || []).find(r => r.linkedNiptoTask === taskUid);
                if (matchingRoutine) {
                    matchingRoutine.completionsByDate = matchingRoutine.completionsByDate || {};
                    if (!matchingRoutine.completionsByDate[dateKey]) {
                        matchingRoutine.completionsByDate[dateKey] = {
                            dateKey: dateKey,
                            completedAt: actDate.toISOString(),
                            completedBy: userName,
                            completedByUid: userUid,
                            points: pts,
                            withoutPoints: false,
                            niptoActivityUids: [act.uid],
                            niptoActivityUid: act.uid
                        };
                        window.getNiptoCollection('routines').doc(matchingRoutine.uid).update({
                            [`completionsByDate.${dateKey}`]: matchingRoutine.completionsByDate[dateKey],
                            updatedAt: new Date().toISOString()
                        }).catch(e => console.warn(`Could not sync routine completion for ${matchingRoutine.name}:`, e));
                    }
                }

                // Check if this activity matches a linked custom To-Do
                const matchingTodo = (state.todoTasksData || []).find(t => t.linkedNiptoTask === taskUid && !t.completed);
                if (matchingTodo) {
                    matchingTodo.completed = true;
                    matchingTodo.completedAt = actDate.toISOString();
                    matchingTodo.completedBy = [userUid];
                    matchingTodo.completedActivityUids = [act.uid];
                    matchingTodo.completedActivityUid = act.uid;
                    window.getNiptoCollection('custom_tasks').doc(matchingTodo.id).update({
                        completed: true,
                        completedAt: actDate.toISOString(),
                        completedBy: [userUid],
                        completedActivityUids: [act.uid],
                        completedActivityUid: act.uid
                    }).catch(e => console.warn(`Could not sync To-Do completion for ${matchingTodo.name}:`, e));
                }
            }

            reconciledCount++;
            newPoints += pts;

            if (opCount >= 450) {
                await batch.commit();
                batch = window.db.batch();
                opCount = 0;
            }
        }

        // Commit queued daily_completions docs
        for (const [dKey, itemsMap] of Object.entries(dailyItemsByDateKey)) {
            const dailyDocRef = window.getNiptoCollection('daily_completions').doc(dKey);
            batch.set(dailyDocRef, {
                dateKey: dKey,
                updatedAt: new Date().toISOString(),
                items: itemsMap
            }, { merge: true });
            opCount++;
            if (opCount >= 450) {
                await batch.commit();
                batch = window.db.batch();
                opCount = 0;
            }
        }

        if (opCount > 0) {
            await batch.commit();
        }

        if (reconciledCount > 0) {
            console.log(`[Nipto Reconcile Complete] Reconciled ${reconciledCount} activities (+${newPoints} pts) from Nipto into Firestore.`);
            if (window.updateLeaderboardUI) window.updateLeaderboardUI();
            if (window.rebuildCompletedToday) window.rebuildCompletedToday();
            if (window.renderDoneTodayFeed) window.renderDoneTodayFeed();
            if (window.rebuildCompletedThisWeek) window.rebuildCompletedThisWeek();
            if (window.renderDoneThisWeekFeed) window.renderDoneThisWeekFeed();
            if (window.renderRollingSchedule) window.renderRollingSchedule();
            if (window.renderTodoTasks) window.renderTodoTasks();
            if (window.renderAllowanceUI) window.renderAllowanceUI();
            pingActivitySignal();
        }
    } catch (err) {
        console.warn("[Nipto Reconcile] Error reconciling activities from Nipto:", err);
    } finally {
        isReconcilingNipto = false;
    }

    return { reconciledCount, newPoints };
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

function pingActivitySignal() {
    try {
        window.__localActivityPingAt = Date.now();
        window.getNiptoCollection('sync_signals').doc('activity').set({
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.warn('Sync ping failed:', e));
    } catch (e) { /* non-critical */ }
}

// Explicit Nipto Task Sync (Only called when clicking the Sync button)
export async function syncNiptoTasks() {
    const statusText = document.getElementById('status');
    const syncBtn = document.getElementById('syncNiptoBtn');
    const apiToken = localStorage.getItem("nipto_api_token") || state.apiToken;

    if (!apiToken) {
        if (statusText) {
            statusText.innerText = "Error: Please unlock the dashboard first.";
            statusText.style.color = "#cf6679";
        }
        const pinModal = document.getElementById('pinModal');
        if (pinModal) pinModal.style.display = 'flex';
        return;
    }

    if (syncBtn) syncBtn.disabled = true;
    if (statusText) {
        statusText.innerText = "Connecting to Nipto API...";
        statusText.style.color = "#e0e0e0";
    }

    const QUERY = `query GetTasks { tasks { uid group name value } }`;

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

        if (statusText) statusText.innerText = `Found ${tasks.length} live tasks. Syncing to Firebase...`;

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

        if (statusText) {
            statusText.innerText = `Success! Synced ${totalSynced} tasks and removed ${totalDeleted} deleted tasks.`;
            statusText.style.color = "var(--success, #03dac6)";
            setTimeout(() => {
                if (statusText.innerText.includes("Success!")) {
                    statusText.innerText = "";
                }
            }, 4000);
        }
    } catch (error) {
        console.error("Error syncing Nipto tasks:", error);
        if (statusText) {
            statusText.innerText = `Error: ${error.message}`;
            statusText.style.color = "var(--danger, #cf6679)";
        }
    } finally {
        if (syncBtn) syncBtn.disabled = false;
    }
}

export async function loadActivityLabelsFromFirestore() {
    const snapshot = await window.getNiptoCollection('activity_labels').get();
    state.activityLabels = {};
    snapshot.forEach(doc => { state.activityLabels[doc.id] = doc.data().name; });
}

export async function saveActivityLabels(activityUids, name) {
    if (!activityUids || !activityUids.length || !name) return;
    if (!state.activityLabels) state.activityLabels = {};
    const batch = window.db.batch();
    activityUids.forEach(uid => {
        batch.set(window.getNiptoCollection('activity_labels').doc(uid), { name });
        batch.set(window.getNiptoCollection('activities_history').doc(uid), { label: name }, { merge: true });
        state.activityLabels[uid] = name;

        Object.keys(state.historicalActivitiesCache).forEach(wUid => {
            const cached = state.historicalActivitiesCache[wUid].find(a => a.uid === uid);
            if (cached) cached.label = name;
        });
    });
    try { await batch.commit(); } catch (e) { console.error("Error saving activity labels:", e); }
}

// ==========================================
// ALLOWANCE LEDGER (AYDEN & DJ: 1 PT = $0.05 / 5 PTS = $0.25)
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

export async function revokeAllowancePoints(userUid, points) {
    if (!points || points <= 0) return;
    let modified = false;
    if (userUid === AYDEN_UID) {
        state.allowanceLedger.ayden.unpaidPoints = Math.max(0, (state.allowanceLedger.ayden.unpaidPoints || 0) - points);
        modified = true;
    } else if (userUid === DJ_UID) {
        state.allowanceLedger.dj.unpaidPoints = Math.max(0, (state.allowanceLedger.dj.unpaidPoints || 0) - points);
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
    const dollars = (unpaid * 0.05).toFixed(2);
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
            const data = doc.data() || {};
            if (!data.geminiModel || String(data.geminiModel).includes('2.5')) {
                data.geminiModel = 'gemini-3.8-flash';
                window.getNiptoCollection('config').doc('integrations').set({ geminiModel: 'gemini-3.8-flash' }, { merge: true }).catch(() => {});
            }
            state.integrationsConfig = { ...state.integrationsConfig, ...data };
        } else {
            await window.getNiptoCollection('config').doc('integrations').set(state.integrationsConfig);
        }
    } catch (e) {
        console.warn("Error loading integrations config:", e);
    }
    return state.integrationsConfig;
}

export async function saveIntegrationsConfigToFirestore(cfg) {
    const sanitized = { ...cfg };
    if (sanitized.geminiModel && String(sanitized.geminiModel).includes('2.5')) {
        sanitized.geminiModel = 'gemini-3.8-flash';
    }
    state.integrationsConfig = { ...state.integrationsConfig, ...sanitized };
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
            const data = doc.data() || {};
            state.notificationPreferences = {
                ...state.notificationPreferences,
                ...data,
                adults: {
                    ...state.notificationPreferences.adults,
                    ...(data.adults || {})
                }
            };
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
// HOME ASSISTANT WEBHOOK DISPATCH (NON-BLOCKING + TIMEOUT)
// ==========================================
export async function dispatchHomeAssistantNotification(payload) {
    try {
        const url = (state.integrationsConfig?.haWebhookUrl || '').trim();
        if (!url || !payload) return false;

        // Filter out empty or unconfigured targets (e.g. Kenny has no phone connected)
        const rawTargets = Array.isArray(payload.targets) ? payload.targets : [];
        const validTargets = rawTargets
            .map(t => (typeof t === 'string' ? t.trim() : ''))
            .filter(t => t.length > 0 && t.startsWith('notify.'));

        if (validTargets.length === 0) {
            return false;
        }

        const safePayload = {
            ...payload,
            token: state.integrationsConfig?.haWebhookToken || "",
            targets: validTargets
        };

        const publicUrl = state.integrationsConfig?.publicAppUrl || NIPTO_PUBLIC_URL;
        if (safePayload.dashboard_path && !safePayload.dashboard_path.startsWith('http')) {
            safePayload.dashboard_path = publicUrl;
        }
        if (Array.isArray(safePayload.actions)) {
            safePayload.actions = safePayload.actions.map(act => {
                const copy = { ...act };
                if (copy.uri && !copy.uri.startsWith('http')) {
                    const queryStr = copy.uri.includes('?') ? copy.uri.slice(copy.uri.indexOf('?')) : '';
                    copy.uri = `${publicUrl}${queryStr}`;
                }
                return copy;
            });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(safePayload),
                signal: controller.signal
            });
            return res.ok;
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (err) {
        console.warn("Home Assistant webhook notification skipped/failed (non-blocking):", err?.message || err);
        return false;
    }
}

// ==========================================
// FIRESTORE-FIRST WEEKLY LEADERBOARD LOADER
// Reset Boundary: Sunday 11:59:59.999 PM Local Time
// ==========================================
function parseAndSumWeekActivities(snapshot, weekBounds) {
    const points = {};
    ALL_USERS.forEach(u => { points[u.uid] = 0; });

    const activities = [];
    snapshot.forEach(doc => {
        const data = doc.data() || {};
        const parsedDate = new Date(data.date);
        if (!isDateInLocalWeek(parsedDate, weekBounds)) return;

        const uid = data.uid || doc.id;
        const taskUid = data.taskUid || (data.task && data.task.uid) || '';
        const pts = (data.awardedPts !== undefined) ? Number(data.awardedPts) : (Number(data.taskValue) || 0);
        if (data.userUid && points[data.userUid] !== undefined) {
            points[data.userUid] += pts;
        }
        activities.push({
            uid,
            taskUid,
            date: data.date,
            parsedDate,
            dateKey: data.dateKey || getLocalTodayKey(parsedDate),
            user: { uid: data.userUid || '', name: data.userName || 'Unknown' },
            task: { uid: taskUid, name: data.taskName || 'Activity', value: pts },
            awardedPts: pts,
            label: (state.activityLabels && state.activityLabels[uid]) || data.label || ''
        });
    });

    return { points, activities };
}

export async function loadWeeklyPointsFromFirestore() {
    const fallbackPoints = {};
    ALL_USERS.forEach(u => { fallbackPoints[u.uid] = 0; });

    const weekBounds = getLocalWeekBounds(new Date(), 0);
    try {
        const snapshot = await window.getNiptoCollection('activities_history')
            .where('date', '>=', weekBounds.startDate.toISOString())
            .where('date', '<=', weekBounds.endDate.toISOString())
            .get();

        const { points, activities } = parseAndSumWeekActivities(snapshot, weekBounds);
        state.currentWeekScores = { ...points };
        state.allWeekActivities = activities;
        if ((state.doneWeekOffset || 0) === 0) {
            state.weeklyActivitiesForDone = activities;
        }
        return { points, activities };
    } catch (e) {
        console.warn("Could not aggregate weekly points from Firestore cache:", e);
        return { points: fallbackPoints, activities: [] };
    }
}

// ==========================================
// WEEKLY COMPLETIONS ("DONE THIS WEEK" + HISTORICAL WEEKS)
// Stored per day at: nipto/{env}/daily_completions/{YYYY-MM-DD}
// ==========================================
export async function recordDailyCompletion(entry) {
    if (!entry || !entry.id) return;
    const todayKey = entry.dateKey || getLocalTodayKey();
    entry.dateKey = todayKey;
    try {
        await window.getNiptoCollection('daily_completions').doc(todayKey).set({
            dateKey: todayKey,
            updatedAt: new Date().toISOString(),
            items: {
                [entry.id]: entry
            }
        }, { merge: true });

        if (!state.persistedDailyCompletions) state.persistedDailyCompletions = [];
        const existingIdx = state.persistedDailyCompletions.findIndex(it => it.id === entry.id);
        if (existingIdx !== -1) {
            state.persistedDailyCompletions[existingIdx] = { ...state.persistedDailyCompletions[existingIdx], ...entry };
        } else {
            state.persistedDailyCompletions.unshift(entry);
        }

        if (window.rebuildCompletedThisWeek) window.rebuildCompletedThisWeek();
        if (window.renderDoneThisWeekFeed) window.renderDoneThisWeekFeed();
    } catch (e) {
        console.error("Error recording daily completion to Firestore:", e);
    }
}

export async function removeDailyCompletion(id, dateKey = null) {
    if (!id) return;
    const targetKey = dateKey || getLocalTodayKey();
    try {
        await window.getNiptoCollection('daily_completions').doc(targetKey).update({
            [`items.${id}`]: window.firebase.firestore.FieldValue.delete(),
            updatedAt: new Date().toISOString()
        });
    } catch (e) {
        console.warn("Could not delete item from daily_completions doc:", e);
    }

    if (state.persistedDailyCompletions) {
        state.persistedDailyCompletions = state.persistedDailyCompletions.filter(it => it.id !== id && it.itemId !== id);
    }
    if (window.rebuildCompletedThisWeek) window.rebuildCompletedThisWeek();
    if (window.renderDoneThisWeekFeed) window.renderDoneThisWeekFeed();
}

export async function loadWeeklyCompletionsFromFirestore(weekOffset = state.doneWeekOffset || 0) {
    const weekBounds = getLocalWeekBounds(new Date(), weekOffset);
    const { dateKeys, startDate, endDate, weekKey } = weekBounds;

    try {
        const [dailySnap, actSnap] = await Promise.all([
            window.getNiptoCollection('daily_completions')
                .where('dateKey', 'in', dateKeys)
                .get()
                .catch(async () => {
                    const docs = await Promise.all(
                        dateKeys.map(k => window.getNiptoCollection('daily_completions').doc(k).get())
                    );
                    return { forEach: (cb) => docs.forEach(d => { if (d.exists) cb(d); }) };
                }),
            window.getNiptoCollection('activities_history')
                .where('date', '>=', startDate.toISOString())
                .where('date', '<=', endDate.toISOString())
                .get()
                .catch(() => ({ forEach: () => {} }))
        ]);

        const persistedItems = [];
        dailySnap.forEach(doc => {
            const data = doc.data() || {};
            const itemsMap = data.items || {};
            Object.values(itemsMap).forEach(item => {
                if (item && item.id) {
                    persistedItems.push({
                        ...item,
                        dateKey: item.dateKey || doc.id
                    });
                }
            });
        });

        const { points, activities: weekActivities } = parseAndSumWeekActivities(actSnap, weekBounds);

        state.weeklyCompletionsCache[weekKey] = {
            persistedItems,
            weekActivities
        };

        // Week 0 is the single canonical source of truth for current week scores & activities
        if (weekOffset === 0) {
            state.currentWeekScores = { ...points };
            state.allWeekActivities = weekActivities;
        }

        if (weekOffset === (state.doneWeekOffset || 0)) {
            state.persistedDailyCompletions = persistedItems;
            state.weeklyActivitiesForDone = weekActivities;
        }
    } catch (e) {
        console.error("Error loading weekly completions from Firestore:", e);
        if (weekOffset === (state.doneWeekOffset || 0)) {
            state.persistedDailyCompletions = [];
            state.weeklyActivitiesForDone = [];
        }
    }

    if (window.rebuildCompletedThisWeek) window.rebuildCompletedThisWeek();
    if (window.renderDoneThisWeekFeed) window.renderDoneThisWeekFeed();
    return state.completedThisWeek;
}

// Backward-compatible alias
export async function loadDailyCompletionsFromFirestore() {
    return loadWeeklyCompletionsFromFirestore(state.doneWeekOffset || 0);
}
