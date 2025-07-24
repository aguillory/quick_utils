import { db } from './connection.js';
import { collection, getDocs, setDoc, addDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const formatCurrency = (num) => isNaN(num) ? '$0.00' : `$${num.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
let initialAccounts = [];

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
        <td class="p-2"><input name="promo" type="text" class="form-input-table" value="${account.promo || ''}" placeholder="N/A"></td>
        <td class="p-2"><input name="minPayment" type="number" class="form-input-table amount" value="${account.minPayment || ''}" placeholder="0.00"></td>
        <td class="text-center"><button class="delete-row-btn text-red-500 hover:text-red-700 p-1">🗑️</button></td>
    `;
    return row;
}

function recalculateAccountsSummary() {
    let totalDebt = 0, totalMonthly = 0, ccDebt = 0, ccMonthly = 0;
    let debtNoDiscover = 0, monthlyNoDiscover = 0, debtNoHouse = 0, monthlyNoHouse = 0;

    document.querySelectorAll('.account-row').forEach(row => {
        const name = row.querySelector('[name="name"]').value.toLowerCase();
        const type = row.querySelector('[name="type"]').value;
        const balance = parseFloat(row.querySelector('[name="balance"]').value) || 0;
        const minPayment = parseFloat(row.querySelector('[name="minPayment"]').value) || 0;

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
    accounts.forEach(acc => accountsBody.appendChild(createAccountRow(acc)));
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
        const data = {
            name: row.querySelector('[name="name"]').value, type: row.querySelector('[name="type"]').value,
            balance: parseFloat(row.querySelector('[name="balance"]').value) || 0,
            limit: parseFloat(row.querySelector('[name="limit"]').value) || null,
            apr: parseFloat(row.querySelector('[name="apr"]').value) || null,
            promo: row.querySelector('[name="promo"]').value,
            minPayment: parseFloat(row.querySelector('[name="minPayment"]').value) || 0,
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
    const addAccountBtn = document.getElementById('add-account-btn');
    const accountsBody = document.getElementById('accounts-body');
    const accountsSaveBtn = document.getElementById('accounts-save-btn');

    addAccountBtn.addEventListener('click', () => accountsBody.appendChild(createAccountRow()));
    accountsBody.addEventListener('input', recalculateAccountsSummary);
    accountsBody.addEventListener('click', e => {
        if (e.target.matches('.delete-row-btn')) {
            e.target.closest('tr').remove();
            recalculateAccountsSummary();
        }
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
