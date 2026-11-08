// Client-side Two-Tier Watchlist Filtering & Brand Locking Engine
import { normalizeDeal, extractPackageSizeAndUnit } from './normalizer.js';

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
        const { size: extractedSize, unit: extractedUnit } = extractPackageSizeAndUnit(fullText);

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

            if (baseline && unitPrice !== null && unitPrice < baseline) {
                beatsBaseline = true;
                savingsAmount = parseFloat((baseline - unitPrice).toFixed(4));
                savingsPct = parseFloat((((baseline - unitPrice) / baseline) * 100).toFixed(1));
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
                notes: math.notes,
                notes_str: math.notes_str
            });
        }
    }

    return matchedDeals;
}
