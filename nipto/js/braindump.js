// braindump.js
// Unified Gemini AI Studio Brain Dump & Task Omnibox,
// Unified Staging Review, and Full-Power Bulk Triage Management.

import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { renderTodoTasks, normalizeTask } from './todos.js';
import { renderRollingSchedule } from './routines.js';
import { rebuildCompletedToday, renderDoneTodayFeed } from './leaderboard.js';
import { getLocalTodayKey } from './utils.js';

// Helper to escape HTML characters
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
// 1. GEMINI AI PARSER & AUTO-DISCOVERY
// ==========================================
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

const BRAINDUMP_UNIFIED_INSTRUCTION = `You are an expert AI task manager for a household chore system.
You are given a JSON array of CURRENT_TASKS and an unstructured natural language BRAIN DUMP / RAMBLE from the user.
Analyze every mentioned item in the ramble against CURRENT_TASKS and output a JSON array of operations:
[
  {
    "action": "create" | "update" | "complete" | "delete",
    "id": "matched_task_id_if_updating_completing_or_deleting (null for create)",
    "type": "todo" | "routine" | "project",
    "title": "Task title",
    "description": "Any extra notes, context, or instructions mentioned (empty string if none)",
    "subtasks": ["Subtask step 1", "Subtask step 2"],
    "assignee": "Alyssa" | "Devyn" | "Carrina" | "Kenny" | "Ayden" | "DJ" | "Anyone",
    "category": "Home" | "Farm" | "Errands" | "Tech" | "Kids" | "Project",
    "points": 5,
    "priority": "high" | "medium" | "low",
    "frictionTag": "" | "quick" | "low_brain" | "deep_focus",
    "schedule": {"type": "daily"|"weekly", "daysOfWeek": [0,1,2,3,4,5,6], "timeOfDay": "Morning"|"Afternoon"|"Evening"|"Anytime", "points": 15},
    "reason": "Short summary of why this action was proposed (e.g. 'New To-Do with 3 steps', 'Increased points to 10', 'Marked completed')"
  }
]

Action Rules:
- "create": Brand new items not matching any existing task.
  - subtasks: If the task/project has multiple steps, components, or instructions, output an array of concise actionable step strings.
  - type: "routine" for recurring/scheduled chores (e.g. daily, weekly), "project" for big ideas/someday items, "todo" for actionable one-off tasks (default).
  - points: Default to 5 if not specified (or 15 for routines).
  - priority: Default to "medium".
  - frictionTag: "" (standard), "quick" (<5m), "low_brain", or "deep_focus".
- "update": The user wants to modify fields on an existing task (e.g. change points, add subtasks, move to projects, edit title, set priority). Match its exact id in CURRENT_TASKS.
  - If the user asks to break down or add steps to an existing task, include the "subtasks" array.
- "complete": The user mentioned crossing off, finishing, or completing an existing task. Match its exact id.
- "delete": The user explicitly asked to delete or remove an existing task. Match its exact id.
Output pure JSON array only.`;

export async function discoverActiveGeminiFlashModel(apiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const models = data.models || [];

    const flashModels = models.filter(m => {
        const id = (m.name || '').replace(/^models\//, '');
        const supportsGen = Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent');
        const isFlash = id.toLowerCase().includes('flash');
        const isExcluded = /(tts|image|embed)/i.test(id);
        return supportsGen && isFlash && !isExcluded;
    }).map(m => (m.name || '').replace(/^models\//, ''));

    if (flashModels.length === 0) {
        return DEFAULT_GEMINI_MODEL;
    }

    flashModels.sort((a, b) => {
        if (a === DEFAULT_GEMINI_MODEL) return -1;
        if (b === DEFAULT_GEMINI_MODEL) return 1;

        const parseVer = (str) => {
            const match = str.match(/gemini-(\d+(?:\.\d+)?)/i);
            return match ? parseFloat(match[1]) : 0;
        };
        const verA = parseVer(a);
        const verB = parseVer(b);
        if (verA !== verB) {
            return verB - verA;
        }
        const isStandardA = a.endsWith('-flash') ? 1 : 0;
        const isStandardB = b.endsWith('-flash') ? 1 : 0;
        return isStandardB - isStandardA;
    });

    return flashModels[0];
}

async function callGeminiGenerate(apiKey, model, text, customInstruction) {
    const cleanModel = (model || DEFAULT_GEMINI_MODEL).replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
    const body = {
        systemInstruction: {
            parts: [{ text: customInstruction || BRAINDUMP_UNIFIED_INSTRUCTION }]
        },
        contents: [
            {
                parts: [{ text: text }]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json"
        }
    };

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
        throw err;
    }

    return await res.json();
}

// ==========================================
// 2. UNIFIED BRAIN DUMP OMNIBOX PARSER
// ==========================================
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

    // Snapshot of current active tasks & routines for context injection
    const activeTodos = (state.todoTasksData || []).filter(t => !t.completed).map(t => {
        const norm = normalizeTask(t);
        return {
            id: norm.id,
            title: norm.name,
            type: norm.type,
            category: norm.category || 'Home',
            points: norm.points || 5,
            priority: norm.priority || 'medium',
            schedule: '',
            description: norm.description || ''
        };
    });

    const activeRoutines = (state.routines || []).map(r => ({
        id: r.uid,
        title: r.name,
        type: 'routine',
        category: r.category || 'Home',
        points: r.points || 15,
        priority: r.priority || 'medium',
        schedule: r.schedule?.type === 'weekly' ? 'weekly' : 'daily',
        description: ''
    }));

    const tasksContext = [...activeTodos, ...activeRoutines];

    let configuredModel = (state.integrationsConfig?.geminiModel || DEFAULT_GEMINI_MODEL).trim();
    if (configuredModel === 'gemini-2.5-flash') {
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

    const payloadText = `CURRENT_TASKS:
${JSON.stringify(tasksContext, null, 2)}

USER BRAIN DUMP / RAMBLE:
"${text}"`;

    try {
        let data;
        let activeModel = configuredModel;

        try {
            data = await callGeminiGenerate(apiKey, activeModel, payloadText, BRAINDUMP_UNIFIED_INSTRUCTION);
        } catch (firstErr) {
            const isDeprecationOr404 = firstErr.status === 404 ||
                firstErr.code === 404 ||
                /no longer available|not found|deprecated/i.test(firstErr.message || '');

            if (isDeprecationOr404) {
                console.warn(`Gemini model ${activeModel} failed. Discovering active Flash model...`);
                if (statusEl) {
                    statusEl.textContent = `Discovering active Flash model...`;
                    statusEl.style.color = "var(--warning, #f59e0b)";
                }

                const discovered = await discoverActiveGeminiFlashModel(apiKey);
                activeModel = discovered;
                data = await callGeminiGenerate(apiKey, activeModel, payloadText, BRAINDUMP_UNIFIED_INSTRUCTION);

                try {
                    await api.saveIntegrationsConfigToFirestore({ geminiModel: activeModel });
                } catch (saveErr) {}
            } else {
                throw firstErr;
            }
        }

        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) throw new Error("Gemini returned empty response.");

        let cleanedText = candidateText.trim();
        if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        }

        let parsedItems = JSON.parse(cleanedText);
        if (!Array.isArray(parsedItems)) {
            if (parsedItems.items && Array.isArray(parsedItems.items)) parsedItems = parsedItems.items;
            else if (parsedItems.tasks && Array.isArray(parsedItems.tasks)) parsedItems = parsedItems.tasks;
            else if (parsedItems.operations && Array.isArray(parsedItems.operations)) parsedItems = parsedItems.operations;
            else parsedItems = [parsedItems];
        }

        state.brainDumpStaging = parsedItems.map((item, idx) => {
            const current = item.id ? tasksContext.find(t => t.id === item.id) : null;
            const action = ['create', 'update', 'complete', 'delete'].includes(item.action)
                ? item.action
                : (current ? 'update' : 'create');

            const itemType = ['todo', 'project', 'routine'].includes(item.type)
                ? item.type
                : (current ? current.type : (item.targetType === 'routine' ? 'routine' : 'todo'));

            let subtasks = [];
            if (Array.isArray(item.subtasks)) {
                subtasks = item.subtasks.map(s => typeof s === 'string' ? s : (s.name || s.text || '')).filter(Boolean);
            } else if (current && Array.isArray(current.subTasks)) {
                subtasks = current.subTasks.map(s => s.name || s.text || '').filter(Boolean);
            }

            return {
                stagingId: 'stage_' + Date.now() + '_' + idx,
                selected: true,
                action,
                id: item.id || (current ? current.id : null),
                type: itemType,
                title: item.title || (current ? current.title : 'Untitled Task'),
                description: item.description !== undefined ? item.description : (current ? current.description : ''),
                subtasks,
                assignee: item.assignee || 'Anyone',
                category: item.category || (current ? current.category : 'Home'),
                points: item.points !== undefined ? (parseInt(item.points, 10) || 5) : (current ? current.points : 5),
                priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : (current ? current.priority : 'medium'),
                frictionTag: item.frictionTag || '',
                schedule: item.schedule || (current ? current.schedule : (itemType === 'routine' ? { type: 'daily', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeOfDay: 'Morning', points: 15 } : null)),
                reason: item.reason || (action === 'create' ? 'New item' : (action === 'complete' ? 'Marked complete' : 'Updated')),
                current: current || null
            };
        });

        renderBrainDumpStaging();
        if (statusEl) {
            const newCount = state.brainDumpStaging.filter(i => i.action === 'create').length;
            const updateCount = state.brainDumpStaging.length - newCount;
            statusEl.textContent = `Analyzed ${state.brainDumpStaging.length} operations (${newCount} new, ${updateCount} updates). Review and apply below.`;
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
        .map(l => l.trim().replace(/^[-*•]\s*/, ''))
        .filter(l => l.length > 0);

    if (lines.length === 0) return;

    state.brainDumpStaging = lines.map((line, idx) => ({
        stagingId: 'stage_' + Date.now() + '_' + idx,
        selected: true,
        action: 'create',
        id: null,
        type: 'todo',
        title: line,
        description: '',
        assignee: 'Anyone',
        category: 'Home',
        points: 5,
        priority: 'medium',
        schedule: null,
        reason: 'Raw line item',
        current: null
    }));

    renderBrainDumpStaging();
    if (statusEl) {
        statusEl.textContent = `Loaded ${state.brainDumpStaging.length} raw items. Adjust and commit below.`;
        statusEl.style.color = "var(--success)";
    }
}

// ==========================================
// 3. FULL-DETAIL STAGING REVIEW UI (LIKE BULK TRIAGE)
// ==========================================
export function addSubtaskToStaging(stagingIdx, text = '') {
    if (!state.brainDumpStaging[stagingIdx]) return;
    if (!Array.isArray(state.brainDumpStaging[stagingIdx].subtasks)) {
        state.brainDumpStaging[stagingIdx].subtasks = [];
    }
    state.brainDumpStaging[stagingIdx].subtasks.push(text);
    renderBrainDumpStaging();
}

export function updateStagingSubtask(stagingIdx, subtaskIdx, text) {
    if (!state.brainDumpStaging[stagingIdx]) return;
    if (state.brainDumpStaging[stagingIdx].subtasks && state.brainDumpStaging[stagingIdx].subtasks[subtaskIdx] !== undefined) {
        state.brainDumpStaging[stagingIdx].subtasks[subtaskIdx] = text;
    }
}

export function removeStagingSubtask(stagingIdx, subtaskIdx) {
    if (!state.brainDumpStaging[stagingIdx]) return;
    if (state.brainDumpStaging[stagingIdx].subtasks) {
        state.brainDumpStaging[stagingIdx].subtasks.splice(subtaskIdx, 1);
        renderBrainDumpStaging();
    }
}

export function renderBrainDumpStaging() {
    const container = document.getElementById('brainDumpStaging');
    if (!container) return;

    if (!state.brainDumpStaging || state.brainDumpStaging.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No staged items. Dictate or paste a ramble in the Omnibox above to add, update, or complete tasks.</div>';
        return;
    }

    const newItems = state.brainDumpStaging.filter(item => item.action === 'create');
    const existingItems = state.brainDumpStaging.filter(item => item.action !== 'create');

    const userOptionsHtml = `<option value="Anyone">Anyone</option>` +
        ALL_USERS.map(u => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`).join('');

    let html = `
    <!-- Top Action Bar -->
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

    // Helper: render single staged item card with all details exposed
    function renderStagingCard(item, idx) {
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

        const targetVal = 'value="' + escapeHtml(item.assignee) + '"';
        const assigneeOptionsHtml = userOptionsHtml.replace(targetVal, targetVal + ' selected');

        let scheduleHtml = '';
        if (item.type === 'routine') {
            const isWeekly = item.schedule && item.schedule.type === 'weekly';
            scheduleHtml = '<label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">' +
                'Schedule:' +
                '<select onchange="const s = item.schedule || {}; s.type = this.value; updateStagingItem(' + idx + ', \'schedule\', s);" style="padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">' +
                '<option value="daily"' + (!isWeekly ? ' selected' : '') + '>Daily</option>' +
                '<option value="weekly"' + (isWeekly ? ' selected' : '') + '>Weekly</option>' +
                '</select>' +
                '</label>';
        }

        let subtasksHtml = '';
        if (item.subtasks && item.subtasks.length > 0) {
            const subtaskRows = item.subtasks.map((step, sIdx) => {
                return '<div style="display: flex; gap: 6px; align-items: center;">' +
                    '<span style="font-size: 11px; color: var(--text-muted);">&#x2022;</span>' +
                    '<input type="text" value="' + escapeHtml(step) + '" onchange="updateStagingSubtask(' + idx + ', ' + sIdx + ', this.value)" placeholder="Step description..." style="flex: 1; padding: 3px 6px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-color); color: var(--text-main);">' +
                    '<button type="button" onclick="removeStagingSubtask(' + idx + ', ' + sIdx + ')" style="background: none; border: none; cursor: pointer; color: var(--danger); font-size: 14px;" title="Remove step">&times;</button>' +
                    '</div>';
            }).join('');

            subtasksHtml = '<div style="display: flex; flex-direction: column; gap: 4px; padding-left: 6px;">' + subtaskRows + '</div>';
        }

        const isUnselected = !item.selected;
        const opacityVal = item.selected ? '1' : '0.6';
        const checkedAttr = item.selected ? 'checked' : '';

        return `
        <div class="staging-card ${isUnselected ? 'is-unselected' : ''}" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 12px; opacity: ${opacityVal}; display: flex; flex-direction: column; gap: 8px;">
            <!-- Line 1: Checkbox, Badge, Title, Reason, Delete -->
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <input type="checkbox" ${checkedAttr} onchange="updateStagingItem(${idx}, 'selected', this.checked)">
                ${actionBadge}
                <input type="text" value="${escapeHtml(item.title)}" onchange="updateStagingItem(${idx}, 'title', this.value)" style="flex: 1; min-width: 180px; padding: 4px 8px; font-size: 13px; font-weight: 700; border-radius: 4px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-color); color: var(--text-main);" placeholder="Task title...">
                ${reasonHtml}
                <button type="button" onclick="deleteStagingItem(${idx})" style="background: none; border: none; cursor: pointer; color: var(--danger); font-size: 16px; margin-left: auto;" title="Remove row">&times;</button>
            </div>

            ${curHtml}

            <!-- Line 2: Full Editable Metadata Grid (Type, Category, Points, Priority, Friction, Assignee, Schedule) -->
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 11px;">
                <label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">
                    Type:
                    <select onchange="updateStagingItem(${idx}, 'type', this.value); renderBrainDumpStaging();" style="padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <option value="todo" ${item.type === 'todo' ? 'selected' : ''}>To-Do</option>
                        <option value="project" ${item.type === 'project' ? 'selected' : ''}>Project / Idea</option>
                        <option value="routine" ${item.type === 'routine' ? 'selected' : ''}>Routine</option>
                    </select>
                </label>

                <label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">
                    Cat:
                    <input type="text" value="${escapeHtml(item.category || 'Home')}" onchange="updateStagingItem(${idx}, 'category', this.value)" style="width: 75px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                </label>

                <label style="display: flex; align-items: center; gap: 4px; color: var(--text-muted);">
                    Points:
                    <input type="number" value="${item.points || 5}" min="0" onchange="updateStagingItem(${idx}, 'points', parseInt(this.value, 10) || 5)" style="width: 48px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); text-align: center;">
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

            <!-- Line 3: Description (Always visible & editable) -->
            <div>
                <label style="font-size: 11px; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 2px;">Description / Notes:</label>
                <textarea rows="2" placeholder="Optional details, instructions, or steps..." onchange="updateStagingItem(${idx}, 'description', this.value)" style="width: 100%; padding: 6px 8px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); box-sizing: border-box; font-family: inherit; background: var(--bg-color); color: var(--text-main);">${escapeHtml(item.description || '')}</textarea>
            </div>

            <!-- Line 4: Subtasks List (Always visible with add/remove/edit) -->
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

    // SECTION 1: NEW ITEMS TO ADD
    if (newItems.length > 0) {
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
            ${state.brainDumpStaging.map((item, idx) => item.action === 'create' ? renderStagingCard(item, idx) : '').join('')}
        </div>
        `;
    }

    // SECTION 2: UPDATES & COMPLETIONS FOR EXISTING ITEMS
    if (existingItems.length > 0) {
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
            ${state.brainDumpStaging.map((item, idx) => item.action !== 'create' ? renderStagingCard(item, idx) : '').join('')}
        </div>
        `;
    }

    container.innerHTML = html;
}

export function updateStagingItem(index, field, value) {
    if (state.brainDumpStaging[index]) {
        state.brainDumpStaging[index][field] = value;
        if (field === 'selected') renderBrainDumpStaging();
    }
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
        if (section === 'create' && item.action === 'create') item.selected = checked;
        else if (section === 'existing' && item.action !== 'create') item.selected = checked;
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
export async function applyUnifiedStagingToFirestore() {
    const selected = state.brainDumpStaging.filter(item => item.selected);
    if (selected.length === 0) {
        alert("Please select at least one staged item to apply.");
        return;
    }

    const batch = window.db.batch();
    const nowIso = new Date().toISOString();
    const todayKey = getLocalTodayKey();
    const doerUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');
    const doerName = ALL_USERS.find(u => u.uid === doerUid)?.name || 'User';

    let createdCount = 0;
    let updatedCount = 0;
    let completedCount = 0;
    let deletedCount = 0;

    for (const item of selected) {
        const id = item.id;
        const isRoutineDoc = id && state.routines?.some(r => r.uid === id);

        if (item.action === 'create') {
            let assigneeUids = [];
            if (item.assignee && item.assignee !== 'Anyone') {
                const userObj = ALL_USERS.find(u => u.name.toLowerCase() === item.assignee.toLowerCase());
                if (userObj) assigneeUids.push(userObj.uid);
            }

            const pts = parseInt(item.points, 10) || 5;

            if (item.type === 'routine') {
                const routineRef = window.getNiptoCollection('routines').doc();
                const days = item.schedule?.daysOfWeek || [0, 1, 2, 3, 4, 5, 6];
                const scheduleData = {
                    type: days.length === 7 ? 'daily' : 'weekly',
                    resetType: 'midnight',
                    daysOfWeek: days,
                    timeOfDay: item.schedule?.timeOfDay || 'Anytime'
                };
                batch.set(routineRef, {
                    name: item.title,
                    type: 'routine',
                    completionType: 'shared',
                    assignees: assigneeUids.length ? assigneeUids : ALL_USERS.map(u => u.uid),
                    schedule: scheduleData,
                    timeOfDay: item.schedule?.timeOfDay || 'Anytime',
                    linkedNiptoTask: null,
                    points: pts,
                    overdueAfterHours: 14,
                    frictionTag: item.frictionTag || '',
                    category: item.category || 'Home',
                    createdBy: doerName,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                    lastReviewedAt: nowIso,
                    lastCompleted: {},
                    lastCompletedBy: {},
                    completionsByDate: {}
                });
            } else {
                const todoRef = window.getNiptoCollection('custom_tasks').doc();
                const subTasks = (item.subtasks || []).map((s, i) => ({
                    id: 'st_' + Date.now() + '_' + i,
                    name: typeof s === 'string' ? s : (s.name || s.text || ''),
                    completed: false,
                    createdBy: doerName,
                    createdAt: nowIso
                }));

                batch.set(todoRef, {
                    name: item.title,
                    type: item.type || 'todo',
                    bucket: item.type === 'project' ? 'project_idea' : 'actionable',
                    category: item.category || 'Home',
                    location: 'N/A',
                    assignees: assigneeUids,
                    frictionTag: item.frictionTag || '',
                    priority: item.priority || 'medium',
                    points: pts,
                    description: item.description || '',
                    notes: item.description || '',
                    createdBy: doerName,
                    subTasks: subTasks,
                    completed: false,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                    lastReviewedAt: nowIso
                });
            }
            createdCount++;
        } else if (item.action === 'delete') {
            if (isRoutineDoc) {
                batch.delete(window.getNiptoCollection('routines').doc(id));
            } else if (id) {
                batch.delete(window.getNiptoCollection('custom_tasks').doc(id));
            }
            deletedCount++;
        } else if (item.action === 'complete') {
            if (!isRoutineDoc && id) {
                batch.update(window.getNiptoCollection('custom_tasks').doc(id), {
                    completed: true,
                    completedAt: nowIso,
                    completedBy: [doerUid],
                    lastReviewedAt: nowIso,
                    updatedAt: nowIso
                });
                const pts = item.points || 5;
                if (pts > 0) api.awardAllowancePoints(doerUid, pts);
                await api.recordDailyCompletion({
                    id: `todo_${id}`,
                    itemId: id,
                    sourceType: 'todo',
                    title: item.title,
                    user: doerName,
                    userUid: doerUid,
                    points: pts,
                    completedAt: nowIso,
                    dateKey: todayKey
                });
            }
            completedCount++;
        } else {
            // action === 'update'
            if (isRoutineDoc) {
                batch.update(window.getNiptoCollection('routines').doc(id), {
                    name: item.title,
                    category: item.category,
                    points: item.points || 15,
                    priority: item.priority || 'medium',
                    frictionTag: item.frictionTag || '',
                    timeOfDay: item.schedule?.timeOfDay || 'Anytime',
                    updatedAt: nowIso,
                    lastReviewedAt: nowIso
                });
            } else if (id) {
                // If converted to routine, migrate doc
                if (item.type === 'routine') {
                    const newRoutineRef = window.getNiptoCollection('routines').doc();
                    batch.set(newRoutineRef, {
                        name: item.title,
                        type: 'routine',
                        completionType: 'shared',
                        assignees: ALL_USERS.map(u => u.uid),
                        schedule: { type: 'daily', resetType: 'midnight', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeOfDay: 'Morning' },
                        points: item.points || 15,
                        category: item.category || 'Home',
                        priority: item.priority || 'medium',
                        frictionTag: item.frictionTag || '',
                        createdAt: nowIso,
                        updatedAt: nowIso,
                        lastReviewedAt: nowIso
                    });
                    batch.delete(window.getNiptoCollection('custom_tasks').doc(id));
                } else {
                    const updates = {
                        name: item.title,
                        type: item.type,
                        bucket: item.type === 'project' ? 'project_idea' : 'actionable',
                        category: item.category,
                        points: item.points || 5,
                        priority: item.priority,
                        frictionTag: item.frictionTag || '',
                        description: item.description !== undefined ? item.description : '',
                        notes: item.description !== undefined ? item.description : '',
                        updatedAt: nowIso,
                        lastReviewedAt: nowIso
                    };
                    if (Array.isArray(item.subtasks) && item.subtasks.length > 0) {
                        updates.subTasks = item.subtasks.map((s, i) => ({
                            id: 'st_' + Date.now() + '_' + i,
                            name: typeof s === 'string' ? s : (s.name || s.text || ''),
                            completed: false,
                            createdBy: doerName,
                            createdAt: nowIso
                        }));
                    }
                    batch.update(window.getNiptoCollection('custom_tasks').doc(id), updates);
                }
            }
            updatedCount++;
        }
    }

    try {
        await batch.commit();
        showToast("unified_ok", `Applied ${selected.length} changes (${createdCount} added, ${updatedCount} updated, ${completedCount} completed)!`, 0, "");
        clearBrainDumpStaging();
        const inputEl = document.getElementById('brainDumpInput');
        if (inputEl) inputEl.value = "";

        await Promise.all([
            api.loadRoutinesFromFirestore()
        ]);
        rebuildCompletedToday();
        renderDoneTodayFeed();
        renderTodoTasks();
        renderRollingSchedule();
        renderBulkTriageList();
    } catch (err) {
        console.error("Batch update error:", err);
        alert("Failed to apply changes: " + err.message);
    }
}

// Backward-compatible aliases
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

// Fast inline field updater for individual row edits in Bulk Triage
export async function updateInlineTaskField(sourceType, id, field, value) {
    const nowIso = new Date().toISOString();
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

export function renderBulkTriageList() {
    const container = document.getElementById('bulkTriageContainer');
    if (!container) return;

    const query = state.manageSearchQuery || '';
    if (!state.bulkTypeFilter) state.bulkTypeFilter = 'all';
    const typeFilter = state.bulkTypeFilter;
    const categoryFilter = state.bulkCategoryFilter || 'all';
    const priorityFilter = state.bulkPriorityFilter || 'all';
    const ownershipFilter = state.bulkOwnershipFilter || 'all';
    const sortBy = state.bulkSortBy || 'default';
    const collapsedSections = state.userPrefs.bulkCollapsedSections || {};

    const activeUid = state.activeUsers[0] || (ALL_USERS[0]?.uid || '');

    const allTodos = (state.todoTasksData || []).map(normalizeTask);
    const allRoutines = state.routines || [];

    const totalSelected = state.selectedTodoIds.size + state.selectedRoutineIds.size;
    updateBulkActionBarVisibility(totalSelected);

    function getPriorityWeight(p) {
        if (!p) return 2;
        const lp = p.toLowerCase();
        if (lp === 'high') return 3;
        if (lp === 'medium') return 2;
        if (lp === 'low') return 1;
        return 2;
    }

    // Helper: matches category
    function matchesCat(cat) {
        if (categoryFilter === 'all') return true;
        return (cat || 'Home').toLowerCase() === categoryFilter.toLowerCase();
    }

    // Helper: matches priority
    function matchesPri(pri) {
        if (priorityFilter === 'all') return true;
        return (pri || 'medium').toLowerCase() === priorityFilter.toLowerCase();
    }

    // Helper: matches ownership
    function matchesOwn(assignees = []) {
        if (ownershipFilter === 'all') return true;
        if (ownershipFilter === 'me') return assignees.includes(activeUid);
        if (ownershipFilter === 'individual') return assignees.length === 1;
        if (ownershipFilter === 'shared') return assignees.length === 0 || assignees.length > 1;
        if (ownershipFilter === 'unassigned') return assignees.length === 0;
        return true;
    }

    // Filter Tasks (To-Dos and Projects)
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

    // Filter Routines
    let filteredRoutines = allRoutines.filter(r => matchesCat(r.category) && matchesPri(r.priority) && matchesOwn(r.assignees));
    if (query) {
        filteredRoutines = filteredRoutines.filter(r => {
            const nameMatch = (r.name || '').toLowerCase().includes(query);
            const catMatch = (r.category || '').toLowerCase().includes(query);
            return nameMatch || catMatch;
        });
    }

    // Sort Tasks: Incomplete first, completed auto-sorted to bottom!
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
                return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
            }
        });
    }

    // Sort Routines: Incomplete today first!
    function sortRoutines(list) {
        const todayKey = getLocalTodayKey();
        return list.slice().sort((a, b) => {
            const aDone = !!(a.completionsByDate && a.completionsByDate[todayKey]);
            const bDone = !!(b.completionsByDate && b.completionsByDate[todayKey]);
            if (aDone !== bDone) return aDone ? 1 : -1;

            if (sortBy === 'priority') {
                const pA = getPriorityWeight(a.priority);
                const pB = getPriorityWeight(b.priority);
                if (pA !== pB) return pB - pA;
                return (b.points || 15) - (a.points || 15);
            } else if (sortBy === 'points') {
                return (b.points || 15) - (a.points || 15);
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

    // Render single task row for Bulk Triage
    function renderBulkTaskRow(t) {
        const isChecked = state.selectedTodoIds.has(t.id);
        const isCompleted = !!t.completed;

        return `
        <div style="display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 6px; border-bottom: 1px solid var(--border-color); background: ${isChecked ? 'rgba(37, 99, 235, 0.05)' : (isCompleted ? 'var(--bg-color)' : 'transparent')}; opacity: ${isCompleted ? 0.6 : 1};">
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleBulkItem('todo', '${t.id}', this.checked)" title="Select for bulk action">
                
                <button type="button" class="item-checkbox ${isCompleted ? 'checked' : ''}" onclick="toggleTaskStatus('${t.id}', ${isCompleted})" title="${isCompleted ? 'Completed - click to undo' : 'Mark task complete'}" style="margin: 0; width: 18px; height: 18px; font-size: 11px;">
                    ${isCompleted ? '&#x2714;' : ''}
                </button>

                <input type="text" value="${escapeHtml(t.name)}" onchange="updateInlineTaskField('todo', '${t.id}', 'name', this.value)" style="flex: 1; min-width: 140px; padding: 4px 8px; font-size: 13px; font-weight: 700; border-radius: 4px; border: 1px solid var(--border-color); text-decoration: ${isCompleted ? 'line-through' : 'none'}; box-sizing: border-box; background: var(--bg-color); color: var(--text-main);">

                <div style="display: flex; gap: 6px; align-items: center;">
                    <button type="button" class="action-btn" onclick="editTask('${t.id}')" title="Full Edit Modal" style="padding: 4px 8px; font-size: 11px;">&#x270E;</button>
                    <button type="button" class="action-btn" onclick="deleteTask('${t.id}')" title="Delete Task" style="padding: 4px 8px; font-size: 11px; color: var(--danger);">&#x1F5D1;</button>
                </div>
            </div>

            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-left: 56px; font-size: 12px;">
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
                    <input type="number" value="${t.points || 5}" min="0" onchange="updateInlineTaskField('todo', '${t.id}', 'points', parseInt(this.value, 10) || 5)" style="width: 45px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); text-align: center;">
                </label>

                <label style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    Cat:
                    <input type="text" value="${escapeHtml(t.category || 'Home')}" onchange="updateInlineTaskField('todo', '${t.id}', 'category', this.value)" style="width: 75px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                </label>

                <button type="button" class="action-btn" onclick="const d = document.getElementById('bulk-desc-${t.id}'); d.style.display = (d.style.display === 'none' ? 'block' : 'none');" style="padding: 2px 6px; font-size: 10px;">
                    ${t.description ? '&#x1F4DD; Note' : '+ Note'}
                </button>
            </div>

            <div id="bulk-desc-${t.id}" style="display: none; margin-left: 56px; margin-top: 4px;">
                <input type="text" value="${escapeHtml(t.description || '')}" placeholder="Optional details/description..." onchange="updateInlineTaskField('todo', '${t.id}', 'description', this.value)" style="width: 100%; padding: 4px 8px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); box-sizing: border-box; background: var(--bg-color); color: var(--text-main);">
            </div>
        </div>
        `;
    }

    // Render single routine row for Bulk Triage
    function renderBulkRoutineRow(r) {
        const isChecked = state.selectedRoutineIds.has(r.uid);
        const sched = r.schedule || {};
        const freq = sched.type || 'daily';
        const pts = r.points || 15;
        const todayKey = getLocalTodayKey();
        const isDoneToday = !!(r.completionsByDate && r.completionsByDate[todayKey]);

        const toggleRoutineCall = isDoneToday 
            ? 'undoRoutineForDate(\'' + r.uid + '\', \'' + todayKey + '\')'
            : 'completeRoutineForDate(\'' + r.uid + '\', \'' + todayKey + '\', true)';

        return `
        <div style="display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 6px; border-bottom: 1px solid var(--border-color); background: ${isChecked ? 'rgba(37, 99, 235, 0.05)' : (isDoneToday ? 'var(--bg-color)' : 'transparent')}; opacity: ${isDoneToday ? 0.7 : 1};">
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleBulkItem('routine', '${r.uid}', this.checked)" title="Select for bulk action">
                
                <button type="button" class="item-checkbox ${isDoneToday ? 'checked' : ''}" onclick="${toggleRoutineCall}" title="${isDoneToday ? 'Completed today - click to undo' : 'Mark done today'}" style="margin: 0; width: 18px; height: 18px; font-size: 11px;">
                    ${isDoneToday ? '&#x2714;' : ''}
                </button>

                <input type="text" value="${escapeHtml(r.name)}" onchange="updateInlineTaskField('routine', '${r.uid}', 'name', this.value)" style="flex: 1; min-width: 140px; padding: 4px 8px; font-size: 13px; font-weight: 700; border-radius: 4px; border: 1px solid var(--border-color); text-decoration: ${isDoneToday ? 'line-through' : 'none'}; box-sizing: border-box; background: var(--bg-color); color: var(--text-main);">

                <div style="display: flex; gap: 6px; align-items: center;">
                    <button type="button" class="action-btn" onclick="editRoutine('${r.uid}')" title="Edit Routine" style="padding: 4px 8px; font-size: 11px;">&#x270E;</button>
                    <button type="button" class="action-btn" onclick="deleteRoutine('${r.uid}')" title="Delete Routine" style="padding: 4px 8px; font-size: 11px; color: var(--danger);">&#x1F5D1;</button>
                </div>
            </div>

            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-left: 56px; font-size: 12px;">
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
                    <input type="number" value="${pts}" min="0" onchange="updateInlineTaskField('routine', '${r.uid}', 'points', parseInt(this.value, 10) || 15)" style="width: 48px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color); text-align: center;">
                </label>

                <label style="display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted);">
                    Cat:
                    <input type="text" value="${escapeHtml(r.category || 'Home')}" onchange="updateInlineTaskField('routine', '${r.uid}', 'category', this.value)" style="width: 75px; padding: 2px 4px; font-size: 11px; border-radius: 4px; border: 1px solid var(--border-color);">
                </label>

                <span style="font-size: 10px; color: var(--text-muted);">
                    ${escapeHtml(r.timeOfDay || 'Anytime')}
                </span>
            </div>
        </div>
        `;
    }

    let html = `
    <!-- Bulk Triage Filtering & Sorting Toolbar -->
    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px 14px; background: var(--bg-color); border: 1px solid var(--border-color); border-bottom: none; border-radius: 8px 8px 0 0;">
        <!-- Type Filter Buttons -->
        <div style="display: flex; gap: 6px;">
            <button class="filter-pill ${typeFilter === 'all' ? 'active' : ''}" onclick="setBulkTypeFilter('all')">All</button>
            <button class="filter-pill ${typeFilter === 'todo' ? 'active' : ''}" onclick="setBulkTypeFilter('todo')">&#x26A1; To-Dos</button>
            <button class="filter-pill ${typeFilter === 'project' ? 'active' : ''}" onclick="setBulkTypeFilter('project')">&#x1F4A1; Projects</button>
            <button class="filter-pill ${typeFilter === 'routine' ? 'active' : ''}" onclick="setBulkTypeFilter('routine')">&#x21BB; Routines</button>
        </div>

        <!-- Category Filter -->
        <select class="todo-compact-select" onchange="setBulkCategoryFilter(this.value)" title="Filter by Category">
            <option value="all" ${categoryFilter === 'all' ? 'selected' : ''}>Category: All</option>
            ${Array.from(new Set([...allTodos.map(t => t.category || 'Home'), ...allRoutines.map(r => r.category || 'Home')])).sort().map(cat => `
                <option value="${escapeHtml(cat)}" ${categoryFilter.toLowerCase() === cat.toLowerCase() ? 'selected' : ''}>${escapeHtml(cat)}</option>
            `).join('')}
        </select>

        <!-- Priority Filter -->
        <select class="todo-compact-select" onchange="setBulkPriorityFilter(this.value)" title="Filter by Priority">
            <option value="all" ${priorityFilter === 'all' ? 'selected' : ''}>Priority: All</option>
            <option value="high" ${priorityFilter === 'high' ? 'selected' : ''}>High</option>
            <option value="medium" ${priorityFilter === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="low" ${priorityFilter === 'low' ? 'selected' : ''}>Low</option>
        </select>

        <!-- Ownership Filter -->
        <select class="todo-compact-select" onchange="setBulkOwnershipFilter(this.value)" title="Filter by Ownership">
            <option value="all" ${ownershipFilter === 'all' ? 'selected' : ''}>Ownership: All</option>
            <option value="me" ${ownershipFilter === 'me' ? 'selected' : ''}>Me</option>
            <option value="individual" ${ownershipFilter === 'individual' ? 'selected' : ''}>Individual (Single)</option>
            <option value="shared" ${ownershipFilter === 'shared' ? 'selected' : ''}>Shared / Anyone</option>
            <option value="unassigned" ${ownershipFilter === 'unassigned' ? 'selected' : ''}>Unassigned</option>
        </select>

        <!-- Sort By Dropdown -->
        <select class="todo-compact-select" onchange="setBulkSortBy(this.value)" title="Sort list" style="margin-left: auto;">
            <option value="default" ${sortBy === 'default' ? 'selected' : ''}>Sort: Active First</option>
            <option value="priority" ${sortBy === 'priority' ? 'selected' : ''}>Sort: Priority (High&rarr;Low)</option>
            <option value="points" ${sortBy === 'points' ? 'selected' : ''}>Sort: Points</option>
            <option value="category" ${sortBy === 'category' ? 'selected' : ''}>Sort: Category</option>
            <option value="title" ${sortBy === 'title' ? 'selected' : ''}>Sort: Title</option>
        </select>
    </div>

    <div style="background: var(--card-bg); border-radius: 0 0 8px 8px; border: 1px solid var(--border-color); overflow: hidden; padding: 8px;">
    `;

    // 3-SECTION STACKED VIEW
    if (typeFilter === 'all') {
        const isTodosCollapsed = !!collapsedSections['todos'];
        const isProjectsCollapsed = !!collapsedSections['projects'];
        const isRoutinesCollapsed = !!collapsedSections['routines'];

        html += `
        <div style="display: flex; flex-direction: column; gap: 16px;">
            <!-- 1. TO-DOS (TOP SECTION) -->
            <div style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-color); cursor: pointer;" onclick="toggleBulkSectionCollapse('todos')">
                    <div style="font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                        <span>&#x26A1; To-Dos</span>
                        <span style="font-size: 11px; background: var(--card-bg); padding: 2px 6px; border-radius: 10px; border: 1px solid var(--border-color);">${todosList.length}</span>
                    </div>
                    <span style="font-size: 12px; color: var(--text-muted);">${isTodosCollapsed ? '&#x25B6;' : '&#x25BC;'}</span>
                </div>
                <div style="display: ${isTodosCollapsed ? 'none' : 'block'}; max-height: 480px; overflow-y: auto; padding: 8px;">
                    ${todosList.length > 0 ? todosList.map(renderBulkTaskRow).join('') : '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No to-dos match filters.</div>'}
                </div>
            </div>

            <!-- 2. PROJECTS / IDEAS (MIDDLE SECTION) -->
            <div style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-color); cursor: pointer;" onclick="toggleBulkSectionCollapse('projects')">
                    <div style="font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                        <span>&#x1F4A1; Projects / Ideas</span>
                        <span style="font-size: 11px; background: var(--card-bg); padding: 2px 6px; border-radius: 10px; border: 1px solid var(--border-color);">${projectsList.length}</span>
                    </div>
                    <span style="font-size: 12px; color: var(--text-muted);">${isProjectsCollapsed ? '&#x25B6;' : '&#x25BC;'}</span>
                </div>
                <div style="display: ${isProjectsCollapsed ? 'none' : 'block'}; max-height: 480px; overflow-y: auto; padding: 8px;">
                    ${projectsList.length > 0 ? projectsList.map(renderBulkTaskRow).join('') : '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No projects match filters.</div>'}
                </div>
            </div>

            <!-- 3. ROUTINES (BOTTOM SECTION) -->
            <div style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-color); cursor: pointer;" onclick="toggleBulkSectionCollapse('routines')">
                    <div style="font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                        <span>&#x21BB; Routines</span>
                        <span style="font-size: 11px; background: var(--card-bg); padding: 2px 6px; border-radius: 10px; border: 1px solid var(--border-color);">${routinesList.length}</span>
                    </div>
                    <span style="font-size: 12px; color: var(--text-muted);">${isRoutinesCollapsed ? '&#x25B6;' : '&#x25BC;'}</span>
                </div>
                <div style="display: ${isRoutinesCollapsed ? 'none' : 'block'}; max-height: 480px; overflow-y: auto; padding: 8px;">
                    ${routinesList.length > 0 ? routinesList.map(renderBulkRoutineRow).join('') : '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No routines match filters.</div>'}
                </div>
            </div>
        </div>
        `;
    } else if (typeFilter === 'todo') {
        html += `
        <div style="max-height: 540px; overflow-y: auto; padding: 8px;">
            ${todosList.length > 0 ? todosList.map(renderBulkTaskRow).join('') : '<div style="text-align: center; color: var(--text-muted); padding: 25px;">No to-dos match the selected filters.</div>'}
        </div>
        `;
    } else if (typeFilter === 'project') {
        html += `
        <div style="max-height: 540px; overflow-y: auto; padding: 8px;">
            ${projectsList.length > 0 ? projectsList.map(renderBulkTaskRow).join('') : '<div style="text-align: center; color: var(--text-muted); padding: 25px;">No projects match the selected filters.</div>'}
        </div>
        `;
    } else if (typeFilter === 'routine') {
        html += `
        <div style="max-height: 540px; overflow-y: auto; padding: 8px;">
            ${routinesList.length > 0 ? routinesList.map(renderBulkRoutineRow).join('') : '<div style="text-align: center; color: var(--text-muted); padding: 25px;">No routines match the selected filters.</div>'}
        </div>
        `;
    }

    html += `</div>`;
    container.innerHTML = html;
}

export async function updateRoutineScheduleInline(routineId, freqType) {
    const routine = state.routines?.find(r => r.uid === routineId);
    if (!routine) return;

    const sched = routine.schedule || {};
    sched.type = freqType;
    if (freqType === 'daily') {
        sched.daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
    }

    try {
        await api.updateFirestoreDocument('routines', routineId, { schedule: sched });
        routine.schedule = sched;
        showToast("routine_sched", `Updated schedule to ${freqType}!`, 0, "");
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
    const subtab = state.manageSubtab || 'todos';

    if (subtab === 'todos') {
        const allTodos = state.todoTasksData || [];
        if (checked) {
            allTodos.forEach(t => state.selectedTodoIds.add(t.id));
        } else {
            state.selectedTodoIds.clear();
        }
    } else {
        const allRoutines = state.routines || [];
        if (checked) {
            allRoutines.forEach(r => state.selectedRoutineIds.add(r.uid));
        } else {
            state.selectedRoutineIds.clear();
        }
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

// Bulk Actions Dispatcher
export async function executeBulkAction(actionType) {
    const todoIds = Array.from(state.selectedTodoIds);
    const routineIds = Array.from(state.selectedRoutineIds);
    const total = todoIds.length + routineIds.length;
    if (total === 0) return;

    const nowIso = new Date().toISOString();

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
            batch.update(window.getNiptoCollection('custom_tasks').doc(id), {
                completed: true,
                completedAt: nowIso,
                completedBy: [doerUid],
                lastReviewedAt: nowIso,
                updatedAt: nowIso
            });
            const t = state.todoTasksData?.find(item => item.id === id);
            if (t) {
                t.completed = true;
                t.completedAt = nowIso;
                t.completedBy = [doerUid];
            }
            await api.recordDailyCompletion({
                id: `todo_${id}`,
                itemId: id,
                sourceType: 'todo',
                title: t ? t.name : 'To-Do',
                user: doerName,
                userUid: doerUid,
                points: t ? (t.points || 5) : 5,
                completedAt: nowIso,
                dateKey: todayKey
            });
        }
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_comp", `Marked ${todoIds.length} To-Dos completed.`, 0, "");
        rebuildCompletedToday();
        renderDoneTodayFeed();
        renderBulkTriageList();
        renderTodoTasks();
    } else if (actionType === 'assign') {
        const userPrompt = prompt("Assign to which user? Enter name (Alyssa, Devyn, Carrina, Kenny, Ayden, DJ) or 'Anyone':", "Anyone");
        if (!userPrompt) return;
        let assignees = [];
        if (userPrompt.toLowerCase() !== 'anyone') {
            const matched = ALL_USERS.find(u => u.name.toLowerCase() === userPrompt.trim().toLowerCase());
            if (matched) assignees.push(matched.uid);
            else { alert("User not recognized."); return; }
        }
        const batch = window.db.batch();
        todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), { assignees, updatedAt: nowIso }));
        routineIds.forEach(id => batch.update(window.getNiptoCollection('routines').doc(id), { assignees: assignees.length ? assignees : ALL_USERS.map(u => u.uid), updatedAt: nowIso }));
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
    } else if (actionType === 'category') {
        const catPrompt = prompt("Set category (Home, Farm, Errands, Tech, Kids, Project):", "Home");
        if (!catPrompt) return;
        const batch = window.db.batch();
        todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), { category: catPrompt.trim(), updatedAt: nowIso }));
        routineIds.forEach(id => batch.update(window.getNiptoCollection('routines').doc(id), { category: catPrompt.trim(), updatedAt: nowIso }));
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_cat", `Updated category for ${total} items.`, 0, "");
        await api.loadRoutinesFromFirestore();
        renderBulkTriageList();
        renderTodoTasks();
        renderRollingSchedule();
    } else if (actionType === 'schedule') {
        const freqPrompt = prompt("Set Routine Frequency ('daily' or 'weekly'):", "daily");
        if (!freqPrompt) return;
        const cleanFreq = freqPrompt.trim().toLowerCase();
        if (!['daily', 'weekly'].includes(cleanFreq)) { alert("Must be 'daily' or 'weekly'."); return; }
        const batch = window.db.batch();
        routineIds.forEach(id => {
            const sched = { type: cleanFreq, resetType: 'midnight', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeOfDay: 'Morning' };
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

// Window bindings for inline HTML onclicks and external callers
if (typeof window !== 'undefined') {
    window.parseWithGemini = parseWithGemini;
    window.rawLineByLineAdd = rawLineByLineAdd;
    window.renderBrainDumpStaging = renderBrainDumpStaging;
    window.updateStagingItem = updateStagingItem;
    window.deleteStagingItem = deleteStagingItem;
    window.addSubtaskToStaging = addSubtaskToStaging;
    window.updateStagingSubtask = updateStagingSubtask;
    window.removeStagingSubtask = removeStagingSubtask;
    window.toggleAllStagingRows = toggleAllStagingRows;
    window.toggleSectionStagingRows = toggleSectionStagingRows;
    window.clearBrainDumpStaging = clearBrainDumpStaging;
    window.applyUnifiedStagingToFirestore = applyUnifiedStagingToFirestore;
    window.commitBrainDumpToFirestore = applyUnifiedStagingToFirestore;

    // Backward-compatible aliases
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
    window.updateInlineTaskField = updateInlineTaskField;
    window.updateRoutineScheduleInline = updateRoutineScheduleInline;
    window.setBulkTypeFilter = setBulkTypeFilter;
    window.setBulkCategoryFilter = setBulkCategoryFilter;
    window.setBulkPriorityFilter = setBulkPriorityFilter;
    window.setBulkOwnershipFilter = setBulkOwnershipFilter;
    window.setBulkSortBy = setBulkSortBy;
}
