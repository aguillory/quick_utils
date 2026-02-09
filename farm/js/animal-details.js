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

        db.collection('farms').doc(currentUser.uid).get().then(doc => {
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
    const speciesSnap = await db.collection('species').get();
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
        const doc = await db.collection('animals').doc(currentAnimalId).get();
        if (!doc.exists) {
            alert('Animal not found');
            return;
        }

        const data = doc.data();
        currentAnimalData = data;
        const species = allSpecies.find(s => s.id === data.species);
        
        document.getElementById('detailName').textContent = data.name;
        document.getElementById('detailStatus').textContent = (data.status || 'Active').toUpperCase();
        document.getElementById('detailStatus').className = `animal-status status-${data.status || 'active'}`;
        document.getElementById('detailSpecies').textContent = species ? species.name : 'Unknown';
        document.getElementById('detailGender').textContent = data.gender || '-';
        document.getElementById('detailColor').textContent = data.color || '-';
        document.getElementById('detailAge').textContent = data.birthDate ? calculateAge(data.birthDate) : '-';
        document.getElementById('detailTag').textContent = data.tagNumber || '-';

        if (data.ownerFarmId) {
            const farmDoc = await db.collection('farms').doc(data.ownerFarmId).get();
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

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('animalContent').classList.remove('hidden');

    } catch (error) {
        console.error("Error loading details:", error);
    }
}

async function loadHealthHistory() {
    const list = document.getElementById('healthRecordsList');
    list.innerHTML = '<div class="loading-placeholder"><i class="fas fa-spinner fa-spin"></i> Loading records...</div>';

    try {
        const snapshot = await db.collection('healthRecords')
            .where('animalId', '==', currentAnimalId)
            .orderBy('eventDate', 'desc')
            .get();

        list.innerHTML = '';
        if (snapshot.empty) {
            list.innerHTML = '<div class="empty-state">No medical history found.</div>';
            return;
        }

        snapshot.forEach(doc => {
            const r = doc.data();
            const date = r.eventDate ? new Date(r.eventDate.toDate()).toLocaleDateString() : 'N/A';
            const iconConfig = getEventIcon(r.eventType);
            
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
                await db.collection('animals').doc(currentAnimalId).delete();
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
        document.getElementById('animalModal').classList.add('active');
    });

    document.getElementById('animalForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const updateData = {
            name: document.getElementById('animalName').value,
            gender: document.getElementById('animalGender').value,
            status: document.getElementById('animalStatus').value,
            birthDate: document.getElementById('animalBirthDate').value,
            color: document.getElementById('animalColor').value,
        };
        const photoData = document.getElementById('animalPhotoData').value;
        if(photoData) updateData.photo = photoData;

        try {
            await db.collection('animals').doc(currentAnimalId).update(updateData);
            document.getElementById('animalModal').classList.remove('active');
            loadAnimalDetails();
        } catch(err) {
            alert('Error updating: ' + err.message);
        }
    });

    // --- HEALTH FEATURES ---

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
            if(meatDays) withdrawal.meat = { days: meatDays, endDate: addDays(date, meatDays) };
            if(dairyDays) withdrawal.dairy = { days: dairyDays, endDate: addDays(date, dairyDays) };
            if(eggsDays) withdrawal.eggs = { days: eggsDays, endDate: addDays(date, eggsDays) };
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
            const docRef = await db.collection('healthRecords').add(recordData);
            
            if(document.getElementById('recordScheduleFollowup').checked) {
                const followDate = document.getElementById('followupDate').value;
                if(followDate) {
                    await db.collection('healthTasks').add({
                        animalId: currentAnimalId,
                        animalName: currentAnimalData.name,
                        farmId: currentFarmId,
                        eventType: recordData.eventType,
                        description: document.getElementById('followupNotes').value || `Follow-up: ${recordData.eventType}`,
                        dueDate: firebase.firestore.Timestamp.fromDate(new Date(followDate)),
                        status: 'pending',
                        isFollowUp: true,
                        linkedRecordId: docRef.id,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
            
            document.getElementById('recordModal').classList.remove('active');
            loadHealthHistory();
        } catch(err) {
            console.error(err);
            alert('Error saving record');
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
            await db.collection('healthTasks').add(taskData);
            document.getElementById('taskModal').classList.remove('active');
            alert('Task scheduled!');
        } catch(err) {
            alert('Error saving task');
        }
    });

    // Toggle Collapsibles (FIXED)
    document.querySelectorAll('.section-toggle').forEach(el => {
        el.addEventListener('click', function() {
            const target = document.getElementById(this.dataset.target);
            // Toggle 'expanded' class for the slide animation
            target.classList.toggle('expanded');
            // Rotate the chevron icon
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
    
    // Photo Upload
    document.getElementById('animalPhotoFile').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    let width = img.width, height = img.height, maxSize = 800;
                    if (width > height) { if (width > maxSize) { height = height * (maxSize / width); width = maxSize; } } 
                    else { if (height > maxSize) { width = width * (maxSize / height); height = maxSize; } }
                    canvas.width = width; canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    document.getElementById('animalPhotoPreview').innerHTML = `<img src="${dataUrl}" style="max-width:150px">`;
                    document.getElementById('animalPhotoData').value = dataUrl;
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return firebase.firestore.Timestamp.fromDate(result);
}

function calculateAge(birthDate) {
    const birth = new Date(birthDate);
    const today = new Date();
    const months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
    if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`;
    const years = Math.floor(months / 12);
    return `${years} year${years !== 1 ? 's' : ''}`;
}

function getEventIcon(type) {
    const map = {
        'Vaccination': { icon: 'fa-syringe', color: '#4A7C59' },
        'Illness/Injury': { icon: 'fa-band-aid', color: '#E74C3C' },
        'Deworming': { icon: 'fa-pills', color: '#E89C3A' },
        'Veterinary Visit': { icon: 'fa-user-md', color: '#3498db' }
    };
    return map[type] || { icon: 'fa-notes-medical', color: '#8B6F47' };
}