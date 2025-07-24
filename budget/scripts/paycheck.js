import { db } from './connection.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const formatCurrency = (num) => isNaN(num) ? '$0.00' : `$${num.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;

function createPaycheckRow(item = { name: '', biweeklyAmount: '' }) {
    const row = document.createElement('tr');
    row.className = 'item-row';
    row.innerHTML = `
        <td class="px-2 py-1"><input type="text" class="form-input-table item-name" value="${item.name}" placeholder="Description"></td>
        <td class="px-6 py-4 text-sm text-right item-annual"></td>
        <td class="px-6 py-4 text-sm text-right item-monthly"></td>
        <td class="px-2 py-1"><input type="number" class="form-input-table amount item-biweekly" value="${item.biweeklyAmount}" placeholder="0.00"></td>
        <td class="text-center"><button class="delete-row-btn text-red-500 hover:text-red-700 p-1">🗑️</button></td>
    `;
    return row;
}

function recalculateAndRenderPaycheck() {
    const paycheckTable = document.getElementById('paycheck-table');
    if (!paycheckTable) return;

    const salaryPayPeriods = 26;
    const deductionPayPeriods = 24;
    const taxPayPeriods = 26;
    const monthlyPeriods = 12;

    const salaryBiweekly = parseFloat(document.getElementById('salary-biweekly-input').value) || 0;
    const salaryAnnual = salaryBiweekly * salaryPayPeriods;
    document.getElementById('salary-annual').textContent = formatCurrency(salaryAnnual);
    document.getElementById('salary-monthly').textContent = formatCurrency(salaryAnnual / monthlyPeriods);

    let totalPreTax = { biweekly: 0, annual: 0 };
    document.querySelectorAll('#paycheck-table tr[data-section-body="pre-tax"]').forEach(row => {
        const biweekly = parseFloat(row.querySelector('.item-biweekly').value) || 0;
        const annual = biweekly * deductionPayPeriods;
        row.querySelector('.item-annual').textContent = formatCurrency(annual);
        row.querySelector('.item-monthly').textContent = formatCurrency(annual / monthlyPeriods);
        totalPreTax.biweekly += biweekly;
        totalPreTax.annual += annual;
    });
    document.getElementById('pre-tax-total-annual').textContent = formatCurrency(totalPreTax.annual);
    document.getElementById('pre-tax-total-monthly').textContent = formatCurrency(totalPreTax.annual / monthlyPeriods);
    document.getElementById('pre-tax-total-biweekly').textContent = formatCurrency(totalPreTax.biweekly);

    let totalTaxes = { biweekly: 0, annual: 0 };
    document.querySelectorAll('#paycheck-table tr[data-section-body="taxes"]').forEach(row => {
        const biweekly = parseFloat(row.querySelector('.item-biweekly').value) || 0;
        const annual = biweekly * taxPayPeriods;
        row.querySelector('.item-annual').textContent = formatCurrency(annual);
        row.querySelector('.item-monthly').textContent = formatCurrency(annual / monthlyPeriods);
        totalTaxes.biweekly += biweekly;
        totalTaxes.annual += annual;
    });
    document.getElementById('taxes-total-annual').textContent = formatCurrency(totalTaxes.annual);
    document.getElementById('taxes-total-monthly').textContent = formatCurrency(totalTaxes.annual / monthlyPeriods);
    document.getElementById('taxes-total-biweekly').textContent = formatCurrency(totalTaxes.biweekly);

    let totalPostTax = { biweekly: 0, annual: 0 };
    document.querySelectorAll('#paycheck-table tr[data-section-body="post-tax"]').forEach(row => {
        const biweekly = parseFloat(row.querySelector('.item-biweekly').value) || 0;
        const annual = biweekly * deductionPayPeriods;
        row.querySelector('.item-annual').textContent = formatCurrency(annual);
        row.querySelector('.item-monthly').textContent = formatCurrency(annual / monthlyPeriods);
        totalPostTax.biweekly += biweekly;
        totalPostTax.annual += annual;
    });

    const netAnnual = salaryAnnual - totalPreTax.annual - totalTaxes.annual - totalPostTax.annual;
    const netBiweekly = salaryBiweekly - totalPreTax.biweekly - totalTaxes.biweekly - totalPostTax.biweekly;
    document.getElementById('net-income-annual').textContent = formatCurrency(netAnnual);
    document.getElementById('net-income-monthly').textContent = formatCurrency(netAnnual / monthlyPeriods);
    document.getElementById('net-income-biweekly').textContent = formatCurrency(netBiweekly);
}

function renderPaycheckForm(paycheckData) {
    const paycheckTable = document.getElementById('paycheck-table');
    document.getElementById('salary-biweekly-input').value = paycheckData.salaryBiweekly || '';
    
    paycheckTable.querySelectorAll('tr[data-section-body]').forEach(row => row.remove());

    const mainTbody = paycheckTable.querySelector('tbody');
    const preTaxSubtotalRow = document.getElementById('pre-tax-total-annual').closest('tr');
    const taxesSubtotalRow = document.getElementById('taxes-total-annual').closest('tr');
    const postTaxSubtotalRow = document.getElementById('net-income-annual').closest('tr');

    paycheckData.deductionsPreTax.forEach(item => {
        const row = createPaycheckRow(item);
        row.dataset.sectionBody = 'pre-tax';
        mainTbody.insertBefore(row, preTaxSubtotalRow);
    });
    paycheckData.taxes.forEach(item => {
        const row = createPaycheckRow(item);
        row.dataset.sectionBody = 'taxes';
        mainTbody.insertBefore(row, taxesSubtotalRow);
    });
    paycheckData.deductionsPostTax.forEach(item => {
        const row = createPaycheckRow(item);
        row.dataset.sectionBody = 'post-tax';
        mainTbody.insertBefore(row, postTaxSubtotalRow);
    });
    
    recalculateAndRenderPaycheck();
    
    document.getElementById('paycheck-loading-message').classList.add('hidden');
    document.getElementById('paycheck-table-container').classList.remove('hidden');
}

async function handleSavePaycheck() {
    const paycheckSaveBtn = document.getElementById('paycheck-save-btn');
    const paycheckSaveStatus = document.getElementById('paycheck-save-status');
    paycheckSaveBtn.disabled = true;
    paycheckSaveStatus.textContent = 'Saving...';

    const dataToSave = {
        salaryBiweekly: parseFloat(document.getElementById('salary-biweekly-input').value) || 0,
        deductionsPreTax: [],
        taxes: [],
        deductionsPostTax: []
    };

    document.querySelectorAll('#paycheck-table tr[data-section-body="pre-tax"]').forEach(row => {
        dataToSave.deductionsPreTax.push({ name: row.querySelector('.item-name').value, biweeklyAmount: parseFloat(row.querySelector('.item-biweekly').value) || 0 });
    });
    document.querySelectorAll('#paycheck-table tr[data-section-body="taxes"]').forEach(row => {
        dataToSave.taxes.push({ name: row.querySelector('.item-name').value, biweeklyAmount: parseFloat(row.querySelector('.item-biweekly').value) || 0 });
    });
    document.querySelectorAll('#paycheck-table tr[data-section-body="post-tax"]').forEach(row => {
        dataToSave.deductionsPostTax.push({ name: row.querySelector('.item-name').value, biweeklyAmount: parseFloat(row.querySelector('.item-biweekly').value) || 0 });
    });

    try {
        await setDoc(doc(db, "income", "myPaycheck"), dataToSave);
        paycheckSaveStatus.textContent = 'Saved successfully!';
    } catch (error) {
        console.error("Error saving paycheck: ", error);
        paycheckSaveStatus.textContent = 'Error saving.';
    } finally {
        setTimeout(() => {
            paycheckSaveBtn.disabled = false;
            paycheckSaveStatus.textContent = '';
        }, 2000);
    }
}

async function getOrCreatePaycheckData() {
    const docRef = doc(db, "income", "myPaycheck");
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) return docSnap.data();
    
    const initialData = {
        salaryBiweekly: 2190.81,
        deductionsPreTax: [ { name: "Pelican HSA Ins", biweeklyAmount: 39.36 }, { name: "HSA Funds", biweeklyAmount: 25.00 }, { name: "Supp Life Ins", biweeklyAmount: 2.50 }, { name: "Retirement", biweeklyAmount: 189.87 } ],
        taxes: [ { name: "Federal", biweeklyAmount: 181.90 }, { name: "Louisiana", biweeklyAmount: 56.30 }, { name: "Medicare", biweeklyAmount: 31.77 } ],
        deductionsPostTax: [ { name: "Unsheltered", biweeklyAmount: 15.29 } ]
    };
    await setDoc(docRef, initialData);
    return initialData;
}

export async function initPaycheck() {
    const paycheckTable = document.getElementById('paycheck-table');
    const paycheckSaveBtn = document.getElementById('paycheck-save-btn');

    paycheckTable.addEventListener('input', e => {
        if (e.target.matches('.form-input-table')) recalculateAndRenderPaycheck();
    });
    paycheckTable.addEventListener('click', e => {
        if (e.target.matches('.add-row-btn')) {
            const section = e.target.dataset.section;
            const subtotalRow = document.getElementById(`${section}-total-annual`)?.closest('tr') || document.getElementById('net-income-annual').closest('tr');
            const newRow = createPaycheckRow();
            newRow.dataset.sectionBody = section;
            paycheckTable.querySelector('tbody').insertBefore(newRow, subtotalRow);
        }
        if (e.target.matches('.delete-row-btn')) {
            e.target.closest('tr').remove();
            recalculateAndRenderPaycheck();
        }
    });
    paycheckSaveBtn.addEventListener('click', handleSavePaycheck);

    try {
        const paycheckData = await getOrCreatePaycheckData();
        renderPaycheckForm(paycheckData);
    } catch (error) {
        console.error("Error loading paycheck data:", error);
        document.getElementById('paycheck-loading-message').innerText = "Error loading data.";
    }
}
