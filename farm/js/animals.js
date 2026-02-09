// Animals Management
let currentUser = null;
let currentFarmId = null;
let currentFarmName = null;
let allSpecies = [];
let allAnimals = [];
let allFarms = {};
let editingAnimalId = null;

// Initialize
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        loadUserFarm();
    } else {
        window.location.href = 'index.html';
    }
});

async function loadUserFarm() {
    try {
        const farmDoc = await firebase.firestore()
            .collection('farms')
            .doc(currentUser.uid)
            .get();
        
        if (farmDoc.exists) {
            currentFarmId = farmDoc.id;
            currentFarmName = farmDoc.data().farmName;
            
            // Wait for ALL data to load before displaying
            await Promise.all([
                loadSpecies(),
                loadAnimals(),
                loadAllFarms()
            ]);
            
            // Now display, ensuring allFarms and allAnimals are ready
            displayAnimals(allAnimals); 
            
        } else {
            alert('No farm found. Please create a farm first.');
            window.location.href = 'dashboard.html';
        }
    } catch (error) {
        console.error('Error loading farm:', error);
    }
}

async function loadSpecies() {
    try {
        const speciesSnapshot = await firebase.firestore()
            .collection('species')
            .get();
        
        allSpecies = [];
        const speciesSelect = document.getElementById('animalSpecies');
        const filterSelect = document.getElementById('speciesFilter');
        
        speciesSelect.innerHTML = '<option value="">Select Species</option>';
        filterSelect.innerHTML = '<option value="">All Species</option>';
        
        speciesSnapshot.forEach((doc) => {
            const species = { id: doc.id, ...doc.data() };
            allSpecies.push(species);
            
            const option = `<option value="${species.id}">${species.name}</option>`;
            speciesSelect.innerHTML += option;
            filterSelect.innerHTML += option;
        });
    } catch (error) {
        console.error('Error loading species:', error);
    }
}

async function loadAnimals() {
    try {
        const animalsSnapshot = await firebase.firestore()
            .collection('animals')
            .orderBy('createdAt', 'desc')
            .get();
        
        allAnimals = [];
        
        animalsSnapshot.forEach((doc) => {
            allAnimals.push({ id: doc.id, ...doc.data() });
        });
        
        // REMOVED: displayAnimals(allAnimals); 
        // Reason: Moved to loadUserFarm to prevent "Owner undefined" race condition
        
    } catch (error) {
        console.error('Error loading animals:', error);
    }
}

async function loadAllFarms() {
    try {
        const farmsSnapshot = await firebase.firestore()
            .collection('farms')
            .get();
        
        const select = document.getElementById('animalOwnerFarm');
        select.innerHTML = '';
        
        farmsSnapshot.forEach((doc) => {
            const farm = doc.data();
            allFarms[doc.id] = farm.farmName;
            const selected = doc.id === currentFarmId ? 'selected' : '';
            select.innerHTML += `<option value="${doc.id}" ${selected}>${farm.farmName}</option>`;
        });
    } catch (error) {
        console.error('Error loading farms:', error);
    }
}

function displayAnimals(animals) {
    const animalsList = document.getElementById('animalsList');
    animalsList.innerHTML = '';
    
    if (animals.length === 0) {
        animalsList.innerHTML = '<div class="empty-state">No animals found. Add your first animal to get started!</div>';
        return;
    }
    
    animals.forEach(animal => {
        animalsList.appendChild(createAnimalCard(animal));
    });
}
function createAnimalCard(animal) {
    const card = document.createElement('div');
    card.className = 'animal-card';
    card.onclick = () => viewAnimalDetails(animal.id);
    
    const species = allSpecies.find(s => s.id === animal.species);
    const speciesName = species ? species.name : 'Unknown';
    
    // Get farm name with safety check
    let farmName = 'Unknown';
    if (animal.ownerFarmId) {
        farmName = allFarms[animal.ownerFarmId] || 'Unknown Farm';
    } else if (animal.ownerCustom) {
        farmName = animal.ownerCustom;
    }
    
    // Create the photo HTML (Image or Placeholder)
    const photoHtml = animal.photo 
        ? `<img src="${animal.photo}" alt="${animal.name}" class="animal-photo-img">`
        : `<div class="no-photo-placeholder">🐾</div>`;

    card.innerHTML = `
        <div class="animal-photo-wrapper">
            ${photoHtml}
        </div>
        <div class="animal-info">
            <div class="animal-name">${animal.name}</div>
            <div class="animal-details">Species: ${speciesName}</div>
            <div class="animal-details">Gender: ${animal.gender || 'Unknown'}</div>
            ${animal.color ? `<div class="animal-details">Color: ${animal.color}</div>` : ''}
            <div class="animal-details">Owner: ${farmName}</div>
            ${animal.birthDate ? `<div class="animal-details">Age: ${calculateAge(animal.birthDate)}</div>` : ''}
            <span class="animal-status status-${animal.status || 'active'}">
                ${(animal.status || 'active').toUpperCase()}
            </span>
        </div>
    `;
    
    return card;
}

function calculateAge(birthDate) {
    const birth = new Date(birthDate);
    const today = new Date();
    const months = (today.getFullYear() - birth.getFullYear()) * 12 + 
                   (today.getMonth() - birth.getMonth());
    
    if (months < 12) {
        return `${months} month${months !== 1 ? 's' : ''}`;
    } else {
        const years = Math.floor(months / 12);
        return `${years} year${years !== 1 ? 's' : ''}`;
    }
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Modal Management
const modal = document.getElementById('animalModal');
const addAnimalBtn = document.getElementById('addAnimalBtn');
const closeBtn = document.querySelector('.modal-close');
const cancelBtn = document.querySelector('.btn-cancel');
const animalForm = document.getElementById('animalForm');
const deleteBtn = document.getElementById('deleteAnimalBtn'); // NEW

addAnimalBtn.onclick = () => openModal();
closeBtn.onclick = () => closeModal();
cancelBtn.onclick = () => closeModal();

// NEW: Delete Button Handler
deleteBtn.onclick = async () => {
    if (!editingAnimalId) return;
    
    if (confirm('Are you sure you want to delete this animal? This action cannot be undone.')) {
        try {
            await firebase.firestore()
                .collection('animals')
                .doc(editingAnimalId)
                .delete();
                
            closeModal();
            loadAnimals(); // Refresh the list
        } catch (error) {
            console.error('Error deleting animal:', error);
            alert('Error deleting animal: ' + error.message);
        }
    }
};
// Handle animal photo upload
document.getElementById('animalPhotoFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 2000000) { // 2MB limit
            alert('Image file size should be less than 2MB');
            e.target.value = '';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                // Create canvas to resize image
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Calculate new dimensions (max 800px width/height)
                let width = img.width;
                let height = img.height;
                const maxSize = 800;
                
                if (width > height) {
                    if (width > maxSize) {
                        height = height * (maxSize / width);
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = width * (maxSize / height);
                        height = maxSize;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Draw and resize image
                ctx.drawImage(img, 0, 0, width, height);
                
                // Get base64 string
                const resizedImage = canvas.toDataURL('image/jpeg', 0.8);
                document.getElementById('animalPhotoPreview').innerHTML = 
                    `<img src="${resizedImage}" alt="Photo preview" style="max-width: 200px; max-height: 200px; border-radius: 4px;">`;
                document.getElementById('animalPhotoData').value = resizedImage;
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

function openModal(animalId = null) {
    editingAnimalId = animalId;
    const modalTitle = document.getElementById('modalTitle');
    const deleteBtn = document.getElementById('deleteAnimalBtn'); // NEW
    
    if (animalId) {
        modalTitle.textContent = 'Edit Animal';
        deleteBtn.style.display = 'flex'; // NEW: Show delete button when editing
        loadAnimalForEdit(animalId);
    } else {
        modalTitle.textContent = 'Add Animal';
        deleteBtn.style.display = 'none'; // NEW: Hide delete button when adding
        animalForm.reset();
        document.getElementById('customFieldsContainer').innerHTML = '';
        document.getElementById('animalPhotoPreview').innerHTML = '';
        document.getElementById('animalPhotoData').value = '';
        document.getElementById('statusDetails').style.display = 'none';
        document.getElementById('animalOwnerFarm').style.display = 'block';
        document.getElementById('animalOwnerCustom').style.display = 'none';
    }
    
    modal.classList.add('active');
}

function closeModal() {
    modal.classList.remove('active');
    editingAnimalId = null;
}

// Species Selection Handler
document.getElementById('animalSpecies').addEventListener('change', async (e) => {
    const speciesId = e.target.value;
    if (speciesId) {
        const species = allSpecies.find(s => s.id === speciesId);
        if (species) {
            loadCustomFields(species);
            await loadParentOptions(species);
        }
    }
});

function loadCustomFields(species) {
    const container = document.getElementById('customFieldsContainer');
    container.innerHTML = '';
    
    if (!species.customFields || species.customFields.length === 0) return;
    
    container.innerHTML = '<h4>Species-Specific Fields</h4>';
    
    species.customFields.forEach(field => {
        const fieldGroup = document.createElement('div');
        fieldGroup.className = 'form-group';
        
        let inputHtml = '';
        switch (field.type) {
            case 'number':
                inputHtml = `<input type="number" id="custom_${field.name}" class="custom-field" data-field-name="${field.name}">`;
                break;
            case 'date':
                inputHtml = `<input type="date" id="custom_${field.name}" class="custom-field" data-field-name="${field.name}">`;
                break;
            case 'boolean':
                inputHtml = `
                    <select id="custom_${field.name}" class="custom-field" data-field-name="${field.name}">
                        <option value="">Not Set</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                    </select>`;
                break;
            case 'select':
                const options = field.options || [];
                inputHtml = `
                    <select id="custom_${field.name}" class="custom-field" data-field-name="${field.name}">
                        <option value="">Select...</option>
                        ${options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                    </select>`;
                break;
            default:
                inputHtml = `<input type="text" id="custom_${field.name}" class="custom-field" data-field-name="${field.name}">`;
        }
        
        fieldGroup.innerHTML = `
            <label for="custom_${field.name}">${field.name}</label>
            ${inputHtml}
        `;
        
        container.appendChild(fieldGroup);
    });
}

async function loadParentOptions(species) {
    try {
        const animalsSnapshot = await firebase.firestore()
            .collection('animals')
            .where('species', '==', species.id)
            .get();
        
        const sireSelect = document.getElementById('animalSire');
        const damSelect = document.getElementById('animalDam');
        
        sireSelect.innerHTML = '<option value="">Unknown</option>';
        damSelect.innerHTML = '<option value="">Unknown</option>';
        
        animalsSnapshot.forEach((doc) => {
            const animal = doc.data();
            if (animal.gender === 'male') {
                sireSelect.innerHTML += `<option value="${doc.id}">${animal.name}</option>`;
            } else if (animal.gender === 'female') {
                damSelect.innerHTML += `<option value="${doc.id}">${animal.name}</option>`;
            }
        });
    } catch (error) {
        console.error('Error loading parent options:', error);
    }
}

// Owner Type Handler
document.getElementById('animalOwnerType').addEventListener('change', (e) => {
    const farmSelect = document.getElementById('animalOwnerFarm');
    const customInput = document.getElementById('animalOwnerCustom');
    
    if (e.target.value === 'farm') {
        farmSelect.style.display = 'block';
        customInput.style.display = 'none';
    } else {
        farmSelect.style.display = 'none';
        customInput.style.display = 'block';
    }
});

// Status Handler
document.getElementById('animalStatus').addEventListener('change', (e) => {
    const statusDetails = document.getElementById('statusDetails');
    const statusLabel = document.getElementById('statusDetailsLabel');
    
    if (['sold', 'deceased', 'transferred'].includes(e.target.value)) {
        statusDetails.style.display = 'block';
        
        // Update label based on status
        switch(e.target.value) {
            case 'sold':
                statusLabel.textContent = 'Sold to / Details';
                break;
            case 'deceased':
                statusLabel.textContent = 'Cause / Details';
                break;
            case 'transferred':
                statusLabel.textContent = 'Transferred to / Details';
                break;
        }
    } else {
        statusDetails.style.display = 'none';
    }
});

// Save Animal
animalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const animalData = {
        name: document.getElementById('animalName').value,
        species: document.getElementById('animalSpecies').value,
        gender: document.getElementById('animalGender').value,
        color: document.getElementById('animalColor').value, // NEW
        acquisitionDate: document.getElementById('animalAcquisitionDate').value || null, // NEW
        status: document.getElementById('animalStatus').value,
        birthDate: document.getElementById('animalBirthDate').value || null,
        photo: document.getElementById('animalPhotoData').value || null,
        sire: document.getElementById('animalSire').value || null,
        dam: document.getElementById('animalDam').value || null,
        ownerId: currentUser.uid,
        customFields: {},
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Handle owner
    const ownerType = document.getElementById('animalOwnerType').value;
    if (ownerType === 'farm') {
        animalData.ownerFarmId = document.getElementById('animalOwnerFarm').value;
    } else {
        animalData.ownerCustom = document.getElementById('animalOwnerCustom').value;
    }
    
    // Handle status details
    if (['sold', 'deceased', 'transferred'].includes(animalData.status)) {
        animalData.statusDetails = {
            date: document.getElementById('statusDate').value,
            details: document.getElementById('statusDetailsText').value
        };
    }
    
    // Collect custom fields
    document.querySelectorAll('.custom-field').forEach(field => {
        const fieldName = field.dataset.fieldName;
        if (field.value) {
            animalData.customFields[fieldName] = field.value;
        }
    });
    
    if (!editingAnimalId) {
        animalData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    
    try {
        if (editingAnimalId) {
            await firebase.firestore()
                .collection('animals')
                .doc(editingAnimalId)
                .update(animalData);
        } else {
            await firebase.firestore()
                .collection('animals')
                .add(animalData);
        }
        
        closeModal();
        loadAnimals();
    } catch (error) {
        console.error('Error saving animal:', error);
        alert('Error saving animal. Please try again.');
    }
});

async function loadAnimalForEdit(animalId) {
    try {
        const doc = await firebase.firestore()
            .collection('animals')
            .doc(animalId)
            .get();
        
        if (doc.exists) {
            const animal = doc.data();
            
            // Load basic fields
            document.getElementById('animalName').value = animal.name;
            document.getElementById('animalSpecies').value = animal.species;
            document.getElementById('animalGender').value = animal.gender || 'unknown';
            document.getElementById('animalColor').value = animal.color || ''; // NEW
            document.getElementById('animalAcquisitionDate').value = animal.acquisitionDate || ''; // NEW
            document.getElementById('animalStatus').value = animal.status || 'active';
            document.getElementById('animalBirthDate').value = animal.birthDate || '';
            
            // Load photo
            if (animal.photo) {
                document.getElementById('animalPhotoPreview').innerHTML = 
                    `<img src="${animal.photo}" alt="Photo preview" style="max-width: 200px; max-height: 200px; border-radius: 4px;">`;
                document.getElementById('animalPhotoData').value = animal.photo;
            }
            
            // Load owner
            if (animal.ownerFarmId) {
                document.getElementById('animalOwnerType').value = 'farm';
                document.getElementById('animalOwnerFarm').value = animal.ownerFarmId;
                document.getElementById('animalOwnerFarm').style.display = 'block';
                document.getElementById('animalOwnerCustom').style.display = 'none';
            } else if (animal.ownerCustom) {
                document.getElementById('animalOwnerType').value = 'custom';
                document.getElementById('animalOwnerCustom').value = animal.ownerCustom;
                document.getElementById('animalOwnerFarm').style.display = 'none';
                document.getElementById('animalOwnerCustom').style.display = 'block';
            }
            
            // Load status details
            if (animal.statusDetails) {
                document.getElementById('statusDetails').style.display = 'block';
                document.getElementById('statusDate').value = animal.statusDetails.date || '';
                document.getElementById('statusDetailsText').value = animal.statusDetails.details || '';
                
                // Update label
                const statusLabel = document.getElementById('statusDetailsLabel');
                switch(animal.status) {
                    case 'sold':
                        statusLabel.textContent = 'Sold to / Details';
                        break;
                    case 'deceased':
                        statusLabel.textContent = 'Cause / Details';
                        break;
                    case 'transferred':
                        statusLabel.textContent = 'Transferred to / Details';
                        break;
                }
            }
            
            // Load custom fields
            const species = allSpecies.find(s => s.id === animal.species);
            if (species) {
                loadCustomFields(species);
                await loadParentOptions(species);
                
                // Set parent values
                document.getElementById('animalSire').value = animal.sire || '';
                document.getElementById('animalDam').value = animal.dam || '';
                
                // Set custom field values
                if (animal.customFields) {
                    Object.keys(animal.customFields).forEach(fieldName => {
                        const field = document.querySelector(`[data-field-name="${fieldName}"]`);
                        if (field) {
                            field.value = animal.customFields[fieldName];
                        }
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error loading animal:', error);
    }
}

async function viewAnimalDetails(animalId) {
    // For now, open edit modal
    openModal(animalId);
}

// Filters
document.getElementById('speciesFilter').addEventListener('change', filterAnimals);
document.getElementById('statusFilter').addEventListener('change', filterAnimals);
document.getElementById('genderFilter').addEventListener('change', filterAnimals);
document.getElementById('searchInput').addEventListener('input', filterAnimals);

function filterAnimals() {
    const speciesFilter = document.getElementById('speciesFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;
    const genderFilter = document.getElementById('genderFilter').value;
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    
    const filtered = allAnimals.filter(animal => {
        if (speciesFilter && animal.species !== speciesFilter) return false;
        if (statusFilter && animal.status !== statusFilter) return false;
        if (genderFilter && animal.gender !== genderFilter) return false;
        if (searchTerm && !animal.name.toLowerCase().includes(searchTerm)) return false;
        return true;
    });
    
    displayAnimals(filtered);
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
    firebase.auth().signOut();
});