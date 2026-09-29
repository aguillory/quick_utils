import { auth, getTrackerDoc, getTrackerCollection } from './connection.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { query, orderBy, limit, getDocs, getDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const container = document.getElementById('history-container');
const filterDateInput = document.getElementById('filter-date');
const filterBtn = document.getElementById('filter-btn');
const clearBtn = document.getElementById('clear-btn');
const dailySummary = document.getElementById('daily-summary');
const dailySummaryContent = document.getElementById('daily-summary-content');

let appConfig = [];
let allLogs = []; // Cache loaded logs

const getLabel = (id) => {
    const cat = appConfig.find(c => c.id === id);
    return cat ? cat.label : id.replace('_', ' ');
};

const renderLogs = (logs) => {
    if(logs.length === 0) {
        container.innerHTML = '<div class="text-center text-slate-400 py-10">No history found.</div>';
        return;
    }

    let html = '';
    logs.forEach(log => {
        const d = new Date(log.date);
        let detailsHtml = '';
        
        if(log.vitals) {
            let vitalList = [];
            if(log.vitals.weight) vitalList.push(`Weight: ${log.vitals.weight}lbs`);
            if(log.vitals.bp) vitalList.push(`BP: ${log.vitals.bp}`);
            if(log.vitals.hr) vitalList.push(`HR: ${log.vitals.hr}bpm`);
            if(log.vitals.o2) vitalList.push(`O2: ${log.vitals.o2}%`);
            if(log.vitals.sleep) vitalList.push(`Sleep: ${log.vitals.sleep}hrs`);
            if(vitalList.length > 0) {
                detailsHtml += `<div class="mb-2 pb-2 border-b text-sm"><strong class="capitalize text-indigo-700">Vitals:</strong> ${vitalList.join(', ')}</div>`;
            }
        }

        Object.keys(log.items || {}).forEach(k => {
            if(log.items[k].length > 0) {
                detailsHtml += `<div class="mb-1 text-sm"><strong class="text-slate-700">${getLabel(k)}:</strong> ${log.items[k].join(', ')}</div>`;
            }
        });
        Object.keys(log.extras || {}).forEach(k => {
            detailsHtml += `<div class="mb-1 text-sm text-slate-500"><strong class="">${getLabel(k)} Note:</strong> ${log.extras[k]}</div>`;
        });

        let weatherHtml = '';
        if(log.weather) {
            weatherHtml = `<div class="mt-3 text-xs text-slate-400 flex items-center gap-2 border-t pt-2">
                <i class="fas fa-cloud"></i>
                <span>${log.weather.temp} F</span>
                <span>H: ${log.weather.humidity}%</span>
                <span>P: ${log.weather.pressure}</span>
                <span>W: ${log.weather.wind}mph</span>
                <span class="ml-auto">${log.weather.source}</span>
            </div>`;
        }

        html += `
            <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
                <div class="flex justify-between items-center mb-2 border-b pb-2">
                    <div class="font-bold text-indigo-600">
                        <i class="fas fa-calendar-alt mr-1"></i> ${d.toLocaleString([], {weekday: 'long', month:'short', day:'numeric', hour: '2-digit', minute:'2-digit'})}
                    </div>
                    <div class="flex gap-3">
                        <button onclick="window.editLog('${log.id}')" class="text-indigo-400 hover:text-indigo-600 transition" title="Edit"><i class="fas fa-edit"></i></button>
                        <button onclick="window.deleteLog('${log.id}')" class="text-red-300 hover:text-red-500 transition" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                ${detailsHtml || '<div class="text-sm text-slate-400">No specific items logged.</div>'}
                ${weatherHtml}
            </div>
        `;
    });
    
    container.innerHTML = html;
};

const renderSummary = (logs) => {
    if(logs.length === 0) {
        dailySummary.classList.add('hidden');
        return;
    }
    dailySummary.classList.remove('hidden');

    let allItems = {};
    let allVitals = {};

    logs.forEach(log => {
        Object.keys(log.items || {}).forEach(k => {
            if(!allItems[k]) allItems[k] = new Set();
            log.items[k].forEach(i => allItems[k].add(i));
        });

        if(log.vitals) {
            Object.keys(log.vitals).forEach(k => {
                if(!allVitals[k]) allVitals[k] = [];
                allVitals[k].push(log.vitals[k]);
            });
        }
    });

    let html = '';
    
    if(Object.keys(allVitals).length > 0) {
        let vList = [];
        if(allVitals.weight) vList.push(`Weight: ${allVitals.weight[allVitals.weight.length-1]}lbs`); // Take latest
        if(allVitals.bp) vList.push(`BP: ${allVitals.bp[allVitals.bp.length-1]}`);
        if(allVitals.sleep) {
            let totalSleep = allVitals.sleep.reduce((sum, v) => sum + parseFloat(v), 0);
            vList.push(`Total Sleep: ${totalSleep}hrs`);
        }
        if(vList.length > 0) {
            html += `<div class="mb-1"><strong class="text-indigo-700">Vitals Logged:</strong> ${vList.join(', ')}</div>`;
        }
    }

    Object.keys(allItems).forEach(k => {
        if(allItems[k].size > 0) {
            html += `<div><strong>${getLabel(k)}:</strong> ${Array.from(allItems[k]).join(', ')}</div>`;
        }
    });

    dailySummaryContent.innerHTML = html || 'Nothing specific recorded.';
};

const applyFilter = () => {
    const dStr = filterDateInput.value;
    if(!dStr) return;

    // dStr is YYYY-MM-DD
    const filtered = allLogs.filter(l => {
        // convert UTC to local to compare properly
        const logD = new Date(l.date);
        const logDateStr = logD.getFullYear() + '-' + String(logD.getMonth()+1).padStart(2, '0') + '-' + String(logD.getDate()).padStart(2, '0');
        return logDateStr === dStr;
    });

    renderLogs(filtered);
    renderSummary(filtered);
};

filterBtn.onclick = applyFilter;

clearBtn.onclick = () => {
    filterDateInput.value = '';
    dailySummary.classList.add('hidden');
    renderLogs(allLogs);
};

window.deleteLog = async (id) => {
    if(confirm("Are you sure you want to delete this log?")) {
        try {
            await deleteDoc(doc(getTrackerCollection('logs'), id));
            allLogs = allLogs.filter(l => l.id !== id);
            
            if(filterDateInput.value) {
                applyFilter();
            } else {
                renderLogs(allLogs);
            }
        } catch(e) {
            alert('Failed to delete log.');
            console.error(e);
        }
    }
};

window.editLog = (id) => {
    window.location.href = `index.html?edit=${id}`;
};

const loadHistory = async () => {
    try {
        try {
            const docSnap = await getDoc(getTrackerDoc('settings', 'config'));
            if(docSnap.exists() && docSnap.data().arr) {
                appConfig = docSnap.data().arr;
            } else if(docSnap.exists() && !Array.isArray(docSnap.data())) {
                const data = docSnap.data();
                appConfig = Object.keys(data).filter(k => k!=='arr').map(k => ({id: k, label: k}));
            }
        } catch(e) {}

        const q = query(getTrackerCollection('logs'), orderBy('date', 'desc'), limit(100));
        const snap = await getDocs(q);
        
        allLogs = [];
        snap.forEach(doc => {
            allLogs.push({ id: doc.id, ...doc.data() });
        });

        renderLogs(allLogs);

    } catch(e) {
        console.error(e);
        container.innerHTML = '<div class="text-center text-red-400 py-10">Error loading history.</div>';
    }
};

onAuthStateChanged(auth, user => {
    if(user) {
        // Set date input max to today
        const now = new Date();
        const localDate = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        filterDateInput.max = localDate;
        
        loadHistory();
    }
});
