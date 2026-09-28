import { auth, getTrackerCollection } from './connection.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const container = document.getElementById('history-container');

const loadHistory = async () => {
    try {
        const q = query(getTrackerCollection('logs'), orderBy('date', 'desc'), limit(50));
        const snap = await getDocs(q);
        
        if(snap.empty) {
            container.innerHTML = '<div class="text-center text-slate-400 py-10">No history found.</div>';
            return;
        }

        let html = '';
        snap.forEach(doc => {
            const data = doc.data();
            const d = new Date(data.date);
            
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
                    detailsHtml += `<div class="mb-2 pb-2 border-b text-sm"><strong class="capitalize text-indigo-700">Vitals:</strong> ${vitalList.join(', ')}</div>`;
                }
            }

            Object.keys(data.items || {}).forEach(k => {
                if(data.items[k].length > 0) {
                    detailsHtml += `<div class="mb-1 text-sm"><strong class="capitalize text-slate-700">${k.replace('_',' ')}:</strong> ${data.items[k].join(', ')}</div>`;
                }
            });
            Object.keys(data.extras || {}).forEach(k => {
                detailsHtml += `<div class="mb-1 text-sm text-slate-500"><strong class="capitalize">${k.replace('_',' ')} Note:</strong> ${data.extras[k]}</div>`;
            });

            let weatherHtml = '';
            if(data.weather) {
                weatherHtml = `<div class="mt-3 text-xs text-slate-400 flex items-center gap-2 border-t pt-2">
                    <i class="fas fa-cloud"></i>
                    <span>${data.weather.temp}°F</span>
                    <span>H: ${data.weather.humidity}%</span>
                    <span>P: ${data.weather.pressure}</span>
                    <span>W: ${data.weather.wind}mph</span>
                    <span class="ml-auto">${data.weather.source}</span>
                </div>`;
            }

            html += `
                <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
                    <div class="font-bold text-indigo-600 mb-2 border-b pb-2">
                        <i class="fas fa-calendar-alt mr-1"></i> ${d.toLocaleString([], {weekday: 'long', month:'short', day:'numeric', hour: '2-digit', minute:'2-digit'})}
                    </div>
                    ${detailsHtml || '<div class="text-sm text-slate-400">No specific items logged.</div>'}
                    ${weatherHtml}
                </div>
            `;
        });
        
        container.innerHTML = html;

    } catch(e) {
        console.error(e);
        container.innerHTML = '<div class="text-center text-red-400 py-10">Error loading history.</div>';
    }
};

onAuthStateChanged(auth, user => {
    if(user) {
        loadHistory();
    }
});
