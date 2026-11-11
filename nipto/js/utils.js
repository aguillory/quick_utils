// utils.js
// Generic helpers: PIN auth, local date/week boundary utilities, custom time mode controls,
// and the reusable Searchable / Creatable Category Combobox component.

import { state } from './state.js';

const DEFAULT_CATEGORIES = ['Home', 'Farm', 'Errands', 'Tech', 'Kids', 'Project', 'General'];

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

export function getAllKnownCategories() {
    const seenLower = new Map();
    const addCat = (raw) => {
        if (!raw || typeof raw !== 'string') return;
        const trimmed = raw.trim();
        if (!trimmed || trimmed.includes('Quick Add') || trimmed.includes('&#x26A1;')) return;
        const lower = trimmed.toLowerCase();
        if (!seenLower.has(lower)) {
            seenLower.set(lower, trimmed);
        }
    };

    DEFAULT_CATEGORIES.forEach(addCat);
    (state.customCategories || []).forEach(addCat);
    (state.todoTasksData || []).forEach(t => addCat(t.category));
    (state.routines || []).forEach(r => addCat(r.category));
    (state.tasks || []).forEach(t => addCat(t.category));
    (state.brainDumpStaging || []).forEach(it => addCat(it.category));

    return Array.from(seenLower.values()).sort((a, b) => a.localeCompare(b));
}

export function registerCustomCategory(catName) {
    if (!catName || typeof catName !== 'string') return '';
    const clean = catName.trim();
    if (!clean) return '';
    if (!Array.isArray(state.customCategories)) state.customCategories = [];
    const exists = state.customCategories.some(c => c.toLowerCase() === clean.toLowerCase());
    if (!exists) state.customCategories.push(clean);
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
                onfocus="openCategoryCombobox(this, false)"
                oninput="filterCategoryCombobox(this)"
                onkeydown="handleCategoryComboboxKeydown(event, this)"
                ${changeAttr}>
            <button type="button" class="category-combobox-toggle" tabindex="-1" onclick="toggleCategoryComboboxDropdown(event, this)" title="Show categories">&#x25BE;</button>
        </div>
        <div class="category-combobox-menu" style="display: none;"></div>
    </div>`;
}

function populateCategoryComboboxMenu(inputEl, showAll = false) {
    if (!inputEl) return;
    const wrapper = inputEl.closest('.category-combobox-wrapper');
    const menu = wrapper ? wrapper.querySelector('.category-combobox-menu') : null;
    if (!menu) return;

    const rawQuery = (inputEl.value || '').trim();
    const queryLower = rawQuery.toLowerCase();
    const allCats = getAllKnownCategories();

    const filtered = showAll || !queryLower
        ? allCats
        : allCats.filter(c => c.toLowerCase().includes(queryLower));

    const exactMatch = allCats.find(c => c.toLowerCase() === queryLower);

    let html = '';
    filtered.forEach(cat => {
        const isCurrent = cat.toLowerCase() === queryLower;
        html += `<button type="button" class="category-combobox-option ${isCurrent ? 'active' : ''}"
            onmousedown="selectCategoryComboboxOption(event, this, '${escapeHtmlAttr(cat)}', false)">
            <span>&#x1F4C1; ${escapeHtmlAttr(cat)}</span>
            ${isCurrent ? '<span class="cat-check">&#x2714;</span>' : ''}
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
        menu.style.display = 'none';
    } else {
        inputEl.focus();
        openCategoryCombobox(inputEl, true);
    }
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

    const finalValue = registerCustomCategory(chosenValue);
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
            const allCats = getAllKnownCategories();
            const existing = allCats.find(c => c.toLowerCase() === rawVal.toLowerCase());
            const finalVal = existing || registerCustomCategory(rawVal);
            inputEl.value = finalVal;
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (menu) menu.style.display = 'none';
    }
}

// Close any open category combobox dropdown when clicking outside
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
    window.getLocalTodayKey = getLocalTodayKey;
    window.getLocalWeekBounds = getLocalWeekBounds;
    window.isDateInLocalWeek = isDateInLocalWeek;
    window.getAllKnownCategories = getAllKnownCategories;
    window.registerCustomCategory = registerCustomCategory;
    window.renderCategoryCombobox = renderCategoryCombobox;
    window.openCategoryCombobox = openCategoryCombobox;
    window.toggleCategoryComboboxDropdown = toggleCategoryComboboxDropdown;
    window.filterCategoryCombobox = filterCategoryCombobox;
    window.selectCategoryComboboxOption = selectCategoryComboboxOption;
    window.handleCategoryComboboxKeydown = handleCategoryComboboxKeydown;
}
