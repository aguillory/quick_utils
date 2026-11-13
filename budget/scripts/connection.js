import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, doc, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBZEMURsXfHMi9E-sOPv5MEBBuqsnPuwEA",
    authDomain: "quick-utils.firebaseapp.com",
    projectId: "quick-utils",
    storageBucket: "quick-utils.firebasestorage.app",
    messagingSenderId: "761342715921",
    appId: "1:761342715921:web:3f05487a9a40beaccfe9b0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const CURRENT_ENV = 'prod';
export const getEnv = () => CURRENT_ENV;

export const toggleEnv = () => {
    console.info("Environment is locked to prod.");
};

export const getBudgetDoc = (...pathSegments) => {
    return doc(db, 'budget', 'prod', ...pathSegments);
};

export const getBudgetCollection = (...pathSegments) => {
    return collection(db, 'budget', 'prod', ...pathSegments);
};

/**
 * Deterministic cent-level rounding to prevent IEEE 754 floating-point drift and -$0.00.
 */
export const roundCents = (val) => {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (!Number.isFinite(num)) return 0;
    const rounded = Math.round((num + Number.EPSILON) * 100) / 100;
    return (Object.is(rounded, -0) || Math.abs(rounded) < 0.005) ? 0 : rounded;
};

/**
 * Formats a number as USD currency after cent-rounding and normalizing -0 to +0.
 */
export const formatCurrency = (val) => {
    const cleanVal = roundCents(val);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cleanVal);
};

/**
 * Returns local calendar date in YYYY-MM-DD format (avoids UTC rollover in the evening).
 */
export const getLocalDateStr = (dateObj = new Date()) => {
    const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Returns local calendar year-month in YYYY-MM format (avoids UTC rollover on month-end evenings).
 */
export const getLocalMonthStr = (dateObj = new Date()) => {
    return getLocalDateStr(dateObj).slice(0, 7);
};

/**
 * Safely parses a YYYY-MM-DD string into a local midnight Date object.
 */
export const parseLocalDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return new Date();
    const parts = dateStr.slice(0, 10).split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
        return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
    }
    return new Date(dateStr);
};

/**
 * Adds a specified number of calendar days to a YYYY-MM-DD string in local time and returns YYYY-MM-DD.
 */
export const addDaysLocal = (dateStr, days) => {
    const d = parseLocalDate(dateStr);
    d.setDate(d.getDate() + Number(days || 0));
    return getLocalDateStr(d);
};

/**
 * Escapes user strings for safe interpolation inside HTML attributes and elements.
 */
export const escapeHtml = (val) => {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * Renders/styles the #env-toggle button if present.
 * If embedded in an iframe, hides it to avoid duplicate/stacked floating controls.
 */
export const initEnvToggleUI = () => {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('env-toggle');
    if (!btn) return;
    btn.style.display = 'none';
};

if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', initEnvToggleUI);
    setTimeout(initEnvToggleUI, 0);
}

export { db, auth };

signInAnonymously(auth).catch(console.error);
