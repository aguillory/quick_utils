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
                    await loadActiveBreeding();
                } else {
                    console.error("Farm document not found.");
                }
            } catch (err) {
                console.error("Error loading farm data:", err);
            }
        } else {
            window.location.href = 'index.html';
        }
    });
});

async function loadActiveBreeding() {
    const container = document.getElementById('breedingList');
    
    try {
        // We fetch Mating records that are either Exposed or Pregnant
        const snapshot = await window.getFarmCollection('breedingRecords')
            .where('farmId', '==', currentFarmId)
            
            .get();

        container.innerHTML = '';
        
        if (snapshot.empty) {
            container.innerHTML = `
                <div class="card" style="grid-column: 1 / -1; text-align: center; color: #666; padding: 3rem;">
                    <i class="fas fa-venus-mars" style="font-size: 3rem; margin-bottom: 1rem; color: #ccc;"></i>
                    <p>No active pregnancies or exposures found.</p>
                </div>
            `;
            return;
        }

        // We will fetch animal details for names and photos
        let docsData = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
        docsData = docsData.filter(d => d.type === 'Mating' && ['Exposed', 'Pregnant'].includes(d.status));
        const animalIds = [...new Set(docsData.map(d => d.animalId))];
        const animalsMap = {};
        
        // Fetch animals in chunks (max 10 for 'in' query)
        for (let i = 0; i < animalIds.length; i += 10) {
            const chunk = animalIds.slice(i, i + 10);
            const aSnap = await window.getFarmCollection('animals').where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get();
            aSnap.forEach(a => animalsMap[a.id] = a.data());
        }

        // Sort by earliest due date
        const records = docsData.sort((a, b) => {
            const aDue = a.dueMin ? a.dueMin.toDate().getTime() : Infinity;
            const bDue = b.dueMin ? b.dueMin.toDate().getTime() : Infinity;
            return aDue - bDue;
        });

        records.forEach(record => {
            const animal = animalsMap[record.animalId] || { name: 'Unknown', tag: '' };
            
            const card = document.createElement('div');
            card.className = 'card';
            
            let dueText = 'Unknown';
            let dateClass = '';
            
            if (record.dueMin && record.dueMax) {
                const now = new Date();
                const minTime = record.dueMin.toDate();
                const maxTime = record.dueMax.toDate();
                
                // Diff in days from now to min due date
                const daysUntil = Math.ceil((minTime - now) / (1000 * 60 * 60 * 24));
                
                if (daysUntil <= 0) {
                    dateClass = 'date-alert';
                    dueText = 'OVERDUE / ANY DAY NOW';
                } else if (daysUntil <= 14) {
                    dateClass = 'date-soon';
                    dueText = `Due in ${daysUntil} days`;
                } else {
                    dueText = `Due in ${daysUntil} days`;
                }
                
                // Append the exact date range window
                const d1 = formatDate(minTime);
                const d2 = formatDate(maxTime);
                const windowStr = (d1 === d2) ? d1 : `${d1} to ${d2}`;
                dueText += `<br><small style="color:#666; font-weight:normal;">(${windowStr})</small>`;
            }

            const dates = record.startDate.toDate().getTime() === record.endDate.toDate().getTime() ?
                formatDate(record.startDate) : 
                `${formatDate(record.startDate)} - ${formatDate(record.endDate)}`;

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                    <h3 style="margin:0;"><a href="animal-details.html?id=${record.animalId}" style="text-decoration:none; color:inherit;">
                        ${animal.name} ${animal.tag ? `(${animal.tag})` : ''}
                    </a></h3>
                    <span class="status-badge status-${record.status}">${record.status}</span>
                </div>
                <div style="margin-bottom: 0.5rem;">
                    <strong>Sire:</strong> ${record.sireName}<br>
                    <strong>Mated:</strong> ${dates}
                </div>
                <div class="card" style="background:#f9f9f9; padding:0.5rem; margin-top:0.5rem;">
                    <strong>Due Window:</strong>
                    <div class="${dateClass}" style="margin-top:0.25rem;">${dueText}</div>
                </div>
            `;
            container.appendChild(card);
        });

    } catch (err) {
        console.error("Error loading breeding dashboard:", err);
        container.innerHTML = `<div style="color:red; grid-column: 1 / -1;">Error loading data: ${err.message}</div>`;
    }
}
