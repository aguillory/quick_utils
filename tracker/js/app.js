import { auth, getTrackerDoc, getTrackerCollection } from './connection.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getDoc, setDoc, addDoc, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { DEFAULT_CONFIG } from './defaultConfig.js';

let appConfig = null;
let currentSelections = {};

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
                conditions: obs.winddir // WU doesn't give simple text conditions on PWS without forecast
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
            pressure: (data.current.surface_pressure * 0.02953).toFixed(2), // hPa to inHg
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

const renderUI = () => {
    UI.categoriesContainer.innerHTML = '';
    UI.settingsLists.innerHTML = '';
    
    const formatLabel = (key) => key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    Object.keys(appConfig).forEach(key => {
        const items = appConfig[key];
        const label = formatLabel(key);

        // Category UI
        const catDiv = document.createElement('div');
        catDiv.className = 'bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden';
        
        const header = document.createElement('button');
        header.className = 'w-full px-4 py-4 flex justify-between items-center bg-slate-50 hover:bg-slate-100 transition text-left';
        header.onclick = () => toggleCategory(key);
        header.innerHTML = `<span class="font-bold text-slate-800">${label}</span><i id="icon-${key}" class="fas fa-chevron-down text-slate-400"></i>`;
        
        const content = document.createElement('div');
        content.id = `content-${key}`;
        content.className = 'category-content p-4 border-t border-slate-100';
        
        const grid = document.createElement('div');
        grid.className = 'flex flex-wrap gap-2';
        
        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'item-btn px-4 py-2 rounded-full border border-slate-300 bg-white text-slate-700 text-sm hover:border-indigo-400 transition-colors';
            btn.textContent = item;
            btn.onclick = () => toggleItem(key, item, btn);
            grid.appendChild(btn);
        });

        // Add custom text input for extra stuff
        const extraDiv = document.createElement('div');
        extraDiv.className = 'w-full mt-3';
        extraDiv.innerHTML = `<input type="text" id="extra-${key}" placeholder="Add a custom note/value..." class="w-full text-sm border rounded-lg p-2 focus:ring focus:ring-indigo-200">`;
        
        content.appendChild(grid);
        content.appendChild(extraDiv);
        catDiv.appendChild(header);
        catDiv.appendChild(content);
        UI.categoriesContainer.appendChild(catDiv);

        // Settings UI
        const setDiv = document.createElement('div');
        setDiv.innerHTML = `
            <label class="block text-slate-600 mb-1 font-semibold text-sm">${label}</label>
            <textarea id="set-val-${key}" rows="2" class="w-full border rounded-lg p-2 text-sm focus:ring focus:ring-indigo-200">${items.join(', ')}</textarea>
        `;
        UI.settingsLists.appendChild(setDiv);
    });
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
            
            // Generate summary
            let summaryParts = [];
            Object.keys(data.items || {}).forEach(k => {
                if(data.items[k].length > 0) summaryParts.push(data.items[k].length + ' ' + k.split('_')[0]);
            });
            UI.recentLogSummary.textContent = summaryParts.length > 0 ? summaryParts.join(', ') : 'Empty log';
            
            // Details
            let detailsHtml = '';
            
            // Render vitals if they exist
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
                    detailsHtml += `<div class="mb-1"><strong class="capitalize">${k.replace('_',' ')}:</strong> ${data.items[k].join(', ')}</div>`;
                }
            });
            Object.keys(data.extras || {}).forEach(k => {
                detailsHtml += `<div class="mb-1 text-slate-500"><em>${k.replace('_',' ')} Note: ${data.extras[k]}</em></div>`;
            });
            
            if(data.weather) {
                detailsHtml += `<div class="mt-2 text-xs text-slate-400"><i class="fas fa-cloud"></i> ${data.weather.temp}°F | ${data.weather.source}</div>`;
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

        // Fetch weather in the background but don't strictly wait to block the UI forever if it's slow
        let weather = null;
        try {
            weather = await Promise.race([fetchWeather(), new Promise(r => setTimeout(r, 4000))]);
        } catch(e) { console.warn("Weather fetch failed"); }
        
        let extras = {};
        Object.keys(appConfig).forEach(k => {
            const val = document.getElementById(`extra-${k}`).value.trim();
            if(val) extras[k] = val;
        });

        // Cleanup empty selections
        let cleanSelections = {};
        Object.keys(currentSelections).forEach(k => {
            if(currentSelections[k] && currentSelections[k].length > 0) {
                cleanSelections[k] = currentSelections[k];
            }
        });
        
        // Grab vitals
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

        // Determine correct date based on override selector
        let logDateISO = new Date().toISOString();
        if(UI.logTime.value) {
            logDateISO = new Date(UI.logTime.value).toISOString();
        }

        const docData = {
            date: logDateISO,
            items: cleanSelections,
            extras: extras,
            vitals: Object.keys(vitals).length > 0 ? vitals : null,
            weather: weather
        };

        await addDoc(getTrackerCollection('logs'), docData);
        
        showToast('Logged successfully!');
        
        // Reset selections
        currentSelections = {};
        document.querySelectorAll('.item-btn.selected').forEach(b => {
            b.classList.remove('selected', 'bg-indigo-600', 'text-white', 'border-indigo-600');
            b.classList.add('bg-white', 'text-slate-700', 'border-slate-300');
        });
        document.querySelectorAll('input[type="text"], input[type="number"], input[type="datetime-local"]').forEach(i => {
            if(i.id.startsWith('extra-') || i.id.startsWith('vital-') || i.id === 'log-time') i.value = '';
        });
        setCurrentTimeDefault();
        
        // Collapse all
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
        UI.logBtn.innerHTML = '<i class="fas fa-save"></i> Log Selected Items';
        UI.logBtn.disabled = false;
    }
};

const setCurrentTimeDefault = () => {
    const now = new Date();
    // Format required by datetime-local is YYYY-MM-DDThh:mm
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    UI.logTime.value = now.toISOString().slice(0, 16);
};

const init = async () => {
    // Check local storage for WU config
    UI.settingApiCode.value = localStorage.getItem('wuApiCode') || '';
    UI.settingStationId.value = localStorage.getItem('wuStationId') || localStorage.getItem('wuStationIdCustom') || '';
    setCurrentTimeDefault();

    try {
        const docSnap = await getDoc(getTrackerDoc('settings', 'config'));
        if (docSnap.exists()) {
            appConfig = docSnap.data();
        } else {
            appConfig = DEFAULT_CONFIG;
            await setDoc(getTrackerDoc('settings', 'config'), appConfig);
        }
        
        renderUI();
        loadRecent();

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

    let newConfig = {};
    Object.keys(appConfig).forEach(k => {
        const val = document.getElementById(`set-val-${k}`).value;
        newConfig[k] = val.split(',').map(s => s.trim()).filter(s => s.length > 0);
    });

    try {
        await setDoc(getTrackerDoc('settings', 'config'), newConfig);
        appConfig = newConfig;
        renderUI();
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
