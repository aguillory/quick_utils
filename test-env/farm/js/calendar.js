let currentDate = new Date();
let tasks = [];
let currentTaskContext = null;
let currentFarmId = null;
let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            try {
                const farmDoc = await window.getFarmCollection('farms').doc(currentUser.uid).get();
                if (farmDoc.exists) {
                    currentFarmId = farmDoc.id;
                    await loadTasks();
                    renderCalendar();
                    setupEventListeners();
                } else {
                    console.error("Farm document not found for user:", currentUser.uid);
                    alert('No farm found. Please set up your farm first.');
                }
            } catch (err) {
                console.error("Error loading farm data:", err);
            }
        } else {
            window.location.href = 'index.html';
        }
    });
});

async function loadTasks() {
    try {
        const snapshot = await window.getFarmCollection('healthTasks')
            .where('farmId', '==', currentFarmId)
            .get();
        
        tasks = snapshot.docs.map(doc => {
            const data = doc.data();
            // Handle Firestore timestamps or string dates
            let taskDate;
            if (data.dueDate && data.dueDate.toDate) {
                taskDate = data.dueDate.toDate();
            } else if (data.dueDate) {
                // assume string yyyy-mm-dd
                const parts = data.dueDate.split('-');
                taskDate = new Date(parts[0], parts[1] - 1, parts[2]);
            } else {
                taskDate = new Date();
            }

            return {
                id: doc.id,
                ...data,
                dateObj: taskDate
            };
        });
    } catch (err) {
        console.error("Error loading tasks:", err);
    }
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const monthYearDisplay = document.getElementById('monthYearDisplay');
    
    // Clear existing (except headers)
    const headers = grid.querySelectorAll('.calendar-day-header');
    grid.innerHTML = '';
    headers.forEach(h => grid.appendChild(h));

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    monthYearDisplay.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentDate);

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();

    // Previous month's days
    for (let i = firstDay - 1; i >= 0; i--) {
        grid.appendChild(createDayCell(year, month - 1, daysInPrevMonth - i, true));
    }

    // Current month's days
    for (let i = 1; i <= daysInMonth; i++) {
        const isToday = (i === today.getDate() && month === today.getMonth() && year === today.getFullYear());
        grid.appendChild(createDayCell(year, month, i, false, isToday));
    }

    // Next month's days (to complete the grid, usually 42 cells total minus headers = 35 or 42)
    const totalCells = firstDay + daysInMonth;
    const nextDays = (totalCells > 35) ? 42 - totalCells : 35 - totalCells;
    for (let i = 1; i <= nextDays; i++) {
        grid.appendChild(createDayCell(year, month + 1, i, true));
    }
}

function createDayCell(year, month, day, isOtherMonth, isToday = false) {
    const cellDate = new Date(year, month, day);
    const cell = document.createElement('div');
    cell.className = 'calendar-day' + (isOtherMonth ? ' other-month' : '') + (isToday ? ' today' : '');
    
    cell.innerHTML = `<span class="day-number">${day}</span><div class="task-list"></div>`;
    const taskList = cell.querySelector('.task-list');

    // Filter tasks for this day
    const dayTasks = tasks.filter(t => 
        t.dateObj.getFullYear() === cellDate.getFullYear() &&
        t.dateObj.getMonth() === cellDate.getMonth() &&
        t.dateObj.getDate() === cellDate.getDate()
    );

    dayTasks.forEach(t => {
        const tEl = document.createElement('div');
        tEl.className = 'calendar-task' + (t.status === 'completed' ? ' completed' : '');
        tEl.textContent = `${t.animalName || 'Unknown'} - ${t.eventType || 'Task'}`;
        tEl.onclick = () => openTaskModal(t);
        taskList.appendChild(tEl);
    });

    return cell;
}

function openTaskModal(task) {
    currentTaskContext = task;
    document.getElementById('taskAnimalName').textContent = task.animalName || 'Unknown';
    document.getElementById('taskTreatment').textContent = task.eventType || 'Task';
    document.getElementById('taskDate').textContent = task.dueDate || task.dateObj.toLocaleDateString();
    document.getElementById('taskNotes').textContent = task.notes || 'None';
    document.getElementById('taskStatus').textContent = (task.status || 'pending').toUpperCase();

    const btnComplete = document.getElementById('btnMarkComplete');
    if (task.status === 'completed') {
        btnComplete.style.display = 'none';
    } else {
        btnComplete.style.display = 'block';
    }

    document.getElementById('taskModal').classList.add('active');
}

function setupEventListeners() {
    document.getElementById('btnPrevMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });

    document.getElementById('btnNextMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });

    document.getElementById('btnToday').addEventListener('click', () => {
        currentDate = new Date();
        renderCalendar();
    });

    document.getElementById('btnMarkComplete').addEventListener('click', async () => {
        if (!currentTaskContext) return;
        try {
            await window.getFarmCollection('healthTasks').doc(currentTaskContext.id).update({
                status: 'completed',
                completedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            currentTaskContext.status = 'completed';
            renderCalendar();
            document.getElementById('taskModal').classList.remove('active');
        } catch (err) {
            alert('Error updating task: ' + err.message);
        }
    });

    document.getElementById('btnSyncGoogle').addEventListener('click', async () => {
        const token = sessionStorage.getItem('googleCalendarToken');
        if (!token) {
            alert("You need to sign in with Google to sync to your calendar. Please log out and sign back in using the 'Sign in with Google' button.");
            return;
        }

        const btn = document.getElementById('btnSyncGoogle');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
        btn.disabled = true;

        try {
            await syncTasksToGoogleCalendar(token);
            alert('Sync complete!');
        } catch (err) {
            console.error(err);
            alert('Error syncing to Google Calendar: ' + err.message);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    // Modal Close
    document.querySelectorAll('.modal-close, .btn-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = e.target.getAttribute('data-modal');
            if (modalId) {
                document.getElementById(modalId).classList.remove('active');
            }
        });
    });
}

async function syncTasksToGoogleCalendar(token) {
    // Only sync pending tasks that have a valid date
    const pendingTasks = tasks.filter(t => t.status !== 'completed' && t.dateObj);
    
    // For simplicity, we just add them. In a real app, you'd store the Google Event ID 
    // on the task to avoid duplicates.
    for (const task of pendingTasks) {
        // Skip if already synced
        if (task.googleEventId) continue;

        const event = {
            summary: `Farm Task: ${task.animalName} - ${task.eventType}`,
            description: task.notes || 'Generated from Farm Manager',
            start: {
                date: task.dateObj.toISOString().split('T')[0] // yyyy-mm-dd
            },
            end: {
                date: task.dateObj.toISOString().split('T')[0]
            }
        };

        const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(event)
        });

        if (!response.ok) {
            throw new Error(`Failed to create event: ${response.statusText}`);
        }

        const gEvent = await response.json();
        
        // Save the event ID so we don't duplicate it
        await window.getFarmCollection('healthTasks').doc(task.id).update({
            googleEventId: gEvent.id
        });
        task.googleEventId = gEvent.id;
    }
}
