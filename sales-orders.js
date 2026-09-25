/* Une validation = une commande. Les anciennes ventes restent lisibles. */
let multiSalesReady = false;
let savingOrder = false;
let pendingOrder = null;
let saleRowSequence = 0;
const initializeShopsBeforeOrders = initializeShops;
initializeShops = async function() {
    await initializeShopsBeforeOrders();
    const {data,error} = await supabaseClient.rpc('sales_api_version');
    if (error && !['PGRST202','42883'].includes(error.code)) throw error;
    multiSalesReady = !error && data === 2;
    document.getElementById('addSaleItem').hidden = !multiSalesReady;
    const notice=document.getElementById('saleMigrationNotice');
    notice.hidden=multiSalesReady;
    notice.textContent='Les commandes multi-produits ne sont pas encore activées. Vous pouvez continuer à enregistrer les ventes à un produit.';
};
function saleProductOptions(selected='') {
    return '<option value="">Choisir un produit</option>'+products.filter(p=>(p.actif!==false && getAvailableStock(p)>0) || p.id===selected)
        .map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} — stock : ${getAvailableStock(p)}</option>`).join('');
}
function addSaleItem() {
    const id=++saleRowSequence;
    const row=document.createElement('fieldset'); row.className='sale-item';
    row.innerHTML=`<legend>Article</legend>
      <div class="sale-item-fields"><div class="form-group sale-product-field"><label for="orderProduct${id}">Produit</label><select id="orderProduct${id}" data-field="product" required>${saleProductOptions()}</select></div>
      <div class="form-group"><label for="orderQty${id}">Quantité</label><input id="orderQty${id}" data-field="quantity" type="number" min="1" step="1" value="1" required></div>
      <div class="form-group"><label for="orderPrice${id}">Prix unitaire (F CFA)</label><input id="orderPrice${id}" data-field="price" type="number" min="0" step="0.01" required></div></div>
      <div class="sale-item-bottom"><strong data-subtotal>0 F</strong><button type="button" class="btn-secondary" data-remove-item>Retirer cet article</button></div>`;
    document.getElementById('saleItems').append(row);
    updateSaleTotal();
    return row;
}
const populateBeforeOrders=populateProductSelects;
populateProductSelects=function() {
    populateBeforeOrders();
    document.querySelectorAll('#saleItems [data-field="product"]').forEach(select=>{
        const selected=select.value; select.innerHTML=saleProductOptions(selected); select.value=selected;
    });
    updateSaleTotal();
};
function orderItems() {
    return [...document.querySelectorAll('#saleItems .sale-item')].map(row=>({
        product_id:row.querySelector('[data-field="product"]').value,
        quantity:Number(row.querySelector('[data-field="quantity"]').value),
        unit_price:Number(row.querySelector('[data-field="price"]').value)
    }));
}
updateSaleTotal=function() {
    let total=0;
    const rows=[...document.querySelectorAll('#saleItems .sale-item')];
    rows.forEach((row,i)=>{
        const qty=Number(row.querySelector('[data-field="quantity"]').value);
        const price=Number(row.querySelector('[data-field="price"]').value);
        const subtotal=Math.round(qty*price*100)/100;
        row.querySelector('legend').textContent='Article '+(i+1);
        row.querySelector('[data-subtotal]').textContent='Sous-total : '+formatMoney(Number.isFinite(subtotal)?subtotal:0);
        row.querySelector('[data-remove-item]').disabled=rows.length===1;
        total+=Number.isFinite(subtotal)?subtotal:0;
    });
    document.getElementById('saleTotal').textContent=formatMoney(total);
};
function resetOrder() {
    document.getElementById('saleItems').replaceChildren();
    pendingOrder=null; addSaleItem();
}
saveSale=async function(event) {
    event.preventDefault();
    if (savingOrder) return;
    if (!isActiveUser()) {showToast('Votre compte est désactivé.'); return;}
    const form=document.getElementById('saleForm'), feedback=document.getElementById('saleFeedback');
    if (!form.reportValidity()) return;
    let committed=false;
    try {
        requireSelectedShop();
        const items=orderItems(), totals=new Map();
        if (!items.length || (!multiSalesReady && items.length!==1)) throw new Error('Ajoutez un produit.');
        for (const item of items) {
            const p=products.find(p=>p.id===item.product_id);
            if (!p || !Number.isInteger(item.quantity) || item.quantity<=0 || !Number.isFinite(item.unit_price)
                || item.unit_price<0 || Math.abs(item.unit_price*100-Math.round(item.unit_price*100))>0.00001)
                throw new Error('Vérifiez le produit, la quantité et le prix de chaque article.');
            totals.set(p.id,(totals.get(p.id)||0)+item.quantity);
            if (totals.get(p.id)>getAvailableStock(p)) throw new Error('Stock insuffisant pour '+p.name+' (toutes les lignes cumulées).');
        }
        const customer=document.getElementById('saleCustomer').value;
        const payload={p_customer_id:customer?Number(customer):null,p_items:items};
        const fingerprint=JSON.stringify({shop:activeShopId,...payload});
        if (!pendingOrder || pendingOrder.fingerprint!==fingerprint) pendingOrder={fingerprint,id:crypto.randomUUID()};
        savingOrder=true; form.inert=true; feedback.textContent='Enregistrement de la commande…';
        const result=multiSalesReady
            ? await shopRpc('create_sale_order',{...payload,p_request_id:pendingOrder.id})
            : await shopRpc('create_sale',{p_customer_id:payload.p_customer_id,p_product_id:items[0].product_id,p_quantity:items[0].quantity,p_unit_price:items[0].unit_price});
        if (result.error) throw result.error;
        if (!result.data) throw new Error('La confirmation de la vente est manquante. Vérifiez l’historique avant de réessayer.');
        committed=true;
        form.reset(); resetOrder();
        feedback.textContent='Vente enregistrée. Chargement de la facture…';
        await refreshAll();
        const invoice=shopData.factures.find(f=>f.sale_id===result.data);
        feedback.textContent='Vente enregistrée avec succès.';
        showToast(feedback.textContent);
        if (invoice) openInvoice(invoice);
    } catch(error) {
        console.error('Enregistrement ou actualisation de la vente',error);
        feedback.textContent=committed?'Vente enregistrée, mais l’affichage n’a pas pu être actualisé. Cliquez sur Actualiser ; ne ressaisissez pas la vente.':friendlyError(error);
        showToast(feedback.textContent);
    } finally {savingOrder=false; form.inert=false;}
};
function invoiceModel(f) {
    const items=f.items?.length?f.items:[{product_name:f.product_name,quantity:f.quantity,unit_price:f.unit_price,total_amount:f.total_amount}];
    const total=Number(f.total_amount), paid=Number(f.paid_amount??total);
    return {...f,items,total,paid,remaining:Math.max(0,total-paid),date:formatDateOnly(f.issued_at),
        cancelled:!!shopData.sales.find(s=>s.id===f.sale_id)?.cancelled_at};
}
function invoiceHtml(f) {
    const m=invoiceModel(f);
    return `<article class="invoice-sheet"><header class="invoice-heading"><div><p class="invoice-kicker">DAROU SALAM MANAGER</p><h2>${escapeHtml(m.shop_name)}</h2></div><div><h3>FACTURE</h3><p class="invoice-number">${escapeHtml(m.numero)}</p><p>${escapeHtml(m.date)}</p></div></header>
      ${m.cancelled?'<p class="invoice-cancelled">VENTE ANNULÉE — document conservé</p>':''}
      <section class="invoice-client"><p class="invoice-kicker">CLIENTE</p><strong>${escapeHtml(m.customer_name)}</strong>
      ${m.customer_phone?'<p>'+escapeHtml(m.customer_phone)+'</p>':''}${m.customer_address?'<p>'+escapeHtml(m.customer_address)+'</p>':''}</section>
      <table class="invoice-table"><thead><tr><th>Produit</th><th>Quantité</th><th>Prix unitaire</th><th>Total</th></tr></thead><tbody>
      ${m.items.map(l=>`<tr><td>${escapeHtml(l.product_name)}</td><td>${formatNumber(l.quantity)}</td><td>${formatMoney(l.unit_price)}</td><td>${formatMoney(l.total_amount)}</td></tr>`).join('')}</tbody></table>
      <section class="invoice-totals"><p><span>Total général</span><strong>${formatMoney(m.total)}</strong></p><p><span>Montant payé</span><span>${formatMoney(m.paid)}</span></p><p><span>Reste à payer</span><strong>${formatMoney(m.remaining)}</strong></p></section>
      <footer class="invoice-thanks">Merci pour votre confiance${m.legacy?'<small>Archive établie à partir des données disponibles.</small>':''}</footer></article>`;
}
function saveInvoiceBlob(blob,name) {
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=name+'.pdf'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function openInvoice(f) {
    const modal=document.getElementById('invoiceModal'), m=invoiceModel(f);
    document.getElementById('invoiceContent').innerHTML=invoiceHtml(f);
    document.getElementById('invoicePdf').onclick=()=>saveInvoiceBlob(InvoicePdf.create(m),m.numero);
    document.getElementById('invoicePrint').onclick=()=>{
        document.getElementById('shopPrintArea').innerHTML=invoiceHtml(f);
        modal.close(); window.print();
    };
    document.getElementById('invoiceShare').onclick=async()=>{
        const file=new File([InvoicePdf.create(m)],m.numero+'.pdf',{type:'application/pdf'});
        try {
            if (navigator.canShare?.({files:[file]})) {
                await navigator.share({files:[file],title:'Facture '+m.numero,text:m.shop_name+' — Merci pour votre confiance'});
            } else {
                saveInvoiceBlob(file,m.numero);
                showToast('PDF téléchargé. Ouvrez WhatsApp, choisissez la cliente puis joignez ce fichier comme document.');
            }
        } catch(error) {if(error.name!=='AbortError') showToast('Partage indisponible. Téléchargez le PDF puis joignez-le dans WhatsApp.');}
    };
    if (!modal.open) modal.showModal();
}
document.addEventListener('DOMContentLoaded',()=>{
    resetOrder();
    document.getElementById('addSaleItem').onclick=()=>{if(multiSalesReady)addSaleItem().querySelector('select').focus();};
    const container=document.getElementById('saleItems');
    container.addEventListener('change',event=>{
        if (event.target.matches('[data-field="product"]')) {
            const p=products.find(p=>p.id===event.target.value), row=event.target.closest('.sale-item');
            row.querySelector('[data-field="price"]').value=p?.selling_price??'';
        }
        updateSaleTotal();
    });
    container.addEventListener('input',updateSaleTotal);
    container.addEventListener('click',event=>{
        if(event.target.closest('[data-remove-item]') && container.children.length>1) {
            event.target.closest('.sale-item').remove(); updateSaleTotal();
        }
    });
    document.getElementById('saleForm').addEventListener('reset',()=>{
        if(!savingOrder) {resetOrder();document.getElementById('saleFeedback').textContent='';}
    });
});
