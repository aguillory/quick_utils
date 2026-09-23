// Dairy logic for Animal Details Page

document.addEventListener('DOMContentLoaded', () => {
    // Wait slightly to ensure Firebase and globals are loaded
    setTimeout(() => {
        if (!currentAnimalId || !currentAnimalData) return;
        initDairy();
    }, 1500); // Wait a bit longer to let reproduction init first
});

async function initDairy() {
    // 1. Check if female and dairy species
    if (currentAnimalData.gender !== 'Female') return;
    
    try {
        const speciesSnap = await window.getFarmCollection('species')
            .where('name', '==', currentAnimalData.species)
            .limit(1)
            .get();
            
        if (speciesSnap.empty) return;
        
        const speciesData = speciesSnap.docs[0].data();
        if (!speciesData.isDairy) return; // Not a dairy species
        
        // It is a dairy female! Show the section
        const section = document.getElementById('dairyHistorySection');
        if (section) section.style.display = 'block';
        
        setupDairyStatusToggle();
        await checkDairyWithdrawal();
        await loadAnimalDairyLogs();
        
    } catch (err) {
        console.error("Error init dairy:", err);
    }
}

function setupDairyStatusToggle() {
    const toggle = document.getElementById('animalDairyStatusToggle');
    if (!toggle) return;
    
    // Set initial value
    toggle.value = currentAnimalData.inMilk ? "true" : "false";
    toggle.style.color = currentAnimalData.inMilk ? '#4CAF50' : '#999';
    
    toggle.addEventListener('change', async (e) => {
        const isMilk = e.target.value === 'true';
        e.target.style.color = isMilk ? '#4CAF50' : '#999';
        
        try {
            await window.getFarmCollection('animals').doc(currentAnimalId).update({ inMilk: isMilk });
            currentAnimalData.inMilk = isMilk; // update local cache
            showNotification(isMilk ? 'Animal marked as In Milk' : 'Animal dried off', 'success');
        } catch (err) {
            console.error("Error updating status:", err);
            alert("Error: " + err.message);
        }
    });
}

async function checkDairyWithdrawal() {
    try {
        const snap = await window.getFarmCollection('healthRecords')
            .where('animalId', '==', currentAnimalId)
            .get();
            
        const now = Date.now();
        let activeWithdrawal = null;
        
        snap.forEach(doc => {
            const data = doc.data();
            if (data.withdrawal && data.withdrawal.dairy && data.withdrawal.dairy.endDate) {
                const end = data.withdrawal.dairy.endDate.toDate();
                if (end.getTime() > now) {
                    if (!activeWithdrawal || end.getTime() > activeWithdrawal.endDate.getTime()) {
                        activeWithdrawal = { reason: data.medication || data.description, endDate: end };
                    }
                }
            }
        });
        
        if (activeWithdrawal) {
            document.getElementById('animalDairyWithdrawalAlert').style.display = 'block';
            document.getElementById('withdrawalEndDateSpan').textContent = formatDate(activeWithdrawal.endDate);
        } else {
            document.getElementById('animalDairyWithdrawalAlert').style.display = 'none';
        }
        
    } catch (err) {
        console.error("Error checking withdrawal:", err);
    }
}

async function loadAnimalDairyLogs() {
    const list = document.getElementById('animalDairyLogsList');
    try {
        const snap = await window.getFarmCollection('milkLogs')
            .where('animalId', '==', currentAnimalId)
            .get();
            
        list.innerHTML = '';
        
        if (snap.empty) {
            list.innerHTML = '<div style="text-align:center; padding:1rem; color:#666;">No milk logs found for this animal.</div>';
            return;
        }
        
        const docs = [];
        snap.forEach(doc => docs.push(doc.data()));
        docs.sort((a,b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
        docs.slice(0,30).forEach(data => {
            
            let amountStr = [];
            if (data.am !== null && data.am !== undefined) amountStr.push(`AM: ${data.am}`);
            if (data.pm !== null && data.pm !== undefined) amountStr.push(`PM: ${data.pm}`);
            
            const total = data.total || 0;
            const unit = data.unit || 'lbs';
            
            const div = document.createElement('div');
            div.className = 'card record-card';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong><i class="fas fa-calendar-day"></i> ${formatDate(data.date)}</strong>
                    <span class="badge" style="background:#2196F3;">${total} ${unit}</span>
                </div>
                <div style="font-size:0.9rem; color:#666; margin-top:5px;">
                    ${amountStr.join(' | ')}
                </div>
                ${data.notes ? `<div style="font-size:0.8rem; margin-top:5px; color:#555;"><em>Note: ${data.notes}</em></div>` : ''}
            `;
            list.appendChild(div);
        });
        
    } catch(err) {
        console.error("Error loading milk logs:", err);
        list.innerHTML = `<div style="color:red; padding:1rem;">Error: ${err.message}</div>`;
    }
}
