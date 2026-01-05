// Species Management
let currentUser = null;
let currentFarmId = null;
let currentFarmName = null;
let editingSpeciesId = null;

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
            loadSpecies();
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
        // Load from root level species collection
        const speciesSnapshot = await firebase.firestore()
            .collection('species')
            .get();
        
        const speciesList = document.getElementById('speciesList');
        speciesList.innerHTML = '';
        
        if (speciesSnapshot.empty) {
            speciesList.innerHTML = '<p class="empty-state">No species defined yet. Add your first species to get started!</p>';
            return;
        }
        
        speciesSnapshot.forEach((doc) => {
            const species = { id: doc.id, ...doc.data() };
            speciesList.appendChild(createSpeciesCard(species));
        });
    } catch (error) {
        console.error('Error loading species:', error);
    }
}

function createSpeciesCard(species) {
    const card = document.createElement('div');
    card.className = 'species-card';
    
    card.innerHTML = `
        <div class="species-header">
            <div class="species-info">
                ${species.icon ? 
                    `<img src="${species.icon}" class="species-icon-img" alt="${species.name}">` :
                    `<span class="species-icon">🐾</span>`
                }
                <span class="species-name">${species.name}</span>
            </div>
            <div class="species-actions">
                <button class="btn-icon" onclick="editSpecies('${species.id}')">
                    <i class="fas fa-edit"></i>
                </button>
                ${species.createdBy === currentUser.uid ? 
                    `<button class="btn-icon" onclick="deleteSpecies('${species.id}')">
                        <i class="fas fa-trash"></i>
                    </button>` : ''
                }
            </div>
        </div>
        ${species.customFields && species.customFields.length > 0 ? `
            <div class="fields-list">
                <strong>Custom Fields:</strong>
                ${species.customFields.map(field => `
                    <div class="field-item">
                        <span>${field.name}</span>
                        <span class="field-type">${field.type}${field.type === 'select' && field.options ? ` (${field.options.join(', ')})` : ''}</span>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;
    
    return card;
}

// Modal Management
const modal = document.getElementById('speciesModal');
const addSpeciesBtn = document.getElementById('addSpeciesBtn');
const closeBtn = document.querySelector('.modal-close');
const cancelBtn = document.querySelector('.btn-cancel');
const speciesForm = document.getElementById('speciesForm');

addSpeciesBtn.onclick = () => openModal();
closeBtn.onclick = () => closeModal();
cancelBtn.onclick = () => closeModal();

// Handle icon upload
document.getElementById('speciesIconFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 500000) { // 500KB limit
            alert('Image file size should be less than 500KB');
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
                
                // Set canvas size to 50x50
                canvas.width = 50;
                canvas.height = 50;
                
                // Draw and resize image
                ctx.drawImage(img, 0, 0, 50, 50);
                
                // Get base64 string
                const resizedImage = canvas.toDataURL('image/jpeg', 0.8);
                document.getElementById('speciesIconPreview').innerHTML = 
                    `<img src="${resizedImage}" alt="Icon preview" style="width: 50px; height: 50px; border-radius: 4px;">`;
                document.getElementById('speciesIconData').value = resizedImage;
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

function openModal(speciesId = null) {
    editingSpeciesId = speciesId;
    const modalTitle = document.getElementById('modalTitle');
    
    if (speciesId) {
        modalTitle.textContent = 'Edit Species';
        loadSpeciesForEdit(speciesId);
    } else {
        modalTitle.textContent = 'Add Species';
        speciesForm.reset();
        document.getElementById('customFieldsList').innerHTML = '';
        document.getElementById('speciesIconPreview').innerHTML = '';
        document.getElementById('speciesIconData').value = '';
    }
    
    modal.classList.add('active');
}

function closeModal() {
    modal.classList.remove('active');
    editingSpeciesId = null;
}

async function loadSpeciesForEdit(speciesId) {
    try {
        const doc = await firebase.firestore()
            .collection('species')
            .doc(speciesId)
            .get();
        
        if (doc.exists) {
            const species = doc.data();
            document.getElementById('speciesName').value = species.name;
            
            // Load icon
            if (species.icon) {
                document.getElementById('speciesIconPreview').innerHTML = 
                    `<img src="${species.icon}" alt="Icon preview" style="width: 50px; height: 50px; border-radius: 4px;">`;
                document.getElementById('speciesIconData').value = species.icon;
            }
            
            // Load custom fields
            const fieldsList = document.getElementById('customFieldsList');
            fieldsList.innerHTML = '';
            if (species.customFields) {
                species.customFields.forEach(field => {
                    addCustomFieldRow(field.name, field.type, field.options);
                });
            }
        }
    } catch (error) {
        console.error('Error loading species:', error);
    }
}

// Custom Fields Management
document.getElementById('addFieldBtn').addEventListener('click', () => {
    addCustomFieldRow();
});

function addCustomFieldRow(name = '', type = 'text', options = []) {
    const fieldsList = document.getElementById('customFieldsList');
    const fieldRow = document.createElement('div');
    fieldRow.className = 'custom-field-row';
    
    const fieldId = 'field_' + Date.now();
    
    fieldRow.innerHTML = `
        <input type="text" placeholder="Field name" value="${name}" class="field-name">
        <select class="field-type" onchange="handleFieldTypeChange(this, '${fieldId}')">
            <option value="text" ${type === 'text' ? 'selected' : ''}>Text</option>
            <option value="number" ${type === 'number' ? 'selected' : ''}>Number</option>
            <option value="date" ${type === 'date' ? 'selected' : ''}>Date</option>
            <option value="select" ${type === 'select' ? 'selected' : ''}>Dropdown</option>
            <option value="boolean" ${type === 'boolean' ? 'selected' : ''}>Yes/No</option>
        </select>
        <div id="${fieldId}" class="field-options" style="${type === 'select' ? 'display: block;' : 'display: none;'}">
            <input type="text" placeholder="Options (comma-separated)" value="${options.join(', ')}" class="field-options-input">
        </div>
        <button type="button" class="btn-remove-field" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    fieldsList.appendChild(fieldRow);
}

function handleFieldTypeChange(selectElement, fieldId) {
    const optionsDiv = document.getElementById(fieldId);
    if (selectElement.value === 'select') {
        optionsDiv.style.display = 'block';
    } else {
        optionsDiv.style.display = 'none';
    }
}

// Save Species
speciesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const speciesData = {
        name: document.getElementById('speciesName').value,
        icon: document.getElementById('speciesIconData').value || null,
        customFields: [],
        createdBy: currentUser.uid,
        createdAt: editingSpeciesId ? undefined : firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Collect custom fields
    document.querySelectorAll('.custom-field-row').forEach(row => {
        const name = row.querySelector('.field-name').value;
        const type = row.querySelector('.field-type').value;
        const fieldData = { name, type };
        
        if (type === 'select') {
            const optionsInput = row.querySelector('.field-options-input');
            if (optionsInput) {
                fieldData.options = optionsInput.value.split(',').map(opt => opt.trim()).filter(opt => opt);
            }
        }
        
        if (name) {
            speciesData.customFields.push(fieldData);
        }
    });
    
    try {
        if (editingSpeciesId) {
            // Don't update createdAt when editing
            delete speciesData.createdAt;
            await firebase.firestore()
                .collection('species')
                .doc(editingSpeciesId)
                .update(speciesData);
        } else {
            await firebase.firestore()
                .collection('species')
                .add(speciesData);
        }
        
        closeModal();
        loadSpecies();
    } catch (error) {
        console.error('Error saving species:', error);
        alert('Error saving species. Please try again.');
    }
});

async function editSpecies(speciesId) {
    openModal(speciesId);
}

async function deleteSpecies(speciesId) {
    if (confirm('Are you sure you want to delete this species? This will not delete existing animals.')) {
        try {
            await firebase.firestore()
                .collection('species')
                .doc(speciesId)
                .delete();
            
            loadSpecies();
        } catch (error) {
            console.error('Error deleting species:', error);
            alert('Error deleting species. Please try again.');
        }
    }
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
    firebase.auth().signOut();
});