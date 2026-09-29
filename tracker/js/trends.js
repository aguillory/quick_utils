import { auth, getTrackerDoc, getTrackerCollection } from './connection.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { query, orderBy, limit, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let logs = [];
let allItems = [];
let chartInstance = null;

const UI = {
    loading: document.getElementById('loading-overlay'),
    dashboard: document.getElementById('dashboard'),
    laggingResults: document.getElementById('lagging-results'),
    tsTrigger: document.getElementById('ts-trigger'),
    tsTarget: document.getElementById('ts-target'),
    tsWindow: document.getElementById('ts-window'),
    tsBtn: document.getElementById('ts-btn'),
    tsResult: document.getElementById('ts-result'),
    wxSymptom: document.getElementById('wx-symptom'),
    wxMetric: document.getElementById('wx-metric'),
    wxBtn: document.getElementById('wx-btn'),
    ctx: document.getElementById('wxChart').getContext('2d')
};

const hasItem = (log, itemStr) => {
    if(!log.items) return false;
    return Object.values(log.items).some(arr => arr.includes(itemStr));
};

const calcLagging = () => {
    // Group logs by day string (local time)
    const byDay = {};
    logs.forEach(log => {
        const d = new Date(log.date);
        const dayStr = d.toLocaleDateString();
        if(!byDay[dayStr]) byDay[dayStr] = [];
        byDay[dayStr].push(log);
    });
    const days = Object.keys(byDay).sort((a,b) => new Date(a) - new Date(b));

    const correlations = [];
    
    // For every pair of items A and B
    // If A happens on day N, how often does B happen on day N+1?
    
    const candidatesA = allItems;
    const candidatesB = allItems; // Compare everything

    // For simplicity and speed, let's just pre-calculate which days have which items
    const dayHasItem = {};
    days.forEach(dayStr => {
        dayHasItem[dayStr] = new Set();
        byDay[dayStr].forEach(log => {
            if(log.items) {
                Object.values(log.items).forEach(arr => arr.forEach(i => dayHasItem[dayStr].add(i)));
            }
        });
    });

    candidatesA.forEach(itemA => {
        // Find days where itemA occurred
        const daysWithA = days.filter(d => dayHasItem[d].has(itemA));
        if(daysWithA.length < 3) return; // Need at least 3 occurrences to be interesting

        candidatesB.forEach(itemB => {
            if(itemA === itemB) return;

            let matches = 0;
            daysWithA.forEach(dayStr => {
                // Find next day
                const d = new Date(dayStr);
                d.setDate(d.getDate() + 1);
                const nextDayStr = d.toLocaleDateString();
                if(dayHasItem[nextDayStr] && dayHasItem[nextDayStr].has(itemB)) {
                    matches++;
                }
            });

            const percentage = (matches / daysWithA.length) * 100;
            if(percentage >= 50 && matches >= 2) {
                correlations.push({ trigger: itemA, target: itemB, pct: percentage, count: daysWithA.length });
            }
        });
    });

    correlations.sort((a,b) => b.pct - a.pct);
    
    if(correlations.length === 0) {
        UI.laggingResults.innerHTML = '<div class="text-sm text-slate-500">Not enough data to find strong correlations yet. Keep logging!</div>';
    } else {
        UI.laggingResults.innerHTML = correlations.slice(0, 5).map(c => 
            `<div class="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-sm text-indigo-900">
                <strong>${c.trigger}</strong> on Day 1 led to <strong>${c.target}</strong> on Day 2 in <strong>${Math.round(c.pct)}%</strong> of cases (${c.count} instances).
            </div>`
        ).join('');
    }
};

const runTimeShifted = () => {
    const trigger = UI.tsTrigger.value;
    const target = UI.tsTarget.value;
    const windowHours = parseInt(UI.tsWindow.value);
    
    let triggerCount = 0;
    let matchCount = 0;

    // Sort ascending by time for this analysis
    const ascLogs = [...logs].sort((a,b) => new Date(a.date) - new Date(b.date));

    for(let i=0; i<ascLogs.length; i++) {
        if(hasItem(ascLogs[i], trigger)) {
            triggerCount++;
            const tDate = new Date(ascLogs[i].date).getTime();
            
            // Look ahead
            let found = false;
            for(let j=i+1; j<ascLogs.length; j++) {
                const aheadDate = new Date(ascLogs[j].date).getTime();
                const diffHours = (aheadDate - tDate) / (1000 * 60 * 60);
                if(diffHours > windowHours) break; // Past window
                
                if(hasItem(ascLogs[j], target)) {
                    found = true;
                    break;
                }
            }
            if(found) matchCount++;
        }
    }

    UI.tsResult.classList.remove('hidden');
    if(triggerCount === 0) {
        UI.tsResult.innerHTML = `You haven't logged <strong>${trigger}</strong> yet.`;
    } else {
        const pct = Math.round((matchCount / triggerCount) * 100);
        UI.tsResult.innerHTML = `When you log <strong>${trigger}</strong>, you log <strong>${target}</strong> within ${windowHours} hours <strong>${pct}%</strong> of the time. (Based on ${triggerCount} occurrences)`;
    }
};

const renderChart = () => {
    const symptom = UI.wxSymptom.value;
    const metric = UI.wxMetric.value;
    
    // Filter logs that have weather
    const wxLogs = [...logs].filter(l => l.weather && l.weather[metric] != null).sort((a,b) => new Date(a.date) - new Date(b.date));
    
    if(wxLogs.length === 0) {
        alert("No weather data found in your logs.");
        return;
    }

    const labels = wxLogs.map(l => new Date(l.date));
    const metricData = wxLogs.map(l => parseFloat(l.weather[metric]));
    
    // We will draw the metric as a line, and put large red points where the symptom occurred
    const pointColors = wxLogs.map(l => hasItem(l, symptom) ? 'rgba(220, 38, 38, 1)' : 'rgba(203, 213, 225, 0.5)');
    const pointRadii = wxLogs.map(l => hasItem(l, symptom) ? 6 : 2);

    let metricName = "Pressure";
    if(metric==='temp') metricName = "Temperature";
    if(metric==='humidity') metricName = "Humidity";

    if(chartInstance) chartInstance.destroy();

    chartInstance = new Chart(UI.ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: metricName,
                data: metricData,
                borderColor: '#4f46e5',
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointBackgroundColor: pointColors,
                pointBorderColor: pointColors,
                pointRadius: pointRadii,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        displayFormats: { day: 'MMM d' }
                    },
                    title: { display: true, text: 'Date' }
                },
                y: {
                    title: { display: true, text: metricName }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const l = wxLogs[context.dataIndex];
                            let text = `${metricName}: ${context.parsed.y}`;
                            if(hasItem(l, symptom)) text += ` (Logged ${symptom})`;
                            return text;
                        }
                    }
                }
            }
        }
    });
};

const init = async () => {
    try {
        // Fetch config for items
        const configSnap = await getDoc(getTrackerDoc('settings', 'config'));
        if(configSnap.exists()) {
            const data = configSnap.data();
            let arr = [];
            if(data.arr) arr = data.arr;
            else if(!Array.isArray(data)) arr = Object.keys(data).map(k => ({id:k, items: data[k]}));
            
            arr.forEach(cat => {
                if(cat.items) cat.items.forEach(i => allItems.push(i));
            });
        }
        allItems = [...new Set(allItems)].sort();

        // Populate dropdowns
        const pop = (el) => {
            allItems.forEach(i => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = i;
                el.appendChild(opt);
            });
        };
        pop(UI.tsTrigger);
        pop(UI.tsTarget);
        pop(UI.wxSymptom);

        // Fetch logs
        const q = query(getTrackerCollection('logs'), orderBy('date', 'desc'), limit(1000));
        const snap = await getDocs(q);
        snap.forEach(d => logs.push(d.data()));

        UI.loading.classList.add('hidden');
        UI.dashboard.classList.remove('hidden');

        calcLagging();

        UI.tsBtn.onclick = runTimeShifted;
        UI.wxBtn.onclick = renderChart;
        
        // Initial chart render
        if(allItems.length > 0) renderChart();

    } catch(e) {
        console.error(e);
        UI.loading.innerHTML = '<div class="text-red-500">Error loading data.</div>';
    }
};

onAuthStateChanged(auth, user => {
    if(user) {
        init();
    }
});
