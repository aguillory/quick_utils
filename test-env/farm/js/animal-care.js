// Feed & Care logic for Animal Details Page

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (!currentAnimalId || !currentAnimalData) return;
        initCareModule();
    }, 1000);
});

async function initCareModule() {
    const btnLog = document.getElementById('btnLogCare');
    if (!btnLog) return;
    
    document.getElementById('careDate').value = formatDateForInput(new Date());

    // Toggle form visibility
    btnLog.addEventListener('click', () => {
        document.getElementById('careFormSection').style.display = 'block';
        document.getElementById('careForm').reset();
        document.getElementById('careDate').value = formatDateForInput(new Date());
        document.getElementById('careCustomGroup').style.display = 'none';
    });

    // Populate species-specific activities
    try {
        const speciesSnap = await window.getFarmCollection('species')
            .where('name', '==', currentAnimalData.species)
            .limit(1)
            .get();
            
        if (!speciesSnap.empty) {
            const speciesData = speciesSnap.docs[0].data();
            if (speciesData.careActivities && speciesData.careActivities.length > 0) {
                const select = document.getElementById('careActivitySelect');
                // Insert before the last option (which is "Other")
                speciesData.careActivities.forEach(act => {
                    const opt = document.createElement('option');
                    opt.value = act;
                    opt.textContent = act;
                    select.insertBefore(opt, select.lastElementChild);
                });
            }
        }
    } catch(err) {
        console.error("Error loading care activities:", err);
    }
    
    // Toggle custom activity input
    document.getElementById('careActivitySelect').addEventListener('change', (e) => {
        document.getElementById('careCustomGroup').style.display = (e.target.value === 'custom') ? 'block' : 'none';
        if (e.target.value === 'custom') document.getElementById('careCustomActivity').required = true;
        else document.getElementById('careCustomActivity').required = false;
    });

    // Save care log
    document.getElementById('careForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let activity = document.getElementById('careActivitySelect').value;
        if (activity === 'custom') activity = document.getElementById('careCustomActivity').value.trim();
        
        const data = {
            farmId: currentFarmId,
            animalId: currentAnimalId, // Works for flocks too if this page is reused!
            date: firebase.firestore.Timestamp.fromDate(new Date(document.getElementById('careDate').value + 'T12:00:00')),
            activity: activity,
            amount: document.getElementById('careAmount').value.trim() || null,
            status: document.getElementById('careStatus').value || null,
            notes: document.getElementById('careNotes').value.trim() || null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        
        try {
            await window.getFarmCollection('careLogs').add(data);
            document.getElementById('careFormSection').style.display = 'none';
            await loadCareLogs();
        } catch(err) {
            alert("Error saving log: " + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save Log';
        }
    });

    await loadCareLogs();
}

async function loadCareLogs() {
    const list = document.getElementById('careRecordsList');
    list.innerHTML = '<div style="text-align:center; color:#666; padding:1rem;">Loading logs...</div>';
    
    try {
        const snap = await window.getFarmCollection('careLogs')
            .where('animalId', '==', currentAnimalId)
            .get();
            
        list.innerHTML = '';
        
        if (snap.empty) {
            list.innerHTML = '<div style="text-align:center; padding:1rem; color:#666;">No care or feeding logs yet.</div>';
            return;
        }
        
        const docs = [];
        snap.forEach(doc => docs.push({id: doc.id, data: doc.data()}));
        docs.sort((a,b) => (b.data.date?.seconds || 0) - (a.data.date?.seconds || 0));
        docs.forEach(item => {
            const doc = item;
            const data = item.data;
            
            const div = document.createElement('div');
            div.className = 'card record-card';
            
            let statusBadge = '';
            if (data.status) {
                let color = '#757575';
                if (data.status === 'Eaten') color = '#4CAF50';
                if (data.status === 'Refused' || data.status === 'Regurgitated') color = '#f44336';
                statusBadge = `<span class="badge" style="background:${color}; font-size:0.8rem;">${data.status}</span>`;
            }
            
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <strong><i class="fas fa-calendar-alt"></i> ${formatDate(data.date)}</strong>
                    </div>
                    <div>${statusBadge}</div>
                </div>
                <div style="margin-top:5px; font-weight:600; font-size:1.1rem;">
                    ${data.activity} ${data.amount ? `<span style="color:#2196F3;">(${data.amount})</span>` : ''}
                </div>
                ${data.notes ? `<div style="font-size:0.9rem; color:#555; margin-top:5px;"><em>${data.notes}</em></div>` : ''}
                <div style="text-align:right; margin-top:10px;">
                    <button class="btn-secondary" onclick="deleteCareLog('${doc.id}')" style="color:#f44336; border:none; background:none; cursor:pointer;"><i class="fas fa-trash"></i> Delete</button>
                </div>
            `;
            list.appendChild(div);
        });
        
    } catch(err) {
        console.error("Error loading care logs:", err);
        list.innerHTML = `<div style="color:red; padding:1rem;">Error: ${err.message}</div>`;
    }
}

window.deleteCareLog = async function(id) {
    if (!confirm("Are you sure you want to delete this log?")) return;
    try {
        await window.getFarmCollection('careLogs').doc(id).delete();
        await loadCareLogs();
    } catch(err) {
        alert("Error deleting log: " + err.message);
    }
};
