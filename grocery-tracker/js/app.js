// Monroe Grocery Tracker Frontend Application
import { 
    db, 
    doc, 
    collection, 
    onSnapshot, 
    setDoc, 
    updateDoc, 
    deleteDoc, 
    getDocs 
} from './firebase-config.js';

import { normalizeDeal } from './normalizer.js';
import { itemMatchesWatchlist, evaluateRawItem, formatValidWindow } from './matcher.js';

// Application State
const state = {
    currentTab: 'pricebook',
    watchlist: [],
    currentAds: [],
    rawFeed: [],
    syncState: {
        status: 'idle',
        last_ad_scan: null,
        last_baseline_refresh: null,
        trigger_request: 'none'
    },
    expandedRows: new Set(),
    editingBaselineId: null,
    filters: {
        beatsBaselineOnly: false,
        priorityOnly: false,
        category: 'all',
        store: 'all',
        searchQuery: ''
    },
    rawFeedFilters: {
        store: 'all',
        searchQuery: '',
        page: 1,
        pageSize: 40
    }
};

// UI Elements Cache
const elements = {};

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    setupTabNavigation();
    setupFilterListeners();
    setupSyncActionButtons();
    initFirestoreListeners();
});

function cacheDOMElements() {
    elements.tabs = document.querySelectorAll('.tab-btn');
    elements.tabContents = document.querySelectorAll('.tab-content');
    
    // Status Bar Elements
    elements.statusPill = document.getElementById('status-pill');
    elements.statusText = document.getElementById('status-text');
    elements.lastScanTime = document.getElementById('last-scan-time');
    elements.statDealsBeating = document.getElementById('stat-deals-beating');
    elements.statPriorityDeals = document.getElementById('stat-priority-deals');
    elements.statTotalTracked = document.getElementById('stat-total-tracked');

    // Controls
    elements.btnScanNow = document.getElementById('btn-scan-now');
    elements.btnRefreshBaselines = document.getElementById('btn-refresh-baselines');
    elements.btnExportCsv = document.getElementById('btn-export-csv');

    // Filter controls
    elements.filterBeats = document.getElementById('filter-beats');
    elements.filterPriority = document.getElementById('filter-priority');
    elements.filterCategory = document.getElementById('filter-category');
    elements.filterStore = document.getElementById('filter-store');
    elements.filterSearch = document.getElementById('filter-search');

    // Tables
    elements.priceBookBody = document.getElementById('pricebook-tbody');
    elements.rawFeedContainer = document.getElementById('raw-feed-container');
    elements.rawFeedSearch = document.getElementById('raw-feed-search');
    elements.rawFeedStore = document.getElementById('raw-feed-store');
    elements.rawFeedCount = document.getElementById('raw-feed-count');
    elements.watchlistBody = document.getElementById('watchlist-tbody');

    // Modals
    elements.trackModal = document.getElementById('track-item-modal');
    elements.trackForm = document.getElementById('track-item-form');
}

// ----------------------------------------------------
// Firestore Real-Time Subscriptions
// ----------------------------------------------------
function initFirestoreListeners() {
    // 1. Sync State Listener
    onSnapshot(doc(db, 'grocery_sync_state', 'current'), (docSnap) => {
        if (docSnap.exists()) {
            state.syncState = { ...state.syncState, ...docSnap.data() };
            updateSyncUI();
        }
    }, (err) => console.warn("Sync state listener note:", err));

    // 2. Watchlist Listener
    onSnapshot(collection(db, 'grocery_watchlist'), (snapshot) => {
        state.watchlist = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        // Populate category filter options dynamically
        updateCategoryOptions();
        renderAll();
    }, (err) => console.error("Watchlist listener error:", err));

    // 3. Current Ads Listener
    onSnapshot(collection(db, 'grocery_ads_current'), (snapshot) => {
        state.currentAds = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        updateStoreOptions();
        renderAll();
    }, (err) => console.error("Current ads listener error:", err));

    // 4. Weekly Raw Feed Listener
    onSnapshot(collection(db, 'grocery_weekly_raw_feed'), (snapshot) => {
        state.rawFeed = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderRawFeed();
    }, (err) => console.error("Raw feed listener error:", err));
}

// ----------------------------------------------------
// UI Renderers
// ----------------------------------------------------
function renderAll() {
    renderPriceBook();
    renderWatchlistTable();
    updateSummaryStats();
}

function updateSyncUI() {
    const isScanning = state.syncState.status === 'scanning' || state.syncState.trigger_request === 'processing';
    
    if (elements.statusText) {
        elements.statusText.textContent = isScanning ? 'Scanning Active...' : 'Idle / Up to Date';
    }
    if (elements.statusPill) {
        elements.statusPill.className = isScanning 
            ? 'badge bg-amber-100 text-amber-800 border border-amber-300 status-pulsing' 
            : 'badge bg-emerald-100 text-emerald-800 border border-emerald-300';
    }

    if (elements.lastScanTime && state.syncState.last_ad_scan) {
        const d = new Date(state.syncState.last_ad_scan);
        elements.lastScanTime.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (elements.btnScanNow) {
        elements.btnScanNow.disabled = isScanning;
        elements.btnScanNow.innerHTML = isScanning 
            ? `<i class="fas fa-spinner fa-spin mr-1"></i> Scanning...` 
            : `<i class="fas fa-satellite-dish mr-1"></i> Run Ad Scan Now`;
    }
}

function updateSummaryStats() {
    let dealsBeating = 0;
    let priorityDeals = 0;

    // Group current ads by watchlist item
    const adsByItem = {};
    for (const ad of state.currentAds) {
        if (!adsByItem[ad.watchlist_id]) adsByItem[ad.watchlist_id] = [];
        adsByItem[ad.watchlist_id].push(ad);
    }

    for (const item of state.watchlist) {
        const itemAds = adsByItem[item.id] || [];
        const beating = itemAds.some(a => a.beats_baseline);
        if (beating) {
            dealsBeating++;
            if (item.is_priority) priorityDeals++;
        }
    }

    if (elements.statDealsBeating) elements.statDealsBeating.textContent = dealsBeating;
    if (elements.statPriorityDeals) elements.statPriorityDeals.textContent = priorityDeals;
    if (elements.statTotalTracked) elements.statTotalTracked.textContent = state.watchlist.length;
}

// ----------------------------------------------------
// Tab 1: Price Book (Main Spreadsheet View)
// ----------------------------------------------------
function renderPriceBook() {
    if (!elements.priceBookBody) return;

    // Group current ads by watchlist_id
    const adsByItem = {};
    for (const ad of state.currentAds) {
        if (!adsByItem[ad.watchlist_id]) adsByItem[ad.watchlist_id] = [];
        adsByItem[ad.watchlist_id].push(ad);
    }

    // Apply Filters
    const filteredItems = state.watchlist.filter(item => {
        if (state.filters.priorityOnly && !item.is_priority) return false;
        if (state.filters.category !== 'all' && item.category !== state.filters.category) return false;

        const itemAds = adsByItem[item.id] || [];
        const hasBeatingDeal = itemAds.some(a => a.beats_baseline);
        if (state.filters.beatsBaselineOnly && !hasBeatingDeal) return false;

        if (state.filters.store !== 'all') {
            const hasStoreDeal = itemAds.some(a => (a.store || '').toLowerCase().includes(state.filters.store.toLowerCase()));
            if (!hasStoreDeal) return false;
        }

        if (state.filters.searchQuery) {
            const q = state.filters.searchQuery.toLowerCase();
            const matchName = (item.canonical_name || '').toLowerCase().includes(q);
            const matchBrand = (item.required_brands || []).some(b => b.toLowerCase().includes(q));
            if (!matchName && !matchBrand) return false;
        }

        return true;
    });

    if (filteredItems.length === 0) {
        elements.priceBookBody.innerHTML = `
            <tr>
                <td colspan="6" class="p-8 text-center text-slate-400">
                    <i class="fas fa-search text-3xl mb-2 text-slate-300"></i>
                    <p>No grocery items match the selected filters.</p>
                </td>
            </tr>`;
        return;
    }

    let html = '';

    const todayStr = new Date().toISOString().split('T')[0];

    for (const item of filteredItems) {
        const itemAds = adsByItem[item.id] || [];
        
        // Prioritize active sales over upcoming preview ads
        const activeDeals = itemAds.filter(a => {
            const fromStr = (a.valid_from || '').slice(0, 10);
            return !a.is_upcoming && (!fromStr || fromStr <= todayStr);
        });
        activeDeals.sort((a, b) => (a.normalized_unit_price || 999) - (b.normalized_unit_price || 999));

        const upcomingDeals = itemAds.filter(a => {
            const fromStr = (a.valid_from || '').slice(0, 10);
            return a.is_upcoming || (fromStr && fromStr > todayStr);
        });
        upcomingDeals.sort((a, b) => (a.normalized_unit_price || 999) - (b.normalized_unit_price || 999));

        const bestDeal = activeDeals[0] || upcomingDeals[0] || null;

        const isExpanded = state.expandedRows.has(item.id);
        const unit = item.target_unit || 'ea';
        const isStrict = item.brand_mode === 'strict';

        // Baseline HTML (Editable inline)
        const isEditingThisBaseline = state.editingBaselineId === item.id;
        const baselineVal = item.baseline_price_per_unit != null ? `$${item.baseline_price_per_unit.toFixed(2)}` : '--';
        
        let baselineHtml = '';
        if (isEditingThisBaseline) {
            baselineHtml = `
                <div class="flex items-center gap-1" onclick="event.stopPropagation()">
                    <input type="number" step="0.01" id="input-baseline-${item.id}" value="${item.baseline_price_per_unit || ''}" class="w-20 px-1 py-0.5 text-sm border rounded" />
                    <button onclick="saveInlineBaseline('${item.id}')" class="text-emerald-600 hover:text-emerald-700 px-1"><i class="fas fa-check"></i></button>
                    <button onclick="cancelInlineBaseline()" class="text-slate-400 hover:text-slate-600 px-1"><i class="fas fa-times"></i></button>
                </div>`;
        } else {
            baselineHtml = `
                <span class="editable-baseline font-semibold text-slate-700" onclick="event.stopPropagation(); startInlineBaseline('${item.id}')" title="Click to edit baseline">
                    ${baselineVal}<span class="text-xs text-slate-400">/${unit}</span>
                </span>
                <span class="text-[11px] block text-slate-400">${item.baseline_source || 'Walmart'}</span>`;
        }

        // Date window & upcoming badge for best deal
        let dateBadgeHtml = '';
        if (bestDeal) {
            const { windowStr, isUpcoming } = formatValidWindow(bestDeal.valid_from, bestDeal.valid_to);
            const displayWindow = bestDeal.date_window_str || windowStr;
            if (bestDeal.is_upcoming || isUpcoming) {
                dateBadgeHtml = `<span class="badge badge-upcoming" title="Upcoming Preview Deal"><i class="fas fa-clock"></i> ${displayWindow || 'Upcoming'}</span>`;
            } else if (displayWindow) {
                dateBadgeHtml = `<span class="badge badge-date" title="Sale Window"><i class="far fa-calendar-alt"></i> ${displayWindow}</span>`;
            }
        }

        // Best Sale Column HTML
        let bestSaleHtml = '';
        if (bestDeal && bestDeal.normalized_unit_price != null) {
            const beat = bestDeal.beats_baseline;
            const savingsPct = bestDeal.savings_pct ? `${bestDeal.savings_pct}% off` : '';
            const beatBadge = beat 
                ? `<span class="badge badge-beat ml-1"><i class="fas fa-arrow-down"></i> ${savingsPct || 'Beats Baseline'}</span>` 
                : '';

            bestSaleHtml = `
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-bold ${beat ? 'text-emerald-700 text-base' : 'text-slate-800'}">
                        $${bestDeal.normalized_unit_price.toFixed(2)}<span class="text-xs font-normal text-slate-500">/${unit}</span>
                    </span>
                    ${beatBadge}
                </div>
                <div class="flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span class="text-xs text-slate-500 font-medium">${bestDeal.store}</span>
                    ${dateBadgeHtml}
                </div>`;
        } else {
            bestSaleHtml = `<span class="text-slate-400 text-sm">No circular sale this week</span>`;
        }

        // Notes / Conditions HTML
        let notesHtml = '';
        if (bestDeal) {
            const badges = [];
            const { windowStr, isUpcoming } = formatValidWindow(bestDeal.valid_from, bestDeal.valid_to);
            if (bestDeal.is_upcoming || isUpcoming) {
                badges.push(`<span class="badge badge-upcoming"><i class="fas fa-clock"></i> ${bestDeal.date_window_str || windowStr || 'Upcoming'}</span>`);
            }
            if (bestDeal.is_bogo) {
                badges.push(`<span class="badge badge-bogo"><i class="fas fa-tag"></i> ${bestDeal.notes_str.includes('BOGO 1¢') ? 'BOGO 1¢' : 'BOGO Free'}</span>`);
            }
            if (bestDeal.is_digital_coupon) {
                badges.push(`<span class="badge badge-coupon"><i class="fas fa-ticket-alt"></i> Coupon</span>`);
            }
            for (const n of bestDeal.notes || []) {
                if (n.startsWith('Limit')) {
                    badges.push(`<span class="badge badge-limit">${n}</span>`);
                } else if (n.includes('pack') || n.includes('count') || n.includes('oz') || n.includes('lb')) {
                    if (!n.includes('BOGO') && !n.startsWith('Starts')) badges.push(`<span class="badge badge-store">${n}</span>`);
                }
            }
            notesHtml = badges.join(' ') || `<span class="text-xs text-slate-400">Standard pack</span>`;
        } else {
            notesHtml = `<span class="text-slate-400 font-medium">—</span>`;
        }

        // Historical Low HTML
        let histLowHtml = '';
        if (item.historical_low_price != null) {
            const isFuture = item.historical_low_date && item.historical_low_date > todayStr;
            histLowHtml = `
                <div class="font-semibold text-slate-800">$${item.historical_low_price.toFixed(2)}<span class="text-xs text-slate-400">/${unit}</span></div>
                <div class="text-[11px] ${isFuture ? 'text-amber-600 font-semibold' : 'text-slate-400'}">${item.historical_low_store || ''} (${item.historical_low_date || ''})</div>`;
        } else {
            histLowHtml = `<span class="text-slate-400 font-medium">—</span>`;
        }

        // Rolling Avg HTML
        const rollingAvgHtml = item.rolling_avg_price != null 
            ? `<span class="font-medium text-slate-700">$${item.rolling_avg_price.toFixed(2)}<span class="text-xs text-slate-400">/${unit}</span></span>` 
            : `<span class="text-slate-400 font-medium">—</span>`;

        // Item Header Column
        const starClass = item.is_priority ? 'fas fa-star star-active' : 'far fa-star star-inactive';
        const brandBadge = isStrict ? `<span class="badge badge-strict" title="Brand Strict Mode: ${(item.required_brands || []).join(', ')}"><i class="fas fa-lock"></i> Strict</span>` : '';

        html += `
            <tr class="hover:bg-slate-50/80 cursor-pointer transition-colors border-b border-slate-100 ${isExpanded ? 'bg-slate-50/60' : ''}" onclick="toggleRowExpand('${item.id}')">
                <td class="p-3.5 pl-4">
                    <div class="flex items-center gap-2.5">
                        <i class="${starClass} star-btn text-base" onclick="event.stopPropagation(); togglePriority('${item.id}', ${!item.is_priority})" title="${item.is_priority ? 'Priority Alert: ON (Click to toggle)' : 'Passive Tracking (Click to make priority alert)'}"></i>
                        <div>
                            <div class="font-bold text-slate-800 text-sm flex items-center gap-1.5 flex-wrap">
                                <span>${item.canonical_name}</span>
                                ${brandBadge}
                                <span class="badge badge-store text-[11px] py-0">${item.category}</span>
                            </div>
                            <div class="text-[11px] text-slate-400">Unit: ${unit}</div>
                        </div>
                    </div>
                </td>
                <td class="p-3.5">${baselineHtml}</td>
                <td class="p-3.5">${bestSaleHtml}</td>
                <td class="p-3.5">${notesHtml}</td>
                <td class="p-3.5">${histLowHtml}</td>
                <td class="p-3.5 pr-4 flex items-center justify-between">
                    <div>${rollingAvgHtml}</div>
                    <i class="fas fa-chevron-${isExpanded ? 'up' : 'down'} text-slate-300 text-xs ml-2"></i>
                </td>
            </tr>`;

        // Expanded Drawer showing ALL store deals for this item
        if (isExpanded) {
            let drawerContent = '';
            if (itemAds.length === 0) {
                drawerContent = `<div class="p-4 text-center text-slate-400 text-sm italic">No store advertised this item in circulars this week.</div>`;
            } else {
                drawerContent = `
                    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                        ${itemAds.map(ad => {
                            const { windowStr: adWin, isUpcoming: isAdUp } = formatValidWindow(ad.valid_from, ad.valid_to);
                            const adWinDisplay = ad.date_window_str || adWin;
                            const adDateBadge = (ad.is_upcoming || isAdUp)
                                ? `<span class="badge badge-upcoming text-[10px] py-0"><i class="fas fa-clock"></i> ${adWinDisplay || 'Upcoming'}</span>`
                                : (adWinDisplay ? `<span class="badge badge-date text-[10px] py-0"><i class="far fa-calendar-alt"></i> ${adWinDisplay}</span>` : '');

                            return `
                            <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex gap-3 items-center">
                                ${ad.image_url ? `<img src="${ad.image_url}" alt="" class="w-16 h-16 object-contain rounded-lg bg-slate-50 border p-1" />` : `<div class="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300"><i class="fas fa-shopping-basket text-xl"></i></div>`}
                                <div class="flex-1 min-w-0">
                                    <div class="flex justify-between items-start">
                                        <div class="font-bold text-xs text-slate-500 uppercase truncate">${ad.store}</div>
                                        <div class="flex items-center gap-1">
                                            ${adDateBadge}
                                            ${ad.beats_baseline ? `<span class="badge badge-beat text-[10px] py-0">Beats Baseline</span>` : ''}
                                        </div>
                                    </div>
                                    <div class="font-semibold text-sm text-slate-800 truncate" title="${ad.raw_name}">${ad.raw_name}</div>
                                    <div class="text-sm font-bold text-emerald-600 mt-0.5">
                                        $${(ad.normalized_unit_price || 0).toFixed(2)}<span class="text-xs font-normal text-slate-500">/${unit}</span>
                                        ${ad.effective_price && ad.effective_price !== ad.normalized_unit_price ? `<span class="text-xs font-normal text-slate-400">($${ad.effective_price.toFixed(2)} pack)</span>` : ''}
                                    </div>
                                    <div class="text-[11px] text-slate-500 truncate">${ad.notes_str || ad.raw_description || ''}</div>
                                </div>
                            </div>
                        `}).join('')}
                    </div>`;
            }

            html += `
                <tr class="bg-slate-50 border-b border-slate-200">
                    <td colspan="6" class="p-0">
                        <div class="store-drawer open bg-slate-50 border-t border-dashed border-slate-200">
                            ${drawerContent}
                        </div>
                    </td>
                </tr>`;
        }
    }

    elements.priceBookBody.innerHTML = html;
}

// ----------------------------------------------------
// Tab 2: Browse This Week's Raw Ads (1-Click Track)
// ----------------------------------------------------
function renderRawFeed() {
    if (!elements.rawFeedContainer) return;

    let items = state.rawFeed;

    // Filters
    if (state.rawFeedFilters.store !== 'all') {
        items = items.filter(it => (it.merchant || '').toLowerCase().includes(state.rawFeedFilters.store.toLowerCase()));
    }

    if (state.rawFeedFilters.searchQuery) {
        const q = state.rawFeedFilters.searchQuery.toLowerCase();
        items = items.filter(it => (it.name || '').toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q));
    }

    if (elements.rawFeedCount) {
        elements.rawFeedCount.textContent = `${items.length} circular items`;
    }

    // Populate store filter dropdown if empty
    populateRawStoreFilter();

    if (items.length === 0) {
        elements.rawFeedContainer.innerHTML = `
            <div class="col-span-full p-12 text-center text-slate-400">
                <i class="fas fa-newspaper text-4xl mb-3 text-slate-300"></i>
                <p>No circular items match your search. Make sure a scan has completed!</p>
            </div>`;
        return;
    }

    const pageSize = state.rawFeedFilters.pageSize;
    const paginated = items.slice(0, pageSize);

    elements.rawFeedContainer.innerHTML = paginated.map(it => {
        const priceDisplay = it.price ? `$${parseFloat(it.price).toFixed(2)}` : (it.price_text || 'See ad');
        return `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col justify-between hover:border-emerald-300 transition-all group">
                <div>
                    <div class="flex justify-between items-start mb-2">
                        <span class="badge badge-store text-xs font-semibold">${it.merchant || 'Store'}</span>
                        <span class="font-extrabold text-emerald-600 text-base">${priceDisplay}</span>
                    </div>
                    <div class="flex gap-3 mb-3">
                        ${it.image_url ? `<img src="${it.image_url}" alt="" class="w-14 h-14 object-contain rounded-lg border bg-slate-50 p-1 flex-shrink-0" />` : `<div class="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300 flex-shrink-0"><i class="fas fa-shopping-basket"></i></div>`}
                        <div class="min-w-0">
                            <h4 class="font-bold text-slate-800 text-sm line-clamp-2 leading-snug group-hover:text-emerald-700 transition-colors">${it.name || ''}</h4>
                            <p class="text-xs text-slate-500 mt-1 line-clamp-2">${it.description || it.sale_story || ''}</p>
                        </div>
                    </div>
                </div>
                <button onclick="openTrackModalFromRaw('${it.id}')" class="w-full mt-2 py-2 px-3 bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 border border-emerald-200 hover:border-emerald-600">
                    <i class="fas fa-plus"></i> + Track Item
                </button>
            </div>
        `;
    }).join('');
}

function populateRawStoreFilter() {
    if (!elements.rawFeedStore || elements.rawFeedStore.children.length > 1) return;
    const stores = Array.from(new Set(state.rawFeed.map(it => it.merchant).filter(Boolean))).sort();
    for (const s of stores) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        elements.rawFeedStore.appendChild(opt);
    }
}

// ----------------------------------------------------
// Tab 3: Manage Watchlist & Sync Controls
// ----------------------------------------------------
function renderWatchlistTable() {
    if (!elements.watchlistBody) return;

    if (state.watchlist.length === 0) {
        elements.watchlistBody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-slate-400">
                    No watchlist items tracked yet.
                </td>
            </tr>`;
        return;
    }

    elements.watchlistBody.innerHTML = state.watchlist.map(item => {
        const starClass = item.is_priority ? 'fas fa-star star-active' : 'far fa-star star-inactive';
        const brandBadge = item.brand_mode === 'strict' 
            ? `<span class="badge badge-strict">Strict: ${(item.required_brands || []).join(', ')}</span>` 
            : `<span class="badge badge-store">Any</span>`;

        return `
            <tr class="hover:bg-slate-50 border-b border-slate-100 text-sm">
                <td class="p-3 pl-4">
                    <i class="${starClass} star-btn text-base" onclick="togglePriority('${item.id}', ${!item.is_priority})"></i>
                </td>
                <td class="p-3 font-bold text-slate-800">${item.canonical_name}</td>
                <td class="p-3"><span class="badge badge-store">${item.category}</span></td>
                <td class="p-3 font-semibold text-slate-700">${brandBadge}</td>
                <td class="p-3">${item.target_unit || 'ea'}</td>
                <td class="p-3 font-semibold text-slate-800">$${(item.baseline_price_per_unit || 0).toFixed(2)}</td>
                <td class="p-3 pr-4 text-right">
                    <button onclick="editWatchlistItem('${item.id}')" class="text-indigo-600 hover:text-indigo-800 p-1.5" title="Edit Rule"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteWatchlistItem('${item.id}')" class="text-rose-500 hover:text-rose-700 p-1.5 ml-1" title="Delete"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

// ----------------------------------------------------
// 1-Click Track Modal Handlers
// ----------------------------------------------------
window.openTrackModalFromRaw = (rawId) => {
    const raw = state.rawFeed.find(r => r.id === rawId);
    if (!raw) return;

    // Auto-detect unit and category
    let unit = 'ea';
    let cat = 'Cereal/Pantry';
    const text = `${raw.name || ''} ${raw.description || ''}`.toLowerCase();

    if (text.includes('beef') || text.includes('chicken') || text.includes('pork') || text.includes('turkey') || text.includes('sausage') || text.includes('bacon')) {
        cat = 'Meat';
        unit = 'lb';
    } else if (text.includes('milk') || text.includes('cheese') || text.includes('butter') || text.includes('yogurt') || text.includes('cream')) {
        cat = 'Dairy';
        unit = text.includes('milk') ? 'gal' : 'oz';
    } else if (text.includes('apple') || text.includes('potato') || text.includes('onion') || text.includes('salad') || text.includes('tomato')) {
        cat = 'Produce';
        unit = 'lb';
    } else if (text.includes('detergent') || text.includes('paper') || text.includes('bath') || text.includes('soap') || text.includes('pods') || text.includes('cleaner')) {
        cat = 'Household';
        unit = 'ct';
    }

    const price = raw.current_price !== undefined ? raw.current_price : raw.price;
    const numPrice = price ? parseFloat(price) : 0;

    document.getElementById('modal-raw-id').value = rawId;
    document.getElementById('modal-canonical-name').value = raw.name || '';
    document.getElementById('modal-category').value = cat;
    document.getElementById('modal-target-unit').value = unit;
    document.getElementById('modal-baseline').value = (numPrice * 1.15).toFixed(2); // estimated baseline
    document.getElementById('modal-brand-mode').value = 'any';
    document.getElementById('modal-required-brands').value = raw.brand || '';
    document.getElementById('modal-priority').checked = false;
    document.getElementById('modal-include-kw').value = raw.name || '';
    document.getElementById('modal-exclude-kw').value = '';

    elements.trackModal.classList.remove('hidden');
};

window.closeTrackModal = () => {
    if (elements.trackModal) elements.trackModal.classList.add('hidden');
};

window.saveTrackedItemFromModal = async (e) => {
    e.preventDefault();

    const name = document.getElementById('modal-canonical-name').value.trim();
    if (!name) return;

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const cat = document.getElementById('modal-category').value;
    const unit = document.getElementById('modal-target-unit').value;
    const baseline = parseFloat(document.getElementById('modal-baseline').value) || 0;
    const brandMode = document.getElementById('modal-brand-mode').value;
    const brands = document.getElementById('modal-required-brands').value.split(',').map(b => b.trim()).filter(Boolean);
    const priority = document.getElementById('modal-priority').checked;
    const includeKw = document.getElementById('modal-include-kw').value.split(',').map(k => k.trim()).filter(Boolean);
    const excludeKw = document.getElementById('modal-exclude-kw').value.split(',').map(k => k.trim()).filter(Boolean);

    const newItem = {
        id: slug,
        canonical_name: name,
        category: cat,
        target_unit: unit,
        baseline_price_per_unit: baseline,
        baseline_source: "Walmart",
        baseline_updated_at: new Date().toISOString(),
        brand_mode: brandMode,
        required_brands: brands,
        is_priority: priority,
        include_keywords: includeKw,
        exclude_keywords: excludeKw,
        default_package_size: 1.0,
        historical_low_price: null,
        historical_low_store: null,
        historical_low_date: null,
        rolling_avg_price: baseline
    };

    try {
        // 1. Save to Firestore grocery_watchlist
        await setDoc(doc(db, 'grocery_watchlist', slug), newItem);
        console.log(`Saved new watchlist item: ${slug}`);

        // 2. Immediately match against raw feed in memory!
        const matchedDeals = [];
        for (const raw of state.rawFeed) {
            const matches = evaluateRawItem(raw, [newItem]);
            matchedDeals.push(...matches);
        }

        // Save matched deals to grocery_ads_current so it pops straight into the Price Book!
        for (const deal of matchedDeals) {
            const storeSlug = (deal.store || 'store').toLowerCase().replace(/[^a-z0-9]/g, '_');
            const docId = `${deal.watchlist_id}_${storeSlug}_${deal.item_id}`;
            await setDoc(doc(db, 'grocery_ads_current', docId), { ...deal, id: docId });
        }

        closeTrackModal();
        showToast(`Added "${name}" to Watchlist! Matched ${matchedDeals.length} current sales.`);
        
        // Switch to Price Book to see it immediately!
        switchTab('pricebook');
    } catch (err) {
        console.error("Error adding tracked item:", err);
        alert("Error saving item: " + err.message);
    }
};

// ----------------------------------------------------
// Inline Baseline Editing
// ----------------------------------------------------
window.startInlineBaseline = (itemId) => {
    state.editingBaselineId = itemId;
    renderPriceBook();
    setTimeout(() => {
        const inp = document.getElementById(`input-baseline-${itemId}`);
        if (inp) {
            inp.focus();
            inp.select();
        }
    }, 50);
};

window.cancelInlineBaseline = () => {
    state.editingBaselineId = null;
    renderPriceBook();
};

window.saveInlineBaseline = async (itemId) => {
    const inp = document.getElementById(`input-baseline-${itemId}`);
    if (!inp) return;
    const newPrice = parseFloat(inp.value);
    if (isNaN(newPrice) || newPrice < 0) return;

    try {
        await updateDoc(doc(db, 'grocery_watchlist', itemId), {
            baseline_price_per_unit: newPrice,
            baseline_updated_at: new Date().toISOString()
        });
        state.editingBaselineId = null;
        showToast("Baseline price updated!");
    } catch (err) {
        console.error("Error updating baseline:", err);
    }
};

// ----------------------------------------------------
// Priority Star Toggle
// ----------------------------------------------------
window.togglePriority = async (itemId, newStatus) => {
    try {
        await updateDoc(doc(db, 'grocery_watchlist', itemId), {
            is_priority: newStatus
        });
        showToast(`Priority alert ${newStatus ? 'activated' : 'deactivated'}.`);
    } catch (err) {
        console.error("Error toggling priority:", err);
    }
};

// ----------------------------------------------------
// Row Accordion Toggle
// ----------------------------------------------------
window.toggleRowExpand = (itemId) => {
    if (state.expandedRows.has(itemId)) {
        state.expandedRows.delete(itemId);
    } else {
        state.expandedRows.add(itemId);
    }
    renderPriceBook();
};

// ----------------------------------------------------
// Watchlist Management CRUD
// ----------------------------------------------------
window.deleteWatchlistItem = async (itemId) => {
    if (!confirm(`Are you sure you want to stop tracking "${itemId}"?`)) return;
    try {
        await deleteDoc(doc(db, 'grocery_watchlist', itemId));
        showToast("Watchlist item deleted.");
    } catch (err) {
        console.error("Error deleting item:", err);
    }
};

window.editWatchlistItem = (itemId) => {
    const item = state.watchlist.find(w => w.id === itemId);
    if (!item) return;

    document.getElementById('modal-raw-id').value = '';
    document.getElementById('modal-canonical-name').value = item.canonical_name;
    document.getElementById('modal-category').value = item.category || 'Meat';
    document.getElementById('modal-target-unit').value = item.target_unit || 'lb';
    document.getElementById('modal-baseline').value = item.baseline_price_per_unit || '';
    document.getElementById('modal-brand-mode').value = item.brand_mode || 'any';
    document.getElementById('modal-required-brands').value = (item.required_brands || []).join(', ');
    document.getElementById('modal-priority').checked = !!item.is_priority;
    document.getElementById('modal-include-kw').value = (item.include_keywords || []).join(', ');
    document.getElementById('modal-exclude-kw').value = (item.exclude_keywords || []).join(', ');

    elements.trackModal.classList.remove('hidden');
};

// ----------------------------------------------------
// Sync Action Controls
// ----------------------------------------------------
function setupSyncActionButtons() {
    if (elements.btnScanNow) {
        elements.btnScanNow.addEventListener('click', async () => {
            try {
                await setDoc(doc(db, 'grocery_sync_state', 'current'), {
                    trigger_request: 'scan_ads'
                }, { merge: true });
                showToast("Ad scan requested! The local Windows worker will start scraping now.");
            } catch (err) {
                console.error("Error requesting ad scan:", err);
            }
        });
    }

    if (elements.btnRefreshBaselines) {
        elements.btnRefreshBaselines.addEventListener('click', async () => {
            try {
                await setDoc(doc(db, 'grocery_sync_state', 'current'), {
                    trigger_request: 'refresh_baselines'
                }, { merge: true });
                showToast("Baseline refresh requested!");
            } catch (err) {
                console.error("Error requesting baseline refresh:", err);
            }
        });
    }

    if (elements.btnExportCsv) {
        elements.btnExportCsv.addEventListener('click', exportPriceBookToCSV);
    }
}

// ----------------------------------------------------
// Export CSV Feature
// ----------------------------------------------------
function exportPriceBookToCSV() {
    const rows = [
        ["Item Name", "Category", "Priority", "Brand Mode", "Unit", "Baseline Price", "Baseline Source", "Current Best Store", "Current Unit Price", "Beats Baseline", "Savings", "Notes", "Historical Low", "Historical Low Store", "Rolling Avg"]
    ];

    const adsByItem = {};
    for (const ad of state.currentAds) {
        if (!adsByItem[ad.watchlist_id]) adsByItem[ad.watchlist_id] = [];
        adsByItem[ad.watchlist_id].push(ad);
    }

    for (const item of state.watchlist) {
        const itemAds = adsByItem[item.id] || [];
        itemAds.sort((a, b) => (a.normalized_unit_price || 999) - (b.normalized_unit_price || 999));
        const best = itemAds[0] || {};

        rows.push([
            `"${item.canonical_name}"`,
            item.category,
            item.is_priority ? "Yes" : "No",
            item.brand_mode,
            item.target_unit,
            item.baseline_price_per_unit || "",
            item.baseline_source || "Walmart",
            `"${best.store || ''}"`,
            best.normalized_unit_price || "",
            best.beats_baseline ? "YES" : "NO",
            best.savings_amount || "",
            `"${best.notes_str || ''}"`,
            item.historical_low_price || "",
            `"${item.historical_low_store || ''}"`,
            item.rolling_avg_price || ""
        ]);
    }

    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `monroe_grocery_price_book_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ----------------------------------------------------
// Tab & Filter Setup
// ----------------------------------------------------
function setupTabNavigation() {
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            switchTab(target);
        });
    });
}

window.switchTab = (target) => {
    state.currentTab = target;
    elements.tabs.forEach(t => {
        if (t.dataset.tab === target) {
            t.classList.add('active', 'border-emerald-600', 'text-emerald-700', 'font-bold');
            t.classList.remove('text-slate-500', 'border-transparent');
        } else {
            t.classList.remove('active', 'border-emerald-600', 'text-emerald-700', 'font-bold');
            t.classList.add('text-slate-500', 'border-transparent');
        }
    });

    elements.tabContents.forEach(c => {
        if (c.id === `tab-${target}`) {
            c.classList.remove('hidden');
        } else {
            c.classList.add('hidden');
        }
    });

    if (target === 'rawfeed') renderRawFeed();
};

function setupFilterListeners() {
    if (elements.filterBeats) {
        elements.filterBeats.addEventListener('change', (e) => {
            state.filters.beatsBaselineOnly = e.target.checked;
            renderPriceBook();
        });
    }

    if (elements.filterPriority) {
        elements.filterPriority.addEventListener('change', (e) => {
            state.filters.priorityOnly = e.target.checked;
            renderPriceBook();
        });
    }

    if (elements.filterCategory) {
        elements.filterCategory.addEventListener('change', (e) => {
            state.filters.category = e.target.value;
            renderPriceBook();
        });
    }

    if (elements.filterStore) {
        elements.filterStore.addEventListener('change', (e) => {
            state.filters.store = e.target.value;
            renderPriceBook();
        });
    }

    if (elements.filterSearch) {
        elements.filterSearch.addEventListener('input', (e) => {
            state.filters.searchQuery = e.target.value.trim();
            renderPriceBook();
        });
    }

    // Raw Feed filters
    if (elements.rawFeedSearch) {
        elements.rawFeedSearch.addEventListener('input', (e) => {
            state.rawFeedFilters.searchQuery = e.target.value.trim();
            renderRawFeed();
        });
    }

    if (elements.rawFeedStore) {
        elements.rawFeedStore.addEventListener('change', (e) => {
            state.rawFeedFilters.store = e.target.value;
            renderRawFeed();
        });
    }
}

function updateCategoryOptions() {
    if (!elements.filterCategory) return;
    const currentVal = elements.filterCategory.value;
    const cats = Array.from(new Set(state.watchlist.map(w => w.category).filter(Boolean))).sort();
    elements.filterCategory.innerHTML = `<option value="all">All Categories</option>` + 
        cats.map(c => `<option value="${c}" ${c === currentVal ? 'selected' : ''}>${c}</option>`).join('');
}

function updateStoreOptions() {
    if (!elements.filterStore) return;
    const currentVal = elements.filterStore.value;
    const stores = Array.from(new Set(state.currentAds.map(a => a.store).filter(Boolean))).sort();
    elements.filterStore.innerHTML = `<option value="all">All Stores</option>` + 
        stores.map(s => `<option value="${s}" ${s === currentVal ? 'selected' : ''}>${s}</option>`).join('');
}

// ----------------------------------------------------
// Toast Notification
// ----------------------------------------------------
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-5 right-5 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg text-sm z-50 flex items-center gap-2 border border-slate-700 animate-fade-in';
    toast.innerHTML = `<i class="fas fa-check-circle text-emerald-400"></i> <span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
