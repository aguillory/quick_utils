let currentUser = null;
let currentFarmId = null;
let dairyAnimals = [];

document.addEventListener('DOMContentLoaded', () => {
    // Default to today
    document.getElementById('milkDate').value = formatDateForInput(new Date());
    
    // Load preferred unit
    const savedUnit = localStorage.getItem('farmDairyUnit') || 'lbs';
    document.getElementById('globalUnitSelect').value = savedUnit;
    
    document.getElementById('globalUnitSelect').addEventListener('change', (e) => {
        localStorage.setItem('farmDairyUnit', e.target.value);
        // Update all rows
        document.querySelectorAll('.row-unit').forEach(select => {
            select.value = e.target.value;
        });
    });

    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            try {
                const farmDoc = await window.getFarmCollection('farms').doc(currentUser.uid).get();
                if (farmDoc.exists) {
                    currentFarmId = farmDoc.id;
                    await loadDairyAnimals();
                    document.getElementById('milkDate').addEventListener('change', loadDairyAnimals);
                }
            } catch (err) {
                console.error("Error loading farm data:", err);
            }
        } else {
            window.location.href = 'index.html';
        }
    });

    document.getElementById('btnSaveMilk').addEventListener('click', saveMilkLogs);
});

async function loadDairyAnimals() {
    const tbody = document.getElementById('dairyTableBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Loading...</td></tr>';
    
    try {
        // 1. Get all dairy species
        const speciesSnap = await window.getFarmCollection('species')
            .where('farmId', '==', currentFarmId)
            .where('isDairy', '==', true)
            .get();
            
        if (speciesSnap.empty) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No dairy species configured. Go to Species settings and mark a species as "Dairy".</td></tr>';
            return;
        }
        
        const dairySpeciesNames = speciesSnap.docs.map(d => d.data().name);
        
        // 2. Get all females of those species
        const rawAnimalsSnap = await window.getFarmCollection('animals').where('farmId', '==', currentFarmId).get();
        
        // Client-side filtering for gender and species to bypass any index/case issues
        const filteredAnimals = rawAnimalsSnap.docs.filter(doc => {
            const data = doc.data();
            const isFemale = data.gender === 'Female' || data.gender === 'female';
            const isDairy = dairySpeciesNames.includes(data.species);
            return isFemale && isDairy;
        });
        
        const animalsSnap = {
            empty: filteredAnimals.length === 0,
            docs: filteredAnimals
        };
            
        console.log('FARM ID IS:', currentFarmId, 'GENDER IS female', 'SPECIES ARE:', dairySpeciesNames); if (animalsSnap.empty) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No female dairy animals found.</td></tr>';
            return;
        }
        
        dairyAnimals = animalsSnap.docs.map(d => ({id: d.id, ...d.data()}));
        
        // 3. Get existing milk logs for the selected date to pre-fill
        const selectedDateStr = document.getElementById('milkDate').value;
        const selectedDateStart = new Date(selectedDateStr + 'T00:00:00');
        const selectedDateEnd = new Date(selectedDateStr + 'T23:59:59');
        
        const logsSnap = await window.getFarmCollection('milkLogs').where('farmId', '==', currentFarmId).get();
    
    // Filter date manually to avoid missing index
    const filteredDocs = logsSnap.docs.filter(doc => {
        const d = doc.data().date.toDate();
        return d >= selectedDateStart && d <= selectedDateEnd;
    });
    // Create a mock snapshot to iterate over
    const manualLogsSnap = { forEach: (cb) => filteredDocs.forEach(cb) };
            
        const existingLogs = {};
        manualLogsSnap.forEach(doc => {
            const data = doc.data();
            existingLogs[data.animalId] = { id: doc.id, ...data };
        });

        // 4. Get active health records to check for Dairy Withdrawal
        const healthSnap = await window.getFarmCollection('healthRecords')
            .where('farmId', '==', currentFarmId)
            .get();
            
        const activeWithdrawals = {};
        const checkTime = selectedDateStart.getTime();
        
        healthSnap.forEach(doc => {
            const data = doc.data();
            if (data.withdrawal && data.withdrawal.dairy && data.withdrawal.dairy.endDate) {
                const end = data.withdrawal.dairy.endDate.toDate().getTime();
                if (end > checkTime) {
                    // Still in withdrawal on this date
                    activeWithdrawals[data.animalId] = {
                        reason: data.medication || data.description,
                        endDate: data.withdrawal.dairy.endDate.toDate()
                    };
                }
            }
        });

        // 5. Render
        tbody.innerHTML = '';
        const defaultUnit = document.getElementById('globalUnitSelect').value;
        
        // Sort: In Milk first, then by name
        dairyAnimals.sort((a, b) => {
            if (a.inMilk && !b.inMilk) return -1;
            if (!a.inMilk && b.inMilk) return 1;
            return a.name.localeCompare(b.name);
        });

        dairyAnimals.forEach(animal => {
            const log = existingLogs[animal.id] || {};
            const withdrawal = activeWithdrawals[animal.id];
            
            const tr = document.createElement('tr');
            if (withdrawal) tr.className = 'warning-row';
            if (!animal.inMilk && !log.id) tr.style.opacity = '0.6'; // Dim dry animals unless they have a log today
            
            let statusHtml = `
                <select class="status-toggle" data-id="${animal.id}" style="border:none; background:transparent; font-weight:bold; color: ${animal.inMilk ? '#4CAF50' : '#999'}">
                    <option value="true" ${animal.inMilk ? 'selected' : ''}>In Milk</option>
                    <option value="false" ${!animal.inMilk ? 'selected' : ''}>Dry</option>
                </select>
            `;

            let notesHtml = `<input type="text" class="log-notes" value="${log.notes || ''}" style="width:100%; border:1px solid #ccc; padding:6px;">`;
            if (withdrawal) {
                notesHtml = `<div style="color:#d32f2f; font-size:0.8rem; font-weight:bold; margin-bottom:4px;"><i class="fas fa-exclamation-triangle"></i> WITHDRAWAL (${formatDate(withdrawal.endDate)})</div>` + notesHtml;
            }

            tr.innerHTML = `
                <td>
                    <a href="animal-details.html?id=${animal.id}" style="text-decoration:none; color:inherit; font-weight:600;">
                        ${animal.name} ${animal.tag ? `(${animal.tag})` : ''}
                    </a>
                    <input type="hidden" class="log-id" value="${log.id || ''}">
                    <input type="hidden" class="animal-id" value="${animal.id}">
                </td>
                <td>${statusHtml}</td>
                <td><input type="number" step="0.01" class="log-am" value="${log.am !== undefined ? log.am : ''}" placeholder="0"></td>
                <td><input type="number" step="0.01" class="log-pm" value="${log.pm !== undefined ? log.pm : ''}" placeholder="0"></td>
                <td><input type="number" step="0.01" class="log-total" value="${log.total !== undefined ? log.total : ''}" placeholder="0" style="font-weight:bold;"></td>
                <td>
                    <select class="row-unit">
                        <option value="lbs" ${log.unit === 'lbs' || (!log.unit && defaultUnit === 'lbs') ? 'selected' : ''}>lbs</option>
                        <option value="oz" ${log.unit === 'oz' || (!log.unit && defaultUnit === 'oz') ? 'selected' : ''}>oz</option>
                        <option value="gal" ${log.unit === 'gal' || (!log.unit && defaultUnit === 'gal') ? 'selected' : ''}>gal</option>
                        <option value="kg" ${log.unit === 'kg' || (!log.unit && defaultUnit === 'kg') ? 'selected' : ''}>kg</option>
                        <option value="L" ${log.unit === 'L' || (!log.unit && defaultUnit === 'L') ? 'selected' : ''}>L</option>
                    </select>
                </td>
                <td>${notesHtml}</td>
            `;
            
            // Auto-calculate total
            const amInput = tr.querySelector('.log-am');
            const pmInput = tr.querySelector('.log-pm');
            const totalInput = tr.querySelector('.log-total');
            
            const calcTotal = () => {
                const am = parseFloat(amInput.value) || 0;
                const pm = parseFloat(pmInput.value) || 0;
                if (am > 0 || pm > 0) {
                    totalInput.value = (am + pm).toFixed(2);
                }
            };
            
            amInput.addEventListener('input', calcTotal);
            pmInput.addEventListener('input', calcTotal);

            // Handle status toggle saving immediately
            const statusSelect = tr.querySelector('.status-toggle');
            statusSelect.addEventListener('change', async (e) => {
                const isMilk = e.target.value === 'true';
                e.target.style.color = isMilk ? '#4CAF50' : '#999';
                try {
                    await window.getFarmCollection('animals').doc(animal.id).update({ inMilk: isMilk });
                    if (!isMilk) tr.style.opacity = '0.6';
                    else tr.style.opacity = '1';
                } catch(err) {
                    console.error("Error updating status", err);
                }
            });
            
            tbody.appendChild(tr);
        });
        
    } catch (err) {
        console.error("Error loading dairy data:", err);
        tbody.innerHTML = `<tr><td colspan="7" style="color:red;">Error: ${err.message}</td></tr>`;
    }
}

async function saveMilkLogs() {
    const btn = document.getElementById('btnSaveMilk');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    const selectedDateStr = document.getElementById('milkDate').value;
    const logDate = firebase.firestore.Timestamp.fromDate(new Date(selectedDateStr + 'T12:00:00'));
    
    const rows = document.querySelectorAll('#dairyTableBody tr');
    const batch = firebase.firestore().batch();
    let hasChanges = false;
    
    rows.forEach(tr => {
        const animalId = tr.querySelector('.animal-id')?.value;
        if (!animalId) return; // Empty or error row
        
        const logId = tr.querySelector('.log-id').value;
        const totalRaw = tr.querySelector('.log-total').value;
        const amRaw = tr.querySelector('.log-am').value;
        const pmRaw = tr.querySelector('.log-pm').value;
        
        // If they left everything blank, and there was no previous log, skip
        if (!totalRaw && !amRaw && !pmRaw && !logId) return;
        
        // If they had a log and cleared it, delete it
        if (!totalRaw && !amRaw && !pmRaw && logId) {
            batch.delete(window.getFarmCollection('milkLogs').doc(logId));
            hasChanges = true;
            return;
        }

        const data = {
            farmId: currentFarmId,
            animalId: animalId,
            date: logDate,
            am: amRaw ? parseFloat(amRaw) : null,
            pm: pmRaw ? parseFloat(pmRaw) : null,
            total: totalRaw ? parseFloat(totalRaw) : null,
            unit: tr.querySelector('.row-unit').value,
            notes: tr.querySelector('.log-notes').value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        if (logId) {
            batch.update(window.getFarmCollection('milkLogs').doc(logId), data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            batch.set(window.getFarmCollection('milkLogs').doc(), data);
        }
        hasChanges = true;
    });
    
    try {
        if (hasChanges) {
            await batch.commit();
            showNotification('Milk logs saved successfully!');
            await loadDairyAnimals(); // Reload to get new log IDs
        } else {
            showNotification('No changes to save.', 'info');
        }
    } catch (err) {
        console.error("Error saving milk logs", err);
        alert("Error saving: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save Daily Logs';
    }
}
