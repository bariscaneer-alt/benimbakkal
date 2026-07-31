let appConfig = { 
    businessName: "Bakkal Adisyon", 
    adminPass: "1234", 
    cashierPass: "5678",
    iban: "TR33 0006 1005 2198 6742 3300 01"
};
let dailyStats = { cashSales: 0, veresiyeSales: 0, estimatedProfit: 0 };
let pendingPayments = [], customers = [], products = [], expenses = [], archivedInvoices = [], salesTransactions = [];
let cart = [], invoiceItems = [], billingItems = [], totalCashEarned = 0, totalExpenses = 0;
let currentUserRole = null, currentModalMode = '', selectedCustomerId = null, activeCustomerForPayment = null;
let currentPdfDataUrl = null;

function initRealtimeSync() {
    db.collection("customers").onSnapshot((snapshot) => {
        customers = [];
        snapshot.forEach((doc) => customers.push({ firebaseId: doc.id, ...doc.data() }));
        if (currentUserRole) renderAdminPanel();
    });

    db.collection("products").onSnapshot((snapshot) => {
        products = [];
        snapshot.forEach((doc) => products.push({ firebaseId: doc.id, ...doc.data() }));
        checkCriticalStock();
        if (currentUserRole) {
            renderPosProducts();
            renderQuickFavorites();
            renderProductsTable();
            populateInvoiceProductSelect();
            populateBillingProductSelect();
            populateReturnProductSelect();
        }
    });

    db.collection("pendingPayments").onSnapshot((snapshot) => {
        pendingPayments = [];
        snapshot.forEach((doc) => pendingPayments.push({ firebaseId: doc.id, ...doc.data() }));
        updatePendingBadge();
        if (currentUserRole) renderPendingPaymentsTable();
    });

    db.collection("archivedInvoices").onSnapshot((snapshot) => {
        archivedInvoices = [];
        snapshot.forEach((doc) => archivedInvoices.push({ firebaseId: doc.id, ...doc.data() }));
        if (currentUserRole) {
            renderInvoiceArchiveTable();
            renderSuppliersSummary();
        }
    });

    db.collection("salesTransactions").onSnapshot((snapshot) => {
        salesTransactions = [];
        snapshot.forEach((doc) => salesTransactions.push({ firebaseId: doc.id, ...doc.data() }));
        if (currentUserRole) renderFinancialReports();
    });
}

window.onload = function() { initRealtimeSync(); };

function searchCustomer() {
    const query = document.getElementById('phoneInput').value.trim();
    const container = document.getElementById('resultContainer');
    if (!query) return;
    const found = customers.find(c => c.phone === query);
    container.style.display = 'block';
    if (found) {
        activeCustomerForPayment = found;
        let itemsHtml = (found.purchasedItems || []).map(item => `
            <div class="purchased-item-row">
                <div><strong>${item.name}</strong> (${item.qty} ${item.unit})<br><span style="font-size:0.75rem; color:var(--text-light);">${item.time}</span></div>
                <div style="font-weight:bold;">${(item.price * item.qty).toFixed(2)} TL</div>
            </div>`).join('');

        container.innerHTML = `
            <div class="result-card">
                <h3>Sayın ${found.name}</h3>
                <div class="info-row"><span>Daire:</span> <strong>${found.apartment}</strong></div>
                <div class="info-row"><span>Güncel Bakiye:</span> <span class="balance">${found.balance.toFixed(2)} TL</span></div>
                <div class="info-row"><span>Veresiye Limiti:</span> <span>${(found.limit || 1000).toFixed(2)} TL</span></div>
                ${itemsHtml ? `<div class="purchased-items-box"><h4>Aldığı Ürünler:</h4>${itemsHtml}</div>` : ''}
                
                <div class="iban-info-box">
                    <h4>🏦 Havale / EFT ile Ödeme Bilgileri</h4>
                    <p style="margin-bottom:5px;"><strong>Banka IBAN:</strong> <span style="font-family:monospace; font-weight:bold; color:var(--primary);">${appConfig.iban}</span></p>
                    <p style="color:var(--danger); font-size:0.85rem;">⚠️ Açıklama Kısmına mutlaka: <strong>${found.name} - ${found.apartment}</strong> yazınız.</p>
                </div>

                <button class="admin-btn" style="width:100%; margin-top:15px; background-color:var(--success);" onclick="openPaymentModal()">💳 Havale Yaptım, Bildirim Gönder</button>
            </div>`;
    } else {
        container.innerHTML = `<p style="color: var(--text-light); text-align:center;">Bu numaraya ait kayıt bulunamadı.</p>`;
    }
}

function openPaymentModal() {
    if (!activeCustomerForPayment) return;
    document.getElementById('paymentModalSub').innerText = `${activeCustomerForPayment.name}, ${activeCustomerForPayment.balance.toFixed(2)} TL borcunuz bulunmaktadır.`;
    document.getElementById('paymentNotifAmount').value = activeCustomerForPayment.balance;
    document.getElementById('paymentModal').style.display = 'flex';
}
function closePaymentModal() { document.getElementById('paymentModal').style.display = 'none'; }

function submitHomePayment() {
    const amount = parseFloat(document.getElementById('paymentNotifAmount').value);
    const method = document.getElementById('paymentNotifMethod').value;
    if (isNaN(amount) || amount <= 0) return alert("Geçerli tutar giriniz.");

    db.collection("pendingPayments").add({
        customerId: activeCustomerForPayment.firebaseId,
        name: activeCustomerForPayment.name,
        apartment: activeCustomerForPayment.apartment,
        amount: amount,
        method: method,
        datetime: new Date().toLocaleString('tr-TR')
    });

    alert("Ödeme bildiriminiz dükkana iletildi. Kontrol edildikten sonra bakiyeniz düşülecektir.");
    closePaymentModal();
}

function checkProductPrice() {
    const val = document.getElementById('priceCheckInput').value.trim().toLowerCase();
    const resBox = document.getElementById('priceCheckResult');
    if (!val) { resBox.innerHTML = ""; return; }
    const match = products.find(p => p.name.toLowerCase().includes(val) || (p.barcode && p.barcode === val));
    if (match) {
        resBox.innerHTML = `✅ ${match.name} — <span style="color:var(--success);">${match.price.toFixed(2)} TL</span> (${match.unit})`;
    } else {
        resBox.innerHTML = `<span style="color:var(--danger); font-size:0.9rem;">Ürün bulunamadı.</span>`;
    }
}

function toggleAdminView() {
    if (!currentUserRole) {
        document.getElementById('loginModal').style.display = 'flex';
    } else {
        currentUserRole = null;
        document.getElementById('toggleViewBtn').innerText = "Bakkal Girişi";
        document.getElementById('activeUserBadge').style.display = 'none';
        document.getElementById('adminTabs').style.display = 'none';
        document.querySelectorAll('.admin-section').forEach(el => el.style.display = 'none');
        document.getElementById('customerView').style.display = 'block';
    }
}

function checkPassword() {
    const pass = document.getElementById('adminPassword').value;
    if (pass === appConfig.adminPass) {
        currentUserRole = 'admin';
        document.getElementById('activeUserBadge').innerText = "Rol: Patron (Tam Yetkili)";
    } else if (pass === appConfig.cashierPass) {
        currentUserRole = 'cashier';
        document.getElementById('activeUserBadge').innerText = "Rol: Kasiyer (Satış & Kısıtlı Yetki)";
    } else {
        alert("Hatalı şifre!");
        return;
    }

    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('adminPassword').value = "";
    document.getElementById('toggleViewBtn').innerText = "Müşteri Ekranına Dön";
    document.getElementById('activeUserBadge').style.display = 'inline';
    document.getElementById('customerView').style.display = 'none';
    document.getElementById('adminTabs').style.display = 'flex';

    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (currentUserRole === 'cashier' && (btn.innerText.includes('Finans') || btn.innerText.includes('Ayarlar') || btn.innerText.includes('Fatura'))) {
            btn.style.display = 'none';
        } else {
            btn.style.display = 'flex';
        }
    });

    switchTab('pos');
}
function closeLoginModal() { document.getElementById('loginModal').style.display = 'none'; }

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(sec => sec.style.display = 'none');
    event.currentTarget.classList.add('active');
    
    if (tabName === 'pos') { 
        document.getElementById('adminPosView').style.display = 'block'; 
        renderPosProducts(); 
        renderQuickFavorites();
        setTimeout(() => { document.getElementById('barcodeInput').focus(); }, 100);
    }
    else if (tabName === 'customers') { document.getElementById('adminCustomersView').style.display = 'block'; renderAdminPanel(); }
    else if (tabName === 'products') { document.getElementById('adminProductsView').style.display = 'block'; renderProductsTable(); }
    else if (tabName === 'excelUpload') { document.getElementById('adminExcelUploadView').style.display = 'block'; }
    else if (tabName === 'invoiceBilling') { document.getElementById('adminInvoiceBillingView').style.display = 'block'; populateBillingProductSelect(); }
    else if (tabName === 'returns') { document.getElementById('adminReturnsView').style.display = 'block'; populateReturnProductSelect(); }
    else if (tabName === 'expenses') { document.getElementById('adminExpensesView').style.display = 'block'; renderExpensesTable(); }
    else if (tabName === 'financialReport') { document.getElementById('adminFinancialReportView').style.display = 'block'; renderFinancialReports(); }
    else if (tabName === 'invoiceEntry') { document.getElementById('adminInvoiceEntryView').style.display = 'block'; populateInvoiceProductSelect(); }
    else if (tabName === 'invoiceArchive') { document.getElementById('adminInvoiceArchiveView').style.display = 'block'; renderInvoiceArchiveTable(); renderSuppliersSummary(); }
    else if (tabName === 'pendingPayments') { document.getElementById('adminPendingPaymentsView').style.display = 'block'; renderPendingPaymentsTable(); }
    else if (tabName === 'reports') { document.getElementById('adminReportsView').style.display = 'block'; }
}

let criticalProductsList = [];
function checkCriticalStock() {
    criticalProductsList = products.filter(p => p.stock <= 3);
    const box = document.getElementById('criticalStockAlertBox');
    const list = document.getElementById('criticalStockList');
    if (criticalProductsList.length > 0) {
        if(box) box.style.display = 'block';
        if(list) list.innerHTML = criticalProductsList.map(p => `• <strong>${p.name}</strong> (Kalan Stok: ${p.stock} ${p.unit})`).join('<br>');
    } else {
        if(box) box.style.display = 'none';
    }
}

function generateWholesaleOrderText() {
    if (criticalProductsList.length === 0) return alert("Kritik seviyede ürün bulunmuyor.");
    let text = "Merhaba, aşağıdaki ürünlerin stoğu azaldı, sipariş vermek istiyoruz:%0A";
    criticalProductsList.forEach(p => {
        text += `- ${p.name}: ${p.stock} ${p.unit} kaldı%0A`;
    });
    window.open(`https://wa.me/?text=${text}`, '_blank');
}

function openBarcodeScannerModal() {
    document.getElementById('barcodeScannerModal').style.display = 'flex';
    setTimeout(() => {
        Quagga.init({
            inputStream : {
                name : "Live",
                type : "LiveStream",
                target: document.querySelector('#interactive')
            },
            decoder : {
                readers : ["ean_reader", "ean_8_reader", "code_128_reader", "upc_reader"]
            }
        }, function(err) {
            if (err) {
                console.log(err);
                alert("Kamera başlatılamadı veya kamera izni verilmedi.");
                return;
            }
            Quagga.start();
        });

        Quagga.onDetected(function(result) {
            let code = result.codeResult.code;
            if (code) {
                document.getElementById('barcodeInput').value = code;
                closeBarcodeScannerModal();
                filterProducts();
            }
        });
    }, 300);
}

function closeBarcodeScannerModal() {
    try { Quagga.stop(); } catch(e) {}
    document.getElementById('barcodeScannerModal').style.display = 'none';
}

function renderPosProducts(filter = "") {
    const grid = document.getElementById('posProductGrid');
    grid.innerHTML = "";
    products.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()) || (p.barcode && p.barcode.includes(filter))).forEach(p => {
        const tile = document.createElement('div');
        tile.className = `product-tile ${p.stock <= 3 ? 'stock-critical' : ''}`;
        tile.onclick = () => promptQuantity(p.firebaseId);
        tile.innerHTML = `<h5>${p.name}</h5><span>${p.price.toFixed(2)} TL</span><div style="font-size:0.75rem;">Stok: ${p.stock}</div>`;
        grid.appendChild(tile);
    });
}

function renderQuickFavorites() {
    const favGrid = document.getElementById('quickFavoriteGrid');
    if (!favGrid) return;
    favGrid.innerHTML = "";
    products.slice(0, 6).forEach(p => {
        const btn = document.createElement('button');
        btn.className = "admin-btn";
        btn.style.cssText = "font-size:0.75rem; padding:4px 8px; background-color:var(--secondary); white-space:nowrap;";
        btn.innerText = `${p.name} (${p.price.toFixed(2)} TL)`;
        btn.onclick = () => {
            cart.push({ ...p, qty: 1 });
            renderCart();
            document.getElementById('barcodeInput').focus();
        };
        favGrid.appendChild(btn);
    });
}

function filterProducts() {
    const inputField = document.getElementById('barcodeInput');
    const val = inputField.value;
    const match = products.find(p => p.barcode === val.trim());
    if (match) {
        cart.push({ ...match, qty: 1 });
        renderCart();
        inputField.value = "";
        inputField.focus();
        return;
    }
    renderPosProducts(val);
}

function processExcelUpload() {
    const fileInput = document.getElementById('excelFileInput');
    const msgBox = document.getElementById('excelResultMsg');
    if(fileInput.files.length === 0) return alert("Lütfen bir Excel dosyası seçiniz.");

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonRows = XLSX.utils.sheet_to_json(worksheet);

            let count = 0;
            jsonRows.forEach(row => {
                const barcode = String(row.Barkod || row.barkod || "").trim();
                const name = row.UrunAdi || row.urunadi || row.Ad || "İsimsiz Ürün";
                const unit = row.Birim || row.birim || "Adet";
                const cost = parseFloat(row.BirimMaliyet || row.maliyet || 0);
                const price = parseFloat(row.SatisFiyati || row.fiyat || 0);
                const stock = parseFloat(row.Stok || row.stok || 0);

                if (barcode) {
                    const existing = products.find(p => p.barcode === barcode);
                    if (existing) {
                        db.collection("products").doc(existing.firebaseId).update({
                            name, unit, cost, price, stock: existing.stock + stock
                        });
                    } else {
                        db.collection("products").add({ barcode, name, unit, cost, price, stock });
                    }
                    count++;
                }
            });
            msgBox.innerHTML = `✅ Başarıyla ${count} ürün Excel dosyasından aktarıldı/güncellendi.`;
        } catch(err) {
            alert("Excel okunurken hata oluştu: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function populateBillingProductSelect() {
    const sel = document.getElementById('billProductSelect');
    if(!sel) return;
    sel.innerHTML = "";
    products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.firebaseId;
        opt.innerText = `${p.name} - ${p.price.toFixed(2)} TL (Stok: ${p.stock})`;
        sel.appendChild(opt);
    });
}

function addBillingItem() {
    const prodId = document.getElementById('billProductSelect').value;
    const qty = parseFloat(document.getElementById('billItemQty').value);
    const taxRate = parseFloat(document.getElementById('billItemTaxRate').value);

    if (!prodId || isNaN(qty) || qty <= 0) return alert("Geçerli miktar giriniz.");
    const prod = products.find(p => p.firebaseId === prodId);
    if (!prod) return;

    billingItems.push({
        firebaseId: prod.firebaseId,
        name: prod.name,
        unitPrice: prod.price,
        qty: qty,
        taxRate: taxRate
    });

    renderBillingItems();
    document.getElementById('billItemQty').value = "";
}

function renderBillingItems() {
    const list = document.getElementById('billItemsList');
    if(!list) return;
    if(billingItems.length === 0) {
        list.innerHTML = `<p style="color:var(--text-light); font-size:0.85rem;">Faturaya kalem eklenmedi.</p>`;
        document.getElementById('billSubTotalText').innerText = "0.00 TL";
        document.getElementById('billTaxTotalText').innerText = "0.00 TL";
        document.getElementById('billGrandTotalText').innerText = "0.00 TL";
        return;
    }

    list.innerHTML = "";
    let subTotal = 0, totalTax = 0;

    billingItems.forEach((item, idx) => {
        let itemTotal = item.unitPrice * item.qty;
        let itemTax = itemTotal * (item.taxRate / 100);
        subTotal += itemTotal;
        totalTax += itemTax;

        list.innerHTML += `<div class="cart-item">
            <span><strong>${item.name}</strong> (${item.qty} adet) - KDV: %${item.taxRate}<br><span style="font-size:0.75rem; color:var(--text-light);">Birim: ${item.unitPrice.toFixed(2)} TL</span></span>
            <span>${(itemTotal + itemTax).toFixed(2)} TL <button class="btn-sm btn-debt" onclick="billingItems.splice(${idx},1);renderBillingItems()">X</button></span>
        </div>`;
    });

    let grandTotal = subTotal + totalTax;
    document.getElementById('billSubTotalText').innerText = subTotal.toFixed(2) + " TL";
    document.getElementById('billTaxTotalText').innerText = totalTax.toFixed(2) + " TL";
    document.getElementById('billGrandTotalText').innerText = grandTotal.toFixed(2) + " TL";
}

function generateAndDownloadSalesInvoicePDF() {
    if (billingItems.length === 0) return alert("Faturada ürün/kalem bulunmuyor.");
    const customerName = document.getElementById('billCustomerName').value.trim() || "Perakende Müşteri";
    const customerTaxNo = document.getElementById('billCustomerTaxNo').value.trim() || "11111111111";
    const customerAddress = document.getElementById('billCustomerAddress').value.trim() || "Merkez / Türkiye";

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(appConfig.businessName, 20, 20);
    doc.setFontSize(10);
    doc.text("E-ARSIV SATIS FATURASI", 20, 26);

    doc.setFont("helvetica", "normal");
    doc.text(`Alici: ${customerName}`, 20, 38);
    doc.text(`VKN / TCKN: ${customerTaxNo}`, 20, 44);
    doc.text(`Adres: ${customerAddress}`, 20, 50);
    doc.text(`Tarih: ${new Date().toLocaleString('tr-TR')}`, 140, 38);
    doc.text(`Fatura No: FAT-${Math.floor(Math.random() * 89999 + 10000)}`, 140, 44);

    doc.line(20, 56, 190, 56);
    doc.setFont("helvetica", "bold");
    doc.text("Mal / Hizmet", 20, 62);
    doc.text("Miktar", 100, 62);
    doc.text("Birim Fiyat", 125, 62);
    doc.text("KDV", 155, 62);
    doc.text("Toplam", 175, 62);
    doc.line(20, 65, 190, 65);

    let y = 72;
    let subTotal = 0, totalTax = 0;

    billingItems.forEach(item => {
        let itemTotal = item.unitPrice * item.qty;
        let itemTax = itemTotal * (item.taxRate / 100);
        subTotal += itemTotal;
        totalTax += itemTax;

        doc.setFont("helvetica", "normal");
        doc.text(item.name, 20, y);
        doc.text(String(item.qty), 100, y);
        doc.text(item.unitPrice.toFixed(2) + " TL", 125, y);
        doc.text(`%${item.taxRate}`, 155, y);
        doc.text((itemTotal + itemTax).toFixed(2) + " TL", 175, y);

        const p = products.find(x => x.firebaseId === item.firebaseId);
        if(p) db.collection("products").doc(p.firebaseId).update({ stock: p.stock - item.qty });

        y += 8;
    });

    doc.line(20, y + 2, 190, y + 2);
    y += 10;
    doc.text(`Ara Toplam: ${subTotal.toFixed(2)} TL`, 130, y);
    y += 6;
    doc.text(`Toplam KDV: ${totalTax.toFixed(2)} TL`, 130, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text(`Genel Toplam: ${(subTotal + totalTax).toFixed(2)} TL`, 130, y);

    doc.save(`Fatura_${customerName.replace(/\s+/g, '_')}.pdf`);
    
    totalCashEarned += (subTotal + totalTax);
    billingItems = [];
    renderBillingItems();
    alert("Fatura başarıyla kesildi, stoktan düşüldü ve PDF indirildi.");
}

async function processPdfInvoice(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function() {
        try {
            currentPdfDataUrl = this.result;
            const typedarray = new Uint8Array(this.result);
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            let fullText = "";

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                fullText += textContent.items.map(item => item.str).join(" ") + "\n";
            }

            document.getElementById('invoiceSupplierName').value = "PDF e-Arşiv Tedarikçi";
            document.getElementById('invoiceNumber').value = "PDF-" + Math.floor(Math.random() * 89999 + 10000);
            alert("PDF Fatura başarıyla tarandı.");
        } catch (err) {
            alert("PDF okunurken hata: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function populateInvoiceProductSelect() {
    const sel = document.getElementById('invoiceProductSelect');
    if(!sel) return;
    sel.innerHTML = "";
    products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.firebaseId;
        opt.innerText = `${p.name} (Stok: ${p.stock} ${p.unit})`;
        sel.appendChild(opt);
    });
}

function populateReturnProductSelect() {
    const sel = document.getElementById('returnProductSelect');
    if(!sel) return;
    sel.innerHTML = "";
    products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.firebaseId;
        opt.innerText = `${p.name} (${p.price.toFixed(2)} TL)`;
        sel.appendChild(opt);
    });
}

function addInvoiceItem() {
    const prodId = document.getElementById('invoiceProductSelect').value;
    const qty = parseFloat(document.getElementById('invoiceItemQty').value);
    const cost = parseFloat(document.getElementById('invoiceItemCost').value);
    const price = parseFloat(document.getElementById('invoiceItemPrice').value);
    if (!prodId || isNaN(qty) || qty <= 0 || isNaN(cost) || cost < 0) return alert("Geçerli miktar ve maliyet giriniz.");

    const prod = products.find(p => p.firebaseId === prodId);
    if (prod) {
        invoiceItems.push({ firebaseId: prod.firebaseId, name: prod.name, qty, cost, price: isNaN(price) ? prod.price : price });
        renderInvoiceItems();
        document.getElementById('invoiceItemQty').value = "";
        document.getElementById('invoiceItemCost').value = "";
        document.getElementById('invoiceItemPrice').value = "";
    }
}

function renderInvoiceItems() {
    const list = document.getElementById('invoiceItemsList');
    if(!list) return;
    if(invoiceItems.length === 0) {
        list.innerHTML = `<p style="color:var(--text-light); font-size:0.85rem;">Faturaya ürün eklenmedi.</p>`;
        document.getElementById('invoiceTotalText').innerText = "0.00 TL";
        return;
    }
    list.innerHTML = "";
    let total = 0;
    invoiceItems.forEach((item, idx) => {
        total += item.cost * item.qty;
        list.innerHTML += `<div class="cart-item"><span><strong>${item.name}</strong> (${item.qty} adet)<br><span style="font-size:0.75rem; color:var(--text-light);">Alış: ${item.cost.toFixed(2)} TL</span></span><span>${(item.cost * item.qty).toFixed(2)} TL <button class="btn-sm btn-debt" onclick="invoiceItems.splice(${idx},1);renderInvoiceItems()">X</button></span></div>`;
    });
    document.getElementById('invoiceTotalText').innerText = total.toFixed(2) + " TL";
}

function saveCompleteInvoice() {
    if (invoiceItems.length === 0) return alert("Faturada kayıtlı ürün bulunmuyor.");
    const supplier = document.getElementById('invoiceSupplierName').value.trim() || "Bilinmeyen Toptancı";
    const invNo = document.getElementById('invoiceNumber').value.trim() || "Belirtilmemiş";
    const totalAmount = invoiceItems.reduce((sum, item) => sum + (item.cost * item.qty), 0);
    const datetime = new Date().toLocaleDateString('tr-TR');

    invoiceItems.forEach(item => {
        const prod = products.find(p => p.firebaseId === item.firebaseId);
        if (prod) {
            db.collection("products").doc(item.firebaseId).update({ 
                stock: prod.stock + item.qty, 
                cost: item.cost, 
                price: item.price 
            });
        }
    });

    db.collection("archivedInvoices").add({
        supplier,
        invNo,
        totalAmount,
        datetime,
        items: invoiceItems,
        pdfData: currentPdfDataUrl ? Array.from(new Uint8Array(currentPdfDataUrl)) : null
    });

    alert(`Tedarikçi (${supplier}) faturası başarıyla kaydedildi ve stoklar güncellendi.`);
    invoiceItems = [];
    currentPdfDataUrl = null;
    document.getElementById('invoiceSupplierName').value = "";
    document.getElementById('invoiceNumber').value = "";
    document.getElementById('pdfInvoiceInput').value = "";
    renderInvoiceItems();
}

function renderInvoiceArchiveTable() {
    const query = document.getElementById('archiveSearchInput') ? document.getElementById('archiveSearchInput').value.toLowerCase().trim() : "";
    const tbody = document.getElementById('invoiceArchiveTableBody');
    if(!tbody) return;
    
    tbody.innerHTML = "";
    const filtered = archivedInvoices.filter(inv => inv.supplier.toLowerCase().includes(query) || inv.invNo.toLowerCase().includes(query));
    document.getElementById('archiveTotalCount').innerText = archivedInvoices.length;

    filtered.forEach(inv => {
        tbody.innerHTML += `<tr>
            <td>${inv.datetime}</td>
            <td><strong>${inv.supplier}</strong></td>
            <td>${inv.invNo}</td>
            <td>${inv.totalAmount.toFixed(2)} TL</td>
            <td><button class="btn-sm" style="background-color:var(--secondary);" onclick="viewArchivedPdf('${inv.firebaseId}')">PDF Görüntüle</button></td>
        </tr>`;
    });
}

function renderSuppliersSummary() {
    const tbody = document.getElementById('suppliersTableBody');
    if(!tbody) return;
    tbody.innerHTML = "";

    let supplierCounts = {};
    archivedInvoices.forEach(inv => {
        supplierCounts[inv.supplier] = (supplierCounts[inv.supplier] || 0) + 1;
    });

    for (let sup in supplierCounts) {
        tbody.innerHTML += `<tr><td><strong>${sup}</strong></td><td>${supplierCounts[sup]} Fatura</td></tr>`;
    }
}

function viewArchivedPdf(id) {
    const inv = archivedInvoices.find(x => x.firebaseId === id);
    if (!inv) return;
    document.getElementById('pdfModalTitle').innerText = `${inv.supplier} - Fatura No: ${inv.invNo}`;
    const container = document.getElementById('pdfViewerContainer');
    
    if (inv.pdfData) {
        const blob = new Blob([new Uint8Array(inv.pdfData)], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);
        container.innerHTML = `<embed src="${blobUrl}" type="application/pdf" width="100%" height="100%">`;
    } else {
        container.innerHTML = `<div style="padding:20px; text-align:center;">
            <h4>Bu fatura manuel olarak kaydedilmiştir.</h4>
            <p style="margin-top:10px; color:var(--text-light);">Fatura Kalemleri:</p>
            <ul style="list-style:none; margin-top:5px;">
                ${(inv.items || []).map(i => `<li>${i.name} - ${i.qty} adet (${i.cost} TL)</li>`).join('')}
            </ul>
        </div>`;
    }
    document.getElementById('pdfViewModal').style.display = 'flex';
}

function closePdfModal() { document.getElementById('pdfViewModal').style.display = 'none'; }

function toggleReturnPhoneInput() {
    const val = document.getElementById('returnRefundType').value;
    document.getElementById('returnCustomerPhone').style.display = (val === 'veresiye') ? 'block' : 'none';
}

function processReturn() {
    const prodId = document.getElementById('returnProductSelect').value;
    const qty = parseFloat(document.getElementById('returnQtyInput').value);
    const condition = document.getElementById('returnConditionSelect').value;
    const refundType = document.getElementById('returnRefundType').value;
    const phone = document.getElementById('returnCustomerPhone').value.trim();

    if (!prodId || isNaN(qty) || qty <= 0) return alert("Lütfen geçerli ürün ve miktar giriniz.");
    const prod = products.find(p => p.firebaseId === prodId);
    if (!prod) return;

    let refundAmount = prod.price * qty;
    if (condition === 'restock') {
        db.collection("products").doc(prodId).update({ stock: prod.stock + qty });
    }

    if (refundType === 'cash') {
        totalCashEarned -= refundAmount;
    } else if (refundType === 'veresiye') {
        if (!phone) return alert("Müşteri telefonu gerekli!");
        const cust = customers.find(c => c.phone === phone);
        if (cust) {
            db.collection("customers").doc(cust.firebaseId).update({ balance: Math.max(0, cust.balance - refundAmount) });
        } else {
            return alert("Müşteri bulunamadı!");
        }
    }
    alert("İade işlemi tamamlandı.");
    document.getElementById('returnQtyInput').value = "";
    document.getElementById('returnCustomerPhone').value = "";
}

function addExpenseRecord() {
    const title = document.getElementById('expenseTitle').value.trim();
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const category = document.getElementById('expenseCategory').value;
    const dateObj = new Date();
    const timeStr = dateObj.toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
    const dateStr = dateObj.toLocaleDateString('tr-TR');
    const monthYearStr = (dateObj.getMonth() + 1).toString().padStart(2, '0') + "." + dateObj.getFullYear();

    if (!title || isNaN(amount) || amount <= 0) return alert("Geçerli masraf adı ve tutarı giriniz.");
    
    db.collection("expenses").add({
        title,
        amount,
        category,
        time: timeStr,
        date: dateStr,
        monthYear: monthYearStr,
        year: dateObj.getFullYear().toString(),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    totalExpenses += amount;
    totalCashEarned -= amount;

    document.getElementById('expenseTitle').value = "";
    document.getElementById('expenseAmount').value = "";
    alert("Masraf kaydedildi.");
}

function renderExpensesTable() {
    const tbody = document.getElementById('expensesTableBody');
    if(!tbody) return;
    db.collection("expenses").orderBy("timestamp", "desc").get().then((snapshot) => {
        let html = "";
        snapshot.forEach((doc) => {
            const e = doc.data();
            html += `<tr><td>${e.date || ''} ${e.time || ''}</td><td>${e.title}</td><td>${e.category}</td><td><strong>${e.amount.toFixed(2)} TL</strong></td></tr>`;
        });
        tbody.innerHTML = html;
    });
}

let allExpenses = [];
function initFinancialSync() {
    db.collection("expenses").onSnapshot((snapshot) => {
        allExpenses = [];
        snapshot.forEach(doc => allExpenses.push(doc.data()));
        if(currentUserRole) renderFinancialReports();
    });
}

function promptQuantity(firebaseId) {
    selectedProductForCart = products.find(p => p.firebaseId === firebaseId);
    document.getElementById('qtyModalTitle').innerText = `${selectedProductForCart.name} Ekle`;
    document.getElementById('modalInputQty').value = "1";
    document.getElementById('quantityModal').style.display = 'flex';
}
function closeQuantityModal() { document.getElementById('quantityModal').style.display = 'none'; }

function confirmAddToCart() {
    const qty = parseFloat(document.getElementById('modalInputQty').value);
    if (isNaN(qty) || qty <= 0) return;
    cart.push({ ...selectedProductForCart, qty });
    closeQuantityModal();
    renderCart();
    document.getElementById('barcodeInput').focus();
}

function renderCart() {
    const list = document.getElementById('cartItemsList');
    list.innerHTML = "";
    let total = 0;
    cart.forEach((item, idx) => {
        total += item.price * item.qty;
        list.innerHTML += `<div class="cart-item"><span>${item.name} (${item.qty})</span><span>${(item.price*item.qty).toFixed(2)} TL <button class="btn-sm btn-debt" onclick="cart.splice(${idx},1);renderCart()">X</button></span></div>`;
    });
    document.getElementById('cartTotalText').innerText = total.toFixed(2) + " TL";
}

function toggleCustomerSelect() {
    const type = document.getElementById('saleTypeSelect').value;
    document.getElementById('saleCustomerWrapper').style.display = (type === 'veresiye') ? 'block' : 'none';
    document.getElementById('mixedPaymentWrapper').style.display = (type === 'mixed') ? 'block' : 'none';
    if (type === 'veresiye') populateCustomerSelect();
}

function populateCustomerSelect() {
    const sel = document.getElementById('saleCustomerSelect');
    sel.innerHTML = "";
    customers.forEach(c => { sel.innerHTML += `<option value="${c.firebaseId}">${c.name} (${c.apartment})</option>`; });
}

function filterPosCustomers() {
    const query = document.getElementById('posCustomerSearch').value.toLowerCase().trim();
    const sel = document.getElementById('saleCustomerSelect');
    sel.innerHTML = "";
    customers.filter(c => c.name.toLowerCase().includes(query) || (c.apartment && c.apartment.toLowerCase().includes(query))).forEach(c => {
        sel.innerHTML += `<option value="${c.firebaseId}">${c.name} (${c.apartment})</option>`;
    });
}

function completeSale() {
    if (cart.length === 0) return;
    let total = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const type = document.getElementById('saleTypeSelect').value;
    const dateObj = new Date();
    const timeStr = dateObj.toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
    const dateStr = dateObj.toLocaleDateString('tr-TR');
    const monthYearStr = (dateObj.getMonth() + 1).toString().padStart(2, '0') + "." + dateObj.getFullYear();
    const yearStr = dateObj.getFullYear().toString();

    cart.forEach(item => {
        const p = products.find(x => x.firebaseId === item.firebaseId);
        if (p) db.collection("products").doc(p.firebaseId).update({ stock: p.stock - item.qty });
    });

    let cashAmount = 0, creditAmount = 0, veresiyeAmount = 0;

    if (type === 'cash') {
        cashAmount = total;
        totalCashEarned += total;
    } else if (type === 'credit') {
        creditAmount = total;
    } else if (type === 'mixed') {
        cashAmount = parseFloat(document.getElementById('mixedCashAmount').value) || 0;
        creditAmount = parseFloat(document.getElementById('mixedCreditAmount').value) || 0;
        totalCashEarned += cashAmount;
    } else if (type === 'veresiye') {
        veresiyeAmount = total;
        const cid = document.getElementById('saleCustomerSelect').value;
        const cust = customers.find(c => c.firebaseId === cid);
        if (cust) {
            if ((cust.balance + total) > (cust.limit || 1000)) {
                alert("HATA: Müşteri veresiye limitini aşıyor!");
                return;
            }
            db.collection("customers").doc(cid).update({
                balance: cust.balance + total,
                purchasedItems: [...(cust.purchasedItems || []), ...cart.map(i => ({name: i.name, qty: i.qty, unit: i.unit, price: i.price, time: timeStr}))]
            });
        }
    }

    db.collection("salesTransactions").add({
        date: dateStr,
        time: timeStr,
        monthYear: monthYearStr,
        year: yearStr,
        type: type,
        cashAmount,
        creditAmount,
        veresiyeAmount,
        totalAmount: total,
        items: cart,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    if(confirm("Satış tamamlandı! Müşteri bilgi fişi yazdırılsın mı?")) {
        printReceipt(cart, total, type);
    }

    cart = [];
    renderCart();
    document.getElementById('barcodeInput').focus();
}

function printReceipt(items, total, type) {
    let win = window.open('', '', 'height=500,width=300');
    win.document.write(`<html><head><title>Fiş</title><style>body{font-family:monospace;font-size:12px;padding:10px;}</style></head><body>`);
    win.document.write(`<h3 style="text-align:center;">${appConfig.businessName}</h3>`);
    win.document.write(`<p>Tarih: ${new Date().toLocaleString('tr-TR')}<br>Ödeme: ${type.toUpperCase()}</p><hr>`);
    items.forEach(i => {
        win.document.write(`<div>${i.name} x ${i.qty} = ${(i.price*i.qty).toFixed(2)} TL</div>`);
    });
    win.document.write(`<hr><h4>TOPLAM: ${total.toFixed(2)} TL</h4>`);
    win.document.write(`<p style="text-align:center;">Teşekkür ederiz</p></body></html>`);
    win.document.close();
    win.print();
}

function renderFinancialReports() {
    const period = document.getElementById('financialPeriodSelect') ? document.getElementById('financialPeriodSelect').value : 'monthly';
    const now = new Date();
    const currentMonthYear = (now.getMonth() + 1).toString().padStart(2, '0') + "." + now.getFullYear();
    const currentYear = now.getFullYear().toString();

    let filteredSales = salesTransactions;
    let filteredExpenses = allExpenses;

    if (period === 'monthly') {
        filteredSales = salesTransactions.filter(s => s.monthYear === currentMonthYear);
        filteredExpenses = allExpenses.filter(e => e.monthYear === currentMonthYear);
    } else if (period === 'yearly') {
        filteredSales = salesTransactions.filter(s => s.year === currentYear);
        filteredExpenses = allExpenses.filter(e => e.year === currentYear);
    }

    let totalCash = 0, totalCredit = 0, totalVeresiye = 0, totalExpAmt = 0;

    filteredSales.forEach(s => {
        totalCash += (s.cashAmount || 0);
        totalCredit += (s.creditAmount || 0);
        totalVeresiye += (s.veresiyeAmount || 0);
    });

    filteredExpenses.forEach(e => {
        totalExpAmt += (e.amount || 0);
    });

    let totalIncome = totalCash + totalCredit;
    let netProfit = totalIncome - totalExpAmt;

    document.getElementById('finCashSales').innerText = totalCash.toFixed(2) + " TL";
    document.getElementById('finCreditSales').innerText = totalCredit.toFixed(2) + " TL";
    document.getElementById('finVeresiyeSales').innerText = totalVeresiye.toFixed(2) + " TL";
    document.getElementById('finExpenses').innerText = totalExpAmt.toFixed(2) + " TL";
    document.getElementById('finNetProfit').innerText = netProfit.toFixed(2) + " TL";

    const incTbody = document.getElementById('finIncomesTableBody');
    incTbody.innerHTML = filteredSales.map(s => `<tr><td>${s.date} ${s.time}</td><td>${s.type.toUpperCase()}</td><td><strong>${s.totalAmount.toFixed(2)} TL</strong></td></tr>`).join('');

    const expTbody = document.getElementById('finExpensesTableBody');
    expTbody.innerHTML = filteredExpenses.map(e => `<tr><td>${e.date || ''} ${e.time || ''}</td><td>${e.category} - ${e.title}</td><td><strong>${e.amount.toFixed(2)} TL</strong></td></tr>`).join('');
}

function downloadZReportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(appConfig.businessName, 20, 20);
    doc.setFontSize(12);
    doc.text("GUN SONU Z-RAPORU", 20, 28);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Tarih: ${new Date().toLocaleDateString('tr-TR')}`, 20, 40);
    doc.text(`Nakit Tahsilat: ${totalCashEarned.toFixed(2)} TL`, 20, 48);
    doc.text(`Toplam Giderler: ${totalExpenses.toFixed(2)} TL`, 20, 56);
    doc.text(`Sistemdeki Toplam Müşteri Borç Alacağı: ${document.getElementById('totalBalanceText').innerText}`, 20, 64);

    doc.save("Z_Raporu.pdf");
}

function renderAdminPanel() {
    const tbody = document.getElementById('customerTableBody');
    if(!tbody) return;
    tbody.innerHTML = "";
    let totalBal = 0;
    customers.forEach(c => {
        totalBal += c.balance;
        tbody.innerHTML += `<tr>
            <td>${c.name}</td>
            <td>${c.apartment}</td>
            <td>${c.phone}</td>
            <td><strong>${c.balance.toFixed(2)} TL</strong></td>
            <td>${(c.limit||1000).toFixed(2)} TL</td>
            <td>
                <button class="btn-sm btn-debt" onclick="openActionModal('debt','${c.firebaseId}')">+Borç</button> 
                <button class="btn-sm btn-pay" onclick="openActionModal('pay','${c.firebaseId}')">Tahsilat</button>
                <button class="btn-sm btn-whatsapp" onclick="sendWhatsAppReminder('${c.phone}', '${c.name}', ${c.balance})">İlet</button>
                <button class="btn-sm" style="background-color:var(--primary);" onclick="downloadCustomerPDF('${c.name}', '${c.apartment}', ${c.balance}, '${JSON.stringify(c.purchasedItems || [])}')">PDF Ekstre</button>
            </td>
        </tr>`;
    });
    document.getElementById('totalBalanceText').innerText = totalBal.toFixed(2) + " TL";
    document.getElementById('totalCashText').innerText = totalCashEarned.toFixed(2) + " TL";
    document.getElementById('totalCustomerText').innerText = customers.length;
}

function downloadCustomerPDF(name, apartment, balance, itemsJson) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const items = JSON.parse(itemsJson);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(appConfig.businessName, 20, 20);
    doc.setFontSize(12);
    doc.text("MUSTERI HESAP EKSTRESI", 20, 28);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Musteri Ad Soyad: ${name}`, 20, 40);
    doc.text(`Daire: ${apartment}`, 20, 46);
    doc.text(`Guncel Bakiye (Borc): ${balance.toFixed(2)} TL`, 20, 52);

    doc.text("Son Alisveris Gecmisi:", 20, 65);
    let y = 72;
    items.forEach((item, index) => {
        doc.text(`${index+1}. ${item.name} - ${item.qty} ${item.unit} x ${item.price} TL (${item.time})`, 25, y);
        y += 6;
    });

    doc.save(`${name}_Hesap_Ekstresi.pdf`);
}

function sendWhatsAppReminder(phone, name, balance) {
    if (!phone) { alert("Telefon kayıtlı değil."); return; }
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '9' + cleanPhone;
    const msg = encodeURIComponent(`Sayın ${name}, ${appConfig.businessName} hesabınıza ait güncel borç bakiyeniz ${balance.toFixed(2)} TL'dir. İyi günler dileriz.`);
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank');
}

function renderProductsTable() {
    const tbody = document.getElementById('productTableBody');
    if(!tbody) return;
    tbody.innerHTML = "";
    products.forEach(p => {
        let cost = p.cost || 0;
        let margin = cost > 0 ? (((p.price - cost) / cost) * 100).toFixed(0) + "%" : "-%";
        tbody.innerHTML += `<tr>
            <td>${p.barcode || '-'}</td>
            <td>${p.name}</td>
            <td>${p.unit}</td>
            <td>${cost.toFixed(2)} TL</td>
            <td>${p.price.toFixed(2)} TL</td>
            <td><span style="color:var(--success); font-weight:bold;">${margin}</span></td>
            <td><strong>${p.stock}</strong></td>
            <td>${p.stock <= 3 ? '<span style="color:red">Kritik Stok!</span>' : 'Normal'}</td>
            <td>
                <button class="btn-sm btn-warning" onclick="editProd('${p.firebaseId}')">Düzenle</button>
                <button class="btn-sm" style="background-color:var(--primary);" onclick="openShelfTag('${p.firebaseId}')">Etiket</button>
            </td>
        </tr>`;
    });
}

function editProd(id) {
    const p = products.find(x => x.firebaseId === id);
    const np = prompt("Yeni Satış Fiyatı:", p.price);
    if (!isNaN(np) && np !== null) db.collection("products").doc(id).update({ price: parseFloat(np) });
}

function openShelfTag(id) {
    const p = products.find(x => x.firebaseId === id);
    if (!p) return;
    document.getElementById('shelfTagContent').innerHTML = `
        <h2>${appConfig.businessName}</h2>
        <div style="font-size:1.1rem; font-weight:bold; margin: 5px 0; color:#333;">${p.name}</div>
        <div class="price">${p.price.toFixed(2)} TL</div>
        <div style="font-size:0.75rem; color:#666;">Birim: ${p.unit} | Barkod: ${p.barcode || '---'}</div>`;
    document.getElementById('shelfTagModal').style.display = 'flex';
}
function closeShelfTagModal() { document.getElementById('shelfTagModal').style.display = 'none'; }

function openAddCustomerModal() { document.getElementById('actionModal').style.display = 'flex'; currentModalMode='add'; }
function closeActionModal() { document.getElementById('actionModal').style.display = 'none'; }
function openActionModal(mode, id) { currentModalMode=mode; selectedCustomerId=id; document.getElementById('actionModal').style.display='flex'; }
function executeAction() {
    const amt = parseFloat(document.getElementById('modalInputAmount').value);
    if (currentModalMode === 'add') {
        db.collection("customers").add({ name: document.getElementById('modalInputName').value, apartment: document.getElementById('modalInputApartment').value, phone: document.getElementById('modalInputPhone').value, limit: parseFloat(document.getElementById('modalInputLimit').value)||1000, balance:0 });
    } else {
        const c = customers.find(x => x.firebaseId === selectedCustomerId);
        let newBal = currentModalMode === 'debt' ? c.balance + amt : c.balance - amt;
        db.collection("customers").doc(selectedCustomerId).update({ balance: newBal });
    }
    closeActionModal();
}

function openAddProductModal() { document.getElementById('productModal').style.display = 'flex'; }
function closeProductModal() { document.getElementById('productModal').style.display = 'none'; }
function saveNewProduct() {
    db.collection("products").add({
        barcode: document.getElementById('prodInputBarcode').value,
        name: document.getElementById('productInputName').value,
        unit: document.getElementById('productInputUnit').value,
        price: parseFloat(document.getElementById('productInputPrice').value),
        cost: parseFloat(document.getElementById('productInputCost').value),
        stock: parseFloat(document.getElementById('productInputStock').value)
    });
    closeProductModal();
}

function updatePendingBadge() {
    const badge = document.getElementById('pendingBadge');
    badge.style.display = pendingPayments.length > 0 ? 'inline' : 'none';
    badge.innerText = pendingPayments.length;
}

function renderPendingPaymentsTable() {
    const tbody = document.getElementById('pendingPaymentsTableBody');
    if(!tbody) return;
    tbody.innerHTML = pendingPayments.map(p => `<tr><td>${p.datetime}</td><td>${p.name}</td><td>${p.apartment}</td><td>${p.amount.toFixed(2)} TL</td><td>${p.method}</td><td><button class="btn-sm btn-pay" onclick="approvePay('${p.firebaseId}','${p.customerId}',${p.amount})">Onayla</button></td></tr>`).join('');
}

function approvePay(pid, cid, amt) {
    db.collection("customers").doc(cid).update({ balance: 0 });
    db.collection("pendingPayments").doc(pid).delete();
    totalCashEarned += amt;
    alert("Ödeme onaylandı.");
}

function saveSettings() { 
    appConfig.businessName = document.getElementById('settingBusinessName').value;
    appConfig.adminPass = document.getElementById('settingAdminPass').value;
    appConfig.cashierPass = document.getElementById('settingCashierPass').value;
    appConfig.iban = document.getElementById('settingIban').value;
    document.getElementById('headerTitle').innerText = `🛒 ${appConfig.businessName}`;
    document.getElementById('footerBrand').innerText = appConfig.businessName;
    alert("Ayarlar kaydedildi."); 
}

setTimeout(() => { initFinancialSync(); }, 1000);