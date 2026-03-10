/**
 * Shared utilities and navigation functions
 */

// ============================================================
// NAVIGATION & UI
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // Add active class to current page in nav
    const currentPage = window.location.pathname.split('/').pop();
    document.querySelectorAll('.nav-links a').forEach(link => {
        if (link.getAttribute('href') === currentPage) {
            link.classList.add('active');
        }
    });
});

function showNotification(message, type = 'success') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// ============================================================
// DATE HELPERS
// ============================================================

// Parse a date string (YYYY-MM-DD) as local time, not UTC (prevents timezone shifts)
function parseLocalDate(dateString) {
    if (!dateString) return null;
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
}

// Get a date object with only the date part (no time), in local timezone
function getLocalDateOnly(date) {
    if (!date) return null;
    if (date.toDate) date = date.toDate(); // Handle Firestore Timestamp
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Get today's date at midnight local time
function getTodayLocal() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Format a date for display (e.g., "Oct 5, 2023")
function formatDate(dateInput) {
    if (!dateInput) return '';
    let date = dateInput;
    if (dateInput.toDate) date = dateInput.toDate(); // Handle Firestore Timestamp
    
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Format a date for input[type="date"] fields (YYYY-MM-DD)
function formatDateForInput(dateInput) {
    if (!dateInput) return '';
    let date = dateInput;
    if (dateInput.toDate) date = dateInput.toDate();
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Format date as relative (e.g., "2 days ago", "in 3 days")
function formatRelativeDate(dateInput) {
    if (!dateInput) return '';
    let date = dateInput;
    if (dateInput.toDate) date = dateInput.toDate();

    const now = new Date();
    const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 0) return `In ${diffDays} days`;
    return `${Math.abs(diffDays)} days ago`;
}

// Calculate days between two dates
function daysBetween(date1, date2) {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round(Math.abs((date1 - date2) / oneDay));
}

// Add days to a date and return a Firestore Timestamp
function addDaysToTimestamp(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return firebase.firestore.Timestamp.fromDate(result);
}

// ============================================================
// ANIMAL UTILS
// ============================================================

function calculateAge(birthDate) {
    if (!birthDate) return 'Unknown';
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

// Helper to get event config safely
function getEventConfig(type) {
    if (window.EVENT_TYPES && window.EVENT_TYPES[type]) {
        return window.EVENT_TYPES[type];
    }
    // Fallback if constants aren't loaded or type is missing
    return { 
        icon: 'fa-notes-medical', 
        color: '#8B6F47', // Fallback secondary color
        hasWithdrawal: true, 
        hasFollowup: true 
    };
}

// ============================================================
// IMAGE PROCESSING
// ============================================================

/**
 * Resizes and compresses an image file.
 * @param {File} file - The image file from input
 * @param {number} maxSize - Max width/height in pixels (default 800)
 * @returns {Promise<string>} - Resolves with the DataURL of the resized image
 */
function processImageUpload(file, maxSize = 800) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('No file provided'));
            return;
        }
        if (!file.type.match('image.*')) {
            reject(new Error('File is not an image'));
            return;
        }

        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                let width = img.width;
                let height = img.height;
                
                // Calculate new dimensions
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
                ctx.drawImage(img, 0, 0, width, height);
                
                // Compress to JPEG with 0.8 quality
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                resolve(dataUrl);
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = event.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}