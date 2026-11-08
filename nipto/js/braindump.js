// braindump.js
// Gemini AI Studio Brain Dump Parser, Staging Table, and Bulk Triage Management
import { state, ALL_USERS } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { renderTodoTasks } from './todos.js';
import { renderRoutines } from './routines.js';

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
// GEMINI AI STUDIO PARSER
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

    const apiKey = state.integrationsConfig?.geminiApiKey;
    if (!apiKey) {
        alert("Gemini API Key is not configured. Please open Settings (gear icon in the top bar) and enter your Gemini API key.");
        if (window.openSettingsModal) window.openSettingsModal();
        return;
    }

    if (parseBtn) {
        parseBtn.disabled = true;
        parseBtn.innerHTML = "Thinking (Gemini)...";
    }
    if (statusEl) {
        statusEl.textContent = "Connecting to Gemini 2.5 Flash...";
        statusEl.style.color = "var(--primary)";
    }

    const knownUsers = ALL_USERS.map(u => u.name).join(', ');
    const systemInstruction = `You are a structured family task assistant. Convert the user's unstructured brain dump of chores, one-off to-dos, project ideas, and recurring schedules into an array of structured JSON task objects.
Available assignees: Alyssa, Devyn, Carrina, Kenny, Ayden, DJ, Anyone.
Inferred categories: Home, Farm, Errands, Tech, Kids, Project.
Friction tags: "quick" (<5 min), "low_brain" (mindless chores), "deep_focus" (projects or complex tasks).
Buckets for todos: "actionable" or "project_idea".

Strict JSON Schema for each item in the array:
- targetType: "todo" or "routine" (use "routine" if recurring or periodic, e.g. "every day", "Mondays and Thursdays", "weekly")
- title: concise title string
- assignee: matched from available assignees or "Anyone"
- category: Home | Farm | Errands | Tech | Kids | Project
- bucket: "actionable" or "project_idea"
- frictionTag: "quick" | "low_brain" | "deep_focus"
- schedule: (only if targetType is "routine") object with:
    - daysOfWeek: array of integers 0..6 where 0=Sun, 1=Mon, ..., 6=Sat (or [0,1,2,3,4,5,6] if daily)
    - timeOfDay: "Morning" | "Afternoon" | "Evening" | "Anytime"
    - points: suggested Nipto points (e.g. 10, 15, 20, 25)

Return ONLY valid JSON: an array of these objects without any Markdown fences or formatting.`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const body = {
            contents: [
                {
                    parts: [
                        { text: systemInstruction + "\n\nUser Input:\n" + text }
                    ]
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
            throw new Error(errBody.error?.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) throw new Error("Gemini returned empty response.");

        let parsedItems = JSON.parse(candidateText);
        if (!Array.isArray(parsedItems)) {
            if (parsedItems.items && Array.isArray(parsedItems.items)) parsedItems = parsedItems.items;
            else if (parsedItems.tasks && Array.isArray(parsedItems.tasks)) parsedItems = parsedItems.tasks;
            else parsedItems = [parsedItems];
        }

        state.brainDumpStaging = parsedItems.map((item, idx) => ({
            id: 'staging_' + Date.now() + '_' + idx,
            selected: true,
            targetType: item.targetType === 'routine' ? 'routine' : 'todo',
            title: item.title || 'Untitled Task',
            assignee: item.assignee || 'Anyone',
            category: item.category || 'Home',
            bucket: item.bucket === 'project_idea' ? 'project_idea' : 'actionable',
            frictionTag: item.frictionTag || 'quick',
            schedule: item.schedule || { daysOfWeek: [1, 4], timeOfDay: 'Morning', points: 15 }
        }));

        renderBrainDumpStaging();
        if (statusEl) {
            statusEl.textContent = `Parsed ${state.brainDumpStaging.length} items successfully. Review and commit below.`;
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
            parseBtn.innerHTML = "&#x2728; Parse with Gemini AI";
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
        id: 'staging_' + Date.now() + '_' + idx,
        selected: true,
        targetType: 'todo',
        title: line,
        assignee: 'Anyone',
        category: 'Home',
        bucket: 'actionable',
        frictionTag: 'quick',
        schedule: { daysOfWeek: [1, 4], timeOfDay: 'Morning', points: 15 }
    }));

    renderBrainDumpStaging();
    if (statusEl) {
        statusEl.textContent = `Loaded ${state.brainDumpStaging.length} raw line items. Adjust and commit below.`;
        statusEl.style.color = "var(--success)";
    }
}

// Renders the editable staging preview table
export function renderBrainDumpStaging() {
    const container = document.getElementById('brainDumpStaging');
    if (!container) return;

    if (!state.brainDumpStaging || state.brainDumpStaging.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No staged items. Use Gemini AI Parse or Raw Add above to preview items.</div>';
        return;
    }

    const userOptionsHtml = `<option value="Anyone">Anyone</option>` +
        ALL_USERS.map(u => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`).join('');

    let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
        <h4 style="margin: 0; font-size: 16px;">Staging Preview (${state.brainDumpStaging.length} items)</h4>
        <div style="display: flex; gap: 8px;">
            <button class="action-btn" onclick="clearBrainDumpStaging()" style="padding: 6px 12px; font-size: 13px;">Clear Staging</button>
            <button class="action-btn save-mode" onclick="commitBrainDumpToFirestore()" style="padding: 6px 14px; font-size: 13px; font-weight: 800;">
                &#x2714; Commit All to Firestore
            </button>
        </div>
    </div>
    <div style="overflow-x: auto; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--border-color);">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
            <thead>
                <tr style="background: var(--bg-color); border-bottom: 2px solid var(--border-color);">
                    <th style="padding: 8px 10px; width: 30px;"><input type="checkbox" checked onchange="toggleAllStagingRows(this.checked)"></th>
                    <th style="padding: 8px 10px; width: 90px;">Type</th>
                    <th style="padding: 8px 10px;">Title</th>
                    <th style="padding: 8px 10px; width: 110px;">Assignee</th>
                    <th style="padding: 8px 10px; width: 100px;">Category</th>
                    <th style="padding: 8px 10px; width: 110px;">Bucket / Schedule</th>
                    <th style="padding: 8px 10px; width: 100px;">Friction</th>
                    <th style="padding: 8px 10px; width: 40px;"></th>
                </tr>
            </thead>
            <tbody>
    `;

    state.brainDumpStaging.forEach((item, idx) => {
        html += `
        <tr style="border-bottom: 1px solid var(--border-color); ${!item.selected ? 'opacity: 0.5;' : ''}">
            <td style="padding: 8px 10px;">
                <input type="checkbox" ${item.selected ? 'checked' : ''} onchange="updateStagingItem(${idx}, 'selected', this.checked)">
            </td>
            <td style="padding: 8px 10px;">
                <select onchange="updateStagingItem(${idx}, 'targetType', this.value)" style="padding: 4px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 12px; width: 100%;">
                    <option value="todo" ${item.targetType === 'todo' ? 'selected' : ''}>To-Do</option>
                    <option value="routine" ${item.targetType === 'routine' ? 'selected' : ''}>Routine</option>
                </select>
            </td>
            <td style="padding: 8px 10px;">
                <input type="text" value="${escapeHtml(item.title)}" onchange="updateStagingItem(${idx}, 'title', this.value)" style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 13px; width: 100%; box-sizing: border-box;">
            </td>
            <td style="padding: 8px 10px;">
                <select onchange="updateStagingItem(${idx}, 'assignee', this.value)" style="padding: 4px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 12px; width: 100%;">
                    ${userOptionsHtml.replace(`value="${escapeHtml(item.assignee)}"`, `value="${escapeHtml(item.assignee)}" selected`)}
                </select>
            </td>
            <td style="padding: 8px 10px;">
                <select onchange="updateStagingItem(${idx}, 'category', this.value)" style="padding: 4px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 12px; width: 100%;">
                    <option value="Home" ${item.category === 'Home' ? 'selected' : ''}>Home</option>
                    <option value="Farm" ${item.category === 'Farm' ? 'selected' : ''}>Farm</option>
                    <option value="Errands" ${item.category === 'Errands' ? 'selected' : ''}>Errands</option>
                    <option value="Tech" ${item.category === 'Tech' ? 'selected' : ''}>Tech</option>
                    <option value="Kids" ${item.category === 'Kids' ? 'selected' : ''}>Kids</option>
                    <option value="Project" ${item.category === 'Project' ? 'selected' : ''}>Project</option>
                </select>
            </td>
            <td style="padding: 8px 10px;">
                ${item.targetType === 'todo' ? `
                    <select onchange="updateStagingItem(${idx}, 'bucket', this.value)" style="padding: 4px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 12px; width: 100%;">
                        <option value="actionable" ${item.bucket === 'actionable' ? 'selected' : ''}>Actionable</option>
                        <option value="project_idea" ${item.bucket === 'project_idea' ? 'selected' : ''}>Project Idea</option>
                    </select>
                ` : `
                    <span style="font-size: 11px; color: var(--primary); font-weight: bold;">
                        ${item.schedule?.timeOfDay || 'Anytime'} (${(item.schedule?.daysOfWeek || []).length}d/wk)
                    </span>
                `}
            </td>
            <td style="padding: 8px 10px;">
                <select onchange="updateStagingItem(${idx}, 'frictionTag', this.value)" style="padding: 4px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 12px; width: 100%;">
                    <option value="quick" ${item.frictionTag === 'quick' ? 'selected' : ''}>Quick (&lt;5m)</option>
                    <option value="low_brain" ${item.frictionTag === 'low_brain' ? 'selected' : ''}>Low Brain</option>
                    <option value="deep_focus" ${item.frictionTag === 'deep_focus' ? 'selected' : ''}>Deep Focus</option>
                </select>
            </td>
            <td style="padding: 8px 10px; text-align: center;">
                <button type="button" onclick="deleteStagingItem(${idx})" style="background: none; border: none; cursor: pointer; color: var(--danger); font-size: 14px;" title="Remove row">&times;</button>
            </td>
        </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    </div>
    `;

    container.innerHTML = html;
}

export function updateStagingItem(index, field, value) {
    if (state.brainDumpStaging[index]) {
        state.brainDumpStaging[index][field] = value;
        if (field === 'targetType' || field === 'selected') renderBrainDumpStaging();
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

export function clearBrainDumpStaging() {
    state.brainDumpStaging = [];
    renderBrainDumpStaging();
    const statusEl = document.getElementById('brainDumpStatus');
    if (statusEl) statusEl.textContent = "";
}

// Commits all selected staging items into Firestore in a batch write
export async function commitBrainDumpToFirestore() {
    const selectedItems = state.brainDumpStaging.filter(item => item.selected);
    if (selectedItems.length === 0) {
        alert("Please select at least one item to commit.");
        return;
    }

    const batch = window.db.batch();
    const nowIso = new Date().toISOString();
    let todosCount = 0;
    let routinesCount = 0;

    selectedItems.forEach(item => {
        let assigneeUids = [];
        if (item.assignee && item.assignee !== 'Anyone') {
            const userObj = ALL_USERS.find(u => u.name.toLowerCase() === item.assignee.toLowerCase());
            if (userObj) assigneeUids.push(userObj.uid);
        }

        if (item.targetType === 'routine') {
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
                completionType: 'shared',
                assignees: assigneeUids.length ? assigneeUids : ALL_USERS.map(u => u.uid),
                schedule: scheduleData,
                timeOfDay: item.schedule?.timeOfDay || 'Anytime',
                linkedNiptoTask: null,
                overdueAfterHours: 14,
                frictionTag: item.frictionTag,
                category: item.category,
                createdAt: nowIso,
                lastCompleted: {},
                lastCompletedBy: {},
                completionsByDate: {}
            });
            routinesCount++;
        } else {
            const todoRef = window.getNiptoCollection('custom_tasks').doc();
            batch.set(todoRef, {
                name: item.title,
                category: item.category || 'Home',
                location: 'N/A',
                assignees: assigneeUids,
                bucket: item.bucket || 'actionable',
                frictionTag: item.frictionTag || 'quick',
                points: null,
                notes: '',
                subTasks: [],
                completed: false,
                createdAt: nowIso
            });
            todosCount++;
        }
    });

    try {
        await batch.commit();
        showToast("commit_all", `Committed ${todosCount} To-Dos & ${routinesCount} Routines!`, 0, "");
        clearBrainDumpStaging();
        const inputEl = document.getElementById('brainDumpInput');
        if (inputEl) inputEl.value = "";
        
        await Promise.all([
            api.loadRoutinesFromFirestore()
        ]);
        renderRoutines();
        renderTodoTasks();
        
        // Switch user to Tab 1 (Schedule & To-Dos) to see their newly added items
        if (window.switchNavTab) window.switchNavTab('schedule-todos');
    } catch (err) {
        console.error("Batch commit failed:", err);
        alert("Failed to commit items: " + err.message);
    }
}

// ==========================================
// BULK TRIAGE & MANAGEMENT TOOLBAR
// ==========================================
export function renderBulkTriageList() {
    const container = document.getElementById('bulkTriageContainer');
    if (!container) return;

    const allTodos = state.todoTasksData || [];
    const allRoutines = state.routines || [];

    if (allTodos.length === 0 && allRoutines.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No items available for triage.</div>';
        return;
    }

    const totalSelected = state.selectedTodoIds.size + state.selectedRoutineIds.size;
    updateBulkActionBarVisibility(totalSelected);

    let html = `
    <div style="background: var(--card-bg); border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--bg-color); border-bottom: 1px solid var(--border-color);">
            <div style="font-weight: 800; font-size: 14px;">All Items (${allTodos.length} To-Dos, ${allRoutines.length} Routines)</div>
            <label style="font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                <input type="checkbox" id="bulkSelectAllCheckbox" onchange="toggleBulkSelectAll(this.checked)"> Select All
            </label>
        </div>
        <div style="max-height: 500px; overflow-y: auto; padding: 10px;">
    `;

    // To-Dos Section
    if (allTodos.length > 0) {
        html += `<div style="font-size: 12px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin: 8px 0 4px 6px;">To-Dos (${allTodos.length})</div>`;
        allTodos.forEach(t => {
            const isChecked = state.selectedTodoIds.has(t.id);
            const assigneesStr = (t.assignees && t.assignees.length)
                ? t.assignees.map(uid => ALL_USERS.find(u => u.uid === uid)?.name || 'Unknown').join(', ')
                : 'Anyone';
            html += `
            <div style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; border-bottom: 1px solid var(--border-color); background: ${isChecked ? 'rgba(37, 99, 235, 0.05)' : 'transparent'};">
                <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleBulkItem('todo', '${t.id}', this.checked)">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 14px; font-weight: 600; text-decoration: ${t.completed ? 'line-through' : 'none'};">${escapeHtml(t.name)}</div>
                    <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px;">
                        <span>Assignee: <strong>${escapeHtml(assigneesStr)}</strong></span>
                        <span>Category: <strong>${escapeHtml(t.category || 'Home')}</strong></span>
                        <span>Bucket: <strong>${escapeHtml(t.bucket || 'actionable')}</strong></span>
                        <span>Friction: <strong>${escapeHtml(t.frictionTag || 'quick')}</strong></span>
                    </div>
                </div>
            </div>
            `;
        });
    }

    // Routines Section
    if (allRoutines.length > 0) {
        html += `<div style="font-size: 12px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin: 16px 0 4px 6px;">Routines (${allRoutines.length})</div>`;
        allRoutines.forEach(r => {
            const isChecked = state.selectedRoutineIds.has(r.uid);
            const assigneesStr = (r.assignees && r.assignees.length)
                ? r.assignees.map(uid => ALL_USERS.find(u => u.uid === uid)?.name || 'Unknown').join(', ')
                : 'Anyone';
            html += `
            <div style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; border-bottom: 1px solid var(--border-color); background: ${isChecked ? 'rgba(37, 99, 235, 0.05)' : 'transparent'};">
                <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleBulkItem('routine', '${r.uid}', this.checked)">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 14px; font-weight: 600;">&#x21BB; ${escapeHtml(r.name)}</div>
                    <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px;">
                        <span>Assignee: <strong>${escapeHtml(assigneesStr)}</strong></span>
                        <span>Schedule: <strong>${escapeHtml(r.schedule?.type || 'daily')} (${escapeHtml(r.timeOfDay || r.schedule?.timeOfDay || 'Anytime')})</strong></span>
                    </div>
                </div>
            </div>
            `;
        });
    }

    html += `
        </div>
    </div>
    `;

    container.innerHTML = html;
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
    if (checked) {
        (state.todoTasksData || []).forEach(t => state.selectedTodoIds.add(t.id));
        (state.routines || []).forEach(r => state.selectedRoutineIds.add(r.uid));
    } else {
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
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
        renderRoutines();
    } else if (actionType === 'complete') {
        const batch = window.db.batch();
        const nowIso = new Date().toISOString();
        todoIds.forEach(id => {
            batch.update(window.getNiptoCollection('custom_tasks').doc(id), {
                completed: true,
                completedAt: nowIso
            });
        });
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_comp", `Marked ${todoIds.length} To-Dos completed.`, 0, "");
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
        todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), { assignees }));
        routineIds.forEach(id => batch.update(window.getNiptoCollection('routines').doc(id), { assignees: assignees.length ? assignees : ALL_USERS.map(u => u.uid) }));
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_assign", `Reassigned ${total} items to ${userPrompt}.`, 0, "");
        await api.loadRoutinesFromFirestore();
        renderBulkTriageList();
        renderTodoTasks();
        renderRoutines();
    } else if (actionType === 'category') {
        const catPrompt = prompt("Set category (Home, Farm, Errands, Tech, Kids, Project):", "Home");
        if (!catPrompt) return;
        const batch = window.db.batch();
        todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), { category: catPrompt.trim() }));
        routineIds.forEach(id => batch.update(window.getNiptoCollection('routines').doc(id), { category: catPrompt.trim() }));
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_cat", `Updated category for ${total} items.`, 0, "");
        await api.loadRoutinesFromFirestore();
        renderBulkTriageList();
        renderTodoTasks();
        renderRoutines();
    } else if (actionType === 'friction') {
        const fricPrompt = prompt("Set friction tag ('quick', 'low_brain', or 'deep_focus'):", "quick");
        if (!fricPrompt) return;
        const cleanTag = fricPrompt.trim().toLowerCase();
        if (!['quick', 'low_brain', 'deep_focus'].includes(cleanTag)) {
            alert("Invalid tag. Must be 'quick', 'low_brain', or 'deep_focus'.");
            return;
        }
        const batch = window.db.batch();
        todoIds.forEach(id => batch.update(window.getNiptoCollection('custom_tasks').doc(id), { frictionTag: cleanTag }));
        await batch.commit();
        state.selectedTodoIds.clear();
        state.selectedRoutineIds.clear();
        showToast("bulk_fric", `Updated friction tag for ${todoIds.length} To-Dos.`, 0, "");
        renderBulkTriageList();
        renderTodoTasks();
    }
}
