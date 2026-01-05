// js/dashboard.js
// No imports needed, we use global 'firebase', 'auth', and 'db' from config

// DOM Elements
const farmNameDisplay = document.getElementById('viewFarmName'); // Updated ID to match HTML
const viewDiv = document.getElementById('farmProfileView');
const form = document.getElementById('farmProfileForm');
const editBtn = document.getElementById('editProfileBtn');
const cancelBtn = document.getElementById('cancelEditBtn');

// 1. Auth Check
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        console.log("User authorized:", user.uid);
        loadFarmProfile(user.uid);
        loadStats(user.uid);
    } else {
        window.location.href = "index.html";
    }
});

// 2. Load Data
async function loadFarmProfile(userId) {
    try {
        // Using Compat syntax: db.collection().doc().get()
        const docSnap = await db.collection("farms").doc(userId).get();

        if (docSnap.exists) {
            const data = docSnap.data();
            
            // Update UI
            document.getElementById('viewFarmName').textContent = data.farmName || "My Farm";
            document.getElementById('viewLocation').textContent = data.location || "Not set";
            
            // Pre-fill form
            document.getElementById('inputFarmName').value = data.farmName || "";
            document.getElementById('inputLocation').value = data.location || "";
        } else {
            document.getElementById('viewFarmName').textContent = "New Farm (Please Edit)";
        }
    } catch (error) {
        console.error("Error loading profile:", error);
    }
}

async function loadStats(userId) {
    try {
        // Example: Get count of animals
        const snapshot = await db.collection("animals")
            .where("ownerId", "==", userId)
            .get();
        document.getElementById('statTotalAnimals').textContent = snapshot.size;
    } catch (error) {
        console.error("Error loading stats:", error);
    }
}

// 3. UI Interactions
editBtn.addEventListener('click', () => {
    viewDiv.classList.add('hidden');
    form.classList.remove('hidden');
    editBtn.classList.add('hidden');
});

cancelBtn.addEventListener('click', () => {
    form.classList.add('hidden');
    viewDiv.classList.remove('hidden');
    editBtn.classList.remove('hidden');
});

// 4. Save Data
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = firebase.auth().currentUser;
    if (!user) return;

    const newName = document.getElementById('inputFarmName').value;
    const newLocation = document.getElementById('inputLocation').value;

    try {
        await db.collection("farms").doc(user.uid).set({
            farmName: newName,
            location: newLocation,
            ownerId: user.uid,
            email: user.email,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Reload UI
        loadFarmProfile(user.uid);
        
        // Switch back to view mode
        cancelBtn.click();
        
    } catch (error) {
        console.error("Error saving farm:", error);
        alert("Could not save changes.");
    }
});
// Note: Logout is now handled by nav.js