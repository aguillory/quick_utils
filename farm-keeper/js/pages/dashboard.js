import { auth, db } from '../config/firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// DOM Elements
const farmNameDisplay = document.getElementById('farmNameDisplay');
const viewDiv = document.getElementById('farmProfileView');
const form = document.getElementById('farmProfileForm');
const editBtn = document.getElementById('editProfileBtn');
const cancelBtn = document.getElementById('cancelEditBtn');
const logoutBtn = document.getElementById('logoutBtn');

// 1. Auth Check (Security Gate)
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("User authorized:", user.uid);
        loadFarmProfile(user.uid);
    } else {
        // No user? Go back to login
        window.location.href = "index.html";
    }
});

// 2. Load Data
async function loadFarmProfile(userId) {
    // We assume the Farm ID is the same as the User ID for MVP 
    // (One farm per user as per Doc A)
    const farmRef = doc(db, "farms", userId);
    const docSnap = await getDoc(farmRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        // Update UI
        farmNameDisplay.textContent = data.farmName || "My Farm";
        document.getElementById('viewFarmName').textContent = data.farmName;
        document.getElementById('viewOwnerName').textContent = data.ownerName || "Unknown";
        document.getElementById('viewLocation').textContent = data.location || "Not set";
        
        // Pre-fill form
        document.getElementById('inputFarmName').value = data.farmName || "";
        document.getElementById('inputLocation').value = data.location || "";
    } else {
        farmNameDisplay.textContent = "New Farm";
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
    const user = auth.currentUser;
    if (!user) return;

    const newName = document.getElementById('inputFarmName').value;
    const newLocation = document.getElementById('inputLocation').value;

    try {
        await setDoc(doc(db, "farms", user.uid), {
            farmName: newName,
            location: newLocation,
            ownerId: user.uid,
            email: user.email
        }, { merge: true }); // Merge updates, don't overwrite everything

        // Reload UI
        loadFarmProfile(user.uid);
        
        // Switch back to view mode
        cancelBtn.click();
        
    } catch (error) {
        console.error("Error saving farm:", error);
        alert("Could not save changes.");
    }
});

// 5. Logout
logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.href = "index.html";
    });
});