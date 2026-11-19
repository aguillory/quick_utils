// utils.js
// Generic helpers: PIN auth, local date/week boundary utilities, custom time mode controls,
// and the reusable Searchable / Creatable Category Combobox component.

import { state } from './state.js';

export const DEFAULT_CATEGORIES = ['Home', 'Farm', 'Errands', 'Tech', 'Kids', 'Project', 'General'];
export const COMPLETED_TODO_HIDE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export function toMillisSafe(val) {
    if (val === null || val === undefined || val === '') return NaN;
    if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return NaN;
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            return new Date(`${trimmed}T12:00:00`).getTime();
        }
        return Date.parse(trimmed);
    }
    if (typeof val === 'object') {
        if (typeof val.toMillis === 'function') {
            const ms = val.toMillis();
            return Number.isFinite(ms) ? ms : NaN;
        }
        if (typeof val.toDate === 'function') {
            const d = val.toDate();
            return (d instanceof Date) ? d.getTime() : NaN;
        }
        const secs = (val.seconds !== undefined) ? val.seconds : val._seconds;
        if (secs !== undefined && secs !== null && Number.isFinite(Number(secs))) {
            const ns = Number(val.nanoseconds ?? val._nanoseconds ?? 0);
            return (Number(secs) * 1000) + (Number.isFinite(ns) ? Math.floor(ns / 1e6) : 0);
        }
    }
    return NaN;
}

export function isCompletedTodoExpired(task, nowMs = Date.now()) {
    if (!task || !task.completed) return false;
    let ms = toMillisSafe(task.completedAt);
    if (!Number.isFinite(ms)) ms = toMillisSafe(task.updatedAt);
    if (!Number.isFinite(ms)) ms = toMillisSafe(task.createdAt);
    if (Number.isFinite(ms)) {
        return (nowMs - ms) >= COMPLETED_TODO_HIDE_AFTER_MS;
    }
    return true;
}

export function escapeHtmlAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Formats local YYYY-MM-DD from a Date object (defaults to now) to prevent UTC rollover bugs
export function getLocalTodayKey(date = new Date()) {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Computes strict local-time Monday 00:00:00.000 through Sunday 23:59:59.999 boundaries.
 * Weekly reset occurs Sunday night at 11:59:59.999 PM local time (Monday 12:00:00.000 AM starts a new week).
 * @param {Date} referenceDate - Base date (defaults to now)
 * @param {number} weekOffset - 0 for current week, -1 for previous week, etc.
 */
export function getLocalWeekBounds(referenceDate = new Date(), weekOffset = 0) {
    const base = (referenceDate instanceof Date) ? new Date(referenceDate.getTime()) : new Date(referenceDate);
    base.setHours(0, 0, 0, 0);

    const dayOfWeek = base.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const diffToMonday = dayOfWeek === 0 ? -6 : (1 - dayOfWeek);

    const startDate = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() + diffToMonday + (weekOffset * 7),
        0, 0, 0, 0
    );

    const endDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate() + 6,
        23, 59, 59, 999
    );

    const dateKeys = [];
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(
            startDate.getFullYear(),
            startDate.getMonth(),
            startDate.getDate() + i,
            12, 0, 0, 0
        );
        dateKeys.push(getLocalTodayKey(dayDate));
    }

    const sameYear = startDate.getFullYear() === endDate.getFullYear();
    const startFmt = startDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' })
    });
    const endFmt = endDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    return {
        weekOffset,
        startDate,
        endDate,
        startMs: startDate.getTime(),
        endMs: endDate.getTime(),
        dateKeys,
        dateKeySet: new Set(dateKeys),
        weekKey: dateKeys[0],
        label: `${startFmt} \u2013 ${endFmt}`
    };
}

// Checks whether a Date, ISO timestamp string, or YYYY-MM-DD key falls within local week bounds
export function isDateInLocalWeek(dateOrIsoOrKey, weekBounds = getLocalWeekBounds()) {
    if (!dateOrIsoOrKey || !weekBounds) return false;
    if (typeof dateOrIsoOrKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrIsoOrKey.trim())) {
        return weekBounds.dateKeySet.has(dateOrIsoOrKey.trim());
    }
    const d = (dateOrIsoOrKey instanceof Date) ? dateOrIsoOrKey : new Date(dateOrIsoOrKey);
    const ms = d.getTime();
    if (isNaN(ms)) return false;
    return ms >= weekBounds.startMs && ms <= weekBounds.endMs;
}

// Reconstructs the API key from a 4-digit PIN.
function decodeKey(pin) {
    const masked = "$a#0$*fa-*a07-%%f%-a%*%-f*c8$9c*%8*8";
    const p1 = pin[0], p2 = pin[1], p3 = pin[2], p4 = pin[3];
    return masked.replace(/\*/g, p1).replace(/#/g, p2).replace(/\$/g, p3).replace(/%/g, p4);
}

// Validates and stores the API token from the PIN modal.
export function savePin(onSuccessCallback) {
    const pinInput = document.getElementById('pinInput');
    const pinError = document.getElementById('pinError');
    const pin = pinInput ? pinInput.value : '';
    if (pin.length !== 4) {
        if (pinError) pinError.style.display = 'block';
        return;
    }
    state.apiToken = decodeKey(pin);
    localStorage.setItem("nipto_api_token", state.apiToken);
    const pinModal = document.getElementById('pinModal');
    if (pinModal) pinModal.style.display = 'none';
    if (onSuccessCallback) onSuccessCallback();
}

// Formats a Date for a datetime-local input.
function formatForInput(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const h = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
}

// Switches between live-time and custom-time logging modes.
export function setMode(mode) {
    if (state.isEditMode) return;
    state.currentMode = mode;
    const btnLive = document.getElementById('btnLive');
    const btnCustom = document.getElementById('btnCustom');
    const customBox = document.getElementById('customTimeBox');
    if (mode === 'live') {
        if (btnLive) btnLive.classList.add('active');
        if (btnCustom) btnCustom.classList.remove('active');
        if (customBox) customBox.classList.remove('visible');
    } else {
        if (btnCustom) btnCustom.classList.add('active');
        if (btnLive) btnLive.classList.remove('active');
        if (customBox) customBox.classList.add('visible');
        const dateInput = document.getElementById('taskDate');
        if (dateInput && !dateInput.value) dateInput.value = formatForInput(new Date());
    }
}

// Nudges the custom log time by a number of minutes.
export function setTimeOffset(minutes) {
    if (state.currentMode === 'live') setMode('custom');
    const dateInput = document.getElementById('taskDate');
    if (!dateInput) return;
    const targetDate = dateInput.value ? new Date(dateInput.value) : new Date();
    targetDate.setMinutes(targetDate.getMinutes() + minutes);
    dateInput.value = formatForInput(targetDate);
}

// ==========================================
// SEARCHABLE / CREATABLE CATEGORY COMBOBOX
// ==========================================
const pendingCategoryWrites = new Set();

export function isInternalLockedCategory(catName) {
    if (!catName || typeof catName !== 'string') return true;
    const trimmed = catName.trim();
    if (!trimmed) return true;
    const lower = trimmed.toLowerCase();
    return trimmed === '\u2705' ||
        lower.includes('quick add') ||
        lower.includes('&#x26a1;') ||
        trimmed.includes('\u26A1');
}

export async function loadCategoryConfigFromFirestore() {
    if (typeof window === 'undefined' || typeof window.getNiptoCollection !== 'function') {
        return state.categoryConfig;
    }
    try {
        const doc = await window.getNiptoCollection('config').doc('categories').get();
        if (doc.exists) {
            const data = doc.data() || {};
            state.categoryConfig = {
                hiddenCategories: Array.isArray(data.hiddenCategories) ? data.hiddenCategories.filter(Boolean) : [],
                unhiddenNiptoCategories: Array.isArray(data.unhiddenNiptoCategories) ? data.unhiddenNiptoCategories.filter(Boolean) : []
            };
        } else {
            state.categoryConfig = {
                hiddenCategories: [],
                unhiddenNiptoCategories: []
            };
        }
    } catch (e) {
        console.warn("Error loading category config:", e);
    }
    return state.categoryConfig;
}

export async function saveCategoryConfigToFirestore(patch = {}) {
    const curr = state.categoryConfig || { hiddenCategories: [], unhiddenNiptoCategories: [] };
    state.categoryConfig = {
        hiddenCategories: Array.isArray(patch.hiddenCategories) ? patch.hiddenCategories : (curr.hiddenCategories || []),
        unhiddenNiptoCategories: Array.isArray(patch.unhiddenNiptoCategories) ? patch.unhiddenNiptoCategories : (curr.unhiddenNiptoCategories || [])
    };
    if (typeof window !== 'undefined' && typeof window.getNiptoCollection === 'function') {
        try {
            await window.getNiptoCollection('config').doc('categories').set(state.categoryConfig, { merge: true });
        } catch (e) {
            console.warn("Could not save category config:", e);
        }
    }
    return state.categoryConfig;
}

export function getNiptoOnlyLowerSet() {
    const knownTaskCatsLower = new Set([
        ...DEFAULT_CATEGORIES.map(c => c.toLowerCase()),
        ...(state.customCategories || []).map(c => String(c || '').trim().toLowerCase()).filter(Boolean),
        ...(state.categoryConfig?.unhiddenNiptoCategories || []).map(c => String(c || '').trim().toLowerCase()).filter(Boolean)
    ]);
    const niptoOnly = new Set();
    (state.tasks || []).forEach(t => {
        const raw = (t?.category || '').trim();
        if (!raw || isInternalLockedCategory(raw)) return;
        const lower = raw.toLowerCase();
        if (!knownTaskCatsLower.has(lower)) {
            niptoOnly.add(lower);
        }
    });
    return niptoOnly;
}

export function isCategoryVisibleForTasks(catName) {
    if (!catName || typeof catName !== 'string') return false;
    const clean = catName.trim();
    if (!clean || isInternalLockedCategory(clean)) return false;
    const lower = clean.toLowerCase();
    const hiddenLower = new Set(
        (state.categoryConfig?.hiddenCategories || []).map(c => String(c || '').trim().toLowerCase()).filter(Boolean)
    );
    if (hiddenLower.has(lower)) return false;
    const niptoOnlyLower = getNiptoOnlyLowerSet();
    if (niptoOnlyLower.has(lower)) return false;
    return true;
}

export async function loadCustomCategoriesFromFirestore() {
    if (typeof window === 'undefined' || typeof window.getNiptoCollection !== 'function') {
        return state.customCategories || [];
    }
    try {
        const snapshot = await window.getNiptoCollection('custom_categories').get();
        const loaded = [];
        const seen = new Set();
        snapshot.forEach(doc => {
            const name = (doc.data()?.name || '').trim();
            if (!name || isInternalLockedCategory(name)) return;
            const lower = name.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                loaded.push(name);
            }
        });
        state.customCategories = loaded;
    } catch (e) {
        console.warn("Error loading custom_categories:", e);
    }
    return state.customCategories || [];
}

export function getEligibleTaskCategories() {
    const seenLower = new Map();
    const addCat = (raw) => {
        if (!raw || typeof raw !== 'string') return;
        const trimmed = raw.trim();
        if (!trimmed || !isCategoryVisibleForTasks(trimmed)) return;
        const lower = trimmed.toLowerCase();
        if (!seenLower.has(lower)) {
            seenLower.set(lower, trimmed);
        }
    };

    DEFAULT_CATEGORIES.forEach(addCat);
    (state.customCategories || []).forEach(addCat);
    (state.categoryConfig?.unhiddenNiptoCategories || []).forEach(addCat);
    (state.todoTasksData || []).forEach(t => {
        if (!isCompletedTodoExpired(t)) addCat(t.category);
    });
    (state.routines || []).forEach(r => addCat(r.category));
    (state.brainDumpStaging || []).forEach(it => addCat(it.category));

    return Array.from(seenLower.values()).sort((a, b) => a.localeCompare(b));
}

export function getAllKnownCategories() {
    return getEligibleTaskCategories();
}

export function registerCustomCategory(catName, isExplicitCreate = false) {
    if (!catName || typeof catName !== 'string') return '';
    const clean = catName.trim();
    if (!clean) return '';
    if (isInternalLockedCategory(clean)) return 'Home';

    if (!Array.isArray(state.customCategories)) state.customCategories = [];
    const lower = clean.toLowerCase();
    const hiddenList = Array.isArray(state.categoryConfig?.hiddenCategories) ? state.categoryConfig.hiddenCategories : [];
    const hiddenLowerSet = new Set(hiddenList.map(c => String(c || '').trim().toLowerCase()).filter(Boolean));
    const niptoOnlyLowerSet = getNiptoOnlyLowerSet();

    if (!isExplicitCreate && (hiddenLowerSet.has(lower) || niptoOnlyLowerSet.has(lower))) {
        return clean;
    }

    if (isExplicitCreate) {
        if (hiddenLowerSet.has(lower)) {
            const nextHidden = hiddenList.filter(c => String(c || '').trim().toLowerCase() !== lower);
            saveCategoryConfigToFirestore({ hiddenCategories: nextHidden });
        }
        if (niptoOnlyLowerSet.has(lower)) {
            const prevUnhidden = Array.isArray(state.categoryConfig?.unhiddenNiptoCategories)
                ? state.categoryConfig.unhiddenNiptoCategories
                : [];
            if (!prevUnhidden.some(c => String(c || '').trim().toLowerCase() === lower)) {
                saveCategoryConfigToFirestore({ unhiddenNiptoCategories: [...prevUnhidden, clean] });
            }
        }
    }

    const isDefault = DEFAULT_CATEGORIES.some(c => c.toLowerCase() === lower);
    const exists = state.customCategories.some(c => c.toLowerCase() === lower);
    if (!exists && !isDefault) {
        state.customCategories.push(clean);
        if (!pendingCategoryWrites.has(lower) && typeof window !== 'undefined' && typeof window.getNiptoCollection === 'function') {
            pendingCategoryWrites.add(lower);
            window.getNiptoCollection('custom_categories').add({
                name: clean,
                createdAt: new Date().toISOString()
            }).catch(e => {
                pendingCategoryWrites.delete(lower);
                console.warn("Could not persist custom category:", e);
            });
        }
    }
    return clean;
}

/**
 * Renders an interactive Searchable / Creatable Category Combobox HTML string.
 * @param {Object} opts
 * @param {string} [opts.id] - Input element ID (for modals)
 * @param {string} [opts.value] - Current category value
 * @param {string} [opts.placeholder] - Input placeholder
 * @param {string} [opts.onChangeExpr] - Inline JS expression using `this.value` when value changes
 * @param {boolean} [opts.compact] - True for compact inline rows (Bulk Triage / Staging)
 * @param {string} [opts.style] - Optional inline style override for wrapper
 */
export function renderCategoryCombobox(opts = {}) {
    const {
        id = '',
        value = 'Home',
        placeholder = 'Search or create category...',
        onChangeExpr = '',
        compact = false,
        style = ''
    } = opts;

    const idAttr = id ? `id="${escapeHtmlAttr(id)}"` : '';
    const valAttr = escapeHtmlAttr(value || '');
    const phAttr = escapeHtmlAttr(placeholder);
    const changeAttr = onChangeExpr ? `data-onchange="${escapeHtmlAttr(onChangeExpr)}" onchange="${escapeHtmlAttr(onChangeExpr)}"` : '';
    const compactClass = compact ? 'is-compact' : '';

    return `<div class="category-combobox-wrapper ${compactClass}" style="${escapeHtmlAttr(style)}">
        <div class="category-combobox-input-wrap">
            <input type="text" ${idAttr} class="category-combobox-input ${compactClass}" value="${valAttr}" placeholder="${phAttr}" autocomplete="off"
                onfocus="openCategoryCombobox(this, true)"
                onclick="openCategoryCombobox(this, true)"
                oninput="filterCategoryCombobox(this)"
                onkeydown="handleCategoryComboboxKeydown(event, this)"
                ${changeAttr}>
            <button type="button" class="category-combobox-clear" tabindex="-1" onclick="clearCategoryComboboxInput(event, this)" title="Clear to type a new category">&times;</button>
            <button type="button" class="category-combobox-toggle" tabindex="-1" onclick="toggleCategoryComboboxDropdown(event, this)" title="Show categories">&#x25BE;</button>
        </div>
        <div class="category-combobox-menu" style="display: none;"></div>
    </div>`;
}

function positionCategoryComboboxMenu(inputEl, menu) {
    if (!inputEl || !menu || typeof window === 'undefined') return;
    const rect = inputEl.getBoundingClientRect();
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 800;
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 1200;
    const spaceBelow = viewportH - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxH = Math.max(100, Math.min(220, openUpward ? spaceAbove : spaceBelow));
    const menuWidth = Math.max(180, rect.width);
    let desiredLeft = rect.left;
    if (desiredLeft + menuWidth > viewportW - 8) {
        desiredLeft = Math.max(8, viewportW - menuWidth - 8);
    }

    // Measure containing-block origin so themes with ancestor backdrop-filter/transform (e.g. blackops.css .card) align accurately
    menu.style.position = 'fixed';
    menu.style.top = '0px';
    menu.style.left = '0px';
    menu.style.bottom = 'auto';
    menu.style.maxHeight = `${maxH}px`;
    const cbOrigin = menu.getBoundingClientRect();
    const offsetLeft = cbOrigin.left || 0;
    const offsetTop = cbOrigin.top || 0;

    menu.style.left = `${desiredLeft - offsetLeft}px`;
    menu.style.width = `${menuWidth}px`;
    menu.style.zIndex = '5000';
    menu.style.overflowY = 'auto';

    if (openUpward) {
        const menuHeight = Math.min(maxH, menu.scrollHeight || maxH);
        const desiredTop = Math.max(8, rect.top - 3 - menuHeight);
        menu.style.top = `${desiredTop - offsetTop}px`;
    } else {
        const desiredTop = rect.bottom + 3;
        menu.style.top = `${desiredTop - offsetTop}px`;
    }
}

function populateCategoryComboboxMenu(inputEl, showAll = false) {
    if (!inputEl) return;
    const wrapper = inputEl.closest('.category-combobox-wrapper');
    const menu = wrapper ? wrapper.querySelector('.category-combobox-menu') : null;
    if (!menu) return;

    menu.dataset.mode = showAll ? 'all' : 'filtered';
    const rawQuery = (inputEl.value || '').trim();
    const queryLower = rawQuery.toLowerCase();
    const allCats = getEligibleTaskCategories();
    const exactMatch = allCats.find(c => c.toLowerCase() === queryLower);

    let listToRender = [];
    if (showAll || !queryLower) {
        if (exactMatch) {
            listToRender = [exactMatch, ...allCats.filter(c => c.toLowerCase() !== queryLower)];
        } else {
            listToRender = allCats;
        }
    } else {
        const matched = allCats.filter(c => c.toLowerCase().includes(queryLower));
        if (exactMatch) {
            listToRender = [exactMatch, ...matched.filter(c => c.toLowerCase() !== queryLower)];
        } else {
            listToRender = matched;
        }
    }

    let html = '';
    listToRender.forEach(cat => {
        const isCurrent = Boolean(queryLower && cat.toLowerCase() === queryLower);
        const checkHtml = isCurrent ? '<span class="cat-check">&#x2714;</span>' : '';
        html += `<button type="button" class="category-combobox-option ${isCurrent ? 'active' : ''}"
            onmousedown="selectCategoryComboboxOption(event, this, '${escapeHtmlAttr(cat)}', false)">
            <span>&#x1F4C1; ${escapeHtmlAttr(cat)}</span>
            ${checkHtml}
        </button>`;
    });

    if (rawQuery && !exactMatch) {
        html += `<button type="button" class="category-combobox-option create-new-option"
            onmousedown="selectCategoryComboboxOption(event, this, '${escapeHtmlAttr(rawQuery)}', true)">
            <span>+ Create "<strong>${escapeHtmlAttr(rawQuery)}</strong>"</span>
        </button>`;
    }

    if (!html) {
        html = `<div class="category-combobox-empty">Type a category name to create it</div>`;
    }

    menu.innerHTML = html;
    menu.style.display = 'flex';
    positionCategoryComboboxMenu(inputEl, menu);
    menu.scrollTop = 0;
}

export function openCategoryCombobox(inputEl, showAll = true) {
    if (!inputEl) return;
    document.querySelectorAll('.category-combobox-menu').forEach(m => {
        const w = m.closest('.category-combobox-wrapper');
        if (!w || !w.contains(inputEl)) m.style.display = 'none';
    });
    populateCategoryComboboxMenu(inputEl, showAll);
}

export function toggleCategoryComboboxDropdown(event, btnEl) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const wrapper = btnEl ? btnEl.closest('.category-combobox-wrapper') : null;
    if (!wrapper) return;
    const inputEl = wrapper.querySelector('.category-combobox-input');
    const menu = wrapper.querySelector('.category-combobox-menu');
    if (!inputEl || !menu) return;

    if (menu.style.display === 'flex') {
        if (menu.dataset.mode === 'filtered') {
            inputEl.focus();
            openCategoryCombobox(inputEl, true);
        } else {
            menu.style.display = 'none';
        }
    } else {
        inputEl.focus();
        openCategoryCombobox(inputEl, true);
    }
}

export function clearCategoryComboboxInput(event, btnEl) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const wrapper = btnEl ? btnEl.closest('.category-combobox-wrapper') : null;
    if (!wrapper) return;
    const inputEl = wrapper.querySelector('.category-combobox-input');
    if (!inputEl) return;
    inputEl.value = '';
    inputEl.focus();
    openCategoryCombobox(inputEl, true);
}

export function filterCategoryCombobox(inputEl) {
    populateCategoryComboboxMenu(inputEl, false);
}

export function selectCategoryComboboxOption(event, optionEl, chosenValue, isNew = false) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const wrapper = optionEl ? optionEl.closest('.category-combobox-wrapper') : null;
    if (!wrapper) return;
    const inputEl = wrapper.querySelector('.category-combobox-input');
    const menu = wrapper.querySelector('.category-combobox-menu');

    const finalValue = registerCustomCategory(chosenValue, isNew);
    if (inputEl) {
        inputEl.value = finalValue;
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (menu) {
        menu.style.display = 'none';
    }
}

export function handleCategoryComboboxKeydown(event, inputEl) {
    const wrapper = inputEl ? inputEl.closest('.category-combobox-wrapper') : null;
    const menu = wrapper ? wrapper.querySelector('.category-combobox-menu') : null;
    if (event.key === 'Escape') {
        if (menu) menu.style.display = 'none';
        inputEl.blur();
    } else if (event.key === 'Enter') {
        event.preventDefault();
        const rawVal = (inputEl.value || '').trim();
        if (rawVal) {
            const allCats = getEligibleTaskCategories();
            const existing = allCats.find(c => c.toLowerCase() === rawVal.toLowerCase());
            const finalVal = existing || registerCustomCategory(rawVal, true);
            inputEl.value = finalVal;
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (menu) menu.style.display = 'none';
    }
}

// Close any open category combobox dropdown when clicking outside or scrolling external containers
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.category-combobox-wrapper')) {
            document.querySelectorAll('.category-combobox-menu').forEach(m => {
                m.style.display = 'none';
            });
        }
    });
}
if (typeof window !== 'undefined') {
    window.addEventListener('scroll', (e) => {
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('.category-combobox-menu')) {
            return;
        }
        document.querySelectorAll('.category-combobox-menu').forEach(m => {
            if (m.style.display === 'flex') m.style.display = 'none';
        });
    }, true);
    window.addEventListener('resize', () => {
        document.querySelectorAll('.category-combobox-menu').forEach(m => {
            if (m.style.display === 'flex') m.style.display = 'none';
        });
    });
}

if (typeof window !== 'undefined') {
    window.toMillisSafe = toMillisSafe;
    window.isCompletedTodoExpired = isCompletedTodoExpired;
    window.getLocalTodayKey = getLocalTodayKey;
    window.getLocalWeekBounds = getLocalWeekBounds;
    window.isDateInLocalWeek = isDateInLocalWeek;
    window.isInternalLockedCategory = isInternalLockedCategory;
    window.loadCategoryConfigFromFirestore = loadCategoryConfigFromFirestore;
    window.saveCategoryConfigToFirestore = saveCategoryConfigToFirestore;
    window.getNiptoOnlyLowerSet = getNiptoOnlyLowerSet;
    window.isCategoryVisibleForTasks = isCategoryVisibleForTasks;
    window.getEligibleTaskCategories = getEligibleTaskCategories;
    window.getAllKnownCategories = getAllKnownCategories;
    window.loadCustomCategoriesFromFirestore = loadCustomCategoriesFromFirestore;
    window.registerCustomCategory = registerCustomCategory;
    window.renderCategoryCombobox = renderCategoryCombobox;
    window.openCategoryCombobox = openCategoryCombobox;
    window.toggleCategoryComboboxDropdown = toggleCategoryComboboxDropdown;
    window.clearCategoryComboboxInput = clearCategoryComboboxInput;
    window.filterCategoryCombobox = filterCategoryCombobox;
    window.selectCategoryComboboxOption = selectCategoryComboboxOption;
    window.handleCategoryComboboxKeydown = handleCategoryComboboxKeydown;
}
