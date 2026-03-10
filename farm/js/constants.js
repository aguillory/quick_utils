/**
 * Global Constants for Farm Manager
 */

// Event types configuration with icons, colors, and logic flags
// Color variables correspond to definitions in css/main.css
const EVENT_TYPES = {
    'Vaccination': { 
        icon: 'fa-syringe', 
        color: 'var(--primary-color)', 
        hasWithdrawal: true, 
        hasFollowup: true 
    },
    'Deworming': { 
        icon: 'fa-pills', 
        color: 'var(--warning-color)', 
        hasWithdrawal: true, 
        hasFollowup: true 
    },
    'Hoof/Foot Trimming': { 
        icon: 'fa-shoe-prints', 
        color: 'var(--secondary-color)', 
        hasWithdrawal: false, 
        hasFollowup: true 
    },
    'Disbudding/Dehorning': { 
        icon: 'fa-fire', 
        color: 'var(--danger-color)', 
        hasWithdrawal: false, 
        hasFollowup: false 
    },
    'Banding/Castration': { 
        icon: 'fa-cut', 
        color: 'var(--danger-color)', 
        hasWithdrawal: false, 
        hasFollowup: true 
    },
    'Shearing/Grooming': { 
        icon: 'fa-scissors', 
        color: 'var(--success-color)', 
        hasWithdrawal: false, 
        hasFollowup: true 
    },
    'Veterinary Visit': { 
        icon: 'fa-user-md', 
        color: 'var(--primary-color)', 
        hasWithdrawal: true, 
        hasFollowup: true 
    },
    'Illness/Injury': { 
        icon: 'fa-band-aid', 
        color: 'var(--danger-color)', 
        hasWithdrawal: true, 
        hasFollowup: true 
    },
    'Surgery': { 
        icon: 'fa-procedures', 
        color: 'var(--danger-color)', 
        hasWithdrawal: true, 
        hasFollowup: true 
    },
    'Dental Care': { 
        icon: 'fa-tooth', 
        color: 'var(--secondary-color)', 
        hasWithdrawal: false, 
        hasFollowup: true 
    },
    'Fecal Test': { 
        icon: 'fa-vial', 
        color: 'var(--warning-color)', 
        hasWithdrawal: false, 
        hasFollowup: true 
    },
    'Blood Test': { 
        icon: 'fa-tint', 
        color: 'var(--danger-color)', 
        hasWithdrawal: false, 
        hasFollowup: true 
    },
    'Other': { 
        icon: 'fa-notes-medical', 
        color: 'var(--secondary-color)', 
        hasWithdrawal: true, 
        hasFollowup: true 
    }
};

// Make available globally if needed for inline scripts
window.EVENT_TYPES = EVENT_TYPES;