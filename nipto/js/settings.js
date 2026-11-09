// settings.js
// Settings modal for Gemini API Key, Gemini Model, Home Assistant Webhook URL,
// and Adult Notification Profiles (Alyssa, Devyn, Carrina, Kenny).

import { state } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { discoverActiveGeminiFlashModel, DEFAULT_GEMINI_MODEL } from './braindump.js';

export function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    // Load Integrations
    const cfg = state.integrationsConfig || {};
    const geminiInput = document.getElementById('settingGeminiApiKey');
    const geminiModelInput = document.getElementById('settingGeminiModel');
    const haInput = document.getElementById('settingHaWebhookUrl');
    const testBadge = document.getElementById('geminiTestBadge');

    if (geminiInput) geminiInput.value = cfg.geminiApiKey || '';

    let currentModel = (cfg.geminiModel || DEFAULT_GEMINI_MODEL).trim();
    if (currentModel === 'gemini-2.5-flash') {
        currentModel = DEFAULT_GEMINI_MODEL;
    }
    if (geminiModelInput) geminiModelInput.value = currentModel;

    if (haInput) haInput.value = cfg.haWebhookUrl || 'https://zbd3yezedhldtsyc2joff0uhgmklnahn.ui.nabu.casa/api/webhook/nipto_notify_bridge';

    if (testBadge) {
        testBadge.style.display = 'none';
        testBadge.textContent = '';
    }

    // Load Adult Notification Profiles
    const adults = state.notificationPreferences?.adults || {};

    const adultKeys = [
        { key: 'alyssa', uid: 'Llb9JjyTDvMnn8SJWfizXgthxl83', defaultTarget: 'notify.mobile_app_alyssa_phone', defaultMode: 'all_messages' },
        { key: 'devyn', uid: 'cHnAKABalRf0gETPsDt9EiJLyZd2', defaultTarget: 'notify.mobile_app_devyn_s_phone', defaultMode: 'ping_only' },
        { key: 'carrina', uid: '2pxnC1oGlZbLQLmu9UJJVPYOEmZ2', defaultTarget: 'notify.mobile_app_carrina_phone', defaultMode: 'all_messages' },
        { key: 'kenny', uid: 'TilLpLRDz4VWel79jVevmu3JsIH3', defaultTarget: '', defaultMode: 'muted' }
    ];

    adultKeys.forEach(a => {
        const prof = adults[a.uid] || {};
        const targetEl = document.getElementById(`setting_${a.key}_target`);
        const modeEl = document.getElementById(`setting_${a.key}_chatMode`);
        const directEl = document.getElementById(`setting_${a.key}_direct`);
        const morningEl = document.getElementById(`setting_${a.key}_morning`);
        const eveningEl = document.getElementById(`setting_${a.key}_evening`);

        if (targetEl) targetEl.value = prof.haTarget !== undefined ? prof.haTarget : a.defaultTarget;
        if (modeEl) modeEl.value = prof.chatMode || a.defaultMode;
        if (directEl) directEl.checked = prof.directAssignmentAlerts !== undefined ? prof.directAssignmentAlerts : (a.key !== 'kenny');
        if (morningEl) morningEl.checked = prof.morningDigest !== undefined ? prof.morningDigest : (a.key !== 'kenny' && a.key !== 'devyn');
        if (eveningEl) eveningEl.checked = prof.eveningDigest !== undefined ? prof.eveningDigest : (a.key !== 'kenny');
    });

    modal.style.display = 'flex';
}

export function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
}

export async function saveSettingsModal() {
    const geminiKey = document.getElementById('settingGeminiApiKey')?.value.trim() || '';
    let geminiModel = document.getElementById('settingGeminiModel')?.value.trim() || DEFAULT_GEMINI_MODEL;
    if (geminiModel === 'gemini-2.5-flash') {
        geminiModel = DEFAULT_GEMINI_MODEL;
    }
    const haWebhook = document.getElementById('settingHaWebhookUrl')?.value.trim() || '';

    const newIntegrations = {
        geminiApiKey: geminiKey,
        geminiModel: geminiModel,
        haWebhookUrl: haWebhook
    };

    const adultKeys = [
        { key: 'alyssa', uid: 'Llb9JjyTDvMnn8SJWfizXgthxl83', name: 'Alyssa' },
        { key: 'devyn', uid: 'cHnAKABalRf0gETPsDt9EiJLyZd2', name: 'Devyn' },
        { key: 'carrina', uid: '2pxnC1oGlZbLQLmu9UJJVPYOEmZ2', name: 'Carrina' },
        { key: 'kenny', uid: 'TilLpLRDz4VWel79jVevmu3JsIH3', name: 'Kenny' }
    ];

    const updatedAdults = {};

    adultKeys.forEach(a => {
        const target = document.getElementById(`setting_${a.key}_target`)?.value.trim() || '';
        const mode = document.getElementById(`setting_${a.key}_chatMode`)?.value || 'all_messages';
        const direct = document.getElementById(`setting_${a.key}_direct`)?.checked || false;
        const morning = document.getElementById(`setting_${a.key}_morning`)?.checked || false;
        const evening = document.getElementById(`setting_${a.key}_evening`)?.checked || false;

        updatedAdults[a.uid] = {
            name: a.name,
            haTarget: target,
            chatMode: mode,
            directAssignmentAlerts: direct,
            morningDigest: morning,
            eveningDigest: evening
        };
    });

    try {
        await Promise.all([
            api.saveIntegrationsConfigToFirestore(newIntegrations),
            api.saveNotificationPreferencesToFirestore({ adults: updatedAdults })
        ]);
        closeSettingsModal();
        showToast("settings_saved", "Integrations and notifications saved!", 0, "");
    } catch (e) {
        console.error("Error saving settings:", e);
        alert("Failed to save settings: " + e.message);
    }
}

// Tiny 5-token test prompt to verify API Key & Model
export async function testGeminiConnection() {
    const keyInput = document.getElementById('settingGeminiApiKey');
    const modelInput = document.getElementById('settingGeminiModel');
    const badge = document.getElementById('geminiTestBadge');
    const btn = document.getElementById('btnTestGeminiKey');

    const apiKey = (keyInput?.value || state.integrationsConfig?.geminiApiKey || '').trim();
    if (!apiKey) {
        if (badge) {
            badge.style.display = 'inline-block';
            badge.style.background = 'rgba(239, 68, 68, 0.15)';
            badge.style.color = 'var(--danger, #dc2626)';
            badge.textContent = 'Please enter an API key first';
        }
        return;
    }

    let model = (modelInput?.value || state.integrationsConfig?.geminiModel || DEFAULT_GEMINI_MODEL).trim();
    if (model === 'gemini-2.5-flash') {
        model = DEFAULT_GEMINI_MODEL;
        if (modelInput) modelInput.value = model;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Testing...';
    }
    if (badge) {
        badge.style.display = 'inline-block';
        badge.style.background = 'rgba(59, 130, 246, 0.15)';
        badge.style.color = 'var(--primary, #2563eb)';
        badge.textContent = `Testing ${model}...`;
    }

    const runTest = async (targetModel) => {
        const clean = targetModel.replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${clean}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'Respond "OK"' }] }],
                generationConfig: { maxOutputTokens: 5 }
            })
        });
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const err = new Error(errBody.error?.message || `HTTP ${res.status}`);
            err.status = res.status;
            err.code = errBody.error?.code;
            throw err;
        }
        return await res.json();
    };

    try {
        let activeModel = model;
        try {
            await runTest(activeModel);
        } catch (err) {
            const isDeprecationOr404 = err.status === 404 ||
                err.code === 404 ||
                /no longer available|not found|deprecated/i.test(err.message || '');

            if (isDeprecationOr404) {
                if (badge) {
                    badge.textContent = `Model ${activeModel} unavailable. Discovering Flash model...`;
                }
                const discovered = await discoverActiveGeminiFlashModel(apiKey);
                activeModel = discovered;
                await runTest(activeModel);
                if (modelInput) modelInput.value = activeModel;
            } else {
                throw err;
            }
        }

        if (badge) {
            badge.style.display = 'inline-block';
            badge.style.background = 'rgba(16, 185, 129, 0.15)';
            badge.style.color = '#059669';
            badge.innerHTML = `&#x2714; Connected (${activeModel.replace(/^models\//, '')})`;
        }
    } catch (err) {
        console.error("Test Gemini connection failed:", err);
        if (badge) {
            badge.style.display = 'inline-block';
            badge.style.background = 'rgba(239, 68, 68, 0.15)';
            badge.style.color = 'var(--danger, #dc2626)';
            badge.textContent = `Failed: ${err.message}`;
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '&#x26A1; Test Key &amp; Model';
        }
    }
}

// Bind to window for HTML onclicks
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettingsModal = saveSettingsModal;
window.testGeminiConnection = testGeminiConnection;
