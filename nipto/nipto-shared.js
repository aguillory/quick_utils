const NIPTO_URL = "https://nipto.app/graphql";
let API_TOKEN = localStorage.getItem("nipto_api_token") || "";

// ==========================================
// COLLAPSIBLE SECTIONS LOGIC (SHARED)
// ==========================================
function toggleSection(contentId, iconId, storageKey) {
    const content = document.getElementById(contentId);
    const icon = document.getElementById(iconId);
    if (!content || !icon) return;
    
    const isCollapsed = content.classList.toggle('collapsed');
    icon.classList.toggle('collapsed', isCollapsed);
    
    if (storageKey) localStorage.setItem(storageKey, isCollapsed);
}

function initCollapsibles(sectionsArray) {
    sectionsArray.forEach(sec => {
        if (localStorage.getItem(sec.key) === 'true') {
            const content = document.getElementById(sec.content);
            const icon = document.getElementById(sec.icon);
            if (content) content.classList.add('collapsed');
            if (icon) icon.classList.add('collapsed');
        }
    });
}

// ==========================================
// AUTH & PIN LOGIC
// ==========================================
function decodeKey(pin) {
    const masked = "$a#0$*fa-*a07-%%f%-a%*%-f*c8$9c*%8*8";
    const p1 = pin[0], p2 = pin[1], p3 = pin[2], p4 = pin[3];
    return masked.replace(/\*/g, p1).replace(/#/g, p2).replace(/\$/g, p3).replace(/%/g, p4);
}

function savePin(onSuccessCallback) {
    const pin = document.getElementById('pinInput').value;
    if (pin.length !== 4) {
        document.getElementById('pinError').style.display = 'block';
        return;
    }
    API_TOKEN = decodeKey(pin);
    localStorage.setItem("nipto_api_token", API_TOKEN); 
    document.getElementById('pinModal').style.display = 'none';
    
    if (onSuccessCallback) onSuccessCallback();
}

function checkAuth(onSuccessCallback) {
    window.firebase.auth().onAuthStateChanged((user) => {
        if (user) {
            if (API_TOKEN) {
                if (onSuccessCallback) onSuccessCallback();
            } else {
                document.getElementById('pinModal').style.display = 'flex';
                if(document.getElementById('status')) document.getElementById('status').innerText = "Awaiting PIN login...";
            }
        } else {
            window.firebase.auth().signInAnonymously().catch((error) => {
                console.error("Firebase Auth Error:", error);
                if(document.getElementById('status')) document.getElementById('status').innerText = "Database Auth Failed.";
            });
        }
    });
}

// ==========================================
// NIPTO API WRAPPER
// ==========================================
async function fetchNipto(query, variables = {}) {
    if (!API_TOKEN) throw new Error("Unauthorized: Missing Token");

    const response = await fetch(NIPTO_URL, {
        method: 'POST',
        headers: { 'Authorization': API_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables })
    });

    const data = await response.json();
    if (data.errors) {
        if (data.errors[0].message.toLowerCase().includes("unauthorized") || data.errors[0].message.toLowerCase().includes("token")) {
            localStorage.removeItem("nipto_api_token");
            API_TOKEN = "";
            document.getElementById('pinModal').style.display = 'flex';
        }
        throw new Error(data.errors[0].message || "GraphQL Error");
    }
    return data.data;
}

// ==========================================
// SYNC TASKS LOGIC 
// ==========================================
async function syncNiptoTasks(onSyncComplete) {
    const statusDiv = document.getElementById('status') || document.getElementById('status-message');
    const syncBtn = document.getElementById('syncNiptoBtn') || document.getElementById('sync-btn');

    if (!API_TOKEN) { alert("Please log in first."); return; }

    if(syncBtn) { syncBtn.disabled = true; syncBtn.innerText = "⏳ Syncing..."; }
    if(statusDiv) { statusDiv.innerText = "Fetching live tasks from Nipto..."; statusDiv.style.color = "var(--primary)"; }

    const QUERY = `query GetTasks { tasks { uid group name value } }`;

    try {
        const data = await fetchNipto(QUERY);
        const tasks = data.tasks;
        if (!tasks || tasks.length === 0) throw new Error("No tasks returned.");

        if(statusDiv) statusDiv.innerText = `Found ${tasks.length} live tasks. Syncing...`;

        let batch = window.db.batch();
        let operationCount = 0;

        for (const task of tasks) {
            const docRef = window.db.collection('nipto_tasks').doc(task.uid);
            batch.set(docRef, task, { merge: true });
            operationCount++;

            if (operationCount === 490) {
                await batch.commit();
                batch = window.db.batch(); 
                operationCount = 0;
            }
        }
        if (operationCount > 0) await batch.commit();

        if(statusDiv) { statusDiv.innerText = `Database Synced!`; statusDiv.style.color = "var(--success)"; }
        
        if (onSyncComplete) await onSyncComplete();

    } catch (error) {
        console.error(error);
        if(statusDiv) { statusDiv.innerText = `Sync Error: ${error.message}`; statusDiv.style.color = "var(--danger)"; }
    } finally {
        if(syncBtn) { syncBtn.disabled = false; syncBtn.innerText = "🔄"; }
    }
}