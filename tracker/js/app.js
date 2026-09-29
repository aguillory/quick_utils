import { auth, getTrackerDoc, getTrackerCollection } from './connection.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getDoc, setDoc, doc, addDoc, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { DEFAULT_CONFIG } from './defaultConfig.js';

let appConfig = null;
let currentSelections = {};
let editDocId = null;

const UI = {
    categoriesContainer: document.getElementById('categories-container'),
    settingsLists: document.getElementById('settings-lists'),
    recentLogContainer: document.getElementById('recent-log-container'),
    recentLogTime: document.getElementById('recent-log-time'),
    recentLogSummary: document.getElementById('recent-log-summary'),
    recentLogDetails: document.getElementById('recent-log-details'),
    settingApiCode: document.getElementById('setting-api-code'),
    settingStationId: document.getElementById('setting-station-id'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    logBtn: document.getElementById('log-btn'),
    logTime: document.getElementById('log-time')
};

// Weather API logic (silent fallback)
const fetchWeather = async () => {
    const apiCode = localStorage.getItem('wuApiCode');
    const stationId = localStorage.getItem('wuStationId') || localStorage.getItem('wuStationIdCustom') || 'KLAOAKRI12';
    
    if (apiCode) {
        const apiKeyTemplate = "90fe5810c9a8{{CODE}}7{{CODE}}{{CODE}}be5810c9a8a7{{CODE}}{{CODE}}d5";
        const apiKey = apiKeyTemplate.replace(/{{CODE}}/g, apiCode);
        const url = `https://api.weather.com/v2/pws/observations/current?stationId=${stationId}&format=json&units=e&apiKey=${apiKey}`;
        
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('WU API Error');
            const data = await res.json();
            const obs = data.observations[0];
            return {
                source: 'Wunderground',
                temp: obs.imperial.temp,
                humidity: obs.humidity,
                pressure: obs.imperial.pressure,
                wind: obs.imperial.windSpeed,
                conditions: obs.winddir 
            };
        } catch(e) {
            console.warn('WU Weather failed, trying Open-Meteo fallback', e);
        }
    }
    
    // Open-Meteo fallback for Start, LA
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=32.4868&longitude=-91.8596&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,surface_pressure,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
        const res = await fetch(url);
        const data = await res.json();
        return {
            source: 'Open-Meteo',
            temp: data.current.temperature_2m,
            humidity: data.current.relative_humidity_2m,
            pressure: (data.current.surface_pressure * 0.02953).toFixed(2),
            wind: data.current.wind_speed_10m,
            conditions: `Code ${data.current.weather_code}`
        };
    } catch(e) {
        console.warn('Weather fallback failed', e);
        return null;
    }
};

const showToast = (msg) => {
    const t = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    t.classList.remove('opacity-0');
    setTimeout(() => t.classList.add('opacity-0'), 3000);
};

const toggleCategory = (id) => {
    const el = document.getElementById(`content-${id}`);
    const icon = document.getElementById(`icon-${id}`);
    if(el.classList.contains('expanded')) {
        el.classList.remove('expanded');
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
    } else {
        el.classList.add('expanded');
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
    }
};
window.toggleCategory = toggleCategory;

const toggleItem = (catKey, item, btnElement) => {
    if(!currentSelections[catKey]) currentSelections[catKey] = [];
    const idx = currentSelections[catKey].indexOf(item);
    if(idx > -1) {
        currentSelections[catKey].splice(idx, 1);
        btnElement.classList.remove('selected', 'bg-indigo-600', 'text-white', 'border-indigo-600');
        btnElement.classList.add('bg-white', 'text-slate-700', 'border-slate-300');
    } else {
        currentSelections[catKey].push(item);
        btnElement.classList.add('selected', 'bg-indigo-600', 'text-white', 'border-indigo-600');
        btnElement.classList.remove('bg-white', 'text-slate-700', 'border-slate-300');
    }
};
window.toggleItem = toggleItem;

let settingsDraft = [];

const renderSettingsList = () => {
    UI.settingsLists.innerHTML = '';
    settingsDraft.forEach((cat, index) => {
        const setDiv = document.createElement('div');
        setDiv.className = 'border p-3 rounded-lg bg-slate-50 relative';
        
        let upBtn = `<button onclick="window.moveSettingsCategory(${index}, -1)" class="text-slate-400 hover:text-indigo-600 px-2" ${index === 0 ? 'disabled style="opacity:0.3"' : ''}><i class="fas fa-arrow-up"></i></button>`;
        let downBtn = `<button onclick="window.moveSettingsCategory(${index}, 1)" class="text-slate-400 hover:text-indigo-600 px-2" ${index === settingsDraft.length - 1 ? 'disabled style="opacity:0.3"' : ''}><i class="fas fa-arrow-down"></i></button>`;
        
        setDiv.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <div class="flex-grow flex gap-2 items-center">
                    ${upBtn}${downBtn}
                    <input type="text" id="set-label-${index}" value="${cat.label}" placeholder="Category Name" class="font-semibold text-sm border rounded p-1 flex-grow focus:ring focus:ring-indigo-200">
                </div>
                <button onclick="window.removeSettingsCategory(${index})" class="text-red-400 hover:text-red-600 ml-2"><i class="fas fa-trash"></i></button>
            </div>
            <textarea id="set-val-${index}" rows="2" placeholder="Comma separated items..." class="w-full border rounded-lg p-2 text-sm focus:ring focus:ring-indigo-200">${cat.items.join(', ')}</textarea>
            <input type="hidden" id="set-id-${index}" value="${cat.id}">
        `;
        UI.settingsLists.appendChild(setDiv);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'w-full py-2 border-2 border-dashed border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 font-semibold text-sm';
    addBtn.innerHTML = '<i class="fas fa-plus"></i> Add Category';
    addBtn.onclick = () => {
        syncSettingsDraft();
        settingsDraft.push({ id: 'cat_' + Date.now(), label: 'New Category', items: [] });
        renderSettingsList();
    };
    UI.settingsLists.appendChild(addBtn);
};

const syncSettingsDraft = () => {
    settingsDraft = settingsDraft.map((cat, index) => {
        const labelEl = document.getElementById(`set-label-${index}`);
        const valEl = document.getElementById(`set-val-${index}`);
        return {
            id: document.getElementById(`set-id-${index}`).value,
            label: labelEl ? labelEl.value.trim() : cat.label,
            items: valEl ? valEl.value.split(',').map(s => s.trim()).filter(s => s.length > 0) : cat.items
        };
    });
};

window.moveSettingsCategory = (index, dir) => {
    syncSettingsDraft();
    if(index + dir >= 0 && index + dir < settingsDraft.length) {
        const temp = settingsDraft[index];
        settingsDraft[index] = settingsDraft[index + dir];
        settingsDraft[index + dir] = temp;
        renderSettingsList();
    }
};

window.removeSettingsCategory = (index) => {
    if(confirm('Remove this category?')) {
        syncSettingsDraft();
        settingsDraft.splice(index, 1);
        renderSettingsList();
    }
};

const renderUI = () => {
    UI.categoriesContainer.innerHTML = '';
    
    appConfig.forEach(cat => {
        const catDiv = document.createElement('div');
        catDiv.className = 'bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden';
        
        const header = document.createElement('button');
        header.className = 'w-full px-4 py-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition text-left';
        header.onclick = () => toggleCategory(cat.id);
        header.innerHTML = `<span class="font-bold text-slate-800">${cat.label}</span><i id="icon-${cat.id}" class="fas fa-chevron-down text-slate-400"></i>`;
        
        const content = document.createElement('div');
        content.id = `content-${cat.id}`;
        content.className = 'category-content p-4 border-t border-slate-100';
        
        const grid = document.createElement('div');
        grid.className = 'flex flex-wrap gap-2';
        
        cat.items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'item-btn px-4 py-2 rounded-full border border-slate-300 bg-white text-slate-700 text-sm hover:border-indigo-400 transition-colors';
            // Mark selected if loading an edit
            if(currentSelections[cat.id] && currentSelections[cat.id].includes(item)) {
                btn.classList.add('selected', 'bg-indigo-600', 'text-white', 'border-indigo-600');
                btn.classList.remove('bg-white', 'text-slate-700', 'border-slate-300');
            }
            btn.textContent = item;
            btn.onclick = () => toggleItem(cat.id, item, btn);
            grid.appendChild(btn);
        });

        const extraDiv = document.createElement('div');
        extraDiv.className = 'w-full mt-3';
        extraDiv.innerHTML = `<input type="text" id="extra-${cat.id}" placeholder="Add a custom note/value..." class="w-full text-sm border rounded-lg p-2 focus:ring focus:ring-indigo-200">`;
        
        content.appendChild(grid);
        content.appendChild(extraDiv);
        catDiv.appendChild(header);
        catDiv.appendChild(content);
        UI.categoriesContainer.appendChild(catDiv);
    });

    settingsDraft = JSON.parse(JSON.stringify(appConfig));
    renderSettingsList();
};

const loadRecent = async () => {
    try {
        const q = query(getTrackerCollection('logs'), orderBy('date', 'desc'), limit(1));
        const snap = await getDocs(q);
        if(!snap.empty) {
            const data = snap.docs[0].data();
            UI.recentLogContainer.classList.remove('hidden');
            
            const d = new Date(data.date);
            UI.recentLogTime.textContent = d.toLocaleString([], {month:'short', day:'numeric', hour: '2-digit', minute:'2-digit'});
            
            let summaryParts = [];
            Object.keys(data.items || {}).forEach(k => {
                if(data.items[k].length > 0) {
                    const catObj = appConfig.find(c => c.id === k);
                    const catLabel = catObj ? catObj.label : k;
                    summaryParts.push(data.items[k].length + ' ' + catLabel);
                }
            });
            UI.recentLogSummary.textContent = summaryParts.length > 0 ? summaryParts.join(', ') : 'Empty log';
            
            let detailsHtml = '';
            
            if(data.vitals) {
                let vitalList = [];
                if(data.vitals.weight) vitalList.push(`Weight: ${data.vitals.weight}lbs`);
                if(data.vitals.bp) vitalList.push(`BP: ${data.vitals.bp}`);
                if(data.vitals.hr) vitalList.push(`HR: ${data.vitals.hr}bpm`);
                if(data.vitals.o2) vitalList.push(`O2: ${data.vitals.o2}%`);
                if(data.vitals.sleep) vitalList.push(`Sleep: ${data.vitals.sleep}hrs`);
                if(vitalList.length > 0) {
                    detailsHtml += `<div class="mb-2 pb-2 border-b"><strong class="capitalize">Vitals:</strong> ${vitalList.join(', ')}</div>`;
                }
            }

            Object.keys(data.items || {}).forEach(k => {
                if(data.items[k].length > 0) {
                    const catObj = appConfig.find(c => c.id === k);
                    const catLabel = catObj ? catObj.label : k;
                    detailsHtml += `<div class="mb-1"><strong class="capitalize">${catLabel}:</strong> ${data.items[k].join(', ')}</div>`;
                }
            });
            Object.keys(data.extras || {}).forEach(k => {
                const catObj = appConfig.find(c => c.id === k);
                const catLabel = catObj ? catObj.label : k;
                detailsHtml += `<div class="mb-1 text-slate-500"><em>${catLabel} Note: ${data.extras[k]}</em></div>`;
            });
            
            if(data.weather) {
                detailsHtml += `<div class="mt-2 text-xs text-slate-400"><i class="fas fa-cloud"></i> ${data.weather.temp} F | ${data.weather.source}</div>`;
            }

            UI.recentLogDetails.innerHTML = detailsHtml || 'No specific items logged.';
        }
    } catch(e) {
        console.error('Failed to load recent log', e);
    }
};

const saveLog = async () => {
    try {
        const btnOrig = UI.logBtn.innerHTML;
        UI.logBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        UI.logBtn.disabled = true;

        let weather = null;
        if (!editDocId) {
            try {
                weather = await Promise.race([fetchWeather(), new Promise(r => setTimeout(r, 4000))]);
            } catch(e) { console.warn("Weather fetch failed"); }
        }
        
        let extras = {};
        appConfig.forEach(cat => {
            const val = document.getElementById(`extra-${cat.id}`).value.trim();
            if(val) extras[cat.id] = val;
        });

        let cleanSelections = {};
        Object.keys(currentSelections).forEach(k => {
            if(currentSelections[k] && currentSelections[k].length > 0) {
                cleanSelections[k] = currentSelections[k];
            }
        });
        
        let vitals = {};
        const vWeight = document.getElementById('vital-weight').value;
        const vBp = document.getElementById('vital-bp').value.trim();
        const vHr = document.getElementById('vital-hr').value;
        const vO2 = document.getElementById('vital-o2').value;
        const vSleep = document.getElementById('vital-sleep').value;
        if(vWeight) vitals.weight = vWeight;
        if(vBp) vitals.bp = vBp;
        if(vHr) vitals.hr = vHr;
        if(vO2) vitals.o2 = vO2;
        if(vSleep) vitals.sleep = vSleep;

        let logDateISO = new Date().toISOString();
        if(UI.logTime.value) {
            logDateISO = new Date(UI.logTime.value).toISOString();
        }

        const docData = {
            date: logDateISO,
            items: cleanSelections,
            extras: extras,
            vitals: Object.keys(vitals).length > 0 ? vitals : null
        };
        
        if(weather) {
            docData.weather = weather;
        }

        if (editDocId) {
            // Keep existing weather if editing
            await setDoc(doc(getTrackerCollection('logs'), editDocId), docData, { merge: true });
            showToast('Log Updated!');
            setTimeout(() => { window.location.href = 'history.html'; }, 1000);
            return;
        } else {
            await addDoc(getTrackerCollection('logs'), docData);
            showToast('Logged successfully!');
        }
        
        currentSelections = {};
        document.querySelectorAll('.item-btn.selected').forEach(b => {
            b.classList.remove('selected', 'bg-indigo-600', 'text-white', 'border-indigo-600');
            b.classList.add('bg-white', 'text-slate-700', 'border-slate-300');
        });
        document.querySelectorAll('input[type="text"], input[type="number"], input[type="datetime-local"]').forEach(i => {
            if(i.id.startsWith('extra-') || i.id.startsWith('vital-') || i.id === 'log-time') i.value = '';
        });
        setCurrentTimeDefault();
        
        document.querySelectorAll('.category-content.expanded').forEach(c => c.classList.remove('expanded'));
        document.querySelectorAll('.fa-chevron-up').forEach(i => {
            i.classList.remove('fa-chevron-up');
            i.classList.add('fa-chevron-down');
        });

        loadRecent();

    } catch(e) {
        console.error(e);
        alert('Failed to save log');
    } finally {
        UI.logBtn.innerHTML = editDocId ? '<i class="fas fa-save"></i> Update Log' : '<i class="fas fa-save"></i> Log Selected Items';
        UI.logBtn.disabled = false;
    }
};

const setCurrentTimeDefault = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    UI.logTime.value = now.toISOString().slice(0, 16);
};

const init = async () => {
    UI.settingApiCode.value = localStorage.getItem('wuApiCode') || '';
    UI.settingStationId.value = localStorage.getItem('wuStationId') || localStorage.getItem('wuStationIdCustom') || '';
    
    // Check if we are editing an existing log
    const urlParams = new URLSearchParams(window.location.search);
    editDocId = urlParams.get('edit');

    if (!editDocId) {
        setCurrentTimeDefault();
    } else {
        UI.logBtn.innerHTML = '<i class="fas fa-save"></i> Update Log';
    }

    try {
        const docSnap = await getDoc(getTrackerDoc('settings', 'config'));
        if (docSnap.exists()) {
            let data = docSnap.data();
            
            if (data && Array.isArray(data.arr)) {
                appConfig = data.arr;
            } else if(data && !Array.isArray(data) && Object.keys(data).length > 0) {
                // If it's the old object format (keys are categories, values are arrays)
                // Filter out the 'arr' key bug if it exists
                const formatLabel = (k) => k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                let migrated = Object.keys(data).filter(k => k !== 'arr' && k !== 'test').map(k => ({
                    id: k,
                    label: formatLabel(k),
                    items: Array.isArray(data[k]) ? data[k] : []
                }));
                appConfig = migrated;
                await setDoc(getTrackerDoc('settings', 'config'), { arr: appConfig });
            } else {
                appConfig = DEFAULT_CONFIG;
                await setDoc(getTrackerDoc('settings', 'config'), { arr: appConfig });
            }
        } else {
            appConfig = DEFAULT_CONFIG;
            await setDoc(getTrackerDoc('settings', 'config'), { arr: appConfig });
        }
        
        // If editing, load the log data and populate UI
        if(editDocId) {
            const logSnap = await getDoc(doc(getTrackerCollection('logs'), editDocId));
            if(logSnap.exists()) {
                const logData = logSnap.data();
                const d = new Date(logData.date);
                d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                UI.logTime.value = d.toISOString().slice(0, 16);
                
                if(logData.items) currentSelections = logData.items;
                
                renderUI(); // Render after selections loaded so buttons are marked
                
                if(logData.extras) {
                    Object.keys(logData.extras).forEach(k => {
                        const el = document.getElementById(`extra-${k}`);
                        if(el) el.value = logData.extras[k];
                    });
                }
                
                if(logData.vitals) {
                    if(logData.vitals.weight) document.getElementById('vital-weight').value = logData.vitals.weight;
                    if(logData.vitals.bp) document.getElementById('vital-bp').value = logData.vitals.bp;
                    if(logData.vitals.hr) document.getElementById('vital-hr').value = logData.vitals.hr;
                    if(logData.vitals.o2) document.getElementById('vital-o2').value = logData.vitals.o2;
                    if(logData.vitals.sleep) document.getElementById('vital-sleep').value = logData.vitals.sleep;
                    toggleCategory('vitals'); // Open vitals section
                }

                // Expand categories that have selections
                Object.keys(currentSelections).forEach(k => {
                    if(currentSelections[k].length > 0) toggleCategory(k);
                });

            } else {
                alert("Log not found.");
                window.location.href = 'index.html';
            }
        } else {
            renderUI();
        }

        if(!editDocId) loadRecent();

    } catch(e) {
        console.error('Init Error', e);
        document.body.innerHTML = 'Error initializing app. Check console.';
    }
};

UI.saveSettingsBtn.onclick = async () => {
    const apiCode = UI.settingApiCode.value.trim();
    const stationId = UI.settingStationId.value.trim();
    if(apiCode) localStorage.setItem('wuApiCode', apiCode);
    if(stationId) localStorage.setItem('wuStationId', stationId);

    syncSettingsDraft();

    try {
        await setDoc(getTrackerDoc('settings', 'config'), { arr: settingsDraft });
        appConfig = settingsDraft;
        renderUI(); // currentSelections might not match perfectly if items were removed, but safe enough
        document.getElementById('settings-modal').classList.add('hidden');
        showToast('Settings Saved');
    } catch(e) {
        alert('Failed to save settings');
    }
};

UI.logBtn.onclick = saveLog;

onAuthStateChanged(auth, user => {
    if(user) {
        init();
    }
});
