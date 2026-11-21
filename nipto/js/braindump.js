// braindump.js
// Unified Gemini AI Studio Brain Dump & Task Omnibox,
// Unified Staging Review, and Full-Power Bulk Triage Management.

import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { renderTodoTasks, normalizeTask, classifyTaskOwnership, expandCategoryOnReactivation } from './todos.js';
import { renderRollingSchedule, isDailyRoutine, completeRoutineForDate, isRoutineCompletedOnDate, normalizeChoreTitle, findMatchingRoutineForChore, getRoutineCompletionForDate } from './routines.js';
import { rebuildCompletedToday, renderDoneTodayFeed, updateLeaderboardUI } from './leaderboard.js';
import { saveCloudPreference } from './preferences.js';
import {
    getLocalTodayKey, renderCategoryCombobox, registerCustomCategory,
    toMillisSafe, isCompletedTodoExpired, getEligibleTaskCategories,
    isCategoryVisibleForTasks, getNiptoOnlyLowerSet, isInternalLockedCategory
} from './utils.js';

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==========================================
// 1. GEMINI AI PARSER & MULTI-MODEL FALLBACK
// ==========================================
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
const GEMINI_LOG_MAX_CHARS = 40000;
const pendingGeminiLogWrites = new Map();
let isApplyingStaging = false;

function truncateLogStr(val, maxLen = GEMINI_LOG_MAX_CHARS) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + `\n... [truncated ${str.length - maxLen} chars]`;
}

function getCurrentActorContext() {
    const isTogether = Boolean(state.isTogetherMode);
    if (!isTogether && Array.isArray(state.activeUsers) && state.activeUsers.length === 1) {
        const uid = state.activeUsers[0];
        const u = ALL_USERS.find(user => user.uid === uid);
        if (u) {
            return { actorUid: u.uid, actorName: u.name, isTogetherMode: false, activeUserObj: u };
        }
    }
    const uid = (Array.isArray(state.activeUsers) && state.activeUsers[0]) ? state.activeUsers[0] : '';
    const fallbackName = ALL_USERS.find(u => u.uid === uid)?.name || 'Unknown';
    return {
        actorUid: uid,
        actorName: isTogether ? 'Anyone (Together Mode)' : fallbackName,
        isTogetherMode: isTogether,
        activeUserObj: null
    };
}

function writeGeminiLogNonBlocking(logData) {
    try {
        if (typeof window === 'undefined' || typeof window.getNiptoCollection !== 'function') return null;
        const docRef = window.getNiptoCollection('gemini_logs').doc();
        const logDocId = docRef.id;
        const payload = {
            ...logData,
            createdAt: window.firebase?.firestore?.FieldValue?.serverTimestamp
                ? window.firebase.firestore.FieldValue.serverTimestamp()
                : new Date().toISOString()
        };
        const writePromise = docRef.set(payload).catch(e => {
            console.warn("Could not write gemini_logs entry:", e);
        });
        pendingGeminiLogWrites.set(logDocId, writePromise);
        return logDocId;
    } catch (e) {
        console.warn("Could not initialize gemini_logs write:", e);
        return null;
    }
}

function updateGeminiLogNonBlocking(logDocId, patch) {
    if (!logDocId || typeof window === 'undefined' || typeof window.getNiptoCollection !== 'function') return;
    const prior = pendingGeminiLogWrites.get(logDocId) || Promise.resolve();
    prior.then(() => {
        return window.getNiptoCollection('gemini_logs').doc(logDocId).update(patch);
    }).catch(e => {
        console.warn("Could not update gemini_logs entry:", e);
    }).finally(() => {
        pendingGeminiLogWrites.delete(logDocId);
    });
}

const BRAINDUMP_UNIFIED_INSTRUCTION = `You are an expert AI task manager for a household chore system.
You are given CURRENT_LOGGED_IN_USER, AVAILABLE_USERS, AVAILABLE_CATEGORIES, a JSON array of CURRENT_TASKS, and an unstructured natural language BRAIN DUMP / RAMBLE from the user.
Analyze every mentioned item in the ramble against CURRENT_TASKS and output a JSON array of operations:
[
  {
    "action": "create" | "update" | "complete" | "delete" | "create_category",
    "id": "matched_task_id_if_updating_completing_or_deleting (null for create or create_category)",
    "type": "todo" | "routine" | "project",
    "title": "Task title (or new category name when action is create_category)",
    "description": "Any extra notes, context, or instructions mentioned (empty string if none; null on update if unchanged)",
    "subtasks": [{"name": "Subtask step 1", "points": 5}, {"name": "Subtask step 2", "points": 10}],
    "assignee": "One of AVAILABLE_USERS or 'Anyone' (or null on update/complete if not specified)",
    "category": "Any category from AVAILABLE_CATEGORIES, OR a new concise Title-Case category name when the user asks to create/use a new category",
    "points": 5,
    "priority": "high" | "medium" | "low",
    "frictionTag": "" | "quick" | "low_brain" | "deep_focus",
    "schedule": {"type": "daily"|"weekly", "daysOfWeek": [0,1,2,3,4,5,6], "timeOfDay": "Morning"|"Afternoon"|"Evening"|"Anytime", "points": 5},
    "reason": "Short summary of why this action was proposed (e.g. 'New To-Do with 3 steps', 'New custom category', 'Increased points to 10', 'Marked completed')"
  }
]

Action Rules:
- First-Person Pronoun Resolution:
  - When CURRENT_LOGGED_IN_USER is a specific user (not "Anyone (Together Mode)"), first-person pronouns ("I", "me", "my", "myself", "I need to...", "assign to me", "I finished...") MUST set "assignee" to CURRENT_LOGGED_IN_USER.
  - When CURRENT_LOGGED_IN_USER is "Anyone (Together Mode)", first-person pronouns map "assignee" to "Anyone".
  - On "create", if no person or first-person pronoun is mentioned, default "assignee" to "Anyone".
- Category Creation & Assignment:
  - When the user asks to create a category AND create or move tasks into it, set "category": "<NewCategory>" directly on those "create" or "update" task operations — do NOT emit a dummy task named "Create category <NewCategory>".
  - When the user asks ONLY to create a category with no tasks mentioned, emit {"action": "create_category", "id": null, "type": "todo", "title": "<NewCategory>", "category": "<NewCategory>", "reason": "New custom category"}.
  - Otherwise choose the best category from AVAILABLE_CATEGORIES.
- "create": Brand new items not matching any existing task.
  - subtasks: If the task/project has multiple steps, components, or instructions, output an array of objects {"name": "...", "points": 5..100 step 5} (default points: 5 per subtask). When subtasks is non-empty, set parent points = 0 (points are awarded per subtask).
  - type: "routine" for recurring/scheduled chores (e.g. daily animal feedings, weekly trash), "project" for big ideas/someday items, "todo" for actionable one-off tasks (default).
  - For daily routines (every day, animal feeding/watering), set schedule.type = "daily" and daysOfWeek = [0,1,2,3,4,5,6]. Only set schedule.type = "weekly" when specific days of the week (1 to 6 days) are explicitly requested.
  - points: Must ALWAYS be a multiple of 5 from 5 to 100 (5, 10, 15, ..., 100). Default to 5 if not specified; set parent points to 0 ONLY when subtasks is non-empty.
  - priority: Default to "low" when type is "project" unless the user explicitly asks for medium/high urgency; otherwise default to "medium".
  - frictionTag: "" (standard), "quick" (<5m), "low_brain", or "deep_focus".
- "update": The user wants to modify fields on an existing task (e.g. change category, change points, add subtasks, move to projects, edit title, set priority, or change schedule). Match its exact id in CURRENT_TASKS.
  - On "update", set "assignee": null unless the user explicitly asked to assign or reassign the task.
  - On "update", set "subtasks": null unless the user explicitly asked to add, edit, or replace subtasks.
- "complete": The user mentioned crossing off, finishing, or completing an existing task. Match its exact id. Set "assignee" to the user who completed it (or CURRENT_LOGGED_IN_USER for "I finished..."), or null if unspecified.
- "delete": The user explicitly asked to delete or remove an existing task. Match its exact id.
Output pure JSON array only.`;

// Queries the Google AI Studio API for all eligible free-tier text generation models, ranked best-first
export async function discoverEligibleGeminiModels(apiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const models = data.models || [];

    const eligible = models.filter(m => {
        const id = (m.name || '').replace(/^models\//, '').toLowerCase();
        const supportsGen = Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent');
        const isExcluded = /(tts|image|imagen|veo|embed|aqa|audio|robotics|computer-use|learnlm|2\.5|3\.8)/i.test(id);
        const isGemini = id.startsWith('gemini-');
        return supportsGen && isGemini && !isExcluded;
    }).map(m => (m.name || '').replace(/^models\//, ''));

    if (eligible.length === 0) {
        return [DEFAULT_GEMINI_MODEL];
    }

    eligible.sort((a, b) => {
        const al = a.toLowerCase();
        const bl = b.toLowerCase();
        if (al === DEFAULT_GEMINI_MODEL) return -1;
        if (bl === DEFAULT_GEMINI_MODEL) return 1;

        const aIsHydrogen = al.includes('hydrogen') ? 1 : 0;
        const bIsHydrogen = bl.includes('hydrogen') ? 1 : 0;
        if (aIsHydrogen !== bIsHydrogen) return bIsHydrogen - aIsHydrogen;

        const aIsG4 = al.includes('gemini-4') ? 1 : 0;
        const bIsG4 = bl.includes('gemini-4') ? 1 : 0;
        if (aIsG4 !== bIsG4) return bIsG4 - aIsG4;

        const aIsFlash = al.includes('flash') ? 1 : 0;
        const bIsFlash = bl.includes('flash') ? 1 : 0;
        if (aIsFlash !== bIsFlash) return bIsFlash - aIsFlash;

        const parseVer = (str) => {
            const match = str.match(/gemini-(\d+(?:\.\d+)?)/i);
            return match ? parseFloat(match[1]) : 0;
        };
        const verA = parseVer(a);
        const verB = parseVer(b);
        if (verA !== verB) return verB - verA;

        const isStandardA = al.endsWith('-flash') ? 1 : 0;
        const isStandardB = bl.endsWith('-flash') ? 1 : 0;
        return isStandardB - isStandardA;
    });

    return Array.from(new Set(eligible));
}

export async function discoverActiveGeminiFlashModel(apiKey) {
    const list = await discoverEligibleGeminiModels(apiKey);
    return list[0] || DEFAULT_GEMINI_MODEL;
}

async function callGeminiGenerateSingle(apiKey, model, text, customInstruction = null, customGenConfig = null) {
    const cleanModel = (model || DEFAULT_GEMINI_MODEL).replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
    const body = {
        contents: [
            {
                parts: [{ text: text }]
            }
        ],
        generationConfig: customGenConfig || {
            responseMimeType: "application/json"
        }
    };

    if (customInstruction) {
        body.systemInstruction = {
            parts: [{ text: customInstruction }]
        };
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const errMsg = errBody.error?.message || `HTTP ${res.status}`;
        const err = new Error(errMsg);
        err.status = res.status;
        err.code = errBody.error?.code;
        err.statusText = errBody.error?.status;
        throw err;
    }

    return await res.json();
}

// Calls Gemini with automatic fallback across eligible free-tier models on 404, 400, 429 (quota), or 503
export async function callGeminiWithFallback(
    apiKey,
    preferredModel,
    promptText,
    customInstruction = null,
    customGenConfig = null,
    onStatusUpdate = null,
    auditMeta = {}
) {
    let primary = (preferredModel || DEFAULT_GEMINI_MODEL).trim().replace(/^models\//, '');
    if (!primary || /(2\.5|3\.8)/i.test(primary)) {
        primary = DEFAULT_GEMINI_MODEL;
    }

    const startedMs = Date.now();
    const actor = getCurrentActorContext();
    const fallbackAttempts = [];
    const baseLog = {
        createdAtIso: new Date().toISOString(),
        source: auditMeta?.source || 'unknown',
        actorUid: actor.actorUid,
        actorName: actor.actorName,
        isTogetherMode: actor.isTogetherMode,
        requestedModel: primary,
        userInput: truncateLogStr(auditMeta?.userInput || '', 10000),
        systemInstructionSent: truncateLogStr(customInstruction || ''),
        fullPromptSent: truncateLogStr(promptText || '')
    };

    try {
        const data = await callGeminiGenerateSingle(apiKey, primary, promptText, customInstruction, customGenConfig);
        const rawResponseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data || '');
        const logDocId = writeGeminiLogNonBlocking({
            ...baseLog,
            modelUsed: primary,
            fallbackAttempts,
            rawResponseText: truncateLogStr(rawResponseText),
            status: 'success',
            errorMessage: '',
            httpStatus: 200,
            durationMs: Date.now() - startedMs
        });
        return { data, modelUsed: primary, logDocId };
    } catch (firstErr) {
        fallbackAttempts.push({
            model: primary,
            errorMessage: firstErr.message || String(firstErr),
            httpStatus: firstErr.status || null
        });

        const isRecoverable =
            firstErr.status === 404 ||
            firstErr.status === 429 ||
            firstErr.status === 503 ||
            firstErr.status === 400 ||
            /no longer available|not found|deprecated|quota|rate limit|resource_exhausted|overloaded/i.test(firstErr.message || '') ||
            /RESOURCE_EXHAUSTED/i.test(firstErr.statusText || '');

        if (!isRecoverable) {
            writeGeminiLogNonBlocking({
                ...baseLog,
                modelUsed: primary,
                fallbackAttempts,
                rawResponseText: '',
                status: 'error',
                errorMessage: firstErr.message || String(firstErr),
                httpStatus: firstErr.status || null,
                durationMs: Date.now() - startedMs
            });
            throw firstErr;
        }

        console.warn(`Primary Gemini model "${primary}" failed (${firstErr.message}). Discovering eligible free-tier fallback models...`);
        if (onStatusUpdate) {
            onStatusUpdate(`Primary model (${primary}) unavailable or quota reached. Trying eligible fallback model...`);
        }

        let fallbackQueue = [];
        try {
            const candidates = await discoverEligibleGeminiModels(apiKey);
            fallbackQueue = candidates.filter(m => m !== primary);
        } catch (discErr) {
            fallbackAttempts.push({
                model: 'models_discovery',
                errorMessage: discErr.message || String(discErr),
                httpStatus: discErr.status || null
            });
        }

        let lastErr = firstErr;
        for (const candidateModel of fallbackQueue) {
            try {
                if (onStatusUpdate) {
                    onStatusUpdate(`Retrying with ${candidateModel}...`);
                }
                const data = await callGeminiGenerateSingle(apiKey, candidateModel, promptText, customInstruction, customGenConfig);

                // If primary was 404/deprecated, persist the valid model
                if (firstErr.status === 404 || /not found|no longer available|deprecated/i.test(firstErr.message || '')) {
                    api.saveIntegrationsConfigToFirestore({ geminiModel: candidateModel }).catch(() => {});
                }
                const rawResponseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data || '');
                const logDocId = writeGeminiLogNonBlocking({
                    ...baseLog,
                    modelUsed: candidateModel,
                    fallbackAttempts,
                    rawResponseText: truncateLogStr(rawResponseText),
                    status: 'success',
                    errorMessage: '',
                    httpStatus: 200,
                    durationMs: Date.now() - startedMs
                });
                return { data, modelUsed: candidateModel, logDocId };
            } catch (candErr) {
                fallbackAttempts.push({
                    model: candidateModel,
                    errorMessage: candErr.message || String(candErr),
                    httpStatus: candErr.status || null
                });
                lastErr = candErr;
            }
        }

        writeGeminiLogNonBlocking({
            ...baseLog,
            modelUsed: primary,
            fallbackAttempts,
            rawResponseText: '',
            status: 'error',
            errorMessage: lastErr.message || String(lastErr),
            httpStatus: lastErr.status || null,
            durationMs: Date.now() - startedMs
        });
        throw lastErr;
    }
}

// ==========================================
// 2. UNIFIED BRAIN DUMP OMNIBOX PARSER
// ==========================================
export function refreshBrainDumpUser() {
    const el = document.getElementById('brainDumpActiveUser');
    if (!el) return;
    const actor = getCurrentActorContext();
    if (actor.activeUserObj) {
        el.textContent = actor.activeUserObj.name;
        el.style.color = actor.activeUserObj.color || 'var(--primary)';
    } else if (state.isTogetherMode) {
        el.textContent = 'Anyone (Together Mode)';
        el.style.color = 'var(--text-muted)';
    } else {
        el.textContent = actor.actorName || 'Anyone';
        el.style.color = 'var(--primary)';
    }
}

export function insertBrainDumpHint(snippet) {
    const input = document.getElementById('brainDumpInput');
    if (!input) return;
    const val = input.value || '';
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : val.length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : val.length;
    const before = val.slice(0, start);
    const after = val.slice(end);
    const needsLeadingSpace = before.length > 0 && !/[\s\n]$/.test(before);
    const insertText = (needsLeadingSpace ? ' ' : '') + snippet;
    input.value = before + insertText + after;
    const nextPos = before.length + insertText.length;
    input.focus();
    if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(nextPos, nextPos);
    }
}

function normalizeStagingAssignee(rawAssignee, selfUserName) {
    if (rawAssignee === null || rawAssignee === undefined) return null;
    const str = String(rawAssignee).trim();
    if (!str) return null;
    const lower = str.toLowerCase();
    if (['i', 'me', 'my', 'myself', 'current_user', 'current user'].includes(lower)) {
        return selfUserName || 'Anyone';
    }
    if (lower === 'anyone' || lower === 'everyone' || lower === 'unassigned') return 'Anyone';
    const matchedUser = ALL_USERS.find(u => (u.name && u.name.toLowerCase() === lower) || u.uid === str);
    return matchedUser ? matchedUser.name : str;
}

export async function parseWithGemini() {
    const inputEl = document.getElementById('brainDumpInput');
    const parseBtn = document.getElementById('btnParseGemini');
    const statusEl = document.getElementById('brainDumpStatus');

    const text = inputEl ? inputEl.value.trim() : '';
    if (!text) {
        alert("Please enter or paste your brain dump text first.");
        return;
    }

    const apiKey = (state.integrationsConfig?.geminiApiKey || '').trim();
    if (!apiKey) {
        alert("Gemini API Key is not configured. Please open Settings and enter your API key.");
        if (window.openSettingsModal) window.openSettingsModal();
        return;
    }

    const mapUidsToNames = (uids = []) => {
        if (!Array.isArray(uids) || uids.length === 0) return ['Anyone'];
        const names = uids.map(uid => ALL_USERS.find(u => u.uid === uid)?.name || uid).filter(Boolean);
        return names.length > 0 ? names : ['Anyone'];
    };

    const activeTodos = (state.todoTasksData || []).filter(t => !t.completed).map(t => {
        const norm = normalizeTask(t);
        return {
            id: norm.id,
            title: norm.name,
            type: norm.type,
            category: norm.category || 'Home',
            points: norm.points || 5,
            priority: norm.priority || 'medium',
            assignees: mapUidsToNames(norm.assignees),
            subtasks: Array.isArray(norm.subTasks) ? norm.subTasks.map(st => ({
                id: st.id || null,
                name: st.name || st.text || '',
                points: api.clampStep5Points(st.points, 5),
                completed: Boolean(st.completed)
            })) : [],
            schedule: null,
            description: norm.description || ''
        };
    });

    const activeRoutines = (state.routines || []).map(r => ({
        id: r.uid,
        title: r.name,
        type: 'routine',
        category: r.category || 'Home',
        points: api.getRoutinePoints(r),
        priority: r.priority || 'medium',
        assignees: mapUidsToNames(r.assignees),
        schedule: isDailyRoutine(r) ? 'daily' : 'weekly',
        description: ''
    }));

    const tasksContext = [...activeTodos, ...activeRoutines];
    const actor = getCurrentActorContext();
    const currentLoggedInUser = actor.activeUserObj ? actor.activeUserObj.name : 'Anyone (Together Mode)';
    const selfUserName = actor.activeUserObj ? actor.activeUserObj.name : 'Anyone';
    const availableUsers = [...ALL_USERS.map(u => u.name), 'Anyone'];
    const availableCategories = getEligibleTaskCategories();

    let configuredModel = (state.integrationsConfig?.geminiModel || DEFAULT_GEMINI_MODEL).trim();
    if (!configuredModel || /(2\.5|3\.8)/i.test(configuredModel)) {
        configuredModel = DEFAULT_GEMINI_MODEL;
    }

    if (parseBtn) {
        parseBtn.disabled = true;
        parseBtn.innerHTML = "Thinking (Gemini)...";
    }
    if (statusEl) {
        statusEl.textContent = `Analyzing with ${configuredModel}...`;
        statusEl.style.color = "var(--primary)";
    }

    const payloadText = `CURRENT_LOGGED_IN_USER: ${currentLoggedInUser}
AVAILABLE_USERS: ${JSON.stringify(availableUsers)}
AVAILABLE_CATEGORIES: ${JSON.stringify(availableCategories)}

CURRENT_TASKS:
${JSON.stringify(tasksContext, null, 2)}

USER BRAIN DUMP / RAMBLE:
"${text}"`;

    try {
        const { data, modelUsed, logDocId } = await callGeminiWithFallback(
            apiKey,
            configuredModel,
            payloadText,
            BRAINDUMP_UNIFIED_INSTRUCTION,
            { responseMimeType: "application/json" },
            (msg) => {
                if (statusEl) {
                    statusEl.textContent = msg;
                    statusEl.style.color = "var(--warning, #f59e0b)";
                }
            },
            { source: 'brain_dump', userInput: text }
        );

        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) {
            if (logDocId) {
                updateGeminiLogNonBlocking(logDocId, {
                    status: 'parse_error',
                    parseError: 'Gemini returned empty response.'
                });
            }
            throw new Error("Gemini returned empty response.");
        }

        let cleanedText = candidateText.trim();
        if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        }

        let parsedItems;
        try {
            parsedItems = JSON.parse(cleanedText);
        } catch (parseErr) {
            if (logDocId) {
                updateGeminiLogNonBlocking(logDocId, {
                    status: 'parse_error',
                    parseError: parseErr.message || String(parseErr)
                });
            }
            throw parseErr;
        }

        if (!Array.isArray(parsedItems)) {
            if (parsedItems.items && Array.isArray(parsedItems.items)) parsedItems = parsedItems.items;
            else if (parsedItems.tasks && Array.isArray(parsedItems.tasks)) parsedItems = parsedItems.tasks;
            else if (parsedItems.operations && Array.isArray(parsedItems.operations)) parsedItems = parsedItems.operations;
            else parsedItems = [parsedItems];
        }

        const createCatTitleRe = /^(?:create|add|make|new)\s+(?:a\s+|the\s+)?category(?:\s+called|\s+named)?\s*[:\-]?\s*["']?(.+?)["']?$/i;
        const usedCatsLower = new Set(
            parsedItems
                .filter(it => it && it.action !== 'create_category' && it.category && !createCatTitleRe.test(it.title || ''))
                .map(it => String(it.category).trim().toLowerCase())
        );

        const cleanedOperations = [];
        for (const rawItem of parsedItems) {
            if (!rawItem || typeof rawItem !== 'object') continue;
            const copy = { ...rawItem };
            const dummyMatch = (copy.title || '').trim().match(createCatTitleRe);
            if (dummyMatch && copy.action === 'create') {
                const targetCat = (dummyMatch[1] || copy.category || '').trim();
                if (targetCat && usedCatsLower.has(targetCat.toLowerCase())) {
                    continue;
                }
                if (targetCat) {
                    copy.action = 'create_category';
                    copy.category = targetCat;
                    copy.title = targetCat;
                    copy.reason = copy.reason || 'New custom category';
                }
            }
            cleanedOperations.push(copy);
        }

        const niptoOnlyLower = getNiptoOnlyLowerSet();
        const hiddenCatsLower = new Set(
            (state.categoryConfig?.hiddenCategories || []).map(c => String(c || '').trim().toLowerCase()).filter(Boolean)
        );

        state.brainDumpStaging = cleanedOperations.map((item, idx) => {
            let current = item.id ? tasksContext.find(t => t.id === item.id) : null;
            let matchedByTitle = false;
            if (!current && item.action !== 'create_category' && item.title) {
                const normTitle = normalizeChoreTitle(item.title);
                const itemIsRoutine = item.type === 'routine';
                const matched = normTitle
                    ? tasksContext.find(t => normalizeChoreTitle(t.title) === normTitle && (t.type === 'routine') === itemIsRoutine)
                    : null;
                if (matched) {
                    current = matched;
                    item.id = matched.id;
                    matchedByTitle = true;
                }
            }

            const rawTodo = item.id ? (state.todoTasksData || []).find(t => t.id === item.id) : null;
            const rawRoutine = item.id ? (state.routines || []).find(r => r.uid === item.id) : null;
            const rawDoc = rawTodo || rawRoutine;

            let action = ['create', 'update', 'complete', 'delete', 'create_category'].includes(item.action)
                ? item.action
                : (current ? 'update' : 'create');
            if (matchedByTitle && action !== 'complete' && action !== 'delete') {
                action = 'update';
            }

            if (action === 'create_category') {
                const newCatName = (item.category || item.title || '').trim();
                return {
                    stagingId: 'stage_' + Date.now() + '_' + idx,
                    selected: Boolean(newCatName),
                    action: 'create_category',
                    id: null,
                    type: 'todo',
                    title: newCatName || 'New Category',
                    description: '',
                    subtasks: [],
                    assignee: 'Anyone',
                    category: newCatName || 'Home',
                    isExplicitCategoryCreate: true,
                    points: 0,
                    _prevPoints: 5,
                    priority: 'medium',
                    priorityTouched: false,
                    frictionTag: '',
                    schedule: null,
                    reason: item.reason || 'New custom category',
                    current: null
                };
            }

            const itemType = ['todo', 'project', 'routine'].includes(item.type)
                ? item.type
                : (current ? current.type : (item.targetType === 'routine' ? 'routine' : 'todo'));

            const existingSubs = (rawTodo && Array.isArray(rawTodo.subTasks))
                ? rawTodo.subTasks
                : ((current && Array.isArray(current.subtasks)) ? current.subtasks : []);

            const normalizeSubItem = (s) => {
                const subName = (typeof s === 'string' ? s : (s?.name || s?.text || '')).trim();
                if (!subName) return null;
                const matchedExisting = existingSubs.find(es =>
                    (s && typeof s === 'object' && s.id && es.id === s.id) ||
                    ((es.name || es.text || '').trim().toLowerCase() === subName.toLowerCase())
                );
                const rawPts = (s && typeof s === 'object' && s.points !== undefined)
                    ? s.points
                    : matchedExisting?.points;
                return {
                    id: (s && typeof s === 'object' && s.id) || matchedExisting?.id || null,
                    name: subName,
                    points: api.clampStep5Points(rawPts, 5)
                };
            };

            let subtasks = [];
            if (Array.isArray(item.subtasks) && item.subtasks.length > 0) {
                subtasks = item.subtasks.map(normalizeSubItem).filter(Boolean);
            } else if (action === 'update' && existingSubs.length > 0) {
                subtasks = existingSubs.map(normalizeSubItem).filter(Boolean);
            } else if (Array.isArray(item.subtasks)) {
                subtasks = item.subtasks.map(normalizeSubItem).filter(Boolean);
            } else if (existingSubs.length > 0) {
                subtasks = existingSubs.map(normalizeSubItem).filter(Boolean);
            }

            // Normalize routine schedule cleanly
            let normalizedSched = null;
            if (itemType === 'routine') {
                const rawSched = item.schedule;
                if (rawSched && typeof rawSched === 'object') {
                    const rawDays = Array.isArray(rawSched.daysOfWeek)
                        ? Array.from(new Set(rawSched.daysOfWeek.map(d => Number(d)).filter(d => !isNaN(d) && d >= 0 && d <= 6)))
                        : [];
                    const isWeekly = rawSched.type === 'weekly' && rawDays.length > 0 && rawDays.length < 7;
                    normalizedSched = {
                        type: isWeekly ? 'weekly' : 'daily',
                        daysOfWeek: isWeekly ? rawDays : [0, 1, 2, 3, 4, 5, 6],
                        timeOfDay: rawSched.timeOfDay || 'Anytime',
                        points: api.clampStep5Points(rawSched.points || item.points, 5)
                    };
                } else if (typeof rawSched === 'string' && rawSched.toLowerCase() === 'weekly') {
                    normalizedSched = { type: 'weekly', daysOfWeek: [1, 3, 5], timeOfDay: 'Anytime', points: api.clampStep5Points(item.points, 5) };
                } else {
                    normalizedSched = { type: 'daily', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeOfDay: 'Anytime', points: api.clampStep5Points(item.points, 5) };
                }
            }

            const existingAssigneeUids = Array.isArray(rawDoc?.assignees)
                ? rawDoc.assignees.map(a => String(a || '').trim()).filter(Boolean)
                : [];
            const existingAssigneesLabel = existingAssigneeUids.length > 0
                ? mapUidsToNames(existingAssigneeUids).join(' & ')
                : 'Anyone';

            const normAssignee = normalizeStagingAssignee(item.assignee, selfUserName);
            let finalAssignee = 'Anyone';
            if (action === 'update') {
                if (normAssignee === null && existingAssigneeUids.length > 0) {
                    finalAssignee = '__KEEP__';
                } else {
                    finalAssignee = normAssignee || 'Anyone';
                }
            } else {
                finalAssignee = normAssignee || 'Anyone';
            }

            const rawProposedCat = (item.category || (current ? current.category : 'Home') || 'Home').trim();
            const proposedLower = rawProposedCat.toLowerCase();
            const escapedCat = rawProposedCat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const userMentionedCat = Boolean(rawProposedCat && new RegExp(`\\b${escapedCat}\\b`, 'i').test(text));
            const isHiddenOrNipto = hiddenCatsLower.has(proposedLower) || niptoOnlyLower.has(proposedLower);
            let catVal = rawProposedCat || 'Home';
            let isExplicitCategoryCreate = false;

            if (isInternalLockedCategory(catVal)) {
                catVal = (current && isCategoryVisibleForTasks(current.category)) ? current.category : 'Home';
            } else if (isHiddenOrNipto && !userMentionedCat && !(current && current.category && current.category.toLowerCase() === proposedLower)) {
                catVal = (current && isCategoryVisibleForTasks(current.category)) ? current.category : 'Home';
            } else if (userMentionedCat || !availableCategories.some(c => c.toLowerCase() === proposedLower)) {
                isExplicitCategoryCreate = Boolean(
                    action === 'create' || action === 'update'
                ) && !availableCategories.some(c => c.toLowerCase() === proposedLower);
            }

            const isContainer = itemType !== 'routine' && subtasks.length > 0;
            const resolvedPoints = isContainer
                ? 0
                : api.clampStep5Points(item.points !== undefined && item.points !== null ? item.points : (current ? current.points : 5), 5);
            const defaultPri = itemType === 'project' ? 'low' : 'medium';
            const resolvedPri = ['high', 'medium', 'low'].includes(item.priority)
                ? item.priority
                : (current ? current.priority : defaultPri);

            return {
                stagingId: 'stage_' + Date.now() + '_' + idx,
                selected: true,
                action,
                id: item.id || (current ? current.id : null),
                type: itemType,
                title: item.title || (current ? current.title : 'Untitled Task'),
                description: (item.description !== undefined && item.description !== null) ? item.description : (current ? current.description : ''),
                subtasks,
                assignee: finalAssignee,
                existingAssigneeUids,
                existingAssigneesLabel,
                category: catVal,
                isExplicitCategoryCreate,
                points: resolvedPoints,
                _prevPoints: current ? api.clampStep5Points(current.points, 5) : 5,
                priority: resolvedPri,
                priorityTouched: Boolean(current),
                frictionTag: item.frictionTag || '',
                schedule: normalizedSched,
                reason: matchedByTitle
                    ? 'Matched existing item by title'
                    : (item.reason || (action === 'create' ? 'New item' : (action === 'complete' ? 'Marked complete' : 'Updated'))),
                current: current || null
            };
        });

        if (logDocId) {
            const parsedSummary = state.brainDumpStaging.slice(0, 50).map(st => ({
                action: st.action,
                type: st.type,
                title: st.title,
                category: st.category,
                assignee: st.assignee,
                points: st.points
            }));
            updateGeminiLogNonBlocking(logDocId, {
                parsedActionCount: state.brainDumpStaging.length,
                parsedSummary
            });
        }

        renderBrainDumpStaging();
        if (statusEl) {
            const newCount = state.brainDumpStaging.filter(i => i.action === 'create' || i.action === 'create_category').length;
            const updateCount = state.brainDumpStaging.length - newCount;
            statusEl.textContent = `Analyzed ${state.brainDumpStaging.length} operations (${newCount} new, ${updateCount} updates) via ${modelUsed}. Review below.`;
            statusEl.style.color = "var(--success)";
        }
    } catch (err) {
        console.error("Gemini parse error:", err);
        if (statusEl) {
            statusEl.textContent = `Parse error: ${err.message}`;
            statusEl.style.color = "var(--danger)";
        }
        alert("Failed to parse with Gemini: " + err.message);
    } finally {
        if (parseBtn) {
            parseBtn.disabled = false;
            parseBtn.innerHTML = "&#x2728; Process with Gemini AI";
        }
    }
}

// Fallback: Raw line-by-line task ingestion
export function rawLineByLineAdd() {
    const inputEl = document.getElementById('brainDumpInput');
    const statusEl = document.getElementById('brainDumpStatus');
    const text = inputEl ? inputEl.value.trim() : '';
    if (!text) {
        alert("Please enter some lines of text first.");
        return;
    }

    const lines = text.split('\n')
        .map(l => l.trim().replace(/^[-*\u2022]\s*/, ''))
        .filter(l => l.length > 0);

    if (lines.length === 0) return;

    const actor = getCurrentActorContext();
    const selfAssignee = actor.activeUserObj ? actor.activeUserObj.name : 'Anyone';

    state.brainDumpStaging = lines.map((line, idx) => {
        let cleanTitle = line;
        let assignee = 'Anyone';

        const meMatch = cleanTitle.match(/^(?:i\s+(?:need|have|want|gotta)\s+to\s+|me\s*:\s*)/i);
        if (meMatch) {
            assignee = selfAssignee;
            cleanTitle = cleanTitle.slice(meMatch[0].length).trim();
        } else {
            const colonMatch = cleanTitle.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
            if (colonMatch) {
                const matchedUser = ALL_USERS.find(u => u.name.toLowerCase() === colonMatch[1].toLowerCase());
                if (matchedUser) {
                    assignee = matchedUser.name;
                    cleanTitle = colonMatch[2].trim();
                }
            }
        }

        if (!cleanTitle) {
            cleanTitle = line;
        } else {
            cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
        }

        const normCleanTitle = normalizeChoreTitle(cleanTitle);
        const matched = normCleanTitle
            ? (state.todoTasksData || []).find(t => !t.completed && normalizeChoreTitle(t.name) === normCleanTitle)
            : null;
        const matchedNorm = matched ? normalizeTask(matched) : null;
        const existingAssigneeUids = matched && Array.isArray(matched.assignees)
            ? matched.assignees.map(a => String(a || '').trim()).filter(Boolean)
            : [];
        const existingAssigneesLabel = existingAssigneeUids.length > 0
            ? existingAssigneeUids.map(uid => ALL_USERS.find(u => u.uid === uid)?.name || uid).join(' & ')
            : 'Anyone';

        let finalAssignee = assignee;
        if (matched && assignee === 'Anyone' && existingAssigneeUids.length > 0) {
            finalAssignee = '__KEEP__';
        }

        const matchedSubtasks = (matched && Array.isArray(matched.subTasks))
            ? matched.subTasks.map(st => ({
                id: st.id || null,
                name: st.name || st.text || '',
                points: api.clampStep5Points(st.points, 5)
            }))
            : [];

        return {
            stagingId: 'stage_' + Date.now() + '_' + idx,
            selected: true,
            action: matched ? 'update' : 'create',
            id: matched ? matched.id : null,
            type: matchedNorm ? matchedNorm.type : 'todo',
            title: cleanTitle,
            description: matchedNorm ? (matchedNorm.description || '') : '',
            subtasks: matchedSubtasks,
            assignee: finalAssignee,
            existingAssigneeUids,
            existingAssigneesLabel,
            category: matched ? (matched.category || 'Home') : 'Home',
            points: matched ? (matched.points || 5) : 5,
            priority: matchedNorm ? (matchedNorm.priority || 'medium') : 'medium',
            frictionTag: matched ? (matched.frictionTag || '') : '',
            schedule: null,
            reason: matched ? 'Matched existing item by title' : (assignee !== 'Anyone' ? `Raw line item (${assignee})` : 'Raw line item'),
            current: matched ? {
                id: matched.id,
                title: matched.name,
                type: matchedNorm.type,
                category: matched.category || 'Home',
                points: matched.points || 5,
                priority: matchedNorm.priority || 'medium'
            } : null
        };
    });

    renderBrainDumpStaging();
    if (statusEl) {
        statusEl.textContent = `Loaded ${state.brainDumpStaging.length} raw items. Adjust and commit below.`;
        statusEl.style.color = "var(--success)";
    }
}

// ==========================================
// 3. FULL-DETAIL STAGING REVIEW UI
// ==========================================
export function addSubtaskToStaging(stagingIdx, text = '', points = 5) {
    const item = state.brainDumpStaging[stagingIdx];
    if (!item) return;
    if (!Array.isArray(item.subtasks)) item.subtasks = [];
    if (item.type !== 'routine' && item.subtasks.length === 0 && Number(item.points) > 0) {
        item._prevPoints = api.clampStep5Points(item.points, 5);
    }
    item.subtasks.push({ name: text, points: api.clampStep5Points(points, 5) });
    if (item.type !== 'routine') item.points = 0;
    renderBrainDumpStaging();
}

export function updateStagingSubtask(stagingIdx, subtaskIdx, text) {
    const item = state.brainDumpStaging[stagingIdx];
    if (!item || !item.subtasks || item.subtasks[subtaskIdx] === undefined) return;
    const prev = item.subtasks[subtaskIdx];
    if (prev && typeof prev === 'object') {
        item.subtasks[subtaskIdx] = { ...prev, name: text };
    } else {
        item.subtasks[subtaskIdx] = { name: text, points: 5 };
    }
}

export function updateStagingSubtaskPoints(stagingIdx, subtaskIdx, rawPoints) {
    const item = state.brainDumpStaging[stagingIdx];
    if (!item || !item.subtasks || item.subtasks[subtaskIdx] === undefined) return;
    const clamped = api.clampStep5Points(rawPoints, 5);
    const prev = item.subtasks[subtaskIdx];
    if (prev && typeof prev === 'object') {
        item.subtasks[subtaskIdx] = { ...prev, points: clamped };
    } else {
        item.subtasks[subtaskIdx] = { name: String(prev || ''), points: clamped };
    }
    renderBrainDumpStaging();
}

export function removeStagingSubtask(stagingIdx, subtaskIdx) {
    const item = state.brainDumpStaging[stagingIdx];
    if (!item || !item.subtasks) return;
    item.subtasks.splice(subtaskIdx, 1);
    if (item.subtasks.length === 0 && item.type !== 'routine') {
        item.points = api.clampStep5Points(item._prevPoints, 5);
    }
    renderBrainDumpStaging();
}

export function updateStagingRoutineSchedule(stagingIdx, freqType) {
    const item = state.brainDumpStaging[stagingIdx];
    if (!item) return;
    const prevSched = (item.schedule && typeof item.schedule === 'object') ? item.schedule : {};
    if (freqType === 'weekly') {
        const existingDays = Array.isArray(prevSched.daysOfWeek) && prevSched.daysOfWeek.length > 0 && prevSched.daysOfWeek.length < 7
            ? prevSched.daysOfWeek
            : [1, 3, 5];
        item.schedule = {
            ...prevSched,
            type: 'weekly',
            daysOfWeek: existingDays,
            timeOfDay: prevSched.timeOfDay || 'Anytime'
        };
    } else {
        item.schedule = {
            ...prevSched,
            type: 'daily',
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            timeOfDay: prevSched.timeOfDay || 'Anytime'
        };
    }
}

export function renderBrainDumpStaging() {
    const container = document.getElementById('brainDumpStaging');
    if (!container) return;

    if (!state.brainDumpStaging || state.brainDumpStaging.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No staged items. Dictate or paste a ramble in the Omnibox above to add, update, or complete tasks.</div>';
        return;
    }

    const newItems = state.brainDumpStaging.filter(item => item.action === 'create' || item.action === 'create_category');
    const existingItems = state.brainDumpStaging.filter(item => item.action !== 'create' && item.action !== 'create_category');

    const userOptionsHtml = `<option value="Anyone">Anyone</option>` +
        ALL_USERS.map(u => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`).join('');

    let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; background: var(--bg-color); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-color);">
        <div style="font-size: 14px; font-weight: 800;">
            Staging Review <span style="font-weight: normal; font-size: 12px; color: var(--text-muted);">(${newItems.length} new, ${existingItems.length} updates/completions)</span>
        </div>
        <div style="display: flex; gap: 8px;">
            <button class="action-btn" onclick="clearBrainDumpStaging()" style="padding: 6px 12px; font-size: 13px;">Clear Staging</button>
            <button class="action-btn save-mode" onclick="applyUnifiedStagingToFirestore()" style="padding: 6px 14px; font-size: 13px; font-weight: 800;">
                &#x2714; Apply Selected Changes (${state.brainDumpStaging.filter(i => i.selected).length})
            </button>
        </div>
    </div>
    `;

    function renderStagingCard(item, idx) {
        if (item.action === 'create_category') {
            const isUnselectedCat = !item.selected;
            const opacityCat = item.selected ? '1' : '0.6';
            const checkedCat = item.selected ? 'checked' : '';
            const catReasonHtml = item.reason
                ? `<span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">${escapeHtml(item.reason)}</span>`
                : '';
            return `
            <div class="staging-card ${isUnselectedCat ? 'is-unselected' : ''}" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; opacity: ${opacityCat}; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <input type="checkbox" ${checkedCat} onchange="updateStagingItem(${idx}, 'selected', this.checked)">
                <span style="background: rgba(16, 185, 129, 0.15); color: #059669; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 11px;">NEW CATEGORY</span>
                <input type="text" value="${escapeHtml(item.category || item.title)}" onchange="updateStagingItem(${idx}, 'category', this.value); updateStagingItem(${idx}, 'title', this.value);" style="flex: 1; min-width: 160px; padding: 4px 8px; font-size: 13px; font-weight: 700; border-radius: 4px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-color); color: var(--text-main);" placeholder="Category name...">
                ${catReasonHtml}
                <button type="button" onclick="deleteStagingItem(${idx})" style="background: none; border: none; cursor: pointer; color: var(--danger); font-size: 16px; margin-left: auto;" title="Remove row">&times;</button>
            </div>
            `;
        }

        let actionBadge = '';
        if (item.action === 'complete') actionBadge = '<span style="background: rgba(34, 197, 94, 0.15); color: #16a34a; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 11px;">COMPLETE</span>';
        else if (item.action === 'delete') actionBadge = '<span style="background: rgba(239, 68, 68, 0.15); color: #dc2626; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 11px;">DELETE</span>';
        else if (item.action === 'update') actionBadge = '<span style="background: rgba(37, 99, 235, 0.15); color: #2563eb; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 11px;">UPDATE</span>';
        else actionBadge = '<span style="background: rgba(16, 185, 129, 0.15); color: #059669; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 11px;">NEW</span>';

        const cur = item.current;
        let curHtml = '';
        if (cur) {
            curHtml = '<div style="font-size: 11px; color: var(--text-muted); padding: 4px 8px; background: var(--bg-color); border-radius: 4px;">' +
                'Current state: <strong>' + escapeHtml(cur.title) + '</strong> &bull; Type: ' + cur.type + ' &bull; ' + (cur.points || 5) + ' pts &bull; Pri: ' + (cur.priority || 'med') + ' &bull; Cat: ' + escapeHtml(cur.category || 'Home') +
                '</div>';
        }

        const reasonHtml = item.reason
            ? '<span style="font-size: 11px; color: var(--text-muted); background: var(--bg-color); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">' + escapeHtml(item.reason) + '</span>'
            : '';

        const keepOptionHtml = (item.action === 'update' && Array.isArray(item.existingAssigneeUids) && item.existingAssigneeUids.length > 0)
            ? `<option value="__KEEP__">Keep Current (${escapeHtml(item.existingAssigneesLabel || 'Assigned')})</option>`
            : '';
        const targetVal = 'value="' + escapeHtml(item.assignee) + '"';
        const assigneeOptionsHtml = (keepOptionHtml + userOptionsHtml).replace(targetVal, targetVal + ' selected');

        let scheduleHtml = '';
        if (item.type === 'routine') {
            const isWeekly = item.schedule && item.schedule.type === 'weekly';
            scheduleHtml = '<label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">' +
                'Schedule:' +
                '<select onchange="updateStagingRoutineSchedule(' + idx + ', this.value)" style="padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">' +
                '<option value="daily"' + (!isWeekly ? ' selected' : '') + '>Daily</option>' +
                '<option value="weekly"' + (isWeekly ? ' selected' : '') + '>Weekly</option>' +
                '</select>' +
                '</label>';
        }

        const categoryComboboxHtml = renderCategoryCombobox({
            value: item.category || 'Home',
            placeholder: 'Category...',
            onChangeExpr: `updateStagingItem(${idx}, 'category', this.value)`,
            compact: true,
            style: 'width: 120px;'
        });

        const isContainer = item.type !== 'routine' && Array.isArray(item.subtasks) && item.subtasks.length > 0;
        const totalSubPts = isContainer
            ? item.subtasks.reduce((sum, s) => sum + api.clampStep5Points(typeof s === 'object' ? s.points : 5, 5), 0)
            : 0;
        const parentPtsVal = isContainer ? 0 : api.clampStep5Points(item.points, 5);

        let subtasksHtml = '';
        if (item.subtasks && item.subtasks.length > 0) {
            const subtaskRows = item.subtasks.map((step, sIdx) => {
                const stepName = typeof step === 'string' ? step : (step?.name || step?.text || '');
                const stepPts = api.clampStep5Points(typeof step === 'object' ? step?.points : 5, 5);
                return '<div style="display: flex; gap: 6px; align-items: center;">' +
                    '<span style="font-size: 11px; color: var(--text-muted);">&#x2022;</span>' +
                    '<input type="text" value="' + escapeHtml(stepName) + '" onchange="updateStagingSubtask(' + idx + ', ' + sIdx + ', this.value)" placeholder="Step description..." style="flex: 1; padding: 3px 6px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-color); color: var(--text-main);">' +
                    '<input type="number" min="5" max="100" step="5" value="' + stepPts + '" onchange="updateStagingSubtaskPoints(' + idx + ', ' + sIdx + ', this.value)" title="Subtask points (5-100, step 5)" style="width: 54px; padding: 3px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); text-align: center; background: var(--bg-color); color: var(--text-main);">' +
                    '<button type="button" onclick="removeStagingSubtask(' + idx + ', ' + sIdx + ')" style="background: none; border: none; cursor: pointer; color: var(--danger); font-size: 14px;" title="Remove step">&times;</button>' +
                    '</div>';
            }).join('');

            subtasksHtml = '<div style="display: flex; flex-direction: column; gap: 4px; padding-left: 6px;">' + subtaskRows + '</div>';
        }

        const isUnselected = !item.selected;
        const opacityVal = item.selected ? '1' : '0.6';
        const checkedAttr = item.selected ? 'checked' : '';
        const pointsInputHtml = isContainer
            ? `<input type="number" value="0" min="0" disabled title="Container mode: points awarded per subtask (Total: ${totalSubPts} pts)" style="width: 48px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); text-align: center; opacity: 0.7;"> <span style="font-size: 10px; color: var(--primary); font-weight: 700;">(&Sigma; ${totalSubPts})</span>`
            : `<input type="number" value="${parentPtsVal}" min="5" max="100" step="5" onchange="updateStagingItem(${idx}, 'points', this.value); this.value = window._clampStep5Staging ? window._clampStep5Staging(this.value) : this.value;" style="width: 52px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); text-align: center;">`;

        return `
        <div class="staging-card ${isUnselected ? 'is-unselected' : ''}" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 12px; opacity: ${opacityVal}; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <input type="checkbox" ${checkedAttr} onchange="updateStagingItem(${idx}, 'selected', this.checked)">
                ${actionBadge}
                <input type="text" value="${escapeHtml(item.title)}" onchange="updateStagingItem(${idx}, 'title', this.value)" style="flex: 1; min-width: 180px; padding: 4px 8px; font-size: 13px; font-weight: 700; border-radius: 4px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-color); color: var(--text-main);" placeholder="Task title...">
                ${reasonHtml}
                <button type="button" onclick="deleteStagingItem(${idx})" style="background: none; border: none; cursor: pointer; color: var(--danger); font-size: 16px; margin-left: auto;" title="Remove row">&times;</button>
            </div>

            ${curHtml}

            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 11px;">
                <label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">
                    Type:
                    <select onchange="updateStagingItem(${idx}, 'type', this.value); renderBrainDumpStaging();" style="padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <option value="todo" ${item.type === 'todo' ? 'selected' : ''}>To-Do</option>
                        <option value="project" ${item.type === 'project' ? 'selected' : ''}>Project / Idea</option>
                        <option value="routine" ${item.type === 'routine' ? 'selected' : ''}>Routine</option>
                    </select>
                </label>

                <div style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">
                    <span>Cat:</span>
                    ${categoryComboboxHtml}
                </div>

                <label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">
                    Points:
                    ${pointsInputHtml}
                </label>

                <label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">
                    Priority:
                    <select onchange="updateStagingItem(${idx}, 'priority', this.value)" style="padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <option value="high" ${item.priority === 'high' ? 'selected' : ''}>High</option>
                        <option value="medium" ${item.priority === 'medium' || !item.priority ? 'selected' : ''}>Med</option>
                        <option value="low" ${item.priority === 'low' ? 'selected' : ''}>Low</option>
                    </select>
                </label>

                <label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">
                    Friction:
                    <select onchange="updateStagingItem(${idx}, 'frictionTag', this.value)" style="padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <option value="" ${!item.frictionTag ? 'selected' : ''}>None</option>
                        <option value="quick" ${item.frictionTag === 'quick' ? 'selected' : ''}>&#x26A1; Quick (&lt;5m)</option>
                        <option value="low_brain" ${item.frictionTag === 'low_brain' ? 'selected' : ''}>&#x1F9E0; Low Brain</option>
                        <option value="deep_focus" ${item.frictionTag === 'deep_focus' ? 'selected' : ''}>&#x1F3AF; Deep Focus</option>
                    </select>
                </label>

                <label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">
                    Assignee:
                    <select onchange="updateStagingItem(${idx}, 'assignee', this.value)" style="padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                        ${assigneeOptionsHtml}
                    </select>
                </label>

                ${scheduleHtml}
            </div>

            <div>
                <label style="font-size: 11px; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 2px;">Description / Notes:</label>
                <textarea rows="2" placeholder="Optional details, instructions, or steps..." onchange="updateStagingItem(${idx}, 'description', this.value)" style="width: 100%; padding: 6px 8px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); box-sizing: border-box; font-family: inherit; background: var(--bg-color); color: var(--text-main);">${escapeHtml(item.description || '')}</textarea>
            </div>

            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 11px; font-weight: 700; color: var(--text-muted);">
                        Subtasks / Steps (${item.subtasks?.length || 0})
                    </span>
                    <button type="button" onclick="addSubtaskToStaging(${idx}, '')" class="action-btn" style="padding: 2px 6px; font-size: 10px;">
                        + Add Step
                    </button>
                </div>
                ${subtasksHtml}
            </div>
        </div>
        `;
    }

    if (newItems.length > 0) {
        const newCardsHtml = state.brainDumpStaging
            .map((item, idx) => (item.action === 'create' || item.action === 'create_category') ? renderStagingCard(item, idx) : '')
            .join('');
        html += `
        <div style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="margin: 0; font-size: 15px; display: flex; align-items: center; gap: 6px;">
                    &#x2728; New Items to Add (${newItems.length})
                </h4>
                <label style="font-size: 12px; font-weight: 600; cursor: pointer;">
                    <input type="checkbox" checked onchange="toggleSectionStagingRows('create', this.checked)"> Select All New
                </label>
            </div>
            ${newCardsHtml}
        </div>
        `;
    }

    if (existingItems.length > 0) {
        const existingCardsHtml = state.brainDumpStaging
            .map((item, idx) => (item.action !== 'create' && item.action !== 'create_category') ? renderStagingCard(item, idx) : '')
            .join('');
        html += `
        <div style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="margin: 0; font-size: 15px; display: flex; align-items: center; gap: 6px;">
                    &#x21BB; Updates &amp; Completions for Existing Items (${existingItems.length})
                </h4>
                <label style="font-size: 12px; font-weight: 600; cursor: pointer;">
                    <input type="checkbox" checked onchange="toggleSectionStagingRows('existing', this.checked)"> Select All Updates
                </label>
            </div>
            ${existingCardsHtml}
        </div>
        `;
    }

    container.innerHTML = html;
}

export function updateStagingItem(index, field, value) {
    const item = state.brainDumpStaging[index];
    if (!item) return;

    if (field === 'category') {
        value = registerCustomCategory(value, false) || 'Home';
        item.isExplicitCategoryCreate = true;
    } else if (field === 'points') {
        const hasSubs = item.type !== 'routine' && Array.isArray(item.subtasks) && item.subtasks.length > 0;
        value = hasSubs ? 0 : api.clampStep5Points(value, 5);
    } else if (field === 'priority') {
        item.priorityTouched = true;
    } else if (field === 'type') {
        if (value === 'routine') {
            if (!item.schedule) {
                item.schedule = {
                    type: 'daily',
                    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    timeOfDay: 'Anytime',
                    points: api.clampStep5Points(item._prevPoints || item.points, 5)
                };
            }
            if (!item.points || Number(item.points) <= 0) {
                item.points = api.clampStep5Points(item._prevPoints, 5);
            }
        } else {
            if (Array.isArray(item.subtasks) && item.subtasks.length > 0) {
                if (Number(item.points) > 0) item._prevPoints = api.clampStep5Points(item.points, 5);
                item.points = 0;
            }
            if (!item.priorityTouched && !item.current) {
                item.priority = (value === 'project') ? 'low' : 'medium';
            }
        }
    }

    item[field] = value;
    if (field === 'selected') renderBrainDumpStaging();
}

export function deleteStagingItem(index) {
    state.brainDumpStaging.splice(index, 1);
    renderBrainDumpStaging();
}

export function toggleAllStagingRows(checked) {
    state.brainDumpStaging.forEach(item => { item.selected = checked; });
    renderBrainDumpStaging();
}

export function toggleSectionStagingRows(section, checked) {
    state.brainDumpStaging.forEach(item => {
        if (section === 'create' && (item.action === 'create' || item.action === 'create_category')) item.selected = checked;
        else if (section === 'existing' && item.action !== 'create' && item.action !== 'create_category') item.selected = checked;
    });
    renderBrainDumpStaging();
}

export function clearBrainDumpStaging() {
    state.brainDumpStaging = [];
    renderBrainDumpStaging();
    const statusEl = document.getElementById('brainDumpStatus');
    if (statusEl) statusEl.textContent = "";
}

// ==========================================
// 4. APPLY ALL STAGED CHANGES TO FIRESTORE
// ==========================================
function buildCleanRoutineSchedule(item) {
    const rawSched = item.schedule || {};
    const rawDays = Array.isArray(rawSched.daysOfWeek)
        ? Array.from(new Set(rawSched.daysOfWeek.map(d => Number(d)).filter(d => !isNaN(d) && d >= 0 && d <= 6)))
        : [];
    const isWeekly = rawSched.type === 'weekly' && rawDays.length > 0 && rawDays.length < 7;
    const timeOfDay = rawSched.timeOfDay || 'Anytime';

    if (isWeekly) {
        return {
            type: 'weekly',
            resetType: 'midnight',
            daysOfWeek: rawDays.sort((a, b) => a - b),
            timeOfDay
        };
    }
    return {
        type: 'daily',
        resetType: 'midnight',
        timeOfDay
    };
}

export async function applyUnifiedStagingToFirestore() {
    if (isApplyingStaging) return;

    const selected = state.brainDumpStaging.filter(item => item.selected);
    if (selected.length === 0) {
        alert("Please select at least one staged item to apply.");
        return;
    }

    const applyBtn = document.querySelector('#brainDumpStaging .save-mode');
    const prevApplyHtml = applyBtn ? applyBtn.innerHTML : '';
    isApplyingStaging = true;
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Applying...';
    }

    try {
        const batch = window.db.batch();
        const nowIso = new Date().toISOString();
        const todayKey = getLocalTodayKey();
        const doerUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
        const doerName = ALL_USERS.find(u => u.uid === doerUid)?.name || 'User';

        let createdCount = 0;
        let updatedCount = 0;
        let completedCount = 0;
        let deletedCount = 0;
        let hasBatchOps = false;

        for (const item of selected) {
            if (item.action === 'create_category') {
                const newCatName = registerCustomCategory(item.category || item.title || '', true);
                if (newCatName) createdCount++;
                continue;
            }

            const id = item.id;
            const isRoutineDoc = id && state.routines?.some(r => r.uid === id);
            const rawCatName = (item.category || 'Home').trim() || 'Home';
            const isAlreadyKnownVisible = getEligibleTaskCategories().some(c => c.toLowerCase() === rawCatName.toLowerCase());
            const shouldExplicitCreateCat = Boolean(item.isExplicitCategoryCreate || !isAlreadyKnownVisible);
            const catVal = registerCustomCategory(rawCatName, shouldExplicitCreateCat) || 'Home';

            if (item.action === 'create') {
                const assigneeUids = [];
                if (item.assignee && item.assignee !== 'Anyone' && item.assignee !== '__KEEP__') {
                    const userObj = ALL_USERS.find(u => u.name.toLowerCase() === item.assignee.toLowerCase());
                    if (userObj) assigneeUids.push(userObj.uid);
                }

                const hasTodoSubtasks = item.type !== 'routine' && Array.isArray(item.subtasks) && item.subtasks.length > 0;
                const pts = item.type === 'routine'
                    ? api.clampStep5Points(item.points, 5)
                    : (hasTodoSubtasks ? 0 : api.clampStep5Points(item.points, 5));

                if (item.type === 'routine') {
                    const routineRef = window.getNiptoCollection('routines').doc();
                    const scheduleData = buildCleanRoutineSchedule(item);
                    batch.set(routineRef, {
                        name: item.title,
                        type: 'routine',
                        completionType: 'shared',
                        assignees: assigneeUids,
                        schedule: scheduleData,
                        timeOfDay: scheduleData.timeOfDay,
                        linkedNiptoTask: null,
                        points: pts,
                        overdueAfterHours: 14,
                        frictionTag: item.frictionTag || '',
                        category: catVal,
                        createdBy: doerName,
                        createdAt: nowIso,
                        updatedAt: nowIso,
                        lastReviewedAt: nowIso,
                        lastCompleted: {},
                        lastCompletedBy: {},
                        completionsByDate: {}
                    });
                    hasBatchOps = true;
                } else {
                    const todoRef = window.getNiptoCollection('custom_tasks').doc();
                    const subTasks = (item.subtasks || []).map((s, i) => ({
                        id: (typeof s === 'object' && s.id) || ('st_' + Date.now() + '_' + i),
                        name: typeof s === 'string' ? s : (s.name || s.text || ''),
                        points: api.clampStep5Points(typeof s === 'object' ? s.points : 5, 5),
                        completed: false,
                        createdBy: doerName,
                        createdAt: nowIso
                    })).filter(st => st.name);

                    const effectiveHasSubtasks = subTasks.length > 0;
                    const finalPriority = ['high', 'medium', 'low'].includes(item.priority)
                        ? item.priority
                        : (item.type === 'project' ? 'low' : 'medium');

                    batch.set(todoRef, {
                        name: item.title,
                        type: item.type || 'todo',
                        bucket: item.type === 'project' ? 'project_idea' : 'actionable',
                        category: catVal,
                        location: 'N/A',
                        assignees: assigneeUids,
                        frictionTag: item.frictionTag || '',
                        priority: finalPriority,
                        points: effectiveHasSubtasks ? 0 : pts,
                        ...(effectiveHasSubtasks ? { linkedNiptoTask: null } : {}),
                        description: item.description || '',
                        notes: item.description || '',
                        createdBy: doerName,
                        subTasks: subTasks,
                        completed: false,
                        createdAt: nowIso,
                        updatedAt: nowIso,
                        lastReviewedAt: nowIso
                    });
                    hasBatchOps = true;
                }
                expandCategoryOnReactivation(item.type || 'todo', catVal);
                createdCount++;
            } else if (item.action === 'delete') {
                if (isRoutineDoc) {
                    batch.delete(window.getNiptoCollection('routines').doc(id));
                    hasBatchOps = true;
                } else if (id) {
                    batch.delete(window.getNiptoCollection('custom_tasks').doc(id));
                    hasBatchOps = true;
                }
                deletedCount++;
            } else if (item.action === 'complete') {
                let compUid = doerUid;
                let compName = doerName;
                if (item.assignee && item.assignee !== 'Anyone' && item.assignee !== '__KEEP__') {
                    const matchedCompUser = ALL_USERS.find(u =>
                        (u.name && u.name.toLowerCase() === String(item.assignee).toLowerCase()) ||
                        u.uid === item.assignee
                    );
                    if (matchedCompUser) {
                        compUid = matchedCompUser.uid;
                        compName = matchedCompUser.name;
                    }
                }

                if (isRoutineDoc) {
                    const routine = state.routines.find(r => r.uid === id);
                    if (routine) {
                        const stagedPts = item.points !== undefined ? api.clampStep5Points(item.points, 5) : null;
                        if (stagedPts && stagedPts !== api.getRoutinePoints(routine)) {
                            routine.points = stagedPts;
                            await api.updateFirestoreDocument('routines', id, { points: stagedPts });
                        }
                        await completeRoutineForDate(id, todayKey, true, compUid);
                    }
                } else if (id) {
                    const existingTodo = state.todoTasksData?.find(t => t.id === id);
                    const isContainerTodo = (Array.isArray(existingTodo?.subTasks) && existingTodo.subTasks.length > 0)
                        || (Array.isArray(item.subtasks) && item.subtasks.length > 0);
                    const pts = isContainerTodo ? 0 : api.clampStep5Points(item.points ?? existingTodo?.points, 5);
                    let activityUids = [];
                    if (!isContainerTodo && pts > 0) {
                        try {
                            activityUids = await api.logCustomPointsToNipto(
                                pts,
                                item.title || existingTodo?.name || 'To-Do',
                                [compUid],
                                nowIso,
                                existingTodo?.linkedNiptoTask || null
                            );
                        } catch (niptoErr) {
                            console.warn("Could not log Brain Dump To-Do points to Nipto API:", niptoErr);
                        }
                    }
                    batch.update(window.getNiptoCollection('custom_tasks').doc(id), {
                        completed: true,
                        completedAt: nowIso,
                        completedBy: [compUid],
                        completedActivityUids: activityUids,
                        completedActivityUid: activityUids[0] || null,
                        lastReviewedAt: nowIso,
                        updatedAt: nowIso
                    });
                    hasBatchOps = true;
                    if (pts > 0 && activityUids.length === 0) {
                        api.awardAllowancePoints(compUid, pts);
                    }
                    if (!isContainerTodo && pts > 0) {
                        await api.recordDailyCompletion({
                            id: `todo_${id}`,
                            itemId: id,
                            sourceType: 'todo',
                            title: item.title || existingTodo?.name || 'To-Do',
                            user: compName,
                            userUid: compUid,
                            points: pts,
                            completedAt: nowIso,
                            dateKey: todayKey,
                            ...(activityUids.length > 0 ? { activityUids, activityUid: activityUids[0] } : {})
                        });
                    }

                    const linkedRoutine = findMatchingRoutineForChore(
                        existingTodo || { id, name: item.title, type: item.type || 'todo' },
                        'todo'
                    );
                    if (linkedRoutine) {
                        const rStatus = getRoutineCompletionForDate(linkedRoutine, todayKey);
                        if (!rStatus.isDone || rStatus.withoutPoints) {
                            await completeRoutineForDate(linkedRoutine.uid, todayKey, true, compUid, {
                                completedByChore: true,
                                sourceChoreType: 'todo',
                                sourceChoreId: id,
                                activityUids,
                                points: pts,
                                creditedName: compName,
                                completedAt: nowIso
                            });
                        }
                    }
                }
                completedCount++;
            } else {
                // action === 'update'
                let nextAssignees = null;
                if (item.assignee && item.assignee !== '__KEEP__') {
                    if (item.assignee === 'Anyone') {
                        nextAssignees = [];
                    } else {
                        const matchedAssUser = ALL_USERS.find(u =>
                            (u.name && u.name.toLowerCase() === String(item.assignee).toLowerCase()) ||
                            u.uid === item.assignee
                        );
                        if (matchedAssUser) nextAssignees = [matchedAssUser.uid];
                    }
                } else if (Array.isArray(item.existingAssigneeUids)) {
                    nextAssignees = [...item.existingAssigneeUids];
                }

                if (isRoutineDoc) {
                    const scheduleData = buildCleanRoutineSchedule(item);
                    batch.update(window.getNiptoCollection('routines').doc(id), {
                        name: item.title,
                        category: catVal,
                        points: api.clampStep5Points(item.points, 5),
                        priority: item.priority || 'medium',
                        frictionTag: item.frictionTag || '',
                        ...(nextAssignees !== null ? { assignees: nextAssignees } : {}),
                        schedule: scheduleData,
                        timeOfDay: scheduleData.timeOfDay,
                        updatedAt: nowIso,
                        lastReviewedAt: nowIso
                    });
                    hasBatchOps = true;
                } else if (id) {
                    if (item.type === 'routine') {
                        const newRoutineRef = window.getNiptoCollection('routines').doc();
                        const scheduleData = buildCleanRoutineSchedule(item);
                        const convertedAssignees = nextAssignees !== null ? nextAssignees : [];
                        batch.set(newRoutineRef, {
                            name: item.title,
                            type: 'routine',
                            completionType: 'shared',
                            assignees: convertedAssignees,
                            schedule: scheduleData,
                            timeOfDay: scheduleData.timeOfDay,
                            points: api.clampStep5Points(item.points, 5),
                            category: catVal,
                            priority: item.priority || 'medium',
                            frictionTag: item.frictionTag || '',
                            createdAt: nowIso,
                            updatedAt: nowIso,
                            lastReviewedAt: nowIso,
                            completionsByDate: {}
                        });
                        batch.delete(window.getNiptoCollection('custom_tasks').doc(id));
                        hasBatchOps = true;
                    } else {
                        const existingTaskDoc = state.todoTasksData?.find(t => t.id === id) || item.current;
                        const existingSubList = Array.isArray(existingTaskDoc?.subTasks) ? existingTaskDoc.subTasks : [];
                        let nextSubTasks = null;
                        if (Array.isArray(item.subtasks) && item.subtasks.length > 0) {
                            nextSubTasks = item.subtasks.map((s, i) => {
                                const subName = (typeof s === 'string' ? s : (s?.name || s?.text || '')).trim();
                                if (!subName) return null;
                                const prevSt = existingSubList.find(es =>
                                    (typeof s === 'object' && s.id && es.id === s.id) ||
                                    ((es.name || es.text || '').trim().toLowerCase() === subName.toLowerCase())
                                );
                                return {
                                    id: (typeof s === 'object' && s.id) || prevSt?.id || ('st_' + Date.now() + '_' + i),
                                    name: subName,
                                    points: api.clampStep5Points(typeof s === 'object' ? s.points : prevSt?.points, 5),
                                    completed: prevSt ? Boolean(prevSt.completed) : false,
                                    completedAt: prevSt?.completedAt ?? null,
                                    completedBy: prevSt?.completedBy ?? null,
                                    completedByUids: Array.isArray(prevSt?.completedByUids) ? prevSt.completedByUids : [],
                                    completedActivityUids: Array.isArray(prevSt?.completedActivityUids) ? prevSt.completedActivityUids : [],
                                    completedActivityUid: prevSt?.completedActivityUid ?? null,
                                    linkedNiptoTask: prevSt?.linkedNiptoTask ?? null,
                                    createdBy: prevSt?.createdBy || doerName,
                                    createdAt: prevSt?.createdAt || nowIso
                                };
                            }).filter(Boolean);
                        } else if (Array.isArray(item.subtasks) && item.subtasks.length === 0 && existingSubList.length > 0) {
                            nextSubTasks = [];
                        }

                        const hasUpdatedSubtasks = Array.isArray(nextSubTasks)
                            ? nextSubTasks.length > 0
                            : existingSubList.length > 0;

                        const updates = {
                            name: item.title,
                            type: item.type,
                            bucket: item.type === 'project' ? 'project_idea' : 'actionable',
                            category: catVal,
                            ...(nextAssignees !== null ? { assignees: nextAssignees } : {}),
                            points: hasUpdatedSubtasks ? 0 : api.clampStep5Points(item.points, 5),
                            ...(hasUpdatedSubtasks ? { linkedNiptoTask: null } : {}),
                            priority: item.priority || (item.type === 'project' ? 'low' : 'medium'),
                            frictionTag: item.frictionTag || '',
                            description: item.description !== undefined ? item.description : '',
                            notes: item.description !== undefined ? item.description : '',
                            updatedAt: nowIso,
                            lastReviewedAt: nowIso
                        };
                        if (nextSubTasks !== null) {
                            updates.subTasks = nextSubTasks;
                        }
                        batch.update(window.getNiptoCollection('custom_tasks').doc(id), updates);
                        hasBatchOps = true;
                    }
                }
                expandCategoryOnReactivation(item.type || 'todo', catVal);
                updatedCount++;
            }
        }

        if (hasBatchOps) {
            await batch.commit();
        }
        showToast("unified_ok", `Applied ${selected.length} changes (${createdCount} added, ${updatedCount} updated, ${completedCount} completed, ${deletedCount} deleted)!`, 0, "");
        clearBrainDumpStaging();
        const inputEl = document.getElementById('brainDumpInput');
        if (inputEl) inputEl.value = "";

        await api.loadRoutinesFromFirestore();
        rebuildCompletedToday();
        renderDoneTodayFeed();
        renderTodoTasks();
        renderRollingSchedule();
        renderBulkTriageList();
        updateLeaderboardUI();
    } catch (err) {
        console.error("Batch update error:", err);
        alert("Failed to apply changes: " + err.message);
    } finally {
        isApplyingStaging = false;
        if (applyBtn && applyBtn.isConnected) {
            applyBtn.disabled = false;
            applyBtn.innerHTML = prevApplyHtml;
        }
    }
}

export const commitBrainDumpToFirestore = applyUnifiedStagingToFirestore;
export const applyRambleUpdatesToFirestore = applyUnifiedStagingToFirestore;
export function switchBrainDumpMode() {}
export const analyzeRambleWithGemini = parseWithGemini;
export const renderRambleDiffStaging = renderBrainDumpStaging;
export function updateRambleRow(idx, field, val) { updateStagingItem(idx, field, val); }
export function updateRambleProp(idx, prop, val) { updateStagingItem(idx, prop, val); }
export const toggleAllRambleRows = toggleAllStagingRows;
export const clearRambleStaging = clearBrainDumpStaging;

// ==========================================
// 5. BULK TRIAGE & MANAGEMENT OVERHAUL
// ==========================================
export function switchManageSubtab(subtab) {
    state.manageSubtab = subtab;
    if (subtab === 'todos') state.bulkTypeFilter = 'todo';
    else if (subtab === 'routines') state.bulkTypeFilter = 'routine';
    else state.bulkTypeFilter = subtab || 'all';
    renderBulkTriageList();
}

export function filterManageList(query) {
    state.manageSearchQuery = (query || '').toLowerCase().trim();
    renderBulkTriageList();
}

export function setBulkTypeFilter(type) {
    state.bulkTypeFilter = type;
    renderBulkTriageList();
}

export function setBulkCategoryFilter(cat) {
    state.bulkCategoryFilter = cat;
    renderBulkTriageList();
}

export function setBulkPriorityFilter(pri) {
    state.bulkPriorityFilter = pri;
    renderBulkTriageList();
}

export function setBulkOwnershipFilter(own) {
    state.bulkOwnershipFilter = own;
    renderBulkTriageList();
}

export function setBulkSortBy(sortBy) {
    state.bulkSortBy = sortBy;
    renderBulkTriageList();
}

export async function updateInlineTaskField(sourceType, id, field, value) {
    const nowIso = new Date().toISOString();
    if (field === 'category') {
        value = registerCustomCategory(value) || 'Home';
    } else if (field === 'points') {
        if (sourceType === 'todo') {
            const existingTodo = state.todoTasksData?.find(item => item.id === id);
            if (existingTodo && Array.isArray(existingTodo.subTasks) && existingTodo.subTasks.length > 0) {
                value = 0;
            } else {
                value = api.clampStep5Points(value, 5);
            }
        } else {
            value = api.clampStep5Points(value, 5);
        }
    }
    try {
        if (sourceType === 'routine') {
            await api.updateFirestoreDocument('routines', id, {
                [field]: value,
                updatedAt: nowIso,
                lastReviewedAt: nowIso
            });
            const r = state.routines?.find(item => item.uid === id);
            if (r) {
                r[field] = value;
                r.updatedAt = nowIso;
                r.lastReviewedAt = nowIso;
            }
        } else {
            const updates = {
                [field]: value,
                updatedAt: nowIso,
                lastReviewedAt: nowIso
            };
            if (field === 'type') {
                updates.bucket = (value === 'project') ? 'project_idea' : 'actionable';
            }
            if (field === 'description') {
                updates.notes = value;
            }
            await api.updateFirestoreDocument('custom_tasks', id, updates);
            const t = state.todoTasksData?.find(item => item.id === id);
            if (t) {
                t[field] = value;
                if (field === 'type') t.bucket = updates.bucket;
                if (field === 'description') t.notes = value;
                t.updatedAt = nowIso;
                t.lastReviewedAt = nowIso;
            }
        }
        showToast("inline_ok", `Updated ${field}!`, 0, "");
        renderTodoTasks();
        if (field === 'category') renderBulkTriageList();
    } catch (e) {
        console.error("Inline update failed:", e);
        alert("Failed to update field: " + e.message);
    }
}

export function toggleBulkSectionCollapse(sectionKey) {
    if (!state.userPrefs.bulkCollapsedSections) state.userPrefs.bulkCollapsedSections = {};
    const curr = !!state.userPrefs.bulkCollapsedSections[sectionKey];
    state.userPrefs.bulkCollapsedSections[sectionKey] = !curr;
    saveCloudPreference('bulkCollapsedSections', state.userPrefs.bulkCollapsedSections);
    renderBulkTriageList();
}

export function toggleBulkShowArchivedDone() {
    state.showArchivedDoneInBulk = !state.showArchivedDoneInBulk;
    if (!state.showArchivedDoneInBulk) {
        (state.todoTasksData || []).forEach(t => {
            if (isCompletedTodoExpired(t)) {
                state.selectedTodoIds.delete(t.id);
            }
        });
    }
    renderBulkTriageList();
}

function getFilteredBulkData() {
    const query = state.manageSearchQuery || '';
    if (!state.bulkTypeFilter) state.bulkTypeFilter = 'all';
    const typeFilter = state.bulkTypeFilter;
    if (state.bulkCategoryFilter && state.bulkCategoryFilter !== 'all' && !isCategoryVisibleForTasks(state.bulkCategoryFilter)) {
        state.bulkCategoryFilter = 'all';
    }
    const categoryFilter = state.bulkCategoryFilter || 'all';
    const priorityFilter = state.bulkPriorityFilter || 'all';
    const ownershipFilter = state.bulkOwnershipFilter || 'all';
    const sortBy = state.bulkSortBy || 'default';
    const showArchivedDone = Boolean(state.showArchivedDoneInBulk);

    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const allRawTodos = (state.todoTasksData || [])
        .filter(t => !isInternalLockedCategory(t.category || 'Home'))
        .map(normalizeTask);
    const archivedDoneCount = allRawTodos.filter(t => isCompletedTodoExpired(t)).length;

    if (!showArchivedDone) {
        allRawTodos.forEach(t => {
            if (isCompletedTodoExpired(t)) state.selectedTodoIds.delete(t.id);
        });
    }

    const allTodos = showArchivedDone
        ? allRawTodos
        : allRawTodos.filter(t => !isCompletedTodoExpired(t));
    const allRoutines = (state.routines || []).filter(r => !isInternalLockedCategory(r.category || 'Home'));

    function getPriorityWeight(p) {
        if (!p) return 2;
        const lp = p.toLowerCase();
        if (lp === 'high') return 3;
        if (lp === 'medium') return 2;
        if (lp === 'low') return 1;
        return 2;
    }

    function matchesCat(cat) {
        if (categoryFilter === 'all') return true;
        return (cat || 'Home').toLowerCase() === categoryFilter.toLowerCase();
    }

    function matchesPri(pri) {
        if (priorityFilter === 'all') return true;
        return (pri || 'medium').toLowerCase() === priorityFilter.toLowerCase();
    }

    function matchesOwn(assignees = []) {
        if (ownershipFilter === 'all') return true;
        const own = classifyTaskOwnership({ assignees }, activeUid, ALL_USERS);
        if (ownershipFilter === 'me') return own.assignees.includes(activeUid);
        if (ownershipFilter === 'individual') return !own.isAnyone && own.assignees.length === 1;
        if (ownershipFilter === 'shared') return own.isAnyone || own.assignees.length > 1;
        if (ownershipFilter === 'unassigned') return own.isAnyone;
        return true;
    }

    let filteredTasks = allTodos.filter(t => matchesCat(t.category) && matchesPri(t.priority) && matchesOwn(t.assignees));
    if (query) {
        filteredTasks = filteredTasks.filter(t => {
            const nameMatch = (t.name || '').toLowerCase().includes(query);
            const descMatch = (t.description || '').toLowerCase().includes(query);
            const catMatch = (t.category || '').toLowerCase().includes(query);
            const creatorMatch = (t.createdBy || '').toLowerCase().includes(query);
            return nameMatch || descMatch || catMatch || creatorMatch;
        });
    }

    let filteredRoutines = allRoutines.filter(r => matchesCat(r.category) && matchesPri(r.priority) && matchesOwn(r.assignees));
    if (query) {
        filteredRoutines = filteredRoutines.filter(r => {
            const nameMatch = (r.name || '').toLowerCase().includes(query);
            const catMatch = (r.category || '').toLowerCase().includes(query);
            return nameMatch || catMatch;
        });
    }

    function sortTasks(list) {
        return list.slice().sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;

            if (sortBy === 'priority') {
                const pA = getPriorityWeight(a.priority);
                const pB = getPriorityWeight(b.priority);
                if (pA !== pB) return pB - pA;
                return (b.points || 5) - (a.points || 5);
            } else if (sortBy === 'points') {
                return (b.points || 5) - (a.points || 5);
            } else if (sortBy === 'category') {
                return (a.category || 'Home').localeCompare(b.category || 'Home');
            } else if (sortBy === 'title') {
                return (a.name || '').localeCompare(b.name || '');
            } else {
                const pA = getPriorityWeight(a.priority);
                const pB = getPriorityWeight(b.priority);
                if (pA !== pB) return pB - pA;
                return (toMillisSafe(b.createdAt) || 0) - (toMillisSafe(a.createdAt) || 0);
            }
        });
    }

    function sortRoutines(list) {
        const todayKey = getLocalTodayKey();
        return list.slice().sort((a, b) => {
            const aDone = isRoutineCompletedOnDate(a, todayKey);
            const bDone = isRoutineCompletedOnDate(b, todayKey);
            if (aDone !== bDone) return aDone ? 1 : -1;

            if (sortBy === 'priority') {
                const pA = getPriorityWeight(a.priority);
                const pB = getPriorityWeight(b.priority);
                if (pA !== pB) return pB - pA;
                return api.getRoutinePoints(b) - api.getRoutinePoints(a);
            } else if (sortBy === 'points') {
                return api.getRoutinePoints(b) - api.getRoutinePoints(a);
            } else if (sortBy === 'category') {
                return (a.category || 'Home').localeCompare(b.category || 'Home');
            } else {
                return (a.name || '').localeCompare(b.name || '');
            }
        });
    }

    const todosList = sortTasks(filteredTasks.filter(t => t.type === 'todo'));
    const projectsList = sortTasks(filteredTasks.filter(t => t.type === 'project'));
    const routinesList = sortRoutines(filteredRoutines);

    return {
        typeFilter,
        categoryFilter,
        priorityFilter,
        ownershipFilter,
        sortBy,
        showArchivedDone,
        archivedDoneCount,
        allTodos,
        allRoutines,
        todosList,
        projectsList,
        routinesList
    };
}

export function renderBulkTriageList() {
    const container = document.getElementById('bulkTriageContainer');
    if (!container) return;

    const {
        typeFilter,
        categoryFilter,
        priorityFilter,
        ownershipFilter,
        sortBy,
        showArchivedDone,
        archivedDoneCount,
        allTodos,
        allRoutines,
        todosList,
        projectsList,
        routinesList
    } = getFilteredBulkData();

    const collapsedSections = state.userPrefs.bulkCollapsedSections || {};
    const totalSelected = state.selectedTodoIds.size + state.selectedRoutineIds.size;
    updateBulkActionBarVisibility(totalSelected);

    const visibleCategoryOptions = Array.from(new Set([
        ...getEligibleTaskCategories(),
        ...allTodos.map(t => (t.category || 'Home').trim()).filter(isCategoryVisibleForTasks),
        ...allRoutines.map(r => (r.category || 'Home').trim()).filter(isCategoryVisibleForTasks)
    ])).sort((a, b) => a.localeCompare(b));

    const bulkCatOptionsHtml = visibleCategoryOptions.map(cat =>
        `<option value="${escapeHtml(cat)}" ${categoryFilter.toLowerCase() === cat.toLowerCase() ? 'selected' : ''}>${escapeHtml(cat)}</option>`
    ).join('');

    const visibleTodosForSelect = typeFilter === 'todo'
        ? todosList
        : (typeFilter === 'project' ? projectsList : (typeFilter === 'all' ? [...todosList, ...projectsList] : []));
    const visibleRoutinesForSelect = (typeFilter === 'routine' || typeFilter === 'all') ? routinesList : [];
    const totalVisibleCount = visibleTodosForSelect.length + visibleRoutinesForSelect.length;
    const allVisibleChecked = totalVisibleCount > 0 &&
        visibleTodosForSelect.every(t => state.selectedTodoIds.has(t.id)) &&
        visibleRoutinesForSelect.every(r => state.selectedRoutineIds.has(r.uid));

    function renderBulkTaskRow(t) {
        const isChecked = state.selectedTodoIds.has(t.id);
        const isCompleted = !!t.completed;
        const catCombobox = renderCategoryCombobox({
            value: t.category || 'Home',
            placeholder: 'Category...',
            onChangeExpr: `updateInlineTaskField('todo', '${t.id}', 'category', this.value)`,
            compact: true,
            style: 'width: 120px;'
        });

        return `
        <div class="bulk-triage-row" style="display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 6px; border-bottom: 1px solid var(--border-color); background: ${isChecked ? 'rgba(37, 99, 235, 0.05)' : (isCompleted ? 'var(--bg-color)' : 'transparent')}; opacity: ${isCompleted ? 0.65 : 1};">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <label class="bulk-select-cb-wrap" title="Select item for batch editing">
                    <input type="checkbox" class="bulk-select-cb" ${isChecked ? 'checked' : ''} onchange="toggleBulkItem('todo', '${t.id}', this.checked)">
                    <span class="bulk-select-label">Select</span>
                </label>

                <input type="text" value="${escapeHtml(t.name)}" onchange="updateInlineTaskField('todo', '${t.id}', 'name', this.value)" style="flex: 1; min-width: 140px; padding: 4px 8px; font-size: 13px; font-weight: 700; border-radius: 4px; border: 1px solid var(--border-color); text-decoration: ${isCompleted ? 'line-through' : 'none'}; box-sizing: border-box; background: var(--bg-color); color: var(--text-main);">

                <div style="display: flex; gap: 6px; align-items: center; margin-left: auto;">
                    <button type="button" class="btn-row-complete ${isCompleted ? 'is-done' : ''}" onclick="toggleTaskStatus('${t.id}', ${isCompleted})" title="${isCompleted ? 'Completed - click to undo' : 'Mark chore complete and award points'}">
                        ${isCompleted ? '&#x2714; Done (Undo)' : '&#x2714; Mark Done'}
                    </button>
                    <button type="button" class="action-btn" onclick="editTask('${t.id}')" title="Full Edit Modal" style="padding: 4px 8px; font-size: 11px;">&#x270E;</button>
                    <button type="button" class="action-btn" onclick="deleteTask('${t.id}')" title="Delete Task" style="padding: 4px 8px; font-size: 11px; color: var(--danger);">&#x1F5D1;</button>
                </div>
            </div>

            <div class="bulk-row-meta" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-left: 58px; font-size: 12px;">
                <label style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    Type:
                    <select onchange="updateInlineTaskField('todo', '${t.id}', 'type', this.value)" style="padding: 2px 5px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <option value="todo" ${t.type === 'todo' ? 'selected' : ''}>To-Do</option>
                        <option value="project" ${t.type === 'project' ? 'selected' : ''}>Project</option>
                    </select>
                </label>

                <label style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    Priority:
                    <select onchange="updateInlineTaskField('todo', '${t.id}', 'priority', this.value)" style="padding: 2px 5px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <option value="high" ${t.priority === 'high' ? 'selected' : ''}>High</option>
                        <option value="medium" ${t.priority === 'medium' ? 'selected' : ''}>Medium</option>
                        <option value="low" ${t.priority === 'low' ? 'selected' : ''}>Low</option>
                    </select>
                </label>

                <label style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    Points:
                    ${(Array.isArray(t.subTasks) && t.subTasks.length > 0)
                        ? `<input type="number" value="0" min="0" disabled title="Container task: points awarded per subtask" style="width: 45px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); text-align: center; opacity: 0.7;">`
                        : `<input type="number" value="${api.clampStep5Points(t.points, 5)}" min="5" max="100" step="5" onchange="const p = window._clampStep5Staging(this.value); this.value = p; updateInlineTaskField('todo', '${t.id}', 'points', p);" style="width: 48px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); text-align: center;">`
                    }
                </label>

                <div style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    <span>Cat:</span>
                    ${catCombobox}
                </div>

                <button type="button" class="action-btn" onclick="const d = document.getElementById('bulk-desc-${t.id}'); d.style.display = (d.style.display === 'none' ? 'block' : 'none');" style="padding: 2px 6px; font-size: 10px;">
                    ${t.description ? '&#x1F4DD; Note' : '+ Note'}
                </button>
            </div>

            <div id="bulk-desc-${t.id}" class="bulk-row-meta" style="display: none; margin-left: 58px; margin-top: 4px;">
                <input type="text" value="${escapeHtml(t.description || '')}" placeholder="Optional details/description..." onchange="updateInlineTaskField('todo', '${t.id}', 'description', this.value)" style="width: 100%; padding: 4px 8px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-color); color: var(--text-main);">
            </div>
        </div>
        `;
    }

    function renderBulkRoutineRow(r) {
        const isChecked = state.selectedRoutineIds.has(r.uid);
        const freq = isDailyRoutine(r) ? 'daily' : 'weekly';
        const pts = api.getRoutinePoints(r);
        const todayKey = getLocalTodayKey();
        const isDoneToday = isRoutineCompletedOnDate(r, todayKey);

        const toggleRoutineCall = isDoneToday
            ? 'undoRoutineForDate(\'' + r.uid + '\', \'' + todayKey + '\')'
            : 'completeRoutineForDate(\'' + r.uid + '\', \'' + todayKey + '\', true)';

        const catCombobox = renderCategoryCombobox({
            value: r.category || 'Home',
            placeholder: 'Category...',
            onChangeExpr: `updateInlineTaskField('routine', '${r.uid}', 'category', this.value)`,
            compact: true,
            style: 'width: 120px;'
        });

        return `
        <div class="bulk-triage-row" style="display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 6px; border-bottom: 1px solid var(--border-color); background: ${isChecked ? 'rgba(37, 99, 235, 0.05)' : (isDoneToday ? 'var(--bg-color)' : 'transparent')}; opacity: ${isDoneToday ? 0.7 : 1};">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <label class="bulk-select-cb-wrap" title="Select routine for batch editing">
                    <input type="checkbox" class="bulk-select-cb" ${isChecked ? 'checked' : ''} onchange="toggleBulkItem('routine', '${r.uid}', this.checked)">
                    <span class="bulk-select-label">Select</span>
                </label>

                <input type="text" value="${escapeHtml(r.name)}" onchange="updateInlineTaskField('routine', '${r.uid}', 'name', this.value)" style="flex: 1; min-width: 140px; padding: 4px 8px; font-size: 13px; font-weight: 700; border-radius: 4px; border: 1px solid var(--border-color); text-decoration: ${isDoneToday ? 'line-through' : 'none'}; box-sizing: border-box; background: var(--bg-color); color: var(--text-main);">

                <div style="display: flex; gap: 6px; align-items: center; margin-left: auto;">
                    <button type="button" class="btn-row-complete ${isDoneToday ? 'is-done' : ''}" onclick="${toggleRoutineCall}" title="${isDoneToday ? 'Completed today - click to undo' : 'Mark routine done today'}">
                        ${isDoneToday ? '&#x2714; Done (Undo)' : '&#x2714; Mark Done'}
                    </button>
                    <button type="button" class="action-btn" onclick="editRoutine('${r.uid}')" title="Edit Routine" style="padding: 4px 8px; font-size: 11px;">&#x270E;</button>
                    <button type="button" class="action-btn" onclick="deleteRoutine('${r.uid}')" title="Delete Routine" style="padding: 4px 8px; font-size: 11px; color: var(--danger);">&#x1F5D1;</button>
                </div>
            </div>

            <div class="bulk-row-meta" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-left: 58px; font-size: 12px;">
                <label style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    Schedule:
                    <select onchange="updateRoutineScheduleInline('${r.uid}', this.value)" style="padding: 2px 5px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <option value="daily" ${freq === 'daily' ? 'selected' : ''}>Daily</option>
                        <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Weekly</option>
                    </select>
                </label>

                <label style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    Priority:
                    <select onchange="updateInlineTaskField('routine', '${r.uid}', 'priority', this.value)" style="padding: 2px 5px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <option value="high" ${r.priority === 'high' ? 'selected' : ''}>High</option>
                        <option value="medium" ${r.priority === 'medium' || !r.priority ? 'selected' : ''}>Medium</option>
                        <option value="low" ${r.priority === 'low' ? 'selected' : ''}>Low</option>
                    </select>
                </label>

                <label style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    Points:
                    <input type="number" value="${api.clampStep5Points(pts, 5)}" min="5" max="100" step="5" onchange="const p = window._clampStep5Staging(this.value); this.value = p; updateInlineTaskField('routine', '${r.uid}', 'points', p);" style="width: 48px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); text-align: center;">
                </label>

                <div style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    <span>Cat:</span>
                    ${catCombobox}
                </div>

                <span style="font-size: 10px; color: var(--text-muted);">
                    ${escapeHtml(r.timeOfDay || 'Anytime')}
                </span>
            </div>
        </div>
        `;
    }

    const archivedBadgeCount = archivedDoneCount > 0 ? ` (${archivedDoneCount})` : '';
    const archivedToggleLabel = showArchivedDone
        ? `Showing Archived Done${archivedBadgeCount}`
        : `Show Archived Done (>3d)${archivedBadgeCount}`;

    let html = `
    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px 14px; background: var(--bg-color); border: 1px solid var(--border-color); border-bottom: none; border-radius: 8px 8px 0 0;">
        <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
            <button class="filter-pill ${typeFilter === 'all' ? 'active' : ''}" onclick="setBulkTypeFilter('all')">All</button>
            <button class="filter-pill ${typeFilter === 'todo' ? 'active' : ''}" onclick="setBulkTypeFilter('todo')">&#x26A1; To-Dos</button>
            <button class="filter-pill ${typeFilter === 'project' ? 'active' : ''}" onclick="setBulkTypeFilter('project')">&#x1F4A1; Projects</button>
            <button class="filter-pill ${typeFilter === 'routine' ? 'active' : ''}" onclick="setBulkTypeFilter('routine')">&#x21BB; Routines</button>
            <button type="button" class="filter-pill ${showArchivedDone ? 'active' : ''}" onclick="toggleBulkShowArchivedDone()" title="Show or hide completed to-dos finished more than 3 days ago">${archivedToggleLabel}</button>
        </div>

        <select class="todo-compact-select" onchange="setBulkCategoryFilter(this.value)" title="Filter by Category">
            <option value="all" ${categoryFilter === 'all' ? 'selected' : ''}>Category: All</option>
            ${bulkCatOptionsHtml}
        </select>

        <select class="todo-compact-select" onchange="setBulkPriorityFilter(this.value)" title="Filter by Priority">
            <option value="all" ${priorityFilter === 'all' ? 'selected' : ''}>Priority: All</option>
            <option value="high" ${priorityFilter === 'high' ? 'selected' : ''}>High</option>
            <option value="medium" ${priorityFilter === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="low" ${priorityFilter === 'low' ? 'selected' : ''}>Low</option>
        </select>

        <select class="todo-compact-select" onchange="setBulkOwnershipFilter(this.value)" title="Filter by Ownership">
            <option value="all" ${ownershipFilter === 'all' ? 'selected' : ''}>Ownership: All</option>
            <option value="me" ${ownershipFilter === 'me' ? 'selected' : ''}>Me</option>
            <option value="individual" ${ownershipFilter === 'individual' ? 'selected' : ''}>Individual (Single)</option>
            <option value="shared" ${ownershipFilter === 'shared' ? 'selected' : ''}>Shared / Anyone</option>
            <option value="unassigned" ${ownershipFilter === 'unassigned' ? 'selected' : ''}>Unassigned</option>
        </select>

        <label class="bulk-select-cb-wrap" title="Select or deselect all currently visible items" style="margin-left: auto;">
            <input type="checkbox" class="bulk-select-cb" ${allVisibleChecked ? 'checked' : ''} onchange="toggleBulkSelectAll(this.checked)">
            <span class="bulk-select-label">Select Visible (${totalVisibleCount})</span>
        </label>

        <select class="todo-compact-select" onchange="setBulkSortBy(this.value)" title="Sort list">
            <option value="default" ${sortBy === 'default' ? 'selected' : ''}>Sort: Active First</option>
            <option value="priority" ${sortBy === 'priority' ? 'selected' : ''}>Sort: Priority (High&rarr;Low)</option>
            <option value="points" ${sortBy === 'points' ? 'selected' : ''}>Sort: Points</option>
            <option value="category" ${sortBy === 'category' ? 'selected' : ''}>Sort: Category</option>
            <option value="title" ${sortBy === 'title' ? 'selected' : ''}>Sort: Title</option>
        </select>
    </div>

    <div style="background: var(--card-bg); border-radius: 0 0 8px 8px; border: 1px solid var(--border-color); padding: 8px;">
    `;

    if (typeFilter === 'all') {
        const isTodosCollapsed = !!collapsedSections['todos'];
        const isProjectsCollapsed = !!collapsedSections['projects'];
        const isRoutinesCollapsed = !!collapsedSections['routines'];
        const todosRowsHtml = todosList.length > 0
            ? todosList.map(renderBulkTaskRow).join('')
            : '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No to-dos match filters.</div>';
        const projectsRowsHtml = projectsList.length > 0
            ? projectsList.map(renderBulkTaskRow).join('')
            : '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No projects match filters.</div>';
        const routinesRowsHtml = routinesList.length > 0
            ? routinesList.map(renderBulkRoutineRow).join('')
            : '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No routines match filters.</div>';

        html += `
        <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="border: 1px solid var(--border-color); border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-color); cursor: pointer; border-radius: 8px 8px 0 0;" onclick="toggleBulkSectionCollapse('todos')">
                    <div style="font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                        <span>&#x26A1; To-Dos</span>
                        <span style="font-size: 11px; background: var(--card-bg); padding: 2px 6px; border-radius: 10px; border: 1px solid var(--border-color);">${todosList.length}</span>
                    </div>
                    <span style="font-size: 12px; color: var(--text-muted);">${isTodosCollapsed ? '&#x25B6;' : '&#x25BC;'}</span>
                </div>
                <div style="display: ${isTodosCollapsed ? 'none' : 'block'}; max-height: 480px; overflow-y: auto; padding: 8px;">
                    ${todosRowsHtml}
                </div>
            </div>

            <div style="border: 1px solid var(--border-color); border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-color); cursor: pointer; border-radius: 8px 8px 0 0;" onclick="toggleBulkSectionCollapse('projects')">
                    <div style="font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                        <span>&#x1F4A1; Projects / Ideas</span>
                        <span style="font-size: 11px; background: var(--card-bg); padding: 2px 6px; border-radius: 10px; border: 1px solid var(--border-color);">${projectsList.length}</span>
                    </div>
                    <span style="font-size: 12px; color: var(--text-muted);">${isProjectsCollapsed ? '&#x25B6;' : '&#x25BC;'}</span>
                </div>
                <div style="display: ${isProjectsCollapsed ? 'none' : 'block'}; max-height: 480px; overflow-y: auto; padding: 8px;">
                    ${projectsRowsHtml}
                </div>
            </div>

            <div style="border: 1px solid var(--border-color); border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-color); cursor: pointer; border-radius: 8px 8px 0 0;" onclick="toggleBulkSectionCollapse('routines')">
                    <div style="font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                        <span>&#x21BB; Routines</span>
                        <span style="font-size: 11px; background: var(--card-bg); padding: 2px 6px; border-radius: 10px; border: 1px solid var(--border-color);">${routinesList.length}</span>
                    </div>
                    <span style="font-size: 12px; color: var(--text-muted);">${isRoutinesCollapsed ? '&#x25B6;' : '&#x25BC;'}</span>
                </div>
                <div style="display: ${isRoutinesCollapsed ? 'none' : 'block'}; max-height: 480px; overflow-y: auto; padding: 8px;">
                    ${routinesRowsHtml}
                </div>
            </div>
        </div>
        `;
    } else if (typeFilter === 'todo') {
        const rowsHtml = todosList.length > 0 ? todosList.map(renderBulkTaskRow).join('') : '<div style="text-align: center; color: var(--text-muted); padding: 25px;">No to-dos match the selected filters.</div>';
        html += `<div style="max-height: 540px; overflow-y: auto; padding: 8px;">${rowsHtml}</div>`;
    } else if (typeFilter === 'project') {
        const rowsHtml = projectsList.length > 0 ? projectsList.map(renderBulkTaskRow).join('') : '<div style="text-align: center; color: var(--text-muted); padding: 25px;">No projects match the selected filters.</div>';
        html += `<div style="max-height: 540px; overflow-y: auto; padding: 8px;">${rowsHtml}</div>`;
    } else if (typeFilter === 'routine') {
        const rowsHtml = routinesList.length > 0 ? routinesList.map(renderBulkRoutineRow).join('') : '<div style="text-align: center; color: var(--text-muted); padding: 25px;">No routines match the selected filters.</div>';
        html += `<div style="max-height: 540px; overflow-y: auto; padding: 8px;">${rowsHtml}</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
}

export async function updateRoutineScheduleInline(routineId, freqType) {
    const routine = state.routines?.find(r => r.uid === routineId);
    if (!routine) return;

    const sched = { ...(routine.schedule || {}) };
    sched.type = freqType;
    if (freqType === 'daily') {
        sched.resetType = sched.resetType || 'midnight';
        delete sched.daysOfWeek;
        delete sched.days;
        delete sched.unit;
        delete sched.value;
    } else if (freqType === 'weekly') {
        if (!Array.isArray(sched.daysOfWeek) || sched.daysOfWeek.length === 0 || sched.daysOfWeek.length >= 7) {
            sched.daysOfWeek = [1, 3, 5];
        }
    }

    try {
        await api.updateFirestoreDocument('routines', routineId, { schedule: sched });
        routine.schedule = sched;
        showToast("routine_sched", `Updated schedule to ${freqType}!`, 0, "");
        renderRollingSchedule();
    } catch (e) {
        console.error("Error updating routine schedule:", e);
    }
}

export function toggleBulkItem(type, id, isChecked) {
    if (type === 'todo') {
        if (isChecked) state.selectedTodoIds.add(id);
        else state.selectedTodoIds.delete(id);
    } else {
        if (isChecked) state.selectedRoutineIds.add(id);
        else state.selectedRoutineIds.delete(id);
    }
    const total = state.selectedTodoIds.size + state.selectedRoutineIds.size;
    updateBulkActionBarVisibility(total);
}

export function toggleBulkSelectAll(checked) {
    const { typeFilter, todosList, projectsList, routinesList, showArchivedDone } = getFilteredBulkData();
    const targetTodos = typeFilter === 'todo'
        ? todosList
        : (typeFilter === 'project' ? projectsList : (typeFilter === 'all' ? [...todosList, ...projectsList] : []));
    const targetRoutines = (typeFilter === 'routine' || typeFilter === 'all') ? routinesList : [];

    if (checked) {
        targetTodos.forEach(t => {
            if (showArchivedDone || !isCompletedTodoExpired(t)) {
                state.selectedTodoIds.add(t.id);
            }
        });
        targetRoutines.forEach(r => state.selectedRoutineIds.add(r.uid));
    } else {
        targetTodos.forEach(t => state.selectedTodoIds.delete(t.id));
        targetRoutines.forEach(r => state.selectedRoutineIds.delete(r.uid));
    }
    renderBulkTriageList();
}

function updateBulkActionBarVisibility(count) {
    const bar = document.getElementById('stickyBulkActionBar');
    const countEl = document.getElementById('bulkSelectedCount');
    if (!bar) return;
    if (count > 0) {
        bar.style.display = 'flex';
        if (countEl) countEl.textContent = `${count} item${count > 1 ? 's' : ''} selected`;
    } else {
        bar.style.display = 'none';
    }
}

// Opens a modal with the Searchable / Creatable Category Combobox for Bulk Category Change
export function openBulkCategoryModal() {
    let modal = document.getElementById('bulkCategoryComboboxModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'bulkCategoryComboboxModal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; padding: 15px; z-index: 1300;';
        document.body.appendChild(modal);
    }

    const total = state.selectedTodoIds.size + state.selectedRoutineIds.size;
    modal.innerHTML = `
        <div class="modal" style="background: var(--card-bg, #fff); padding: 22px; border-radius: 12px; width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.2);">
            <h3 style="margin: 0; font-size: 16px;">&#x1F4C1; Set Category for ${total} Selected Item${total > 1 ? 's' : ''}</h3>
            <p style="margin: 0; font-size: 12px; color: var(--text-muted);">Search an existing category or type a new name to create it:</p>
            ${renderCategoryCombobox({
                id: 'bulkCategoryComboboxInput',
                value: 'Home',
                placeholder: 'Search or create category...'
            })}
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                <button type="button" class="action-btn" onclick="document.getElementById('bulkCategoryComboboxModal').style.display='none'">Cancel</button>
                <button type="button" class="action-btn save-mode" onclick="confirmBulkCategoryModal()">Apply Category</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
    const inp = document.getElementById('bulkCategoryComboboxInput');
    if (inp) setTimeout(() => inp.focus(), 50);
}

export async function confirmBulkCategoryModal() {
    const inp = document.getElementById('bulkCategoryComboboxInput');
    const rawVal = inp ? inp.value.trim() : '';
    if (!rawVal) {
        alert("Please select or type a category.");
        return;
    }
    const cleanCat = registerCustomCategory(rawVal, true);
    const modal = document.getElementById('bulkCategoryComboboxModal');
    if (modal) modal.style.display = 'none';

    const todoIds = Array.from(state.selectedTodoIds);
    const routineIds = Array.from(state.selectedRoutineIds);
    const total = todoIds.length + routineIds.length;
    if (total === 0) return;

    const nowIso = new Date().toISOString();
    const batch = window.db.batch();
    todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), { category: cleanCat, updatedAt: nowIso }));
    routineIds.forEach(id => batch.update(window.getNiptoCollection('routines').doc(id), { category: cleanCat, updatedAt: nowIso }));
    await batch.commit();

    state.selectedTodoIds.clear();
    state.selectedRoutineIds.clear();
    showToast("bulk_cat", `Updated category to "${cleanCat}" for ${total} items.`, 0, "");
    await api.loadRoutinesFromFirestore();
    renderBulkTriageList();
    renderTodoTasks();
    renderRollingSchedule();
}

export async function executeBulkAction(actionType) {
    const todoIds = Array.from(state.selectedTodoIds);
    const routineIds = Array.from(state.selectedRoutineIds);
    const total = todoIds.length + routineIds.length;
    if (total === 0) return;

    const nowIso = new Date().toISOString();

    if (actionType === 'category') {
        openBulkCategoryModal();
        return;
    }

    if (actionType === 'delete') {
        if (!confirm(`Delete ${total} selected item(s)? This cannot be undone.`)) return;
        const batch = window.db.batch();
        todoIds.forEach(id => batch.delete(window.getNiptoCollection('custom_tasks').doc(id)));
        routineIds.forEach(id => batch.delete(window.getNiptoCollection('routines').doc(id)));
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_del", `Deleted ${total} items.`, 0, "");
        await api.loadRoutinesFromFirestore();
        renderBulkTriageList();
        renderTodoTasks();
        renderRollingSchedule();
    } else if (actionType === 'complete') {
        const batch = window.db.batch();
        const todayKey = getLocalTodayKey();
        const doerUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
        const doerName = ALL_USERS.find(u => u.uid === doerUid)?.name || 'User';

        for (const id of todoIds) {
            const t = state.todoTasksData?.find(item => item.id === id);
            const isContainer = Array.isArray(t?.subTasks) && t.subTasks.length > 0;
            const pts = isContainer ? 0 : api.clampStep5Points(t?.points, 5);
            let activityUids = [];
            if (!isContainer && pts > 0) {
                try {
                    activityUids = await api.logCustomPointsToNipto(
                        pts,
                        t ? t.name : 'To-Do',
                        [doerUid],
                        nowIso,
                        t?.linkedNiptoTask || null
                    );
                } catch (niptoErr) {
                    console.warn("Could not log bulk To-Do points to Nipto API:", niptoErr);
                }
            }

            batch.update(window.getNiptoCollection('custom_tasks').doc(id), {
                completed: true,
                completedAt: nowIso,
                completedBy: [doerUid],
                completedActivityUids: activityUids,
                completedActivityUid: activityUids[0] || null,
                lastReviewedAt: nowIso,
                updatedAt: nowIso
            });
            if (t) {
                t.completed = true;
                t.completedAt = nowIso;
                t.completedBy = [doerUid];
                t.completedActivityUids = activityUids;
                t.completedActivityUid = activityUids[0] || null;
            }
            if (pts > 0 && activityUids.length === 0) {
                await api.awardAllowancePoints(doerUid, pts);
            }
            if (!isContainer && pts > 0) {
                await api.recordDailyCompletion({
                    id: `todo_${id}`,
                    itemId: id,
                    sourceType: 'todo',
                    title: t ? t.name : 'To-Do',
                    user: doerName,
                    userUid: doerUid,
                    points: pts,
                    completedAt: nowIso,
                    dateKey: todayKey,
                    ...(activityUids.length > 0 ? { activityUids, activityUid: activityUids[0] } : {})
                });
            }

            if (t) {
                const linkedRoutine = findMatchingRoutineForChore(t, 'todo');
                if (linkedRoutine) {
                    const rStatus = getRoutineCompletionForDate(linkedRoutine, todayKey);
                    if (!rStatus.isDone || rStatus.withoutPoints) {
                        await completeRoutineForDate(linkedRoutine.uid, todayKey, true, doerUid, {
                            completedByChore: true,
                            sourceChoreType: 'todo',
                            sourceChoreId: id,
                            activityUids,
                            points: pts,
                            creditedName: doerName,
                            completedAt: nowIso
                        });
                    }
                }
            }
        }
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_comp", `Marked ${todoIds.length} To-Dos completed.`, 0, "");
        rebuildCompletedToday();
        renderDoneTodayFeed();
        renderBulkTriageList();
        renderTodoTasks();
        updateLeaderboardUI();
    } else if (actionType === 'assign') {
        const userPrompt = prompt("Assign to which user? Enter name (Alyssa, Devyn, Carrina, Kenny, Ayden, DJ) or 'Anyone':", "Anyone");
        if (!userPrompt) return;
        const assignees = [];
        if (userPrompt.toLowerCase() !== 'anyone') {
            const matched = ALL_USERS.find(u => u.name.toLowerCase() === userPrompt.trim().toLowerCase());
            if (matched) assignees.push(matched.uid);
            else { alert("User not recognized."); return; }
        }
        const batch = window.db.batch();
        todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), { assignees, updatedAt: nowIso }));
        routineIds.forEach(id => batch.update(window.getNiptoCollection('routines').doc(id), { assignees, updatedAt: nowIso }));
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_assign", `Reassigned ${total} items to ${userPrompt}.`, 0, "");
        await api.loadRoutinesFromFirestore();
        renderBulkTriageList();
        renderTodoTasks();
        renderRollingSchedule();
    } else if (actionType === 'type') {
        const typePrompt = prompt("Set Type for selected tasks ('todo', 'project', or 'routine'):", "todo");
        if (!typePrompt) return;
        const cleanType = typePrompt.trim().toLowerCase();
        if (!['todo', 'project', 'routine'].includes(cleanType)) {
            alert("Invalid type. Must be 'todo', 'project', or 'routine'.");
            return;
        }
        const batch = window.db.batch();
        todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), {
            type: cleanType,
            bucket: (cleanType === 'project') ? 'project_idea' : 'actionable',
            updatedAt: nowIso,
            lastReviewedAt: nowIso
        }));
        await batch.commit();
        state.selectedTodoIds.clear();
        showToast("bulk_type", `Set type to ${cleanType} for ${todoIds.length} tasks.`, 0, "");
        renderBulkTriageList();
        renderTodoTasks();
    } else if (actionType === 'points') {
        const ptsPrompt = prompt("Enter point value for selected items (e.g. 5, 10, 15):", "5");
        if (!ptsPrompt) return;
        const pts = parseInt(ptsPrompt, 10);
        if (isNaN(pts) || pts < 0) { alert("Invalid points."); return; }
        const batch = window.db.batch();
        todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), { points: pts, updatedAt: nowIso }));
        routineIds.forEach(id => batch.update(window.getNiptoCollection('routines').doc(id), { points: pts, updatedAt: nowIso }));
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_pts", `Updated points to ${pts} for ${total} items.`, 0, "");
        await api.loadRoutinesFromFirestore();
        renderBulkTriageList();
        renderTodoTasks();
        renderRollingSchedule();
    } else if (actionType === 'priority') {
        const priPrompt = prompt("Set priority ('high', 'medium', 'low'):", "medium");
        if (!priPrompt) return;
        const cleanPri = priPrompt.trim().toLowerCase();
        if (!['high', 'medium', 'low'].includes(cleanPri)) {
            alert("Invalid priority. Must be 'high', 'medium', or 'low'.");
            return;
        }
        const batch = window.db.batch();
        todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), { priority: cleanPri, updatedAt: nowIso, lastReviewedAt: nowIso }));
        routineIds.forEach(id => batch.update(window.getNiptoCollection('routines').doc(id), { priority: cleanPri, updatedAt: nowIso, lastReviewedAt: nowIso }));
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_pri", `Updated priority for ${total} items.`, 0, "");
        renderBulkTriageList();
        renderTodoTasks();
    } else if (actionType === 'schedule') {
        const freqPrompt = prompt("Set Routine Frequency ('daily' or 'weekly'):", "daily");
        if (!freqPrompt) return;
        const cleanFreq = freqPrompt.trim().toLowerCase();
        if (!['daily', 'weekly'].includes(cleanFreq)) { alert("Must be 'daily' or 'weekly'."); return; }
        const batch = window.db.batch();
        routineIds.forEach(id => {
            const sched = cleanFreq === 'daily'
                ? { type: 'daily', resetType: 'midnight', timeOfDay: 'Morning' }
                : { type: 'weekly', resetType: 'midnight', daysOfWeek: [1, 3, 5], timeOfDay: 'Morning' };
            batch.update(window.getNiptoCollection('routines').doc(id), { schedule: sched, updatedAt: nowIso });
        });
        await batch.commit();
        state.selectedRoutineIds.clear();
        showToast("bulk_sched", `Updated schedule for ${routineIds.length} routines.`, 0, "");
        await api.loadRoutinesFromFirestore();
        renderBulkTriageList();
        renderRollingSchedule();
    }
}

if (typeof window !== 'undefined') {
    window.refreshBrainDumpUser = refreshBrainDumpUser;
    window.insertBrainDumpHint = insertBrainDumpHint;
    window.parseWithGemini = parseWithGemini;
    window.rawLineByLineAdd = rawLineByLineAdd;
    window.renderBrainDumpStaging = renderBrainDumpStaging;
    window.updateStagingItem = updateStagingItem;
    window.updateStagingRoutineSchedule = updateStagingRoutineSchedule;
    window.deleteStagingItem = deleteStagingItem;
    window.addSubtaskToStaging = addSubtaskToStaging;
    window.updateStagingSubtask = updateStagingSubtask;
    window.updateStagingSubtaskPoints = updateStagingSubtaskPoints;
    window.removeStagingSubtask = removeStagingSubtask;
    window._clampStep5Staging = (v) => api.clampStep5Points(v, 5);
    window.toggleAllStagingRows = toggleAllStagingRows;
    window.toggleSectionStagingRows = toggleSectionStagingRows;
    window.clearBrainDumpStaging = clearBrainDumpStaging;
    window.applyUnifiedStagingToFirestore = applyUnifiedStagingToFirestore;
    window.commitBrainDumpToFirestore = applyUnifiedStagingToFirestore;

    window.switchBrainDumpMode = switchBrainDumpMode;
    window.analyzeRambleWithGemini = parseWithGemini;
    window.renderRambleDiffStaging = renderBrainDumpStaging;
    window.updateRambleRow = updateRambleRow;
    window.updateRambleProp = updateRambleProp;
    window.toggleAllRambleRows = toggleAllStagingRows;
    window.clearRambleStaging = clearBrainDumpStaging;
    window.applyRambleUpdatesToFirestore = applyUnifiedStagingToFirestore;

    window.switchManageSubtab = switchManageSubtab;
    window.filterManageList = filterManageList;
    window.renderBulkTriageList = renderBulkTriageList;
    window.toggleBulkSectionCollapse = toggleBulkSectionCollapse;
    window.toggleBulkItem = toggleBulkItem;
    window.toggleBulkSelectAll = toggleBulkSelectAll;
    window.executeBulkAction = executeBulkAction;
    window.openBulkCategoryModal = openBulkCategoryModal;
    window.confirmBulkCategoryModal = confirmBulkCategoryModal;
    window.updateInlineTaskField = updateInlineTaskField;
    window.updateRoutineScheduleInline = updateRoutineScheduleInline;
    window.setBulkTypeFilter = setBulkTypeFilter;
    window.setBulkCategoryFilter = setBulkCategoryFilter;
    window.setBulkPriorityFilter = setBulkPriorityFilter;
    window.setBulkOwnershipFilter = setBulkOwnershipFilter;
    window.setBulkSortBy = setBulkSortBy;
    window.toggleBulkShowArchivedDone = toggleBulkShowArchivedDone;
}
