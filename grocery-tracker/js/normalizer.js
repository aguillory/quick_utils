// Client-side Unit Price Normalization & Deal Math Engine
// Matches the logic in Python normalizer.py with edge-case & unit-conversion fixes

const GRAMS_PER_LB = 453.59237;
const GRAMS_PER_OZ = 28.349523125;
const FL_OZ_PER_GAL = 128.0;
const OZ_PER_LB = 16.0;

export function parseNumeric(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') {
        return Number.isFinite(val) && val > 0 ? val : null;
    }

    const s = String(val).replace(/,/g, '').trim();
    if (!s) return null;

    // Detect explicit cent pricing without dollar sign (e.g., "99¢", "79 cents", "89¢/lb")
    if (!s.includes('$')) {
        const mCents = s.match(/(?:^|\s)(\d{1,3})\s*(?:¢|cents?\b)/i);
        if (mCents) {
            const centsVal = parseFloat(mCents[1]) / 100.0;
            return Number.isFinite(centsVal) && centsVal > 0 ? parseFloat(centsVal.toFixed(4)) : null;
        }
    }

    const m = s.match(/\$?\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const parsed = parseFloat(m[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function extractMultiBuy(text) {
    if (!text) return null;
    // 2/$5 or 2 / $5.00
    const mSlash = text.match(/\b(\d{1,2})\s*\/\s*\$\s*(\d+(?:\.\d+)?)\b/i);
    if (mSlash) {
        const qty = parseInt(mSlash[1], 10);
        const total = parseFloat(mSlash[2]);
        if (Number.isFinite(qty) && qty > 1 && qty <= 20 && Number.isFinite(total) && total > 0) {
            return { qty, total };
        }
    }

    // 3 for $10
    const mFor = text.match(/\b(\d{1,2})\s+for\s+\$?\s*(\d+(?:\.\d+)?)\b/i);
    if (mFor) {
        const qty = parseInt(mFor[1], 10);
        const total = parseFloat(mFor[2]);
        if (Number.isFinite(qty) && qty > 1 && qty <= 20 && Number.isFinite(total) && total > 0 && total <= 100) {
            return { qty, total };
        }
    }
    return null;
}

export function extractLimit(text) {
    if (!text) return null;
    const m = text.match(/\blimit\s*(?:of\s*)?(\d+)\b/i);
    return m ? parseInt(m[1], 10) : null;
}

export function extractPackageRange(text) {
    if (!text) return null;
    // Range pattern: e.g. 10-16 lbs, 10 to 16 lbs, 10 - 16 lb, 10 lbs - 16 lbs
    const pattern = /(?:^|[^\/])\b(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?|fl(?:uid)?\.?\s*oz|oz|ounces?|g|grams?|ct|count|pods?|pacs?|tabs?|capsules?|gal(?:lon)?s?)?\s*(?:-|–|—|\bto\b)\s*(\d+(?:\.\d+)?)\s*(?:-| )?(lbs?|pounds?|fl(?:uid)?\.?\s*oz|oz|ounces?|g|grams?|ct|count|pods?|pacs?|tabs?|capsules?|gal(?:lon)?s?)\b(?!\/)/i;
    const m = text.match(pattern);
    if (!m) return null;
    const minVal = parseFloat(m[1]);
    const maxVal = parseFloat(m[2]);
    const rawUnit = m[3].toLowerCase();
    if (Number.isFinite(minVal) && Number.isFinite(maxVal) && minVal > 0 && maxVal > minVal) {
        let unit = rawUnit;
        if (/lbs?|pounds?/i.test(rawUnit)) unit = 'lb';
        else if (/fl(?:uid)?\.?\s*oz|oz|ounces?/i.test(rawUnit)) unit = 'oz';
        else if (/g|grams?/i.test(rawUnit)) unit = 'g';
        else if (/ct|count|pods?|pacs?|tabs?|capsules?/i.test(rawUnit)) unit = 'ct';
        else if (/gal(?:lon)?s?/i.test(rawUnit)) unit = 'gal';

        const midpoint = (minVal + maxVal) / 2.0;
        const fmt = (n) => Number(n.toFixed(2)).toString();
        const note = `${fmt(minVal)}-${fmt(maxVal)} ${unit} range (avg ${fmt(midpoint)} ${unit})`;
        return {
            minVal,
            maxVal,
            midpoint,
            unit,
            note
        };
    }
    return null;
}

export function extractPackageSizeAndUnit(text, targetUnit = null) {
    if (!text) return { size: null, unit: null };

    // 0. Check weight/count ranges first (e.g. 10-16 lbs -> midpoint 13.0 lbs)
    const r = extractPackageRange(text);
    if (r) {
        return { size: r.midpoint, unit: r.unit };
    }

    const t = text.toLowerCase();

    // If target unit is count (ct), prioritize extracting count/pack to avoid shadowing by ounce descriptors
    // (e.g., "Cascade Platinum Plus 12 pk 12 oz" -> extracts 12 ct when targetUnit is ct)
    if (targetUnit === 'ct') {
        const mCtDirect = t.match(/(\d+)\s*(?:-| )?(?:ct|count|pods?|pacs?|tabs?|capsules?)\b/i);
        if (mCtDirect) return { size: parseInt(mCtDirect[1], 10), unit: 'ct' };
        const mPkDirect = t.match(/(\d+)\s*(?:-| )?(?:pk|pack)\b/i);
        if (mPkDirect) return { size: parseInt(mPkDirect[1], 10), unit: 'ct' };
    }

    // Gallon / Half Gallon / Quart
    if (t.includes('half gallon') || t.includes('1/2 gallon') || t.includes('1/2 gal') || t.includes('0.5 gal')) {
        return { size: 0.5, unit: 'gal' };
    }
    if (/\b1\s*(?:-| )?gal(?:lon)?\b/i.test(t) || /\bgallon\b/i.test(t)) {
        return { size: 1.0, unit: 'gal' };
    }
    const mGal = t.match(/(\d+(?:\.\d+)?)\s*(?:-| )?gal(?:lon)?s?\b/i);
    if (mGal) return { size: parseFloat(mGal[1]), unit: 'gal' };

    if (/\b1\s*(?:-| )?qt\b|\b1\s*(?:-| )?quart\b|\bquart\b/i.test(t)) {
        return { size: 0.25, unit: 'gal' };
    }
    const mQt = t.match(/(\d+(?:\.\d+)?)\s*(?:-| )?q(?:uar)?ts?\b/i);
    if (mQt) return { size: parseFloat(mQt[1]) * 0.25, unit: 'gal' };

    // Weight in Lb / Lbs
    const mLb = t.match(/(\d+(?:\.\d+)?)\s*(?:-| )?(?:lbs?|pounds?)\b/i);
    if (mLb) return { size: parseFloat(mLb[1]), unit: 'lb' };

    // Weight in Grams
    const mG = t.match(/(\d+(?:\.\d+)?)\s*(?:-| )?(?:g|grams?)\b/i);
    if (mG) return { size: parseFloat(mG[1]), unit: 'g' };

    // Weight in Oz / Ounce
    const mOz = t.match(/(\d+(?:\.\d+)?)\s*(?:-| )?(?:fl(?:uid)?\.?\s*)?(?:oz|ounces?)\b/i);
    if (mOz) return { size: parseFloat(mOz[1]), unit: 'oz' };

    // Count / Pods / Pacs
    const mCt = t.match(/(\d+)\s*(?:-| )?(?:ct|count|pods?|pacs?|tabs?|capsules?)\b/i);
    if (mCt) return { size: parseInt(mCt[1], 10), unit: 'ct' };

    const mPk = t.match(/(\d+)\s*(?:-| )?(?:pk|pack)\b/i);
    if (mPk) return { size: parseInt(mPk[1], 10), unit: 'ct' };

    return { size: null, unit: null };
}

export function extractBogoInfo(text) {
    if (!text) return { isBogo: false, regPrice: null, is1Cent: false };
    const t = text.toLowerCase();
    const is1Cent = /buy\s*1\s*get\s*1\s*(?:for\s*)?(?:1\s*¢|1\s*cent|0\.01|\.01)/i.test(t);
    const isFree = /buy\s*1\s*get\s*1\s*free|\bbogo\b|\bb1g1\b/i.test(t);

    if (!is1Cent && !isFree) return { isBogo: false, regPrice: null, is1Cent: false };

    // Brookshire's "Save up to $X.XX on 2"
    const mSave = t.match(/save\s+(?:up\s+to\s+)?\$?(\d+(?:\.\d+)?)\s+on\s+2/i);
    if (mSave) {
        const saveAmt = parseFloat(mSave[1]);
        const regPrice = is1Cent ? saveAmt + 0.01 : saveAmt;
        return { isBogo: true, regPrice, is1Cent };
    }

    // Reg. $X.XX
    const mReg = t.match(/reg(?:ular)?\.?\s*\$?(\d+(?:\.\d+)?)/i);
    if (mReg) {
        const regVal = parseFloat(mReg[1]);
        if (Number.isFinite(regVal) && regVal > 0) {
            return { isBogo: true, regPrice: regVal, is1Cent };
        }
    }

    return { isBogo: true, regPrice: null, is1Cent };
}

export function normalizeDeal(rawItem, watchlistItem = null) {
    const notes = [];
    const targetUnit = (watchlistItem?.target_unit || 'ea').toLowerCase();
    const defaultPackSize = watchlistItem?.default_package_size || null;
    const baselinePrice = watchlistItem?.baseline_price_per_unit || null;

    const allText = [
        rawItem.name || '',
        rawItem.description || '',
        rawItem.sale_story || '',
        rawItem.price_text || '',
        rawItem.pre_price_text || '',
        rawItem.post_price_text || ''
    ].join(' ').trim();

    // Limits
    const limit = extractLimit(allText);
    if (limit) notes.push(`Limit ${limit}`);

    // Digital Coupon
    const isDigitalCoupon = /\bdigital\s+coupon\b|\bwith\s+coupon\b|\be-coupon\b/i.test(allText);
    if (isDigitalCoupon) notes.push("Digital Coupon");

    // Base price
    let basePrice = parseNumeric(rawItem.current_price !== undefined ? rawItem.current_price : rawItem.price);
    const origPrice = parseNumeric(rawItem.original_price);

    if (basePrice === null) {
        const mP = (rawItem.price_text || '').match(/\$(\d+(?:\.\d+)?)/);
        if (mP) basePrice = parseFloat(mP[1]);
    }

    // Multi-buy
    const multibuy = extractMultiBuy(allText);
    if (multibuy) {
        const unitFromMb = multibuy.total / multibuy.qty;
        if (basePrice === null || unitFromMb <= basePrice + 0.005) {
            basePrice = basePrice !== null ? Math.min(basePrice, unitFromMb) : unitFromMb;
            const mustBuy = /must\s+buy/i.test(allText) ? ` (Must buy ${multibuy.qty})` : '';
            notes.push(`${multibuy.qty}/$${multibuy.total}${mustBuy}`);
        }
    }

    // BOGO (Buy 1 Get 1 Free or Buy 1 Get 1 for 1¢)
    const bogo = extractBogoInfo(allText);
    let isEstimatedBogo = false;

    if (bogo.isBogo) {
        const bogoLabel = bogo.is1Cent ? "BOGO 1¢" : "BOGO Free";
        const extraCent = bogo.is1Cent ? 0.01 : 0.0;

        if (bogo.regPrice && bogo.regPrice > 0) {
            basePrice = parseFloat(((bogo.regPrice + extraCent) / 2.0).toFixed(4));
            notes.push(`${bogoLabel} (Reg. $${bogo.regPrice.toFixed(2)})`);
        } else if (origPrice && origPrice > 0) {
            basePrice = parseFloat(((origPrice + extraCent) / 2.0).toFixed(4));
            notes.push(`${bogoLabel} (Reg. $${origPrice.toFixed(2)})`);
        } else if (basePrice && basePrice > 0) {
            basePrice = parseFloat(((basePrice + extraCent) / 2.0).toFixed(4));
            notes.push(`${bogoLabel} (Half of listed pack price)`);
        } else if (baselinePrice && baselinePrice > 0) {
            basePrice = parseFloat(((baselinePrice + extraCent) / 2.0).toFixed(4));
            isEstimatedBogo = true;
            notes.push(`${bogoLabel} (Est. from baseline - verify reg price)`);
        } else {
            notes.push(bogoLabel);
        }
    }

    // Extracted size & unit
    const fullDesc = `${rawItem.description || ''} ${rawItem.name || ''}`;
    const rangeInfo = extractPackageRange(fullDesc);
    const { size: extractedSize, unit: extractedUnit } = extractPackageSizeAndUnit(fullDesc, targetUnit);
    const isRange = !!rangeInfo;
    const rangeNote = rangeInfo ? rangeInfo.note : null;

    const isPerLbAd = /\/\s*lb|\bper\s+lb\b|\blb\b/i.test(`${rawItem.price_text || ''} ${rawItem.name || ''}`);

    let normalizedUnitPrice = null;
    const finalUnit = targetUnit || extractedUnit || 'ea';

    if (basePrice !== null && Number.isFinite(basePrice) && basePrice > 0) {
        if (targetUnit === 'lb') {
            if (isPerLbAd && (extractedUnit !== 'lb' || !extractedSize || extractedSize === 1.0)) {
                normalizedUnitPrice = basePrice;
            } else if (extractedUnit === 'lb' && extractedSize && extractedSize > 0) {
                normalizedUnitPrice = isPerLbAd ? basePrice : basePrice / extractedSize;
                if (isRange && rangeNote) {
                    notes.push(rangeNote);
                } else {
                    notes.push(`${extractedSize} lb pack`);
                }
            } else if (extractedUnit === 'oz' && extractedSize && extractedSize > 0) {
                normalizedUnitPrice = (basePrice / extractedSize) * OZ_PER_LB;
                if (isRange && rangeNote) {
                    notes.push(rangeNote);
                } else {
                    notes.push(`${extractedSize} oz pack`);
                }
            } else if (extractedUnit === 'g' && extractedSize && extractedSize > 0) {
                normalizedUnitPrice = (basePrice / extractedSize) * GRAMS_PER_LB;
                if (isRange && rangeNote) {
                    notes.push(rangeNote);
                } else {
                    notes.push(`${extractedSize} g pack`);
                }
            } else if (defaultPackSize && defaultPackSize > 0) {
                normalizedUnitPrice = basePrice / defaultPackSize;
                notes.push(`Assumed default pack size (${defaultPackSize} lb)`);
            } else {
                normalizedUnitPrice = basePrice;
            }
        } else if (targetUnit === 'oz') {
            if (extractedUnit === 'oz' && extractedSize && extractedSize > 0) {
                normalizedUnitPrice = basePrice / extractedSize;
                if (isRange && rangeNote) {
                    notes.push(rangeNote);
                } else {
                    notes.push(`${extractedSize} oz`);
                }
            } else if (extractedUnit === 'lb' && extractedSize && extractedSize > 0) {
                normalizedUnitPrice = basePrice / (extractedSize * OZ_PER_LB);
                if (isRange && rangeNote) {
                    notes.push(rangeNote);
                } else {
                    notes.push(`${extractedSize} lb (${extractedSize * 16} oz)`);
                }
            } else if (extractedUnit === 'g' && extractedSize && extractedSize > 0) {
                normalizedUnitPrice = (basePrice / extractedSize) * GRAMS_PER_OZ;
                if (isRange && rangeNote) {
                    notes.push(rangeNote);
                } else {
                    notes.push(`${extractedSize} g`);
                }
            } else if (defaultPackSize && defaultPackSize > 0) {
                normalizedUnitPrice = basePrice / defaultPackSize;
                notes.push(`Assumed default pack size (${defaultPackSize} oz)`);
            } else {
                normalizedUnitPrice = basePrice;
            }
        } else if (targetUnit === 'ct') {
            if (extractedUnit === 'ct' && extractedSize && extractedSize > 0) {
                normalizedUnitPrice = basePrice / extractedSize;
                if (isRange && rangeNote) {
                    notes.push(rangeNote);
                } else {
                    notes.push(`${extractedSize} count`);
                }
            } else if (defaultPackSize && defaultPackSize > 0) {
                normalizedUnitPrice = basePrice / defaultPackSize;
                notes.push(`Assumed default pack size (${defaultPackSize} ct)`);
            } else {
                normalizedUnitPrice = basePrice;
            }
        } else if (targetUnit === 'gal') {
            if (extractedUnit === 'gal' && extractedSize && extractedSize >= 0.9) {
                normalizedUnitPrice = basePrice / extractedSize;
                if (extractedSize !== 1.0) notes.push(`${extractedSize} gal`);
            } else if (extractedUnit === 'oz' && extractedSize && extractedSize >= 120.0) {
                normalizedUnitPrice = (basePrice / extractedSize) * FL_OZ_PER_GAL;
                notes.push(`${extractedSize} fl oz`);
            } else if (defaultPackSize && defaultPackSize > 0 && (!extractedUnit || extractedUnit === 'gal')) {
                normalizedUnitPrice = basePrice / defaultPackSize;
            } else {
                if (['lb', 'g'].includes(extractedUnit) || (extractedUnit === 'oz' && extractedSize && extractedSize < 120.0) || (extractedUnit === 'gal' && extractedSize && extractedSize < 0.9)) {
                    normalizedUnitPrice = null;
                } else {
                    normalizedUnitPrice = basePrice;
                }
            }
        } else {
            normalizedUnitPrice = basePrice;
            if (isRange && rangeNote) {
                notes.push(rangeNote);
            } else if (extractedSize && extractedUnit) {
                notes.push(`${extractedSize} ${extractedUnit}`);
            }
        }
    }

    if (normalizedUnitPrice !== null) {
        normalizedUnitPrice = Number.isFinite(normalizedUnitPrice) ? parseFloat(normalizedUnitPrice.toFixed(4)) : null;
    }

    return {
        normalized_unit_price: normalizedUnitPrice,
        target_unit: finalUnit,
        effective_price: basePrice !== null && Number.isFinite(basePrice) ? parseFloat(basePrice.toFixed(2)) : null,
        extracted_size: extractedSize,
        extracted_unit: extractedUnit,
        is_bogo: bogo.isBogo,
        is_estimated_bogo: isEstimatedBogo,
        is_digital_coupon: isDigitalCoupon,
        notes: notes,
        notes_str: notes.join(' | ')
    };
}
