/**
 * Health & Medical Records Module
 * Handles health tracking, scheduling, withdrawals, and bulk actions
 */

// ============================================================
// GLOBAL STATE
// ============================================================
let currentUser = null;
let currentFarmId = null;
let animalsCache = [];
let allAnimalsCache = [];
let speciesCache = [];
let healthRecordsCache = [];
let healthTasksCache = [];
let selectedBulkAnimals = new Set();
let showAllFarmsAnimals = false;
let showAllFarmsDashboard = false; // Toggle for main dashboard


// Event types configuration
const EVENT_TYPES = {
    'Vaccination': { icon: 'fa-syringe', color: 'var(--primary-color)', hasWithdrawal: true, hasFollowup: true },
    'Deworming': { icon: 'fa-pills', color: 'var(--warning-color)', hasWithdrawal: true, hasFollowup: true },
    'Hoof/Foot Trimming': { icon: 'fa-shoe-prints', color: 'var(--secondary-color)', hasWithdrawal: false, hasFollowup: true },
    'Disbudding/Dehorning': { icon: 'fa-fire', color: 'var(--danger-color)', hasWithdrawal: false, hasFollowup: false },
    'Banding/Castration': { icon: 'fa-cut', color: 'var(--danger-color)', hasWithdrawal: false, hasFollowup: true },
    'Shearing/Grooming': { icon: 'fa-scissors', color: 'var(--success-color)', hasWithdrawal: false, hasFollowup: true },
    'Veterinary Visit': { icon: 'fa-user-md', color: 'var(--primary-color)', hasWithdrawal: true, hasFollowup: true },
    'Illness/Injury': { icon: 'fa-band-aid', color: 'var(--danger-color)', hasWithdrawal: true, hasFollowup: true },
    'Surgery': { icon: 'fa-procedures', color: 'var(--danger-color)', hasWithdrawal: true, hasFollowup: true },
    'Dental Care': { icon: 'fa-tooth', color: 'var(--secondary-color)', hasWithdrawal: false, hasFollowup: true },
    'Fecal Test': { icon: 'fa-vial', color: 'var(--warning-color)', hasWithdrawal: false, hasFollowup: true },
    'Blood Test': { icon: 'fa-tint', color: 'var(--danger-color)', hasWithdrawal: false, hasFollowup: true },
    'Other': { icon: 'fa-notes-medical', color: 'var(--secondary-color)', hasWithdrawal: true, hasFollowup: true }
};

// ============================================================
// DATE HELPER FUNCTIONS - Fixed for timezone issues
// ============================================================
function parseLocalDate(dateString) {
    // Parse a date string (YYYY-MM-DD) as local time, not UTC
    if (!dateString) return null;
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function getLocalDateOnly(date) {
    // Get a date object with only the date part (no time), in local timezone
    if (!date) return null;
    if (date.toDate) date = date.toDate(); // Handle Firestore Timestamp
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getTodayLocal() {
    // Get today's date at midnight local time
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDateForInput(date) {
    // Format a date for an input[type="date"] field
    if (!date) return '';
    if (date.toDate) date = date.toDate();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ============================================================
// INITIALIZATION
// ============================================================

firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        initializeModule();
    } else {
        window.location.href = 'index.html';
    }
});


async function initializeModule() {
    try {
        console.log("Initializing Health Module...");

        const farmDoc = await window.db.collection('farms').doc(currentUser.uid).get();
        
        if (!farmDoc.exists) {
            console.error("Farm document not found for user:", currentUser.uid);
            showNotification('No farm found. Please set up your farm first.', 'error');
            return;
        }
        
        currentFarmId = farmDoc.id;
        console.log("Farm loaded:", currentFarmId);
        
        await Promise.all([
            loadAnimals(),
            loadAllAnimals(),
            loadSpecies(),
            loadHealthRecords(),
            loadHealthTasks()
        ]);
        
        populateFilters();
        populateAnimalDropdowns();
        setupSearchableDropdowns();
        
        renderAlerts();
        renderStats();
        renderTasks();
        renderRecords();
        renderWithdrawals();
        
        setupEventListeners();
        
    } catch (error) {
        console.error('Error initializing health module:', error);
        showNotification('Error loading health data. Please refresh.', 'error');
    }
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadAnimals() {
    console.log("Loading animals...");
    const snapshot = await window.db.collection('animals')
        .where('ownerId', '==', currentUser.uid)
        .get();
    
    animalsCache = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
    console.log("Animals loaded:", animalsCache.length);
}

async function loadAllAnimals() {
    console.log("Loading all animals across farms...");
    const snapshot = await window.db.collection('animals').get();
    
    allAnimalsCache = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
    console.log("All animals loaded:", allAnimalsCache.length);
}

async function loadSpecies() {
    const snapshot = await window.db.collection('species').get();
    
    speciesCache = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
}

async function loadHealthRecords() {
    const snapshot = await window.db.collection('healthRecords')
        .where('farmId', '==', currentFarmId)
        .orderBy('eventDate', 'desc')
        .limit(100)
        .get();
    
    healthRecordsCache = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
}

async function loadHealthTasks() {
    const snapshot = await window.db.collection('healthTasks')
        .where('farmId', '==', currentFarmId)
        .where('status', '==', 'pending')
        .get();
    
    healthTasksCache = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
}

// ============================================================
// HELPER: Find animal in appropriate cache
// ============================================================
function findAnimal(animalId) {
    // First check user's animals
    let animal = animalsCache.find(a => a.id === animalId);
    if (animal) return animal;
    
    // If showing all farms or animal not found, check all animals
    return allAnimalsCache.find(a => a.id === animalId);
}

function getDisplayAnimalsCache() {
    return showAllFarmsDashboard ? allAnimalsCache : animalsCache;
}

// ============================================================
// POPULATE DROPDOWNS & FILTERS
// ============================================================
function populateFilters() {
    const speciesSelects = ['recordsSpeciesFilter', 'bulkSpeciesFilter'];
    speciesSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            select.innerHTML = '<option value="all">All Species</option>';
            speciesCache.forEach(species => {
                select.innerHTML += `<option value="${species.id}">${species.name}</option>`;
            });
        }
    });
    
    const typeFilter = document.getElementById('recordsTypeFilter');
    if (typeFilter) {
        typeFilter.innerHTML = '<option value="all">All Types</option>';
        Object.keys(EVENT_TYPES).forEach(type => {
            typeFilter.innerHTML += `<option value="${type}">${type}</option>`;
        });
    }
}

function getActiveAnimalsCache() {
    return showAllFarmsAnimals ? allAnimalsCache : animalsCache;
}

function populateAnimalDropdowns(speciesFilter = 'all') {
    const animalSelects = ['recordAnimal', 'taskAnimal'];
    const activeAnimals = getActiveAnimalsCache();
    
    animalSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            select.innerHTML = '<option value="">Select an animal...</option>';
            
            let filteredAnimals = activeAnimals;
            if (speciesFilter !== 'all') {
                filteredAnimals = activeAnimals.filter(a => a.species === speciesFilter);
            }
            
            const grouped = {};
            filteredAnimals.forEach(animal => {
                const species = speciesCache.find(s => s.id === animal.species);
                const speciesName = species ? species.name : 'Unknown';
                if (!grouped[speciesName]) grouped[speciesName] = [];
                grouped[speciesName].push(animal);
            });
            
            Object.keys(grouped).sort().forEach(speciesName => {
                const optgroup = document.createElement('optgroup');
                optgroup.label = speciesName;
                grouped[speciesName].sort((a, b) => a.name.localeCompare(b.name)).forEach(animal => {
                    const option = document.createElement('option');
                    option.value = animal.id;
                    const farmIndicator = showAllFarmsAnimals && animal.ownerId !== currentUser.uid ? ' (Other Farm)' : '';
                    option.textContent = animal.name + farmIndicator;
                    optgroup.appendChild(option);
                });
                select.appendChild(optgroup);
            });
        }
    });
}

function setupSearchableDropdowns() {
    setupSearchableDropdown('recordAnimal', 'recordAnimalSearch', 'recordAnimalSpeciesFilter', 'recordAnimalFarmToggle');
    setupSearchableDropdown('taskAnimal', 'taskAnimalSearch', 'taskAnimalSpeciesFilter', 'taskAnimalFarmToggle');
}

function setupSearchableDropdown(selectId, searchId, speciesFilterId, farmToggleId) {
    const searchInput = document.getElementById(searchId);
    const speciesFilter = document.getElementById(speciesFilterId);
    const farmToggle = document.getElementById(farmToggleId);
    const select = document.getElementById(selectId);
    
    if (!searchInput || !speciesFilter || !select) return;
    
    speciesFilter.innerHTML = '<option value="all">All Species</option>';
    speciesCache.forEach(species => {
        speciesFilter.innerHTML += `<option value="${species.id}">${species.name}</option>`;
    });
    
    searchInput.addEventListener('input', function() {
        filterAnimalDropdown(selectId, this.value, speciesFilter.value, farmToggle?.checked || false);
    });
    
    speciesFilter.addEventListener('change', function() {
        filterAnimalDropdown(selectId, searchInput.value, this.value, farmToggle?.checked || false);
    });
    
    if (farmToggle) {
        farmToggle.addEventListener('change', function() {
            showAllFarmsAnimals = this.checked;
            filterAnimalDropdown(selectId, searchInput.value, speciesFilter.value, this.checked);
        });
    }
}

function filterAnimalDropdown(selectId, searchTerm, speciesFilter, showAllFarms) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    const activeAnimals = showAllFarms ? allAnimalsCache : animalsCache;
    
    let filteredAnimals = activeAnimals;
    if (speciesFilter !== 'all') {
        filteredAnimals = filteredAnimals.filter(a => a.species === speciesFilter);
    }
    
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filteredAnimals = filteredAnimals.filter(a => 
            a.name.toLowerCase().includes(term) ||
            (a.tagNumber && a.tagNumber.toLowerCase().includes(term))
        );
    }
    
    select.innerHTML = '<option value="">Select an animal...</option>';
    
    const grouped = {};
    filteredAnimals.forEach(animal => {
        const species = speciesCache.find(s => s.id === animal.species);
        const speciesName = species ? species.name : 'Unknown';
        if (!grouped[speciesName]) grouped[speciesName] = [];
        grouped[speciesName].push(animal);
    });
    
    Object.keys(grouped).sort().forEach(speciesName => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = speciesName;
        grouped[speciesName].sort((a, b) => a.name.localeCompare(b.name)).forEach(animal => {
            const option = document.createElement('option');
            option.value = animal.id;
            const farmIndicator = showAllFarms && animal.ownerId !== currentUser.uid ? ' (Other Farm)' : '';
            option.textContent = animal.name + farmIndicator;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    });
}

// ============================================================
// RENDER FUNCTIONS
// ============================================================
function renderAlerts() {
    const container = document.getElementById('alertsGrid');
    const alerts = [];
    const today = getTodayLocal();
    
    const displayAnimals = getDisplayAnimalsCache();
    
    // Active illness/injury alerts
    const activeIssues = healthRecordsCache.filter(r => 
        r.eventType === 'Illness/Injury' && r.status === 'ongoing'
    );
    
    activeIssues.forEach(record => {
        const animal = findAnimal(record.animalId);
        // Skip if not showing all farms and animal is not owned
        if (!showAllFarmsDashboard && !animalsCache.find(a => a.id === record.animalId)) return;
        
        alerts.push({
            type: 'danger',
            icon: 'fa-band-aid',
            title: 'Active Health Issue',
            message: `${animal?.name || 'Unknown'}: ${record.description || record.eventType}`,
            date: record.eventDate,
            action: () => viewRecord(record.id)
        });
    });
    
    // Withdrawal alerts
    healthRecordsCache.forEach(record => {
        if (record.withdrawal) {
            const animal = findAnimal(record.animalId);
            // Skip if not showing all farms and animal is not owned
            if (!showAllFarmsDashboard && !animalsCache.find(a => a.id === record.animalId)) return;
            
            ['meat', 'dairy', 'eggs'].forEach(type => {
                if (record.withdrawal[type]?.endDate) {
                    const endDate = getLocalDateOnly(record.withdrawal[type].endDate);
                    if (endDate >= today) {
                        const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                        alerts.push({
                            type: 'warning',
                            icon: type === 'meat' ? 'fa-drumstick-bite' : type === 'dairy' ? 'fa-cheese' : 'fa-egg',
                            title: `${type.charAt(0).toUpperCase() + type.slice(1)} Withdrawal`,
                            message: `${animal?.name || 'Unknown'}: ${daysLeft} days remaining`,
                            date: endDate,
                            action: () => viewRecord(record.id)
                        });
                    }
                }
            });
        }
    });
    
    // Overdue and due today tasks
    healthTasksCache.forEach(task => {
        if (task.isUndated) return;
        
        const dueDate = task.dueDate?.toDate();
        if (!dueDate) return;
        
        const animal = findAnimal(task.animalId);
        // Skip if not showing all farms and animal is not owned
        if (!showAllFarmsDashboard && !animalsCache.find(a => a.id === task.animalId)) return;
        
        const dueDateOnly = getLocalDateOnly(dueDate);
        
        if (dueDateOnly.getTime() < today.getTime()) {
            alerts.push({
                type: 'danger',
                icon: 'fa-exclamation-circle',
                title: 'Overdue Task',
                message: `${animal?.name || 'Unknown'}: ${task.description || task.eventType}`,
                date: dueDate,
                action: () => openCompleteTaskModal(task)
            });
        } else if (dueDateOnly.getTime() === today.getTime()) {
            alerts.push({
                type: 'primary',
                icon: 'fa-calendar-day',
                title: 'Due Today',
                message: `${animal?.name || 'Unknown'}: ${task.description || task.eventType}`,
                date: dueDate,
                action: () => openCompleteTaskModal(task)
            });
        }
    });
    
    const priorityOrder = { danger: 0, warning: 1, primary: 2 };
    alerts.sort((a, b) => {
        if (priorityOrder[a.type] !== priorityOrder[b.type]) {
            return priorityOrder[a.type] - priorityOrder[b.type];
        }
        return new Date(a.date) - new Date(b.date);
    });
    
    if (alerts.length === 0) {
        container.innerHTML = `
            <div class="alert-card alert-success">
                <i class="fas fa-check-circle"></i>
                <div class="alert-content">
                    <strong>All Clear!</strong>
                    <p>No urgent alerts at this time.</p>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = alerts.slice(0, 6).map(alert => `
            <div class="alert-card alert-${alert.type}" onclick="(${alert.action.toString()})()">
                <i class="fas ${alert.icon}"></i>
                <div class="alert-content">
                    <strong>${alert.title}</strong>
                    <p>${alert.message}</p>
                </div>
                <i class="fas fa-chevron-right alert-arrow"></i>
            </div>
        `).join('');
    }
}

function renderStats() {
    const today = getTodayLocal();
    
    // Filter based on dashboard toggle
    const relevantRecords = showAllFarmsDashboard 
        ? healthRecordsCache 
        : healthRecordsCache.filter(r => animalsCache.find(a => a.id === r.animalId));
    
    const relevantTasks = showAllFarmsDashboard
        ? healthTasksCache
        : healthTasksCache.filter(t => animalsCache.find(a => a.id === t.animalId));
    
    // Active issues
    const activeIssues = relevantRecords.filter(r => 
        r.eventType === 'Illness/Injury' && r.status === 'ongoing'
    ).length;
    document.querySelector('#statActiveIssues .stat-number').textContent = activeIssues;
    
    // Animals in withdrawal
    const inWithdrawal = new Set();
    relevantRecords.forEach(record => {
        if (record.withdrawal) {
            ['meat', 'dairy', 'eggs'].forEach(type => {
                if (record.withdrawal[type]?.endDate) {
                    const endDate = getLocalDateOnly(record.withdrawal[type].endDate);
                    if (endDate >= today) {
                        inWithdrawal.add(record.animalId);
                    }
                }
            });
        }
    });
    document.querySelector('#statInWithdrawal .stat-number').textContent = inWithdrawal.size;
    
    // Due today
    const dueToday = relevantTasks.filter(task => {
        if (task.isUndated || !task.dueDate) return false;
        const dueDateOnly = getLocalDateOnly(task.dueDate);
        return dueDateOnly.getTime() === today.getTime();
    }).length;
    document.querySelector('#statDueToday .stat-number').textContent = dueToday;
    
    // Overdue
    const overdue = relevantTasks.filter(task => {
        if (task.isUndated || !task.dueDate) return false;
        const dueDateOnly = getLocalDateOnly(task.dueDate);
        return dueDateOnly.getTime() < today.getTime();
    }).length;
    document.querySelector('#statOverdue .stat-number').textContent = overdue;
}

function renderTasks(filter = 'all') {
    const container = document.getElementById('tasksList');
    const today = getTodayLocal();
    
    // Filter based on dashboard toggle
    let tasks = showAllFarmsDashboard
        ? [...healthTasksCache]
        : healthTasksCache.filter(t => animalsCache.find(a => a.id === t.animalId));
    
    // Apply filter
    tasks = tasks.filter(task => {
        const dueDate = task.dueDate?.toDate();
        if (!dueDate && !task.isUndated) return filter === 'all';
        
        if (task.isUndated) {
            return filter === 'undated' || filter === 'all';
        }
        
        const dueDateOnly = getLocalDateOnly(dueDate);
        
        switch (filter) {
            case 'overdue':
                return dueDateOnly.getTime() < today.getTime();
            case 'today':
                return dueDateOnly.getTime() === today.getTime();
            case 'week':
                const weekFromNow = new Date(today);
                weekFromNow.setDate(weekFromNow.getDate() + 7);
                return dueDateOnly.getTime() >= today.getTime() && dueDateOnly.getTime() <= weekFromNow.getTime();
            case 'undated':
                return false;
            default:
                return true;
        }
    });
    
    // Sort: overdue first, then by date, undated last
    tasks.sort((a, b) => {
        if (a.isUndated && !b.isUndated) return 1;
        if (!a.isUndated && b.isUndated) return -1;
        if (a.isUndated && b.isUndated) {
            const priorityOrder = { high: 0, normal: 1, low: 2 };
            return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
        }
        return (a.dueDate?.toDate() || 0) - (b.dueDate?.toDate() || 0);
    });
    
    if (tasks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-calendar-check"></i>
                <p>No tasks found</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = tasks.map(task => {
        const animal = findAnimal(task.animalId);
        const eventConfig = EVENT_TYPES[task.eventType] || EVENT_TYPES['Other'];
        const dueDate = task.dueDate?.toDate();
        
        let statusClass = '';
        let statusText = '';
        
        if (task.isUndated) {
            statusClass = 'status-undated';
            statusText = 'Needs Done';
        } else if (dueDate) {
            const dueDateOnly = getLocalDateOnly(dueDate);
            
            if (dueDateOnly.getTime() < today.getTime()) {
                statusClass = 'status-overdue';
                statusText = 'Overdue';
            } else if (dueDateOnly.getTime() === today.getTime()) {
                statusClass = 'status-today';
                statusText = 'Due Today';
            } else {
                statusClass = 'status-upcoming';
                statusText = formatDate(dueDate);
            }
        }
        
        const priorityBadge = task.priority === 'high' 
            ? '<span class="priority-badge high">High</span>' 
            : task.priority === 'low' 
                ? '<span class="priority-badge low">Low</span>' 
                : '';
        
        const isOtherFarm = animal && animal.ownerId !== currentUser.uid;
        const farmBadge = isOtherFarm ? '<span class="farm-badge">Other Farm</span>' : '';
        
        return `
            <div class="task-item ${statusClass}" data-task-id="${task.id}">
                <div class="task-icon" style="background-color: ${eventConfig.color}20; color: ${eventConfig.color}">
                    <i class="fas ${eventConfig.icon}"></i>
                </div>
                <div class="task-details">
                    <div class="task-header">
                        <span class="task-animal">${animal?.name || 'Unknown Animal'}</span>
                        ${farmBadge}
                        ${priorityBadge}
                        ${task.isFollowUp ? '<span class="followup-badge"><i class="fas fa-redo"></i> Follow-up</span>' : ''}
                    </div>
                    <div class="task-title">${task.eventType}</div>
                    <div class="task-description">${task.description || ''}</div>
                    <div class="task-meta">
                        <span class="task-status ${statusClass}">${statusText}</span>
                    </div>
                </div>
                <div class="task-actions">
                    <button class="btn-icon btn-complete" onclick="openCompleteTaskModal(getTaskById('${task.id}'))" title="Mark Complete">
                        <i class="fas fa-check"></i>
                    </button>
                    <button class="btn-icon btn-edit" onclick="openEditTask('${task.id}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon btn-delete" onclick="confirmDeleteItem('${task.id}', 'task')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderRecords(speciesFilter = 'all', typeFilter = 'all') {
    const container = document.getElementById('recordsList');
    
    // Filter based on dashboard toggle
    let records = showAllFarmsDashboard
        ? [...healthRecordsCache]
        : healthRecordsCache.filter(r => animalsCache.find(a => a.id === r.animalId));
    
    // Apply filters
    if (speciesFilter !== 'all') {
        const speciesAnimals = (showAllFarmsDashboard ? allAnimalsCache : animalsCache)
            .filter(a => a.species === speciesFilter).map(a => a.id);
        records = records.filter(r => speciesAnimals.includes(r.animalId));
    }
    
    if (typeFilter !== 'all') {
        records = records.filter(r => r.eventType === typeFilter);
    }
    
    // Show most recent 10
    records = records.slice(0, 10);
    
    if (records.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-notes-medical"></i>
                <p>No health records found</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = records.map(record => {
        const animal = findAnimal(record.animalId);
        const eventConfig = EVENT_TYPES[record.eventType] || EVENT_TYPES['Other'];
        const eventDate = record.eventDate?.toDate();
        
        const hasWithdrawal = record.withdrawal && 
            (record.withdrawal.meat?.days || record.withdrawal.dairy?.days || record.withdrawal.eggs?.days);
        
        const isOtherFarm = animal && animal.ownerId !== currentUser.uid;
        const farmBadge = isOtherFarm ? '<span class="farm-badge">Other Farm</span>' : '';
        
        return `
            <div class="record-item" onclick="viewRecord('${record.id}')">
                <div class="record-icon" style="background-color: ${eventConfig.color}20; color: ${eventConfig.color}">
                    <i class="fas ${eventConfig.icon}"></i>
                </div>
                <div class="record-details">
                    <div class="record-header">
                        <span class="record-animal">${animal?.name || 'Unknown Animal'}</span>
                        ${farmBadge}
                        ${record.status === 'ongoing' ? '<span class="status-badge ongoing">Ongoing</span>' : ''}
                        ${hasWithdrawal ? '<span class="withdrawal-indicator" title="Has withdrawal period"><i class="fas fa-clock"></i></span>' : ''}
                    </div>
                    <div class="record-title">${record.eventType}</div>
                    <div class="record-description">${record.description || ''}</div>
                    <div class="record-date">${eventDate ? formatDate(eventDate) : 'No date'}</div>
                </div>
                <i class="fas fa-chevron-right record-arrow"></i>
            </div>
        `;
    }).join('');
}

function renderWithdrawals() {
    const container = document.getElementById('withdrawalList');
    const today = getTodayLocal();
    
    const withdrawals = [];
    
    // Filter based on dashboard toggle
    const relevantRecords = showAllFarmsDashboard
        ? healthRecordsCache
        : healthRecordsCache.filter(r => animalsCache.find(a => a.id === r.animalId));
    
    relevantRecords.forEach(record => {
        if (!record.withdrawal) return;
        
        const animal = findAnimal(record.animalId);
        if (!animal) return;
        
        ['meat', 'dairy', 'eggs'].forEach(type => {
            if (record.withdrawal[type]?.endDate) {
                const endDate = getLocalDateOnly(record.withdrawal[type].endDate);
                if (endDate >= today) {
                    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                    withdrawals.push({
                        animalId: record.animalId,
                        animalName: animal.name,
                        isOtherFarm: animal.ownerId !== currentUser.uid,
                        type,
                        endDate,
                        daysLeft,
                        medication: record.medication,
                        eventType: record.eventType,
                        recordId: record.id
                    });
                }
            }
        });
    });
    
    withdrawals.sort((a, b) => a.daysLeft - b.daysLeft);
    
    if (withdrawals.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-check-circle"></i>
                <p>No active withdrawals</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = withdrawals.map(w => {
        const typeIcon = w.type === 'meat' ? 'fa-drumstick-bite' : w.type === 'dairy' ? 'fa-cheese' : 'fa-egg';
        const urgencyClass = w.daysLeft <= 3 ? 'urgent' : w.daysLeft <= 7 ? 'warning' : '';
        const farmBadge = w.isOtherFarm ? '<span class="farm-badge small">Other</span>' : '';
        
        return `
            <div class="withdrawal-item ${urgencyClass}" onclick="viewRecord('${w.recordId}')">
                <div class="withdrawal-type">
                    <i class="fas ${typeIcon}"></i>
                    <span>${w.type.charAt(0).toUpperCase() + w.type.slice(1)}</span>
                </div>
                <div class="withdrawal-details">
                    <div class="withdrawal-animal">${w.animalName} ${farmBadge}</div>
                    <div class="withdrawal-info">${w.medication || w.eventType}</div>
                </div>
                <div class="withdrawal-countdown">
                    <span class="days-number">${w.daysLeft}</span>
                    <span class="days-label">days left</span>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// MODAL HANDLERS
// ============================================================
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function openAddRecordModal(animalId = null) {
    document.getElementById('recordForm').reset();
    document.getElementById('recordId').value = '';
    document.getElementById('recordLinkedTaskId').value = '';
    document.getElementById('recordModalTitle').innerHTML = '<i class="fas fa-notes-medical"></i> Add Health Record';
    
    // Set default date to today using local date
    document.getElementById('recordDate').value = formatDateForInput(new Date());
    
    // Reset animal search/filter
    const searchInput = document.getElementById('recordAnimalSearch');
    const speciesFilter = document.getElementById('recordAnimalSpeciesFilter');
    const farmToggle = document.getElementById('recordAnimalFarmToggle');
    if (searchInput) searchInput.value = '';
    if (speciesFilter) speciesFilter.value = 'all';
    if (farmToggle) farmToggle.checked = false;
    showAllFarmsAnimals = false;
    
    populateAnimalDropdowns('all');
    
    if (animalId) {
        document.getElementById('recordAnimal').value = animalId;
    }
    
    document.querySelectorAll('#recordModal .section-fields').forEach(el => el.classList.remove('expanded'));
    document.getElementById('followupDetails').classList.add('hidden');
    
    openModal('recordModal');
}

function openEditRecord(recordId) {
    const record = healthRecordsCache.find(r => r.id === recordId);
    if (!record) return;
    
    document.getElementById('recordId').value = recordId;
    document.getElementById('recordLinkedTaskId').value = '';
    document.getElementById('recordModalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Health Record';
    
    document.getElementById('recordAnimal').value = record.animalId;
    document.getElementById('recordEventType').value = record.eventType;
    document.getElementById('recordDate').value = formatDateForInput(record.eventDate);
    document.getElementById('recordStatus').value = record.status || 'completed';
    document.getElementById('recordDescription').value = record.description || '';
    document.getElementById('recordMedication').value = record.medication || '';
    document.getElementById('recordDosage').value = record.dosage || '';
    document.getElementById('recordAdministeredBy').value = record.administeredBy || '';
    document.getElementById('recordLotNumber').value = record.lotNumber || '';
    document.getElementById('withdrawalMeat').value = record.withdrawal?.meat?.days || '';
    document.getElementById('withdrawalDairy').value = record.withdrawal?.dairy?.days || '';
    document.getElementById('withdrawalEggs').value = record.withdrawal?.eggs?.days || '';
    document.getElementById('recordVeterinarian').value = record.veterinarian || '';
    document.getElementById('recordCost').value = record.cost || '';
    document.getElementById('recordNotes').value = record.notes || '';
    
    closeModal('viewRecordModal');
    openModal('recordModal');
}

function openScheduleTaskModal(animalId = null) {
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
    document.getElementById('taskLinkedRecordId').value = '';
    document.getElementById('taskModalTitle').innerHTML = '<i class="fas fa-calendar-plus"></i> Schedule Health Task';
    
    document.querySelector('input[name="taskDateOption"][value="dated"]').checked = true;
    document.getElementById('taskDueDate').disabled = false;
    
    // Reset animal search/filter
    const searchInput = document.getElementById('taskAnimalSearch');
    const speciesFilter = document.getElementById('taskAnimalSpeciesFilter');
    const farmToggle = document.getElementById('taskAnimalFarmToggle');
    if (searchInput) searchInput.value = '';
    if (speciesFilter) speciesFilter.value = 'all';
    if (farmToggle) farmToggle.checked = false;
    showAllFarmsAnimals = false;
    
    populateAnimalDropdowns('all');
    
    if (animalId) {
        document.getElementById('taskAnimal').value = animalId;
    }
    
    openModal('taskModal');
}

function openEditTask(taskId) {
    const task = healthTasksCache.find(t => t.id === taskId);
    if (!task) return;
    
    document.getElementById('taskId').value = taskId;
    document.getElementById('taskLinkedRecordId').value = task.linkedRecordId || '';
    document.getElementById('taskModalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Health Task';
    
    document.getElementById('taskAnimal').value = task.animalId;
    document.getElementById('taskEventType').value = task.eventType;
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskPriority').value = task.priority || 'normal';
    document.getElementById('taskMedication').value = task.medication || '';
    document.getElementById('taskDosage').value = task.dosage || '';
    document.getElementById('taskWithdrawalMeat').value = task.withdrawal?.meat || '';
    document.getElementById('taskWithdrawalDairy').value = task.withdrawal?.dairy || '';
    document.getElementById('taskWithdrawalEggs').value = task.withdrawal?.eggs || '';
    document.getElementById('taskNotes').value = task.notes || '';
    
    if (task.isUndated) {
        document.querySelector('input[name="taskDateOption"][value="undated"]').checked = true;
        document.getElementById('taskDueDate').disabled = true;
        document.getElementById('taskDueDate').value = '';
    } else {
        document.querySelector('input[name="taskDateOption"][value="dated"]').checked = true;
        document.getElementById('taskDueDate').disabled = false;
        document.getElementById('taskDueDate').value = formatDateForInput(task.dueDate);
    }
    
    openModal('taskModal');
}

function openCompleteTaskModal(task) {
    document.getElementById('completeTaskId').value = task.id;
    document.getElementById('completeDate').value = formatDateForInput(new Date());
    
    document.getElementById('completeMedication').value = task.medication || '';
    document.getElementById('completeDosage').value = task.dosage || '';
    document.getElementById('completeWithdrawalMeat').value = task.withdrawal?.meat || '';
    document.getElementById('completeWithdrawalDairy').value = task.withdrawal?.dairy || '';
    document.getElementById('completeWithdrawalEggs').value = task.withdrawal?.eggs || '';
    document.getElementById('completeNotes').value = task.notes || '';
    
    const animal = findAnimal(task.animalId);
    document.getElementById('completeTaskSummary').innerHTML = `
        <div class="task-summary-content">
            <p><strong>Animal:</strong> ${animal?.name || 'Unknown'}</p>
            <p><strong>Task:</strong> ${task.eventType}</p>
            <p><strong>Description:</strong> ${task.description || 'N/A'}</p>
        </div>
    `;
    
    document.getElementById('completeScheduleFollowup').checked = false;
    document.getElementById('completeFollowupDetails').classList.add('hidden');
    
    openModal('completeTaskModal');
}

function openBulkModal() {
    document.getElementById('bulkStep1').classList.remove('hidden');
    document.getElementById('bulkStep2').classList.add('hidden');
    selectedBulkAnimals.clear();
    updateSelectedCount();
    
    document.getElementById('bulkForm').reset();
    document.getElementById('bulkDate').value = formatDateForInput(new Date());
    document.getElementById('bulkFollowupDetails').classList.add('hidden');
    
    renderBulkAnimals();
    
    openModal('bulkModal');
}

function renderBulkAnimals() {
    const container = document.getElementById('bulkAnimalsGrid');
    const speciesFilter = document.getElementById('bulkSpeciesFilter').value;
    const statusFilter = document.getElementById('bulkStatusFilter').value;
    
    let animals = [...animalsCache];
    
    if (speciesFilter !== 'all') {
        animals = animals.filter(a => a.species === speciesFilter);
    }
    
    if (statusFilter === 'active') {
        animals = animals.filter(a => a.status === 'Active' || a.status === 'active');
    }
    
    animals.sort((a, b) => {
        const speciesA = speciesCache.find(s => s.id === a.species)?.name || '';
        const speciesB = speciesCache.find(s => s.id === b.species)?.name || '';
        if (speciesA !== speciesB) return speciesA.localeCompare(speciesB);
        return a.name.localeCompare(b.name);
    });
    
    if (animals.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <p>No animals found matching filters</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = animals.map(animal => {
        const species = speciesCache.find(s => s.id === animal.species);
        const isSelected = selectedBulkAnimals.has(animal.id);
        
        return `
            <div class="animal-select-card ${isSelected ? 'selected' : ''}" 
                 data-animal-id="${animal.id}"
                 onclick="toggleBulkAnimal('${animal.id}')">
                <div class="animal-select-checkbox">
                    <i class="fas ${isSelected ? 'fa-check-square' : 'fa-square'}"></i>
                </div>
                <div class="animal-select-info">
                    <span class="animal-name">${animal.name}</span>
                    <span class="animal-species">${species?.name || 'Unknown'}</span>
                </div>
                ${animal.photo ? `<img src="${animal.photo}" class="animal-thumbnail" alt="">` : ''}
            </div>
        `;
    }).join('');
}

function toggleBulkAnimal(animalId) {
    if (selectedBulkAnimals.has(animalId)) {
        selectedBulkAnimals.delete(animalId);
    } else {
        selectedBulkAnimals.add(animalId);
    }
    
    const card = document.querySelector(`[data-animal-id="${animalId}"]`);
    if (card) {
        card.classList.toggle('selected');
        const checkbox = card.querySelector('.animal-select-checkbox i');
        checkbox.className = `fas ${selectedBulkAnimals.has(animalId) ? 'fa-check-square' : 'fa-square'}`;
    }
    
    updateSelectedCount();
}

function updateSelectedCount() {
    const count = selectedBulkAnimals.size;
    document.querySelector('.selected-count').textContent = `${count} animal${count !== 1 ? 's' : ''} selected`;
    document.getElementById('btnBulkNext').disabled = count === 0;
}

function selectAllBulkAnimals() {
    document.querySelectorAll('.animal-select-card').forEach(card => {
        const animalId = card.dataset.animalId;
        selectedBulkAnimals.add(animalId);
        card.classList.add('selected');
        card.querySelector('.animal-select-checkbox i').className = 'fas fa-check-square';
    });
    updateSelectedCount();
}

function selectNoneBulkAnimals() {
    selectedBulkAnimals.clear();
    document.querySelectorAll('.animal-select-card').forEach(card => {
        card.classList.remove('selected');
        card.querySelector('.animal-select-checkbox i').className = 'fas fa-square';
    });
    updateSelectedCount();
}

function bulkNextStep() {
    if (selectedBulkAnimals.size === 0) return;
    
    const summary = document.getElementById('selectedAnimalsSummary');
    const selectedAnimals = animalsCache.filter(a => selectedBulkAnimals.has(a.id));
    
    summary.innerHTML = `
        <div class="selected-summary">
            <strong>${selectedAnimals.length} animals selected:</strong>
            <div class="selected-tags">
                ${selectedAnimals.map(a => `<span class="animal-tag">${a.name}</span>`).join('')}
            </div>
        </div>
    `;
    
    document.getElementById('bulkStep1').classList.add('hidden');
    document.getElementById('bulkStep2').classList.remove('hidden');
}

function bulkPreviousStep() {
    document.getElementById('bulkStep2').classList.add('hidden');
    document.getElementById('bulkStep1').classList.remove('hidden');
}

function viewRecord(recordId) {
    const record = healthRecordsCache.find(r => r.id === recordId);
    if (!record) return;
    
    const animal = findAnimal(record.animalId);
    const eventConfig = EVENT_TYPES[record.eventType] || EVENT_TYPES['Other'];
    const eventDate = record.eventDate?.toDate();
    
    let withdrawalHTML = '';
    if (record.withdrawal) {
        const withdrawalItems = [];
        if (record.withdrawal.meat?.days) {
            const endDate = record.withdrawal.meat.endDate?.toDate();
            withdrawalItems.push(`
                <div class="withdrawal-detail-item">
                    <i class="fas fa-drumstick-bite"></i>
                    <span>Meat: ${record.withdrawal.meat.days} days</span>
                    ${endDate ? `<span class="withdrawal-end">(until ${formatDate(endDate)})</span>` : ''}
                </div>
            `);
        }
        if (record.withdrawal.dairy?.days) {
            const endDate = record.withdrawal.dairy.endDate?.toDate();
            withdrawalItems.push(`
                <div class="withdrawal-detail-item">
                    <i class="fas fa-cheese"></i>
                    <span>Dairy: ${record.withdrawal.dairy.days} days</span>
                    ${endDate ? `<span class="withdrawal-end">(until ${formatDate(endDate)})</span>` : ''}
                </div>
            `);
        }
        if (record.withdrawal.eggs?.days) {
            const endDate = record.withdrawal.eggs.endDate?.toDate();
            withdrawalItems.push(`
                <div class="withdrawal-detail-item">
                    <i class="fas fa-egg"></i>
                    <span>Eggs: ${record.withdrawal.eggs.days} days</span>
                    ${endDate ? `<span class="withdrawal-end">(until ${formatDate(endDate)})</span>` : ''}
                </div>
            `);
        }
        
        if (withdrawalItems.length > 0) {
            withdrawalHTML = `
                <div class="detail-section">
                    <h4><i class="fas fa-clock"></i> Withdrawal Periods</h4>
                    ${withdrawalItems.join('')}
                </div>
            `;
        }
    }
    
    const content = document.getElementById('viewRecordContent');
    content.innerHTML = `
        <div class="record-view-header">
            <div class="record-view-icon" style="background-color: ${eventConfig.color}20; color: ${eventConfig.color}">
                <i class="fas ${eventConfig.icon}"></i>
            </div>
            <div class="record-view-title">
                <h3>${record.eventType}</h3>
                <p>${animal?.name || 'Unknown Animal'}</p>
            </div>
            ${record.status === 'ongoing' ? '<span class="status-badge ongoing">Ongoing Issue</span>' : ''}
        </div>
        
        <div class="record-view-details">
            <div class="detail-row">
                <span class="detail-label">Date:</span>
                <span class="detail-value">${eventDate ? formatDate(eventDate) : 'N/A'}</span>
            </div>
            ${record.description ? `
                <div class="detail-row">
                    <span class="detail-label">Description:</span>
                    <span class="detail-value">${record.description}</span>
                </div>
            ` : ''}
            ${record.medication ? `
                <div class="detail-row">
                    <span class="detail-label">Medication:</span>
                    <span class="detail-value">${record.medication}</span>
                </div>
            ` : ''}
            ${record.dosage ? `
                <div class="detail-row">
                    <span class="detail-label">Dosage:</span>
                    <span class="detail-value">${record.dosage}</span>
                </div>
            ` : ''}
            ${record.administeredBy ? `
                <div class="detail-row">
                    <span class="detail-label">Administered By:</span>
                    <span class="detail-value">${record.administeredBy}</span>
                </div>
            ` : ''}
            ${record.lotNumber ? `
                <div class="detail-row">
                    <span class="detail-label">Lot Number:</span>
                    <span class="detail-value">${record.lotNumber}</span>
                </div>
            ` : ''}
            ${record.veterinarian ? `
                <div class="detail-row">
                    <span class="detail-label">Veterinarian:</span>
                    <span class="detail-value">${record.veterinarian}</span>
                </div>
            ` : ''}
            ${record.cost ? `
                <div class="detail-row">
                    <span class="detail-label">Cost:</span>
                    <span class="detail-value">$${parseFloat(record.cost).toFixed(2)}</span>
                </div>
            ` : ''}
            ${record.notes ? `
                <div class="detail-row full-width">
                    <span class="detail-label">Notes:</span>
                    <span class="detail-value">${record.notes}</span>
                </div>
            ` : ''}
        </div>
        
        ${withdrawalHTML}
    `;
    
    document.getElementById('btnEditRecord').onclick = () => openEditRecord(recordId);
    document.getElementById('btnDeleteRecord').onclick = () => confirmDeleteItem(recordId, 'record');
    
    openModal('viewRecordModal');
}

function confirmDeleteItem(itemId, itemType) {
    document.getElementById('deleteItemId').value = itemId;
    document.getElementById('deleteItemType').value = itemType;
    document.getElementById('confirmDeleteMessage').textContent = 
        `Are you sure you want to delete this ${itemType}? This action cannot be undone.`;
    openModal('confirmDeleteModal');
}

// ============================================================
// FORM SUBMISSIONS
// ============================================================
async function saveHealthRecord(e) {
    e.preventDefault();
    
    const recordId = document.getElementById('recordId').value;
    const linkedTaskId = document.getElementById('recordLinkedTaskId').value;
    
    // Parse date as local time
    const eventDate = parseLocalDate(document.getElementById('recordDate').value);
    
    // Build withdrawal data
    const withdrawal = {};
    const meatDays = parseInt(document.getElementById('withdrawalMeat').value) || 0;
    const dairyDays = parseInt(document.getElementById('withdrawalDairy').value) || 0;
    const eggsDays = parseInt(document.getElementById('withdrawalEggs').value) || 0;
    
    if (meatDays > 0) {
        const endDate = new Date(eventDate);
        endDate.setDate(endDate.getDate() + meatDays);
        withdrawal.meat = { days: meatDays, endDate: firebase.firestore.Timestamp.fromDate(endDate) };
    }
    if (dairyDays > 0) {
        const endDate = new Date(eventDate);
        endDate.setDate(endDate.getDate() + dairyDays);
        withdrawal.dairy = { days: dairyDays, endDate: firebase.firestore.Timestamp.fromDate(endDate) };
    }
    if (eggsDays > 0) {
        const endDate = new Date(eventDate);
        endDate.setDate(endDate.getDate() + eggsDays);
        withdrawal.eggs = { days: eggsDays, endDate: firebase.firestore.Timestamp.fromDate(endDate) };
    }
    
    const animal = findAnimal(document.getElementById('recordAnimal').value);
    
    const recordData = {
        animalId: document.getElementById('recordAnimal').value,
        animalName: animal?.name || '',
        farmId: currentFarmId,
        eventType: document.getElementById('recordEventType').value,
        eventDate: firebase.firestore.Timestamp.fromDate(eventDate),
        status: document.getElementById('recordStatus').value,
        description: document.getElementById('recordDescription').value,
        medication: document.getElementById('recordMedication').value,
        dosage: document.getElementById('recordDosage').value,
        administeredBy: document.getElementById('recordAdministeredBy').value,
        lotNumber: document.getElementById('recordLotNumber').value,
        veterinarian: document.getElementById('recordVeterinarian').value,
        cost: parseFloat(document.getElementById('recordCost').value) || null,
        notes: document.getElementById('recordNotes').value,
        withdrawal: Object.keys(withdrawal).length > 0 ? withdrawal : null,
        linkedTaskId: linkedTaskId || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    try {
        if (recordId) {
            await window.db.collection('healthRecords').doc(recordId).update(recordData);
            showNotification('Health record updated successfully', 'success');
        } else {
            recordData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            const docRef = await window.db.collection('healthRecords').add(recordData);
            
            if (document.getElementById('recordScheduleFollowup').checked) {
                const followupDateStr = document.getElementById('followupDate').value;
                if (followupDateStr) {
                    const followupDate = parseLocalDate(followupDateStr);
                    await createFollowupTask({
                        animalId: recordData.animalId,
                        animalName: recordData.animalName,
                        eventType: recordData.eventType,
                        dueDate: followupDate,
                        description: document.getElementById('followupNotes').value || `Follow-up: ${recordData.eventType}`,
                        linkedRecordId: docRef.id,
                        medication: recordData.medication,
                        dosage: recordData.dosage,
                        withdrawal: {
                            meat: meatDays,
                            dairy: dairyDays,
                            eggs: eggsDays
                        }
                    });
                }
            }
            
            showNotification('Health record added successfully', 'success');
        }
        
        closeModal('recordModal');
        await loadHealthRecords();
        await loadHealthTasks();
        renderAlerts();
        renderStats();
        renderRecords();
        renderWithdrawals();
        renderTasks(document.getElementById('scheduleFilter').value);
        
    } catch (error) {
        console.error('Error saving health record:', error);
        showNotification('Error saving health record', 'error');
    }
}

async function saveHealthTask(e) {
    e.preventDefault();
    
    const taskId = document.getElementById('taskId').value;
    const isUndated = document.querySelector('input[name="taskDateOption"]:checked').value === 'undated';
    
    let dueDate = null;
    if (!isUndated) {
        const dueDateStr = document.getElementById('taskDueDate').value;
        if (dueDateStr) {
            dueDate = parseLocalDate(dueDateStr);
        }
    }
    
    const taskData = {
        animalId: document.getElementById('taskAnimal').value,
        animalName: findAnimal(document.getElementById('taskAnimal').value)?.name || '',
        farmId: currentFarmId,
        eventType: document.getElementById('taskEventType').value,
        description: document.getElementById('taskDescription').value,
        priority: document.getElementById('taskPriority').value,
        isUndated: isUndated,
        dueDate: dueDate ? firebase.firestore.Timestamp.fromDate(dueDate) : null,
        status: 'pending',
        medication: document.getElementById('taskMedication').value,
        dosage: document.getElementById('taskDosage').value,
        withdrawal: {
            meat: parseInt(document.getElementById('taskWithdrawalMeat').value) || 0,
            dairy: parseInt(document.getElementById('taskWithdrawalDairy').value) || 0,
            eggs: parseInt(document.getElementById('taskWithdrawalEggs').value) || 0
        },
        notes: document.getElementById('taskNotes').value,
        linkedRecordId: document.getElementById('taskLinkedRecordId').value || null,
        isFollowUp: !!document.getElementById('taskLinkedRecordId').value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    try {
        if (taskId) {
            await window.db.collection('healthTasks').doc(taskId).update(taskData);
            showNotification('Task updated successfully', 'success');
        } else {
            taskData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await window.db.collection('healthTasks').add(taskData);
            showNotification('Task scheduled successfully', 'success');
        }
        
        closeModal('taskModal');
        await loadHealthTasks();
        renderAlerts();
        renderStats();
        renderTasks(document.getElementById('scheduleFilter').value);
        
    } catch (error) {
        console.error('Error saving task:', error);
        showNotification('Error saving task', 'error');
    }
}

async function completeTask(e) {
    e.preventDefault();
    
    const taskId = document.getElementById('completeTaskId').value;
    const task = healthTasksCache.find(t => t.id === taskId);
    if (!task) return;
    
    const completionDate = parseLocalDate(document.getElementById('completeDate').value);
    
    // Build withdrawal data
    const withdrawal = {};
    const meatDays = parseInt(document.getElementById('completeWithdrawalMeat').value) || 0;
    const dairyDays = parseInt(document.getElementById('completeWithdrawalDairy').value) || 0;
    const eggsDays = parseInt(document.getElementById('completeWithdrawalEggs').value) || 0;
    
    if (meatDays > 0) {
        const endDate = new Date(completionDate);
        endDate.setDate(endDate.getDate() + meatDays);
        withdrawal.meat = { days: meatDays, endDate: firebase.firestore.Timestamp.fromDate(endDate) };
    }
    if (dairyDays > 0) {
        const endDate = new Date(completionDate);
        endDate.setDate(endDate.getDate() + dairyDays);
        withdrawal.dairy = { days: dairyDays, endDate: firebase.firestore.Timestamp.fromDate(endDate) };
    }
    if (eggsDays > 0) {
        const endDate = new Date(completionDate);
        endDate.setDate(endDate.getDate() + eggsDays);
        withdrawal.eggs = { days: eggsDays, endDate: firebase.firestore.Timestamp.fromDate(endDate) };
    }
    
    try {
        const recordData = {
            animalId: task.animalId,
            animalName: task.animalName,
            farmId: currentFarmId,
            eventType: task.eventType,
            eventDate: firebase.firestore.Timestamp.fromDate(completionDate),
            status: 'completed',
            description: task.description,
            medication: document.getElementById('completeMedication').value,
            dosage: document.getElementById('completeDosage').value,
            notes: document.getElementById('completeNotes').value,
            withdrawal: Object.keys(withdrawal).length > 0 ? withdrawal : null,
            linkedTaskId: taskId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        const recordRef = await window.db.collection('healthRecords').add(recordData);
        
        await window.db.collection('healthTasks').doc(taskId).update({
            status: 'completed',
            completedAt: firebase.firestore.FieldValue.serverTimestamp(),
            linkedRecordId: recordRef.id
        });
        
        if (document.getElementById('completeScheduleFollowup').checked) {
            const followupDateStr = document.getElementById('completeFollowupDate').value;
            if (followupDateStr) {
                const followupDate = parseLocalDate(followupDateStr);
                await createFollowupTask({
                    animalId: task.animalId,
                    animalName: task.animalName,
                    eventType: task.eventType,
                    dueDate: followupDate,
                    description: document.getElementById('completeFollowupNotes').value || `Follow-up: ${task.eventType}`,
                    linkedRecordId: recordRef.id,
                    medication: document.getElementById('completeMedication').value,
                    dosage: document.getElementById('completeDosage').value,
                    withdrawal: { meat: meatDays, dairy: dairyDays, eggs: eggsDays }
                });
            }
        }
        
        showNotification('Task completed and record created', 'success');
        closeModal('completeTaskModal');
        
        await Promise.all([loadHealthRecords(), loadHealthTasks()]);
        renderAlerts();
        renderStats();
        renderTasks(document.getElementById('scheduleFilter').value);
        renderRecords();
        renderWithdrawals();
        
    } catch (error) {
        console.error('Error completing task:', error);
        showNotification('Error completing task', 'error');
    }
}

async function createFollowupTask(data) {
    const taskData = {
        animalId: data.animalId,
        animalName: data.animalName,
        farmId: currentFarmId,
        eventType: data.eventType,
        description: data.description,
        priority: 'normal',
        isUndated: false,
        dueDate: firebase.firestore.Timestamp.fromDate(data.dueDate),
        status: 'pending',
        medication: data.medication || '',
        dosage: data.dosage || '',
        withdrawal: data.withdrawal || { meat: 0, dairy: 0, eggs: 0 },
        notes: '',
        linkedRecordId: data.linkedRecordId,
        isFollowUp: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    await window.db.collection('healthTasks').add(taskData);
}

async function saveBulkRecords(e) {
    e.preventDefault();
    
    if (selectedBulkAnimals.size === 0) {
        showNotification('Please select at least one animal', 'error');
        return;
    }
    
    const recordType = document.getElementById('bulkRecordType').value;
    const eventDate = parseLocalDate(document.getElementById('bulkDate').value);
    const eventType = document.getElementById('bulkEventType').value;
    const description = document.getElementById('bulkDescription').value;
    const medication = document.getElementById('bulkMedication').value;
    const dosage = document.getElementById('bulkDosage').value;
    const notes = document.getElementById('bulkNotes').value;
    
    const meatDays = parseInt(document.getElementById('bulkWithdrawalMeat').value) || 0;
    const dairyDays = parseInt(document.getElementById('bulkWithdrawalDairy').value) || 0;
    const eggsDays = parseInt(document.getElementById('bulkWithdrawalEggs').value) || 0;
    
    const scheduleFollowup = document.getElementById('bulkScheduleFollowup').checked;
    const followupDateStr = document.getElementById('bulkFollowupDate').value;
    const followupNotes = document.getElementById('bulkFollowupNotes').value;
    
    try {
        const batch = window.db.batch();
        const recordRefs = [];
        
        for (const animalId of selectedBulkAnimals) {
            const animal = animalsCache.find(a => a.id === animalId);
            
            if (recordType === 'record') {
                const withdrawal = {};
                if (meatDays > 0) {
                    const endDate = new Date(eventDate);
                    endDate.setDate(endDate.getDate() + meatDays);
                    withdrawal.meat = { days: meatDays, endDate: firebase.firestore.Timestamp.fromDate(endDate) };
                }
                if (dairyDays > 0) {
                    const endDate = new Date(eventDate);
                    endDate.setDate(endDate.getDate() + dairyDays);
                    withdrawal.dairy = { days: dairyDays, endDate: firebase.firestore.Timestamp.fromDate(endDate) };
                }
                if (eggsDays > 0) {
                    const endDate = new Date(eventDate);
                    endDate.setDate(endDate.getDate() + eggsDays);
                    withdrawal.eggs = { days: eggsDays, endDate: firebase.firestore.Timestamp.fromDate(endDate) };
                }
                
                const recordRef = window.db.collection('healthRecords').doc();
                batch.set(recordRef, {
                    animalId,
                    animalName: animal?.name || '',
                    farmId: currentFarmId,
                    eventType,
                    eventDate: firebase.firestore.Timestamp.fromDate(eventDate),
                    status: 'completed',
                    description,
                    medication,
                    dosage,
                    notes,
                    withdrawal: Object.keys(withdrawal).length > 0 ? withdrawal : null,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                recordRefs.push({ animalId, animalName: animal?.name || '', recordId: recordRef.id });
                
            } else {
                const taskRef = window.db.collection('healthTasks').doc();
                batch.set(taskRef, {
                    animalId,
                    animalName: animal?.name || '',
                    farmId: currentFarmId,
                    eventType,
                    description,
                    priority: 'normal',
                    isUndated: false,
                    dueDate: firebase.firestore.Timestamp.fromDate(eventDate),
                    status: 'pending',
                    medication,
                    dosage,
                    withdrawal: { meat: meatDays, dairy: dairyDays, eggs: eggsDays },
                    notes,
                    isFollowUp: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }
        
        await batch.commit();
        
        if (recordType === 'record' && scheduleFollowup && followupDateStr) {
            const followupDate = parseLocalDate(followupDateStr);
            const followupBatch = window.db.batch();
            for (const ref of recordRefs) {
                const taskRef = window.db.collection('healthTasks').doc();
                followupBatch.set(taskRef, {
                    animalId: ref.animalId,
                    animalName: ref.animalName,
                    farmId: currentFarmId,
                    eventType,
                    description: followupNotes || `Follow-up: ${eventType}`,
                    priority: 'normal',
                    isUndated: false,
                    dueDate: firebase.firestore.Timestamp.fromDate(followupDate),
                    status: 'pending',
                    medication,
                    dosage,
                    withdrawal: { meat: meatDays, dairy: dairyDays, eggs: eggsDays },
                    notes: '',
                    linkedRecordId: ref.recordId,
                    isFollowUp: true,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            await followupBatch.commit();
        }
        
        const actionType = recordType === 'record' ? 'records' : 'tasks';
        showNotification(`${selectedBulkAnimals.size} ${actionType} created successfully`, 'success');
        closeModal('bulkModal');
        
        await Promise.all([loadHealthRecords(), loadHealthTasks()]);
        renderAlerts();
        renderStats();
        renderTasks(document.getElementById('scheduleFilter').value);
        renderRecords();
        renderWithdrawals();
        
    } catch (error) {
        console.error('Error saving bulk records:', error);
        showNotification('Error saving bulk records', 'error');
    }
}

async function deleteItem() {
    const itemId = document.getElementById('deleteItemId').value;
    const itemType = document.getElementById('deleteItemType').value;
    
    try {
        const collection = itemType === 'record' ? 'healthRecords' : 'healthTasks';
        await window.db.collection(collection).doc(itemId).delete();
        
        showNotification(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} deleted successfully`, 'success');
        closeModal('confirmDeleteModal');
        closeModal('viewRecordModal');
        
        await Promise.all([loadHealthRecords(), loadHealthTasks()]);
        renderAlerts();
        renderStats();
        renderTasks(document.getElementById('scheduleFilter').value);
        renderRecords();
        renderWithdrawals();
        
    } catch (error) {
        console.error('Error deleting item:', error);
        showNotification('Error deleting item', 'error');
    }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getTaskById(taskId) {
    return healthTasksCache.find(t => t.id === taskId);
}

function openMedCalculator() {
    window.open('https://aguillory.github.io/quick_utils/medicine-calc.html', '_blank');
}

function toggleDashboardFarmView() {
    showAllFarmsDashboard = document.getElementById('dashboardFarmToggle').checked;
    renderAlerts();
    renderStats();
    renderTasks(document.getElementById('scheduleFilter').value);
    renderRecords();
    renderWithdrawals();
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function setupEventListeners() {
    document.getElementById('btnAddRecord').addEventListener('click', () => openAddRecordModal());
    document.getElementById('btnScheduleTask').addEventListener('click', () => openScheduleTaskModal());
    document.getElementById('btnBulkAction').addEventListener('click', openBulkModal);
    
    const medCalcBtn = document.getElementById('btnMedCalculator');
    if (medCalcBtn) {
        medCalcBtn.addEventListener('click', openMedCalculator);
    }
    
    // Dashboard farm toggle
    const dashboardFarmToggle = document.getElementById('dashboardFarmToggle');
    if (dashboardFarmToggle) {
        dashboardFarmToggle.addEventListener('change', toggleDashboardFarmView);
    }
    
    document.querySelectorAll('.modal-close, [data-modal]').forEach(el => {
        el.addEventListener('click', function() {
            const modalId = this.dataset.modal || this.closest('.modal').id;
            closeModal(modalId);
        });
    });
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal(this.id);
            }
        });
    });
    
    document.getElementById('recordForm').addEventListener('submit', saveHealthRecord);
    document.getElementById('taskForm').addEventListener('submit', saveHealthTask);
    document.getElementById('completeTaskForm').addEventListener('submit', completeTask);
    document.getElementById('bulkForm').addEventListener('submit', saveBulkRecords);
    
    document.getElementById('btnConfirmDelete').addEventListener('click', deleteItem);
    
    document.querySelectorAll('.section-toggle').forEach(toggle => {
        toggle.addEventListener('click', function() {
            const targetId = this.dataset.target;
            const targetEl = document.getElementById(targetId);
            targetEl.classList.toggle('expanded');
            this.querySelector('.toggle-icon').classList.toggle('rotated');
        });
    });
    
    document.getElementById('recordScheduleFollowup').addEventListener('change', function() {
        document.getElementById('followupDetails').classList.toggle('hidden', !this.checked);
    });
    
    document.getElementById('completeScheduleFollowup').addEventListener('change', function() {
        document.getElementById('completeFollowupDetails').classList.toggle('hidden', !this.checked);
    });
    
    document.getElementById('bulkScheduleFollowup').addEventListener('change', function() {
        document.getElementById('bulkFollowupDetails').classList.toggle('hidden', !this.checked);
    });
    
    document.querySelectorAll('input[name="taskDateOption"]').forEach(radio => {
        radio.addEventListener('change', function() {
            document.getElementById('taskDueDate').disabled = this.value === 'undated';
        });
    });
    
    document.getElementById('bulkRecordType').addEventListener('change', function() {
        const isRecord = this.value === 'record';
        document.getElementById('bulkDateLabel').textContent = isRecord ? 'Date *' : 'Due Date *';
        document.getElementById('bulkFollowupSection').style.display = isRecord ? 'block' : 'none';
    });
    
    document.getElementById('scheduleFilter').addEventListener('change', function() {
        renderTasks(this.value);
    });
    
    document.getElementById('recordsSpeciesFilter').addEventListener('change', function() {
        renderRecords(this.value, document.getElementById('recordsTypeFilter').value);
    });
    
    document.getElementById('recordsTypeFilter').addEventListener('change', function() {
        renderRecords(document.getElementById('recordsSpeciesFilter').value, this.value);
    });
    
    document.getElementById('bulkSpeciesFilter').addEventListener('change', renderBulkAnimals);
    document.getElementById('bulkStatusFilter').addEventListener('change', renderBulkAnimals);
    
    document.getElementById('btnSelectAll').addEventListener('click', selectAllBulkAnimals);
    document.getElementById('btnSelectNone').addEventListener('click', selectNoneBulkAnimals);
    document.getElementById('btnBulkNext').addEventListener('click', bulkNextStep);
    document.getElementById('btnBulkBack').addEventListener('click', bulkPreviousStep);
}