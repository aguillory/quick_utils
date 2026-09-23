// Reproduction logic for Animal Details Page

let currentSpeciesData = null; // To hold gestation info
let activePregnancyDoc = null; // The currently open mating document

document.addEventListener('DOMContentLoaded', () => {
    // Wait slightly to ensure Firebase and globals are loaded
    setTimeout(() => {
        if (!currentAnimalId) return;
        initReproduction();
    }, 1000);
});

async function initReproduction() {
    setupMatingModal();
    setupPregnancyCheckModal();
    
    // We need the specific species config to get gestation and breeding custom fields
    if (currentAnimalData && currentAnimalData.species) {
        const speciesSnapshot = await window.getFarmCollection('species')
            .where('name', '==', currentAnimalData.species)
            .limit(1)
            .get();
            
        if (!speciesSnapshot.empty) {
            currentSpeciesData = speciesSnapshot.docs[0].data();
            currentSpeciesData.id = speciesSnapshot.docs[0].id;
        }
    }
    
    loadBreedingHistory();
}

function setupMatingModal() {
    const btnLogMating = document.getElementById('btnLogMating');
    const toggleRange = document.getElementById('matingDateRangeToggle');
    const endDateGroup = document.getElementById('matingEndDateGroup');
    const startDateLabel = document.getElementById('matingDateLabel');
    
    if(btnLogMating) {
        btnLogMating.addEventListener('click', () => {
            document.getElementById('matingStartDate').value = formatDateForInput(new Date());
            document.getElementById('matingEndDate').value = formatDateForInput(new Date());
            populateMatingSires();
            populateBreedingCustomFields();
            document.getElementById('matingModal').classList.add('active');
        });
    }

    if(toggleRange) {
        toggleRange.addEventListener('change', (e) => {
            if (e.target.checked) {
                endDateGroup.style.display = 'block';
                startDateLabel.textContent = 'Start Date';
            } else {
                endDateGroup.style.display = 'none';
                startDateLabel.textContent = 'Date';
            }
        });
    }

    document.getElementById('matingForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveMatingRecord();
    });
}

function setupPregnancyCheckModal() {
    document.getElementById('btnLogPregnancyCheck')?.addEventListener('click', () => {
        document.getElementById('pregCheckDate').value = formatDateForInput(new Date());
        document.getElementById('pregnancyCheckModal').classList.add('active');
    });

    document.getElementById('pregnancyCheckForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await savePregnancyCheck();
    });
}

async function populateMatingSires() {
    const sireSelect = document.getElementById('matingSire');
    sireSelect.innerHTML = '<option value="">Unknown / None</option>';
    
    try {
        const snapshot = await window.getFarmCollection('animals')
            .where('gender', '==', 'Male')
            .where('species', '==', currentAnimalData.species)
            .get();
            
        snapshot.forEach(doc => {
            const data = doc.data();
            // Don't let them mate with themselves
            if (doc.id !== currentAnimalId) {
                const opt = document.createElement('option');
                opt.value = doc.id;
                opt.textContent = data.name + (data.tag ? ` (${data.tag})` : '');
                sireSelect.appendChild(opt);
            }
        });
    } catch (err) {
        console.error("Error loading sires:", err);
    }
}

function populateBreedingCustomFields() {
    const container = document.getElementById('matingCustomFieldsContainer');
    container.innerHTML = '';
    
    if (currentSpeciesData && currentSpeciesData.breedingFields && currentSpeciesData.breedingFields.length > 0) {
        currentSpeciesData.breedingFields.forEach(field => {
            const group = document.createElement('div');
            group.className = 'form-group';
            
            let inputHtml = '';
            const safeName = field.name.replace(/[^a-zA-Z0-9]/g, '');
            const fieldId = `breed_custom_${safeName}`;
            
            switch (field.type) {
                case 'text':
                    inputHtml = `<input type="text" id="${fieldId}" data-name="${field.name}">`;
                    break;
                case 'number':
                    inputHtml = `<input type="number" id="${fieldId}" data-name="${field.name}">`;
                    break;
                case 'date':
                    inputHtml = `<input type="date" id="${fieldId}" data-name="${field.name}">`;
                    break;
                case 'boolean':
                    inputHtml = `<select id="${fieldId}" data-name="${field.name}">
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                    </select>`;
                    break;
                case 'select':
                    const opts = field.options.map(o => `<option value="${o}">${o}</option>`).join('');
                    inputHtml = `<select id="${fieldId}" data-name="${field.name}">${opts}</select>`;
                    break;
            }
            
            group.innerHTML = `<label>${field.name}</label>${inputHtml}`;
            container.appendChild(group);
        });
    }
}

async function saveMatingRecord() {
    const useRange = document.getElementById('matingDateRangeToggle').checked;
    const startDate = document.getElementById('matingStartDate').value;
    const endDate = useRange ? document.getElementById('matingEndDate').value : startDate;
    
    const sireSelect = document.getElementById('matingSire');
    const sireName = sireSelect.options[sireSelect.selectedIndex].text;
    
    const customFields = {};
    document.querySelectorAll('#matingCustomFieldsContainer input, #matingCustomFieldsContainer select').forEach(el => {
        customFields[el.dataset.name] = el.value;
    });

    let dueMin = null;
    let dueMax = null;

    if (currentSpeciesData) {
        const gestMin = currentSpeciesData.gestationMin;
        const gestMax = currentSpeciesData.gestationMax;
        
        if (gestMin && gestMax) {
            dueMin = new Date(startDate + 'T00:00:00');
            dueMin.setDate(dueMin.getDate() + gestMin);
            
            dueMax = new Date(endDate + 'T00:00:00');
            dueMax.setDate(dueMax.getDate() + gestMax);
        }
    }

    const matingData = {
        animalId: currentAnimalId,
        farmId: currentFarmId,
        type: 'Mating', // vs Pregnancy Check vs Birth
        matingType: document.getElementById('matingType').value,
        sireId: sireSelect.value,
        sireName: sireName,
        startDate: firebase.firestore.Timestamp.fromDate(new Date(startDate + 'T00:00:00')),
        endDate: firebase.firestore.Timestamp.fromDate(new Date(endDate + 'T00:00:00')),
        dueMin: dueMin ? firebase.firestore.Timestamp.fromDate(dueMin) : null,
        dueMax: dueMax ? firebase.firestore.Timestamp.fromDate(dueMax) : null,
        customFields: customFields,
        notes: document.getElementById('matingNotes').value,
        status: 'Exposed', // Status goes Exposed -> Pregnant -> Complete (Birth) or Open (Failed)
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        const batch = firebase.firestore().batch();
        const docRef = window.getFarmCollection('breedingRecords').doc();
        batch.set(docRef, matingData);
        
        // Auto-schedule pregnancy check if configured
        if (currentSpeciesData && currentSpeciesData.pregnancyCheckDays) {
            const checkDate = new Date(endDate + 'T00:00:00');
            checkDate.setDate(checkDate.getDate() + currentSpeciesData.pregnancyCheckDays);
            
            const taskRef = window.getFarmCollection('healthTasks').doc();
            batch.set(taskRef, {
                animalId: currentAnimalId,
                animalName: currentAnimalData.name,
                farmId: currentFarmId,
                eventType: 'Pregnancy Check',
                description: `Pregnancy check after exposure to ${sireName}`,
                dueDate: firebase.firestore.Timestamp.fromDate(checkDate),
                status: 'pending',
                linkedRecordId: docRef.id,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        await batch.commit();
        document.getElementById('matingModal').classList.remove('active');
        loadBreedingHistory();
    } catch (err) {
        alert('Error saving mating: ' + err.message);
    }
}

async function loadBreedingHistory() {
    try {
        const snapshot = await window.getFarmCollection('breedingRecords')
            .where('animalId', '==', currentAnimalId)
            .get();
            
        const recordsList = document.getElementById('breedingRecordsList');
        const activeSection = document.getElementById('reproductionActiveSection');
        const activeDetails = document.getElementById('activePregnancyDetails');
        
        recordsList.innerHTML = '';
        activePregnancyDoc = null;
        
        if (snapshot.empty) {
            recordsList.innerHTML = '<div class="card"><p style="color: #666; text-align: center;">No breeding history found.</p></div>';
            activeSection.style.display = 'none';
            return;
        }

        // The most recent mating is the first one due to order.
        // Let's check if it's active.
        const recentDoc = snapshot.docs[0];
        const recentData = recentDoc.data();
        
        if (recentData.type === 'Mating' && (recentData.status === 'Exposed' || recentData.status === 'Pregnant')) {
            activePregnancyDoc = { id: recentDoc.id, ...recentData };
            activeSection.style.display = 'block';
            
            const dateStr = recentData.startDate.toDate().getTime() === recentData.endDate.toDate().getTime() ?
                formatDate(recentData.startDate) : 
                `${formatDate(recentData.startDate)} to ${formatDate(recentData.endDate)}`;
                
            let dueStr = 'Unknown';
            if (recentData.dueMin && recentData.dueMax) {
                if(recentData.dueMin.toDate().getTime() === recentData.dueMax.toDate().getTime()) {
                    dueStr = formatDate(recentData.dueMin);
                } else {
                    dueStr = `${formatDate(recentData.dueMin)} to ${formatDate(recentData.dueMax)}`;
                }
            }

            activeDetails.innerHTML = `
                <div><strong>Status:</strong> <span class="badge" style="background: ${recentData.status === 'Pregnant' ? '#4CAF50' : '#FFC107'}">${recentData.status}</span></div>
                <div><strong>Sire:</strong> ${recentData.sireName}</div>
                <div><strong>Mating Date(s):</strong> ${dateStr}</div>
                <div><strong>Due Window:</strong> ${dueStr}</div>
                <div style="grid-column: span 2;"><strong>Type:</strong> ${recentData.matingType}</div>
            `;
            
            // disable btnLogMating if already pregnant/exposed
            document.getElementById('btnLogMating').disabled = true;
            document.getElementById('btnLogMating').title = "Animal is already in an active breeding cycle.";
        } else {
            activeSection.style.display = 'none';
            document.getElementById('btnLogMating').disabled = false;
            document.getElementById('btnLogMating').title = "";
        }

        const docs = [];
        snapshot.forEach(doc => docs.push(doc.data()));
        docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        docs.forEach(data => {
            
            const div = document.createElement('div');
            div.className = 'card record-card';
            
            if (data.type === 'Mating') {
                const dates = data.startDate.toDate().getTime() === data.endDate.toDate().getTime() ?
                    formatDate(data.startDate) : 
                    `${formatDate(data.startDate)} - ${formatDate(data.endDate)}`;
                    
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between;">
                        <strong><i class="fas fa-heart" style="color:#e91e63;"></i> Mating / Exposure</strong>
                        <span>${dates}</span>
                    </div>
                    <div style="color: #666; margin-top:5px; font-size:0.9rem;">
                        Sire: ${data.sireName} | Method: ${data.matingType} <br>
                        Status: <strong>${data.status}</strong>
                    </div>
                    ${data.notes ? `<div style="margin-top:5px;"><em>"${data.notes}"</em></div>` : ''}
                `;
            } else if (data.type === 'Pregnancy Check') {
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between;">
                        <strong><i class="fas fa-stethoscope" style="color:#00bcd4;"></i> Pregnancy Check</strong>
                        <span>${formatDate(data.date)}</span>
                    </div>
                    <div style="color: #666; margin-top:5px; font-size:0.9rem;">
                        Result: <strong>${data.result}</strong> | Method: ${data.method}
                    </div>
                    ${data.notes ? `<div style="margin-top:5px;"><em>"${data.notes}"</em></div>` : ''}
                `;
            }
            
            recordsList.appendChild(div);
        });

    } catch (error) {
        console.error("Error loading breeding history", error);
    }
}

async function savePregnancyCheck() {
    if (!activePregnancyDoc) return;
    
    const result = document.getElementById('pregCheckResult').value;
    const dateStr = document.getElementById('pregCheckDate').value;
    
    const checkData = {
        animalId: currentAnimalId,
        farmId: currentFarmId,
        type: 'Pregnancy Check',
        linkedMatingId: activePregnancyDoc.id,
        date: firebase.firestore.Timestamp.fromDate(new Date(dateStr + 'T00:00:00')),
        result: result,
        method: document.getElementById('pregCheckMethod').value,
        notes: document.getElementById('pregCheckNotes').value,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    try {
        const batch = firebase.firestore().batch();
        
        // Save the check log
        const checkRef = window.getFarmCollection('breedingRecords').doc();
        batch.set(checkRef, checkData);
        
        // Update the mating doc status
        const matingRef = window.getFarmCollection('breedingRecords').doc(activePregnancyDoc.id);
        if (result === 'Pregnant') {
            batch.update(matingRef, { status: 'Pregnant' });
        } else if (result === 'Open') {
            batch.update(matingRef, { status: 'Open' });
        }
        // If Recheck, we leave status as Exposed or whatever it was
        
        await batch.commit();
        document.getElementById('pregnancyCheckModal').classList.remove('active');
        loadBreedingHistory();
    } catch (err) {
        alert('Error saving check: ' + err.message);
    }
}

// Add simple close logic for cancel button
document.getElementById('btnCancelPregnancy')?.addEventListener('click', async () => {
    if(!activePregnancyDoc) return;
    if(confirm('Are you sure you want to mark this animal as Open/Failed and close this cycle?')) {
        await window.getFarmCollection('breedingRecords').doc(activePregnancyDoc.id).update({
            status: 'Open'
        });
        loadBreedingHistory();
    }
});
