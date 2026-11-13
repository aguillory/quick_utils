// settings.js
// Settings modal for Gemini API Key, Gemini Model, Home Assistant Webhook URL,
// and Adult Notification Profiles (Alyssa, Devyn, Carrina, Kenny).

import { state, NIPTO_PUBLIC_URL } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';
import { callGeminiWithFallback, DEFAULT_GEMINI_MODEL } from './braindump.js';

export { NIPTO_PUBLIC_URL };

export function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    const cfg = state.integrationsConfig || {};
    const geminiInput = document.getElementById('settingGeminiApiKey');
    const geminiModelInput = document.getElementById('settingGeminiModel');
    const haInput = document.getElementById('settingHaWebhookUrl');
    const testBadge = document.getElementById('geminiTestBadge');

    if (geminiInput) geminiInput.value = cfg.geminiApiKey || '';

    let currentModel = (cfg.geminiModel || DEFAULT_GEMINI_MODEL).trim();
    if (!currentModel || currentModel.includes('2.5')) {
        currentModel = DEFAULT_GEMINI_MODEL;
    }
    if (geminiModelInput) geminiModelInput.value = currentModel;

    if (haInput) {
        haInput.value = cfg.haWebhookUrl || '';
    }

    if (testBadge) {
        testBadge.style.display = 'none';
        testBadge.textContent = '';
    }

    // Load Adult Notification Profiles (Alyssa, Devyn, Carrina have phones; Kenny does not)
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
    if (!geminiModel || geminiModel.includes('2.5')) {
        geminiModel = DEFAULT_GEMINI_MODEL;
    }
    const haWebhook = document.getElementById('settingHaWebhookUrl')?.value.trim() || '';

    const newIntegrations = {
        geminiApiKey: geminiKey,
        geminiModel: geminiModel,
        haWebhookUrl: haWebhook,
        haWebhookToken: state.integrationsConfig?.haWebhookToken || '',
        publicAppUrl: state.integrationsConfig?.publicAppUrl || NIPTO_PUBLIC_URL
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
        const mode = document.getElementById(`setting_${a.key}_chatMode`)?.value || (a.key === 'kenny' ? 'muted' : 'all_messages');
        const direct = document.getElementById(`setting_${a.key}_direct`)?.checked || false;
        const morning = document.getElementById(`setting_${a.key}_morning`)?.checked || false;
        const evening = document.getElementById(`setting_${a.key}_evening`)?.checked || false;

        updatedAdults[a.uid] = {
            name: a.name,
            haTarget: target,
            chatMode: target ? mode : 'muted',
            directAssignmentAlerts: target ? direct : false,
            morningDigest: target ? morning : false,
            eveningDigest: target ? evening : false
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

// Verifies API Key & Model with automatic free-tier model discovery/fallback
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
    if (!model || model.includes('2.5')) {
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

    try {
        const { modelUsed } = await callGeminiWithFallback(
            apiKey,
            model,
            'Respond "OK"',
            null,
            { maxOutputTokens: 5 },
            (statusMsg) => {
                if (badge) badge.textContent = statusMsg;
            }
        );

        if (modelInput && modelUsed) {
            modelInput.value = modelUsed;
        }

        if (badge) {
            badge.style.display = 'inline-block';
            badge.style.background = 'rgba(16, 185, 129, 0.15)';
            badge.style.color = '#059669';
            badge.innerHTML = `&#x2714; Connected (${modelUsed.replace(/^models\//, '')})`;
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

if (typeof window !== 'undefined') {
    window.openSettingsModal = openSettingsModal;
    window.closeSettingsModal = closeSettingsModal;
    window.saveSettingsModal = saveSettingsModal;
    window.testGeminiConnection = testGeminiConnection;
}
