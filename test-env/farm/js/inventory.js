let currentUser = null;
let currentFarmId = null;

document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            try {
                const farmDoc = await window.getFarmCollection('farms').doc(currentUser.uid).get();
                if (farmDoc.exists) {
                    currentFarmId = farmDoc.id;
                    await loadInventory();
                    setupModal();
                }
            } catch (err) {
                console.error("Error loading farm data:", err);
            }
        } else {
            window.location.href = 'index.html';
        }
    });
});

function setupModal() {
    const modal = document.getElementById('itemModal');
    
    document.getElementById('btnNewItem').addEventListener('click', () => {
        document.getElementById('itemForm').reset();
        document.getElementById('itemId').value = '';
        document.getElementById('itemModalTitle').textContent = 'Add Inventory Item';
        document.getElementById('itemLowAlertGroup').style.display = 'none';
        modal.classList.add('active');
    });

    document.getElementById('itemLowAlertToggle').addEventListener('change', (e) => {
        document.getElementById('itemLowAlertGroup').style.display = e.target.checked ? 'block' : 'none';
    });

    document.querySelectorAll('.modal-close, .btn-cancel').forEach(btn => {
        btn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    });

    document.getElementById('itemForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('itemId').value;
        const hasAlert = document.getElementById('itemLowAlertToggle').checked;
        
        const data = {
            farmId: currentFarmId,
            name: document.getElementById('itemName').value,
            category: document.getElementById('itemCategory').value,
            quantity: parseFloat(document.getElementById('itemQty').value) || 0,
            unit: document.getElementById('itemUnit').value,
            alertEnabled: hasAlert,
            alertThreshold: hasAlert ? (parseFloat(document.getElementById('itemThreshold').value) || 0) : null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (id) {
                await window.getFarmCollection('inventory').doc(id).update(data);
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await window.getFarmCollection('inventory').add(data);
            }
            modal.classList.remove('active');
            loadInventory();
        } catch(err) {
            alert("Error saving item: " + err.message);
        }
    });
}

async function loadInventory() {
    const container = document.getElementById('inventoryList');
    try {
        const snap = await window.getFarmCollection('inventory')
            .where('farmId', '==', currentFarmId)
            .get();
            
        container.innerHTML = '';
        
        if (snap.empty) {
            container.innerHTML = `
                <div class="card" style="grid-column: 1 / -1; text-align: center; color: #666; padding: 3rem;">
                    <i class="fas fa-boxes" style="font-size: 3rem; margin-bottom: 1rem; color: #ccc;"></i>
                    <p>Your inventory is empty. Click "Add New Item" to start tracking feed and supplies.</p>
                </div>
            `;
            return;
        }
        
        const docs = [];
        snap.forEach(doc => docs.push({id: doc.id, data: doc.data()}));
        docs.sort((a,b) => (a.data.name || '').localeCompare(b.data.name || ''));
        docs.forEach(item => {
            const data = item.data;
            const id = item.id;
            
            const isLow = data.alertEnabled && data.quantity <= data.alertThreshold;
            
            const card = document.createElement('div');
            card.className = 'card inventory-card';
            if (isLow) card.style.border = '1px solid #f44336';
            
            let icon = 'fa-box';
            if (data.category === 'Feed') icon = 'fa-seedling';
            if (data.category === 'Medical') icon = 'fa-first-aid';
            if (data.category === 'Bedding') icon = 'fa-layer-group';
            
            card.innerHTML = `
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <h3 style="margin:0; ${isLow ? 'color:#f44336;' : ''}">
                            <i class="fas ${icon}" style="color:#888; margin-right:5px;"></i> ${data.name}
                        </h3>
                        <button class="btn-edit" data-id="${id}" style="background:none; border:none; color:#2196F3; cursor:pointer;"><i class="fas fa-edit"></i></button>
                    </div>
                    <div style="color:#666; font-size:0.9rem; margin-top:5px;">Category: ${data.category}</div>
                    ${isLow ? `<div style="color:#f44336; font-size:0.8rem; font-weight:bold; margin-top:5px;"><i class="fas fa-exclamation-circle"></i> Low Stock Alert</div>` : ''}
                </div>
                
                <div class="qty-controls">
                    <button class="btn-secondary btn-sub" data-id="${id}" style="background:#f44336; color:white; border:none;">-</button>
                    <input type="number" class="qty-input" data-id="${id}" value="${data.quantity}" step="0.01">
                    <span style="font-weight:600; color:#555;">${data.unit}</span>
                    <button class="btn-secondary btn-add" data-id="${id}" style="background:#4CAF50; color:white; border:none;">+</button>
                </div>
                <div style="margin-top: 10px; display:flex; justify-content:flex-end;">
                     <button class="btn-primary btn-save-qty" data-id="${id}" style="padding: 4px 8px; font-size: 0.8rem; display:none;">Update Qty</button>
                </div>
            `;
            container.appendChild(card);
        });
        
        // Attach event listeners to all these new inputs/buttons
        attachCardListeners();
        
    } catch (err) {
        console.error("Error loading inventory:", err);
        container.innerHTML = `<div style="color:red; grid-column: 1 / -1;">Error: ${err.message}</div>`;
    }
}

function attachCardListeners() {
    // Edit buttons
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            try {
                const doc = await window.getFarmCollection('inventory').doc(id).get();
                if (doc.exists) {
                    const data = doc.data();
                    document.getElementById('itemId').value = id;
                    document.getElementById('itemName').value = data.name;
                    document.getElementById('itemCategory').value = data.category;
                    document.getElementById('itemQty').value = data.quantity;
                    document.getElementById('itemUnit').value = data.unit;
                    
                    document.getElementById('itemLowAlertToggle').checked = !!data.alertEnabled;
                    document.getElementById('itemLowAlertGroup').style.display = data.alertEnabled ? 'block' : 'none';
                    document.getElementById('itemThreshold').value = data.alertThreshold || 0;
                    
                    document.getElementById('itemModalTitle').textContent = 'Edit Inventory Item';
                    document.getElementById('itemModal').classList.add('active');
                }
            } catch(err) {
                console.error(err);
            }
        });
    });

    // Qty + / - / input changes
    document.querySelectorAll('.inventory-card').forEach(card => {
        const id = card.querySelector('.qty-input').dataset.id;
        const input = card.querySelector('.qty-input');
        const btnSave = card.querySelector('.btn-save-qty');
        const origVal = parseFloat(input.value);
        
        const showSaveBtn = () => {
            if (parseFloat(input.value) !== origVal) {
                btnSave.style.display = 'block';
            } else {
                btnSave.style.display = 'none';
            }
        };

        card.querySelector('.btn-sub').addEventListener('click', () => {
            let val = parseFloat(input.value) || 0;
            if (val > 0) {
                input.value = (val - 1).toFixed(2);
                showSaveBtn();
            }
        });
        
        card.querySelector('.btn-add').addEventListener('click', () => {
            let val = parseFloat(input.value) || 0;
            input.value = (val + 1).toFixed(2);
            showSaveBtn();
        });
        
        input.addEventListener('input', showSaveBtn);
        
        btnSave.addEventListener('click', async () => {
            btnSave.disabled = true;
            btnSave.textContent = 'Saving...';
            try {
                await window.getFarmCollection('inventory').doc(id).update({
                    quantity: parseFloat(input.value) || 0,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                await loadInventory();
            } catch(err) {
                alert("Error updating quantity: " + err.message);
                btnSave.disabled = false;
                btnSave.textContent = 'Update Qty';
            }
        });
    });
}
