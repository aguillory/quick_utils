// sync-tasks.js

const NIPTO_URL = "https://nipto.app/graphql";

// Reusing your exact decryption logic
function decodeKey(pin) {
    const masked = "$a#0$*fa-*a07-%%f%-a%*%-f*c8$9c*%8*8";
    const p1 = pin[0], p2 = pin[1], p3 = pin[2], p4 = pin[3];
    return masked.replace(/\*/g, p1).replace(/#/g, p2).replace(/\$/g, p3).replace(/%/g, p4);
}

async function syncNiptoTasks() {
    const pin = document.getElementById('pinInput').value;
    const statusText = document.getElementById('status-message');
    const syncBtn = document.getElementById('sync-btn');

    if (pin.length !== 4) {
        statusText.innerText = "Error: Please enter a valid 4-digit PIN.";
        statusText.style.color = "#cf6679";
        return;
    }

    const apiToken = decodeKey(pin);
    syncBtn.disabled = true;
    statusText.innerText = "Connecting to Nipto API...";
    statusText.style.color = "#e0e0e0";

    // This query matches the exact structure of your tasks.txt
    const QUERY = `
        query GetTasks {
          tasks {
            uid
            group
            name
            value
          }
        }
    `;

    try {
        // 1. Fetch live data from Nipto
        const response = await fetch(NIPTO_URL, {
            method: 'POST',
            headers: {
                'Authorization': apiToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: QUERY })
        });

        const jsonData = await response.json();

        if (jsonData.errors) {
            throw new Error(jsonData.errors[0].message || "GraphQL Error from Nipto");
        }

        const tasks = jsonData.data.tasks;
        if (!tasks || tasks.length === 0) {
            throw new Error("No tasks returned from Nipto. Check your PIN or API permissions.");
        }

        statusText.innerText = `Found ${tasks.length} live tasks. Syncing to Firebase...`;

        // 1. Create a Set of all the incoming active task IDs for fast comparison
        const activeNiptoTaskIds = new Set(tasks.map(task => task.uid));

        // 2. Fetch all current tasks from your Firebase database
        const firebaseSnapshot = await window.db.collection('nipto_tasks').get();
        
        // 3. Find the tasks in Firebase that are NO LONGER in the Nipto API response
        const uidsToDelete = [];
        firebaseSnapshot.forEach(doc => {
            if (!activeNiptoTaskIds.has(doc.id)) {
                uidsToDelete.push(doc.id);
            }
        });

        // 4. Populate the Firebase database (Upserts & Deletions)
        let batch = window.db.batch();
        let operationCount = 0;
        let totalSynced = 0;
        let totalDeleted = 0;

        // Upsert active tasks
        for (const task of tasks) {
            const docRef = window.db.collection('nipto_tasks').doc(task.uid);
            batch.set(docRef, task, { merge: true });
            operationCount++;
            totalSynced++;

            if (operationCount === 490) {
                await batch.commit();
                batch = window.db.batch(); 
                operationCount = 0;
            }
        }

        // Delete orphaned tasks
        for (const orphanId of uidsToDelete) {
            const docRef = window.db.collection('nipto_tasks').doc(orphanId);
            batch.delete(docRef);
            operationCount++;
            totalDeleted++;

            if (operationCount === 490) {
                await batch.commit();
                batch = window.db.batch(); 
                operationCount = 0;
            }
        }

        if (operationCount > 0) {
            await batch.commit();
        }

        statusText.innerText = `Success! Synced ${totalSynced} tasks and removed ${totalDeleted} deleted tasks.`;
        statusText.style.color = "#03dac6";
        document.getElementById('pinInput').value = ''; // Clear PIN for security

    } catch (error) {
        console.error("Error syncing Nipto tasks:", error);
        statusText.innerText = `Error: ${error.message}`;
        statusText.style.color = "#cf6679";
    } finally {
        syncBtn.disabled = false;
    }
}

