import { db } from './connection.js';
import { collection, getDocs, setDoc, addDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const formatCurrency = (num) => isNaN(num) ? '$0.00' : `$${num.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
let initialAccounts = [];

function createPromoRow(promo = {}) {
    const promoId = promo.id || `new-promo-${Date.now()}`;
    const promoDiv = document.createElement('div');
    promoDiv.className = 'promo-row grid grid-cols-5 gap-2 items-center p-2 bg-gray-50 rounded-md mb-2';
    promoDiv.dataset.id = promoId;

    const today = new Date().toISOString().split('T')[0];
    const balance = promo.balance || '';
    const startDate = promo.startDate || today;
    const endDate = promo.endDate || '';

    let minPaymentDisplay = '$0.00';
    if (balance && endDate) {
        const monthsRemaining = (new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24 * 30.44);
        if (monthsRemaining > 1) {
            const payment = balance / (monthsRemaining - 1);
            minPaymentDisplay = formatCurrency(payment);
        } else if (monthsRemaining > 0) {
            minPaymentDisplay = formatCurrency(balance);
        }
    }

    promoDiv.innerHTML = `
        <div><label class="text-xs font-medium">Promo Balance</label><input name="promoBalance" type="number" class="form-input-table amount" value="${balance}" placeholder="0.00"></div>
        <div><label class="text-xs font-medium">Start Date</label><input name="promoStartDate" type="date" class="form-input-table" value="${startDate}"></div>
        <div><label class="text-xs font-medium">End Date</label><input name="promoEndDate" type="date" class="form-input-table" value="${endDate}"></div>
        <div class="text-center">
            <div class="text-xs font-medium">Min. Payment</div>
            <div name="promoMinPayment" class="font-semibold text-blue-600">${minPaymentDisplay}</div>
        </div>
        <div class="text-center"><button class="delete-promo-btn text-red-500 hover:text-red-700 p-1">🗑️</button></div>
    `;
    return promoDiv;
}

function renderPromos(promos = [], container) {
    container.innerHTML = ''; // Clear existing promos
    const promoList = document.createElement('div');
    promos.forEach(promo => promoList.appendChild(createPromoRow(promo)));
    container.appendChild(promoList);

    const addPromoBtn = document.createElement('button');
    addPromoBtn.textContent = '+ Add Promo';
    addPromoBtn.className = 'add-promo-btn text-xs bg-blue-500 text-white hover:bg-blue-600 px-2 py-1 rounded-md mt-2';
    container.appendChild(addPromoBtn);
}


function createAccountRow(account = {}) {
    const row = document.createElement('tr');
    row.className = 'account-row';
    row.dataset.id = account.id || `new-${Date.now()}`;

    const accountTypes = ["Credit Card", "Mortgage", "Loan"];
    const typeOptions = accountTypes.map(t => `<option value="${t}" ${account.type === t ? 'selected' : ''}>${t}</option>`).join('');

    row.innerHTML = `
        <td class="p-2"><input name="name" type="text" class="form-input-table" value="${account.name || ''}" placeholder="Account Name"></td>
        <td class="p-2"><select name="type" class="form-input-table">${typeOptions}</select></td>
        <td class="p-2"><input name="balance" type="number" class="form-input-table amount" value="${account.balance || ''}" placeholder="0.00"></td>
        <td class="p-2"><input name="limit" type="number" class="form-input-table amount" value="${account.limit || ''}" placeholder="N/A"></td>
        <td class="p-2"><input name="apr" type="number" class="form-input-table amount" value="${account.apr || ''}" placeholder="N/A"></td>
        <td class="p-2"><button class="manage-promo-btn text-sm text-blue-600 hover:underline">Promos (${(account.promos || []).length})</button></td>
        <td class="p-2"><input name="minPayment" type="number" class="form-input-table amount" value="${account.minPayment || ''}" placeholder="0.00"></td>
        <td class="text-center"><button class="delete-row-btn text-red-500 hover:text-red-700 p-1">🗑️</button></td>
    `;

    const promoContainerRow = document.createElement('tr');
    promoContainerRow.className = 'promo-container-row hidden';
    promoContainerRow.dataset.accountId = row.dataset.id;
    const promoCell = document.createElement('td');
    promoCell.colSpan = 8;
    promoCell.className = 'p-4 bg-gray-100';
    renderPromos(account.promos, promoCell);
    promoContainerRow.appendChild(promoCell);

    return [row, promoContainerRow];
}


function recalculateAccountsSummary() {
    let totalDebt = 0, totalMonthly = 0, ccDebt = 0, ccMonthly = 0;
    let debtNoDiscover = 0, monthlyNoDiscover = 0, debtNoHouse = 0, monthlyNoHouse = 0;

    document.querySelectorAll('.account-row').forEach(row => {
        const name = row.querySelector('[name="name"]').value.toLowerCase();
        const type = row.querySelector('[name="type"]').value;
        const balance = parseFloat(row.querySelector('[name="balance"]').value) || 0;
        let minPayment = parseFloat(row.querySelector('[name="minPayment"]').value) || 0;

        // Add promo minimum payments to the total monthly payment for the account
        const promoContainer = document.querySelector(`.promo-container-row[data-account-id="${row.dataset.id}"]`);
        if (promoContainer) {
            promoContainer.querySelectorAll('.promo-row').forEach(promoRow => {
                const promoBalance = parseFloat(promoRow.querySelector('[name="promoBalance"]').value) || 0;
                const endDate = promoRow.querySelector('[name="promoEndDate"]').value;
                if (promoBalance && endDate) {
                     const monthsRemaining = (new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24 * 30.44);
                     if (monthsRemaining > 1) {
                         minPayment += promoBalance / (monthsRemaining - 1);
                     } else if (monthsRemaining > 0) {
                         minPayment += promoBalance;
                     }
                }
            });
        }

        totalDebt += balance;
        totalMonthly += minPayment;
        if (type === 'Credit Card') { ccDebt += balance; ccMonthly += minPayment; }
        if (!name.includes('discover')) { debtNoDiscover += balance; monthlyNoDiscover += minPayment; }
        if (type !== 'Mortgage') { debtNoHouse += balance; monthlyNoHouse += minPayment; }
    });

    document.getElementById('summary-total-debt').textContent = formatCurrency(totalDebt);
    document.getElementById('summary-total-monthly').textContent = formatCurrency(totalMonthly);
    document.getElementById('summary-cc-debt').textContent = formatCurrency(ccDebt);
    document.getElementById('summary-cc-monthly').textContent = formatCurrency(ccMonthly);
    document.getElementById('summary-debt-no-discover').textContent = formatCurrency(debtNoDiscover);
    document.getElementById('summary-monthly-no-discover').textContent = formatCurrency(monthlyNoDiscover);
    document.getElementById('summary-debt-no-house').textContent = formatCurrency(debtNoHouse);
    document.getElementById('summary-monthly-no-house').textContent = formatCurrency(monthlyNoHouse);
}

function renderAccountsForm(accounts) {
    const accountsBody = document.getElementById('accounts-body');
    accountsBody.innerHTML = '';
    accounts.forEach(acc => {
        const rows = createAccountRow(acc);
        accountsBody.appendChild(rows[0]);
        accountsBody.appendChild(rows[1]);
    });
    recalculateAccountsSummary();
    document.getElementById('accounts-loading-message').classList.add('hidden');
    document.getElementById('accounts-container').classList.remove('hidden');
}

async function handleSaveAccounts() {
    const accountsSaveBtn = document.getElementById('accounts-save-btn');
    const accountsSaveStatus = document.getElementById('accounts-save-status');
    accountsSaveBtn.disabled = true;
    accountsSaveStatus.textContent = 'Saving...';

    const currentRowIds = [];
    const promises = [];

    document.querySelectorAll('.account-row').forEach(row => {
        const id = row.dataset.id;
        currentRowIds.push(id);
        const promos = [];
        const promoContainer = document.querySelector(`.promo-container-row[data-account-id="${id}"]`);
        if (promoContainer) {
            promoContainer.querySelectorAll('.promo-row').forEach(promoRow => {
                promos.push({
                    id: promoRow.dataset.id,
                    balance: parseFloat(promoRow.querySelector('[name="promoBalance"]').value) || 0,
                    startDate: promoRow.querySelector('[name="promoStartDate"]').value,
                    endDate: promoRow.querySelector('[name="promoEndDate"]').value,
                });
            });
        }

        const data = {
            name: row.querySelector('[name="name"]').value, type: row.querySelector('[name="type"]').value,
            balance: parseFloat(row.querySelector('[name="balance"]').value) || 0,
            limit: parseFloat(row.querySelector('[name="limit"]').value) || null,
            apr: parseFloat(row.querySelector('[name="apr"]').value) || null,
            minPayment: parseFloat(row.querySelector('[name="minPayment"]').value) || 0,
            promos: promos
        };
        if (id.startsWith('new-')) promises.push(addDoc(collection(db, 'accounts'), data));
        else promises.push(setDoc(doc(db, 'accounts', id), data));
    });

    initialAccounts.forEach(initialAcc => {
        if (!currentRowIds.includes(initialAcc.id)) promises.push(deleteDoc(doc(db, 'accounts', initialAcc.id)));
    });

    try {
        await Promise.all(promises);
        accountsSaveStatus.textContent = 'Saved successfully!';
        const newAccountsData = await getAccountsData();
        initialAccounts = newAccountsData;
        renderAccountsForm(newAccountsData);
    } catch (error) {
        console.error("Error saving accounts: ", error);
        accountsSaveStatus.textContent = 'Error saving.';
    } finally {
        setTimeout(() => {
            accountsSaveBtn.disabled = false;
            accountsSaveStatus.textContent = '';
        }, 2000);
    }
}

async function getAccountsData() {
    const querySnapshot = await getDocs(collection(db, "accounts"));
    const accounts = [];
    querySnapshot.forEach((doc) => accounts.push({ id: doc.id, ...doc.data() }));
    return accounts;
}

export async function initAccounts() {
    const accountsBody = document.getElementById('accounts-body');
    const accountsSaveBtn = document.getElementById('accounts-save-btn');

    accountsBody.addEventListener('input', (e) => {
        if (e.target.closest('.account-row') || e.target.closest('.promo-row')) {
            recalculateAccountsSummary();
            if (e.target.closest('.promo-row')) {
                 const promoRow = e.target.closest('.promo-row');
                 const balance = parseFloat(promoRow.querySelector('[name="promoBalance"]').value) || 0;
                 const endDate = promoRow.querySelector('[name="promoEndDate"]').value;
                 const paymentDiv = promoRow.querySelector('[name="promoMinPayment"]');
                 let minPaymentDisplay = '$0.00';
                 if (balance && endDate) {
                    const monthsRemaining = (new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24 * 30.44);
                    if (monthsRemaining > 1) {
                         minPaymentDisplay = formatCurrency(balance / (monthsRemaining - 1));
                    } else if (monthsRemaining > 0) {
                         minPaymentDisplay = formatCurrency(balance);
                    }
                 }
                 paymentDiv.textContent = minPaymentDisplay;
            }
        }
    });

    accountsBody.addEventListener('click', e => {
        if (e.target.matches('.delete-row-btn')) {
            const row = e.target.closest('tr');
            const promoRow = row.nextElementSibling;
            if (promoRow && promoRow.matches('.promo-container-row')) {
                promoRow.remove();
            }
            row.remove();
            recalculateAccountsSummary();
        }
        if (e.target.matches('.manage-promo-btn')) {
            const accountRow = e.target.closest('.account-row');
            const promoContainer = document.querySelector(`.promo-container-row[data-account-id="${accountRow.dataset.id}"]`);
            promoContainer.classList.toggle('hidden');
        }
        if (e.target.matches('.add-promo-btn')) {
            const container = e.target.closest('td');
            container.querySelector('div').appendChild(createPromoRow());
        }
        if (e.target.matches('.delete-promo-btn')) {
            e.target.closest('.promo-row').remove();
            recalculateAccountsSummary();
        }
    });

    document.getElementById('add-account-btn').addEventListener('click', () => {
         const rows = createAccountRow();
         accountsBody.appendChild(rows[0]);
         accountsBody.appendChild(rows[1]);
    });

    accountsSaveBtn.addEventListener('click', handleSaveAccounts);

    try {
        const accountsData = await getAccountsData();
        initialAccounts = accountsData;
        renderAccountsForm(accountsData);
    } catch (error) {
        console.error("Error loading accounts data:", error);
        document.getElementById('accounts-loading-message').innerText = "Error loading data.";
    }
}