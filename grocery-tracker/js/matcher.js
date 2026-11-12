// Client-side Two-Tier Watchlist Filtering & Brand Locking Engine
import { normalizeDeal, extractPackageSizeAndUnit } from './normalizer.js';

export function getLocalTodayStr(dateObj = new Date()) {
    const d = dateObj instanceof Date && !isNaN(dateObj) ? dateObj : new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function cleanText(text) {
    if (!text) return '';
    return String(text).toLowerCase()
        .replace(/[’`]/g, "'")
        .replace(/[“”]/g, '"')
        .trim();
}

export function matchesKeyword(text, keyword) {
    const kw = cleanText(keyword);
    if (!kw) return false;
    // Word boundary or punctuation match
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['']?");
    const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
    return pattern.test(text);
}

export function formatValidWindow(validFrom, validTo) {
    if (!validFrom && !validTo) return { windowStr: null, isUpcoming: false, isExpired: false };
    const todayStr = getLocalTodayStr();
    const fromStr = validFrom ? String(validFrom).slice(0, 10) : null;
    const toStr = validTo ? String(validTo).slice(0, 10) : null;

    if (fromStr && fromStr > todayStr) {
        const parts = fromStr.split('-');
        const mmDd = parts.length === 3 ? `${parts[1]}/${parts[2]}` : fromStr;
        return { windowStr: `Starts ${mmDd}`, isUpcoming: true, isExpired: false };
    }

    if (toStr && toStr < todayStr) {
        const tParts = toStr.split('-');
        const mmDd = tParts.length === 3 ? `${tParts[1]}/${tParts[2]}` : toStr;
        return { windowStr: `Expired ${mmDd}`, isUpcoming: false, isExpired: true };
    }

    if (fromStr && toStr) {
        const fParts = fromStr.split('-');
        const tParts = toStr.split('-');
        const windowStr = (fParts.length === 3 && tParts.length === 3)
            ? `${fParts[1]}/${fParts[2]}–${tParts[1]}/${tParts[2]}`
            : `${fromStr}–${toStr}`;
        return { windowStr, isUpcoming: false, isExpired: false };
    } else if (toStr) {
        const tParts = toStr.split('-');
        const windowStr = tParts.length === 3 ? `Thru ${tParts[1]}/${tParts[2]}` : `Thru ${toStr}`;
        return { windowStr, isUpcoming: false, isExpired: false };
    } else if (fromStr) {
        const fParts = fromStr.split('-');
        const windowStr = fParts.length === 3 ? `From ${fParts[1]}/${fParts[2]}` : `From ${fromStr}`;
        return { windowStr, isUpcoming: false, isExpired: false };
    }
    return { windowStr: null, isUpcoming: false, isExpired: false };
}

export function itemMatchesWatchlist(rawItem, watchlistItem) {
    const name = cleanText(rawItem.name);
    const desc = cleanText(rawItem.description);
    const brand = cleanText(rawItem.brand);
    const fullText = `${name} ${desc} ${brand}`;

    // 1. Brand Locking (Strict Mode)
    const brandMode = (watchlistItem.brand_mode || 'any').toLowerCase();
    const requiredBrands = watchlistItem.required_brands || [];

    if (brandMode === 'strict') {
        if (!requiredBrands || requiredBrands.length === 0) return false;
        const brandMatched = requiredBrands.some(b => matchesKeyword(fullText, b));
        if (!brandMatched) return false;
    }

    // 2. Exclude Keywords
    const excludeKeywords = watchlistItem.exclude_keywords || [];
    for (const ex of excludeKeywords) {
        if (matchesKeyword(fullText, ex)) return false;
    }

    // 3. Include Keywords
    const includeKeywords = watchlistItem.include_keywords || [];
    if (includeKeywords.length > 0) {
        const includeMatched = includeKeywords.some(inc => matchesKeyword(fullText, inc));
        if (!includeMatched) return false;
    } else {
        // Fallback: match canonical name words
        const canonical = cleanText(watchlistItem.canonical_name);
        const words = canonical.split(/\s+/).filter(w => w.length > 2 && !['and', 'the', 'for', 'with'].includes(w));
        if (words.length > 0 && !words.every(w => matchesKeyword(fullText, w))) {
            return false;
        }
    }

    // 4. Container & Unit Guardrails for Target Units
    const targetUnit = (watchlistItem.target_unit || '').toLowerCase();
    if (targetUnit === 'gal') {
        const { size: extractedSize, unit: extractedUnit } = extractPackageSizeAndUnit(fullText, targetUnit);

        // Reject dry weight measurements (lb, lbs, g)
        if (['lb', 'g'].includes(extractedUnit)) return false;

        // Reject small ounce canisters/cartons (< 120 oz)
        if (extractedUnit === 'oz' && extractedSize !== null && extractedSize < 120.0) return false;

        // Reject sub-gallon sizes (half gallon, quart, pint)
        if (extractedUnit === 'gal' && extractedSize !== null && extractedSize < 0.9) return false;

        // Reject explicit sub-gallon or dry weight patterns in text
        const subGallonPatterns = [
            /\b(?:half|1\/2)\s*(?:-| )?gal(?:lon)?\b/i,
            /\bquart\b|\bqt\b/i,
            /\bpint\b|\bpt\b/i,
            /\b\d+(?:\.\d+)?\s*(?:-| )?(?:lb|lbs|pounds?|g|grams?)\b/i,
            /\b(?:[1-9]|[1-9]\d|1[0-1]\d)(?:\.\d+)?\s*(?:-| )?(?:fl\.?\s*oz|oz|ounces?)\b/i
        ];
        for (const pat of subGallonPatterns) {
            if (pat.test(fullText)) return false;
        }
    }

    return true;
}

export function evaluateRawItem(rawItem, watchlist) {
    const matchedDeals = [];

    for (const wItem of watchlist) {
        if (itemMatchesWatchlist(rawItem, wItem)) {
            const math = normalizeDeal(rawItem, wItem);
            const baseline = wItem.baseline_price_per_unit || null;
            const unitPrice = math.normalized_unit_price;

            let beatsBaseline = false;
            let savingsAmount = 0.0;
            let savingsPct = 0.0;

            if (baseline && baseline > 0 && unitPrice !== null && Number.isFinite(unitPrice) && unitPrice < baseline) {
                beatsBaseline = true;
                savingsAmount = parseFloat((baseline - unitPrice).toFixed(4));
                savingsPct = parseFloat((((baseline - unitPrice) / baseline) * 100).toFixed(1));
            }

            const { windowStr, isUpcoming, isExpired } = formatValidWindow(rawItem.valid_from, rawItem.valid_to);
            const notesList = [...(math.notes || [])];
            if (isUpcoming && windowStr) {
                notesList.push(windowStr);
            }

            matchedDeals.push({
                watchlist_id: wItem.id,
                canonical_name: wItem.canonical_name,
                category: wItem.category,
                is_priority: !!wItem.is_priority,
                brand_mode: wItem.brand_mode,
                required_brands: wItem.required_brands || [],
                store: rawItem.merchant || rawItem.store || 'Store',
                store_id: rawItem.merchant_id || rawItem.store_id || '',
                flyer_id: rawItem.flyer_id || '',
                item_id: rawItem.id || rawItem.raw_id,
                raw_name: rawItem.name,
                raw_description: rawItem.description,
                raw_price: rawItem.current_price !== undefined ? rawItem.current_price : rawItem.price,
                sale_story: rawItem.sale_story,
                image_url: rawItem.image_url,
                valid_from: rawItem.valid_from,
                valid_to: rawItem.valid_to,
                date_window_str: windowStr,
                is_upcoming: isUpcoming,
                is_expired: isExpired,
                target_unit: math.target_unit,
                normalized_unit_price: unitPrice,
                effective_price: math.effective_price,
                baseline_price_per_unit: baseline,
                baseline_source: wItem.baseline_source || 'Walmart',
                beats_baseline: beatsBaseline,
                savings_amount: savingsAmount,
                savings_pct: savingsPct,
                is_bogo: math.is_bogo,
                is_estimated_bogo: math.is_estimated_bogo,
                is_digital_coupon: math.is_digital_coupon,
                notes: notesList,
                notes_str: notesList.join(' | ')
            });
        }
    }

    return matchedDeals;
}

export function computeWatchlistStatsFromDeals(deals, currentItem = {}) {
    const validDeals = (deals || []).filter(d => 
        d && 
        d.normalized_unit_price !== null && 
        Number.isFinite(d.normalized_unit_price) && 
        d.normalized_unit_price > 0 &&
        !d.is_upcoming
    );

    let histLowPrice = currentItem.historical_low_price !== undefined ? currentItem.historical_low_price : null;
    let histLowStore = currentItem.historical_low_store || null;
    let histLowDate = currentItem.historical_low_date || null;

    if (validDeals.length > 0) {
        const sorted = [...validDeals].sort((a, b) => a.normalized_unit_price - b.normalized_unit_price);
        const bestDeal = sorted[0];

        if (histLowPrice === null || bestDeal.normalized_unit_price < histLowPrice) {
            histLowPrice = bestDeal.normalized_unit_price;
            histLowStore = bestDeal.store || 'Unknown Store';
            histLowDate = bestDeal.valid_from ? String(bestDeal.valid_from).slice(0, 10) : getLocalTodayStr();
        }
    }

    const prices = validDeals.map(d => d.normalized_unit_price);
    let rollingAvg = currentItem.rolling_avg_price !== undefined ? currentItem.rolling_avg_price : null;
    if (prices.length > 0) {
        const sum = prices.reduce((acc, p) => acc + p, 0);
        rollingAvg = parseFloat((sum / prices.length).toFixed(4));
    }

    return {
        historical_low_price: histLowPrice,
        historical_low_store: histLowStore,
        historical_low_date: histLowDate,
        rolling_avg_price: rollingAvg
    };
}
