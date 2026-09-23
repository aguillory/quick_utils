// animal-details.js

let currentAnimalId = null;
let currentAnimalData = null;
let currentUser = null;
let allSpecies = [];
let currentFarmId = null;

firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        const urlParams = new URLSearchParams(window.location.search);
        currentAnimalId = urlParams.get('id');

        window.getFarmCollection('farms').doc(currentUser.uid).get().then(doc => {
            if(doc.exists) currentFarmId = doc.id;
        });

        if (currentAnimalId) {
            loadInitialData();
        } else {
            alert('No animal specified');
            window.location.href = 'animals.html';
        }
    } else {
        window.location.href = 'index.html';
    }
});

async function loadInitialData() {
    const speciesSnap = await window.getFarmCollection('species').get();
    allSpecies = speciesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const speciesSelect = document.getElementById('animalSpecies');
    speciesSelect.innerHTML = '<option value="">Select Species</option>';
    allSpecies.forEach(s => {
        speciesSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });

    await loadAnimalDetails();
    loadHealthHistory();
    setupEventListeners();
}

async function loadAnimalDetails() {
    try {
        const doc = await window.getFarmCollection('animals').doc(currentAnimalId).get();
        if (!doc.exists) {
            alert('Animal not found');
            return;
        }

        const data = doc.data();
        currentAnimalData = data;
        const species = allSpecies.find(s => s.id === data.species);
        
        const displayName = data.isGroup ? `${data.name} (Flock of ${data.quantity || 1})` : data.name;
        document.getElementById('detailName').textContent = displayName;
        document.getElementById('detailStatus').textContent = (data.status || 'Active').toUpperCase();
        document.getElementById('detailStatus').className = `animal-status status-${data.status || 'active'}`;
        document.getElementById('detailSpecies').textContent = species ? species.name : 'Unknown';
        document.getElementById('detailGender').textContent = data.gender || '-';
        document.getElementById('detailColor').textContent = data.color || '-';
        document.getElementById('detailAge').textContent = calculateAge(data.birthDate); // Uses shared.js
        document.getElementById('detailTag').textContent = data.tagNumber || '-';

        if (data.ownerFarmId) {
            const farmDoc = await window.getFarmCollection('farms').doc(data.ownerFarmId).get();
            document.getElementById('detailOwner').textContent = farmDoc.exists ? farmDoc.data().farmName : 'Unknown Farm';
        } else {
            document.getElementById('detailOwner').textContent = data.ownerCustom || '-';
        }
        
        const photoContainer = document.getElementById('detailPhoto');
        if (data.photo) {
            photoContainer.innerHTML = `<img src="${data.photo}" class="details-photo">`;
        } else {
            photoContainer.innerHTML = `<div class="no-photo-placeholder"><i class="fas fa-paw"></i></div>`;
        }

        const customContainer = document.getElementById('detailCustomFields');
        const customGrid = document.getElementById('customFieldsGrid');
        customGrid.innerHTML = '';
        if (data.customFields && Object.keys(data.customFields).length > 0) {
            customContainer.style.display = 'block';
            for (const [key, value] of Object.entries(data.customFields)) {
                customGrid.innerHTML += `
                    <div class="info-item">
                        <label>${key}</label>
                        <span>${value}</span>
                    </div>`;
            }
        } else {
            customContainer.style.display = 'none';
        }

        const flockBadge = document.getElementById('flockBadge');
        if (data.flockId) {
            const flockDoc = await window.getFarmCollection('animals').doc(data.flockId).get();
            if (flockDoc.exists) {
                flockBadge.style.display = 'inline-block';
                flockBadge.innerHTML = `<a href="animal-details.html?id=${data.flockId}" style="color: inherit; text-decoration: none;">Member of ${flockDoc.data().name} <i class="fas fa-link"></i></a>`;
            }
        } else {
            flockBadge.style.display = 'none';
        }

        const flockMembersSection = document.getElementById('flockMembersSection');
        if (data.isGroup) {
            flockMembersSection.style.display = 'block';
            await loadFlockMembers(currentAnimalId);
        } else {
            flockMembersSection.style.display = 'none';
        }

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('animalContent').classList.remove('hidden');

    } catch (error) {
        console.error("Error loading details:", error);
    }
}

async function loadFlockMembers(flockId) {
    try {
        const snapshot = await window.getFarmCollection('animals').where('flockId', '==', flockId).get();
        const listContainer = document.getElementById('flockMembersList');
        listContainer.innerHTML = '';
        
        if (snapshot.empty) {
            listContainer.innerHTML = '<div style="grid-column: 1 / -1; color: #666;">No members in this flock.</div>';
            return;
        }

        snapshot.forEach(doc => {
            const animal = { id: doc.id, ...doc.data() };
            const card = document.createElement('div');
            card.className = 'animal-card';
            card.style.cursor = 'pointer';
            card.style.position = 'relative';
            
            card.onclick = (e) => {
                window.location.href = `animal-details.html?id=${animal.id}`;
            };
            
            const photoHtml = animal.photo 
                ? `<img src="${animal.photo}" style="width:100%; height:150px; object-fit:cover;">`
                : `<div class="no-photo-placeholder" style="width:100%;height:150px;display:flex;align-items:center;justify-content:center;font-size:2rem;background:#f5f5f5;color:#ccc;"><i class="fas fa-paw"></i></div>`;

            card.innerHTML = `
                <div class="animal-photo-wrapper">
                    ${photoHtml}
                </div>
                <div class="animal-info" style="padding: 10px;">
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <div class="animal-name" style="font-weight: 600;">${animal.name}</div>
                        <button class="btn-icon" style="color: var(--danger-color); padding: 0; background:none; border:none; cursor:pointer;" 
                                onclick="event.stopPropagation(); removeFlockMember('${animal.id}', '${animal.name}')" title="Remove from flock">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="animal-details" style="font-size: 0.9rem; color: #666;">Gender: ${animal.gender || 'Unknown'}</div>
                </div>
            `;
            listContainer.appendChild(card);
        });
    } catch (err) {
        console.error("Error loading flock members", err);
    }
}

async function removeFlockMember(animalId, animalName) {
    if (confirm(`Are you sure you want to remove ${animalName} from this flock?`)) {
        try {
            await window.getFarmCollection('animals').doc(animalId).update({
                flockId: null
            });
            await loadFlockMembers(currentAnimalId); // reload
        } catch(err) {
            alert('Error removing member: ' + err.message);
        }
    }
}

async function loadHealthHistory() {
    const list = document.getElementById('healthRecordsList');
    list.innerHTML = '<div class="loading-placeholder"><i class="fas fa-spinner fa-spin"></i> Loading records...</div>';

    try {
        const snapshot = await window.getFarmCollection('healthRecords')
            .where('animalId', '==', currentAnimalId)
            .get();

        list.innerHTML = '';
        if (snapshot.empty) {
            list.innerHTML = '<div class="empty-state">No medical history found.</div>';
            return;
        }

        const docs = [];
        snapshot.forEach(doc => docs.push(doc.data()));
        docs.sort((a, b) => (b.eventDate?.seconds || 0) - (a.eventDate?.seconds || 0));

        docs.forEach(r => {
            const date = r.eventDate ? new Date(r.eventDate.toDate()).toLocaleDateString() : 'N/A';
            const iconConfig = getEventConfig(r.eventType); // Uses shared.js
            
            list.innerHTML += `
                <div class="record-item">
                    <div class="record-icon" style="color:${iconConfig.color}; background:${iconConfig.color}20">
                        <i class="fas ${iconConfig.icon}"></i>
                    </div>
                    <div class="record-details">
                        <div class="record-title">${r.eventType}</div>
                        <div class="record-description">${r.description || r.medication || ''}</div>
                        <div class="record-date">${date}</div>
                    </div>
                </div>
            `;
        });
    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="error-text">Failed to load records.</div>';
    }
}

function setupEventListeners() {
    // Delete Animal
    document.getElementById('btnDeleteAnimal').addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete this animal? THIS CANNOT BE UNDONE.')) {
            try {
                await window.getFarmCollection('animals').doc(currentAnimalId).delete();
                window.location.href = 'animals.html';
            } catch (e) {
                alert('Error deleting: ' + e.message);
            }
        }
    });

    // Edit Modal
    document.getElementById('btnEditAnimal').addEventListener('click', () => {
        document.getElementById('animalId').value = currentAnimalId;
        document.getElementById('animalName').value = currentAnimalData.name;
        document.getElementById('animalSpecies').value = currentAnimalData.species;
        document.getElementById('animalGender').value = currentAnimalData.gender;
        document.getElementById('animalStatus').value = currentAnimalData.status;
        document.getElementById('animalBirthDate').value = currentAnimalData.birthDate || '';
        document.getElementById('animalColor').value = currentAnimalData.color || '';
        
        const isGroupEl = document.getElementById('animalIsGroup');
        const quantityEl = document.getElementById('animalQuantity');
        isGroupEl.checked = currentAnimalData.isGroup || false;
        quantityEl.value = currentAnimalData.quantity || 1;
        isGroupEl.disabled = true;
        quantityEl.disabled = true;
        isGroupEl.dispatchEvent(new Event('change'));
        
        document.getElementById('animalModal').classList.add('active');
    });

    document.getElementById('animalIsGroup')?.addEventListener('change', (e) => {
        const isGroup = e.target.checked;
        const quantityGroup = document.getElementById('quantityGroup');
        const nameLabel = document.getElementById('animalNameLabel');
        const genderSelect = document.getElementById('animalGender');

        if (isGroup) {
            quantityGroup.style.display = 'block';
            nameLabel.textContent = 'Flock/Group Name *';
            genderSelect.value = 'unknown';
        } else {
            quantityGroup.style.display = 'none';
            nameLabel.textContent = 'Name *';
        }
    });

    document.getElementById('animalForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const isGroup = document.getElementById('animalIsGroup').checked;
        const updateData = {
            name: document.getElementById('animalName').value,
            isGroup: isGroup,
            quantity: isGroup ? parseInt(document.getElementById('animalQuantity').value) || 1 : 1,
            gender: document.getElementById('animalGender').value,
            status: document.getElementById('animalStatus').value,
            birthDate: document.getElementById('animalBirthDate').value,
            color: document.getElementById('animalColor').value,
        };
        const photoData = document.getElementById('animalPhotoData').value;
        if(photoData) updateData.photo = photoData;

        try {
            await window.getFarmCollection('animals').doc(currentAnimalId).update(updateData);
            document.getElementById('animalModal').classList.remove('active');
            loadAnimalDetails();
        } catch(err) {
            alert('Error updating: ' + err.message);
        }
    });

    // --- HEALTH FEATURES ---

    // Flock Management
    const btnAddFlockMember = document.getElementById('btnAddFlockMember');
    if (btnAddFlockMember) {
        btnAddFlockMember.addEventListener('click', async () => {
            const select = document.getElementById('addMemberSelect');
            select.innerHTML = '<option value="">Loading...</option>';
            document.getElementById('addMemberModal').classList.add('active');
            
            try {
                const snapshot = await window.getFarmCollection('animals')
                    .where('species', '==', currentAnimalData.species)
                    .where('isGroup', '==', false)
                    .get();
                
                select.innerHTML = '<option value="">-- Select an Animal --</option>';
                snapshot.forEach(doc => {
                    const a = doc.data();
                    if (!a.flockId) {
                        select.innerHTML += `<option value="${doc.id}">${a.name}</option>`;
                    }
                });
            } catch (err) {
                console.error(err);
                select.innerHTML = '<option value="">Error loading animals</option>';
            }
        });
    }

    const btnSaveNewMember = document.getElementById('btnSaveNewMember');
    if (btnSaveNewMember) {
        btnSaveNewMember.addEventListener('click', async () => {
            const selectedId = document.getElementById('addMemberSelect').value;
            if (!selectedId) return;
            
            try {
                await window.getFarmCollection('animals').doc(selectedId).update({
                    flockId: currentAnimalId
                });
                document.getElementById('addMemberModal').classList.remove('active');
                await loadFlockMembers(currentAnimalId);
            } catch (err) {
                alert('Error adding member: ' + err.message);
            }
        });
    }

    // 1. Add Record Modal Open
    document.getElementById('btnAddHealthRecord').addEventListener('click', () => {
        document.getElementById('recordForm').reset();
        document.getElementById('recordDate').valueAsDate = new Date();
        
        // Reset collapsibles: remove 'expanded' class and reset icons
        document.querySelectorAll('.section-fields').forEach(el => el.classList.remove('expanded'));
        document.querySelectorAll('.toggle-icon').forEach(el => el.classList.remove('rotated'));
        
        // Reset follow up details visibility
        document.getElementById('followupDetails').classList.add('hidden');
        
        document.getElementById('recordModal').classList.add('active');
    });

    // 2. Schedule Task Modal Open
    document.getElementById('btnScheduleTask').addEventListener('click', () => {
        document.getElementById('taskForm').reset();
        document.getElementById('taskDueDate').valueAsDate = new Date();
        document.getElementById('taskModal').classList.add('active');
    });

    // Save Health Record
    document.getElementById('recordForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const meatDays = parseInt(document.getElementById('withdrawalMeat').value) || 0;
        const dairyDays = parseInt(document.getElementById('withdrawalDairy').value) || 0;
        const eggsDays = parseInt(document.getElementById('withdrawalEggs').value) || 0;
        
        let withdrawal = null;
        if(meatDays || dairyDays || eggsDays) {
            const date = new Date(document.getElementById('recordDate').value);
            withdrawal = {};
            // Using addDaysToTimestamp from shared.js
            if(meatDays) withdrawal.meat = { days: meatDays, endDate: addDaysToTimestamp(date, meatDays) };
            if(dairyDays) withdrawal.dairy = { days: dairyDays, endDate: addDaysToTimestamp(date, dairyDays) };
            if(eggsDays) withdrawal.eggs = { days: eggsDays, endDate: addDaysToTimestamp(date, eggsDays) };
        }

        const recordData = {
            animalId: currentAnimalId,
            animalName: currentAnimalData.name,
            farmId: currentFarmId,
            eventType: document.getElementById('recordEventType').value,
            eventDate: firebase.firestore.Timestamp.fromDate(new Date(document.getElementById('recordDate').value)),
            description: document.getElementById('recordDescription').value,
            medication: document.getElementById('recordMedication').value,
            dosage: document.getElementById('recordDosage').value,
            notes: document.getElementById('recordNotes').value,
            withdrawal: withdrawal,
            status: 'completed',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            const docRef = await window.getFarmCollection('healthRecords').add(recordData);
            
            if(document.getElementById('recordScheduleFollowup').checked) {
                const followDateStr = document.getElementById('followupDate').value;
                const duration = parseInt(document.getElementById('followupDuration').value) || 1;
                const baseNotes = document.getElementById('followupNotes').value || `Follow-up: ${recordData.eventType}`;

                if(followDateStr) {
                    const batch = firebase.firestore().batch();
                    const startDate = new Date(followDateStr + 'T00:00:00'); // Ensure local timezone isn't shifted

                    for (let i = 0; i < duration; i++) {
                        const taskDate = new Date(startDate);
                        taskDate.setDate(taskDate.getDate() + i);

                        const taskRef = window.getFarmCollection('healthTasks').doc();
                        batch.set(taskRef, {
                            animalId: currentAnimalId,
                            animalName: currentAnimalData.name,
                            farmId: currentFarmId,
                            eventType: recordData.eventType,
                            description: duration > 1 ? `${baseNotes} (Day ${i+1} of ${duration})` : baseNotes,
                            notes: duration > 1 ? `${baseNotes} (Day ${i+1} of ${duration})` : baseNotes,
                            dueDate: firebase.firestore.Timestamp.fromDate(taskDate),
                            status: 'pending',
                            linkedRecordId: docRef.id,
                            createdAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }
                    await batch.commit();
                }
            }
            
            document.getElementById('recordModal').classList.remove('active');
            loadHealthHistory();
        } catch (err) {
            alert('Error saving record: ' + err.message);
        }
    });

    // Save Task
    document.getElementById('taskForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const isUndated = document.querySelector('input[name="taskDateOption"]:checked').value === 'undated';
        const dueDateVal = document.getElementById('taskDueDate').value;
        
        const taskData = {
            animalId: currentAnimalId,
            animalName: currentAnimalData.name,
            farmId: currentFarmId,
            eventType: document.getElementById('taskEventType').value,
            description: document.getElementById('taskDescription').value,
            priority: document.getElementById('taskPriority').value,
            notes: document.getElementById('taskNotes').value,
            isUndated: isUndated,
            dueDate: (isUndated || !dueDateVal) ? null : firebase.firestore.Timestamp.fromDate(new Date(dueDateVal)),
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await window.getFarmCollection('healthTasks').add(taskData);
            document.getElementById('taskModal').classList.remove('active');
            alert('Task scheduled!');
        } catch(err) {
            alert('Error saving task');
        }
    });

    // Toggle Collapsibles
    document.querySelectorAll('.section-toggle').forEach(el => {
        el.addEventListener('click', function() {
            const target = document.getElementById(this.dataset.target);
            target.classList.toggle('expanded');
            this.querySelector('.toggle-icon').classList.toggle('rotated');
        });
    });

    // Toggle Follow-up inner details
    document.getElementById('recordScheduleFollowup').addEventListener('change', function() {
        document.getElementById('followupDetails').classList.toggle('hidden', !this.checked);
    });

    // Modal Closing
    document.querySelectorAll('.modal-close, .btn-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = e.target.dataset.modal || e.target.closest('.modal').id;
            document.getElementById(modalId).classList.remove('active');
        });
    });
    
    // Photo Upload - Uses processImageUpload from shared.js
    document.getElementById('animalPhotoFile').addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (file) {
            try {
                const dataUrl = await processImageUpload(file);
                document.getElementById('animalPhotoPreview').innerHTML = `<img src="${dataUrl}" style="max-width:150px">`;
                document.getElementById('animalPhotoData').value = dataUrl;
            } catch (error) {
                alert(error.message);
            }
        }
    });
}
