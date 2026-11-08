// settings.js
// Settings modal for Gemini API Key, Home Assistant Webhook URL,
// and Adult Notification Profiles (Alyssa, Devyn, Carrina, Kenny).

import { state } from './state.js';
import * as api from './api.js';
import { showToast } from './toast.js';

export function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    // Load Integrations
    const cfg = state.integrationsConfig || {};
    const geminiInput = document.getElementById('settingGeminiApiKey');
    const haInput = document.getElementById('settingHaWebhookUrl');
    if (geminiInput) geminiInput.value = cfg.geminiApiKey || '';
    if (haInput) haInput.value = cfg.haWebhookUrl || 'https://zbd3yezedhldtsyc2joff0uhgmklnahn.ui.nabu.casa/api/webhook/nipto_notify_bridge';

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
    const haWebhook = document.getElementById('settingHaWebhookUrl')?.value.trim() || '';

    const newIntegrations = {
        geminiApiKey: geminiKey,
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

// Bind to window for HTML onclicks
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettingsModal = saveSettingsModal;
