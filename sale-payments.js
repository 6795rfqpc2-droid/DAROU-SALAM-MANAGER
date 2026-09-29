/* Versements de ventes : historique distinct des réservations et des remises administratives. */
let salePaymentsReady=false;
let paymentEditing=null, paymentSaving=false, pendingPayment=null;
const paymentMethods={especes:'Espèces',wave:'Wave',orange_money:'Orange Money',virement:'Virement',carte:'Carte',autre:'Autre'};
const paymentToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Dakar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const paymentDateLabel=date=>date?formatDateOnly(String(date).slice(0,10)+'T12:00:00'):'—';
const paymentRows=()=>ShopMetrics.paymentBalances(shopData,paymentToday());
function updateSalePaymentFields(total) {
    const status=document.getElementById('salePaymentStatus');if(!status)return;
    const partial=status.value==='partial';
    document.getElementById('partialPaymentFields').hidden=!partial;
    for(const id of ['salePaymentName','salePaymentPhone','salePaidAmount']){
        document.getElementById(id).required=partial;
        document.getElementById(id).disabled=!partial;
    }
    document.getElementById('saleNextDue').disabled=!partial;
    if(total==null) total=orderItems().reduce((sum,l)=>sum+(Number.isFinite(l.quantity*l.unit_price)?Math.round(l.quantity*l.unit_price*100)/100:0),0);
    const paid=partial?Number(document.getElementById('salePaidAmount').value):total;
    document.getElementById('salePaidAmount').max=total;
    document.getElementById('salePaymentRemaining').textContent='Reste à payer : '+formatMoney(Math.max(0,total-paid));
    const date=document.getElementById('salePaymentDate');if(!date.value)date.value=paymentToday();date.max=paymentToday();
    document.getElementById('saleNextDue').min=date.value;
}
function salePaymentPayload(){
    const partial=document.getElementById('salePaymentStatus').value==='partial';
    const customer=customers.find(c=>String(c.id)===document.getElementById('saleCustomer').value);
    const data={status:partial?'partial':'full',name:partial?document.getElementById('salePaymentName').value.trim():customer?.full_name||'',
        phone:partial?document.getElementById('salePaymentPhone').value.trim():customer?.phone||'',
        paid:partial?Number(document.getElementById('salePaidAmount').value):0,
        mode:document.getElementById('salePaymentMethod').value,date:document.getElementById('salePaymentDate').value,
        due:partial?document.getElementById('saleNextDue').value:null};
    if(partial && (!data.name || data.phone.replace(/\D/g,'').length<8))throw new Error('Renseignez le nom et le téléphone du client.');
    const total=orderItems().reduce((sum,l)=>sum+Math.round(l.quantity*l.unit_price*100)/100,0);
    if(partial && (!Number.isFinite(data.paid)||data.paid<0||data.paid>=total))throw new Error('Le montant payé doit être inférieur au total. Pour un règlement complet, choisissez « Payé intégralement ».');
    return data;
}
function paymentInvoiceDetails(f){
    const a=paymentRows().find(a=>a.sale_id===f.sale_id);if(!a)return {};
    const methods=[...new Set(a.entries.map(e=>paymentMethods[e.method]||e.method))].join(', ')||'Aucun versement';
    return {paid:a.paid,remaining:a.remaining,customer_name:a.customer_name,customer_phone:a.customer_phone,
        payment_note:`${a.remaining===0?'Payé':'Paiement en cours'}${a.status==='late'?' — En retard':''} · Modes : ${methods}${a.next_due_date?' · Prochaine échéance : '+paymentDateLabel(a.next_due_date):''}`};
}
function renderSalePayments(){
    const rows=paymentRows();
    document.getElementById('receivablesNotice').textContent=salePaymentsReady
        ? 'Historique conservé pour chaque versement. Les anciennes ventes et réservations restent dans leurs rubriques.'
        : 'Cette rubrique sera activée après exécution de la migration des paiements dans Supabase.';
    const filter=document.getElementById('receivablesFilter').value;
    const shown=rows.filter(a=>filter==='all'||(filter==='open'?a.remaining>0:a.status===filter));
    document.getElementById('receivablesRows').innerHTML=shown.map(a=>{
        const invoice=shopData.factures.find(f=>f.sale_id===a.sale_id);
        const btn=(action,label,disabled=false)=>`<button class="btn-secondary" data-payment-action="${action}" data-account="${a.id}" ${disabled?'disabled':''}>${label}</button>`;
        return `<tr><td>${escapeHtml(a.customer_name)}${!activeShopId?'<small>'+escapeHtml(availableShops.find(s=>s.id===a.shop_id)?.nom||'')+'</small>':''}</td><td>${escapeHtml(a.customer_phone||'—')}</td><td>${escapeHtml(invoice?.numero||'—')}</td><td>${formatMoney(a.total_amount)}</td><td>${formatMoney(a.paid)}</td><td><strong>${formatMoney(a.remaining)}</strong></td><td>${paymentDateLabel(a.entries.at(-1)?.paid_on)}</td><td>${paymentDateLabel(a.next_due_date)}${a.soon?'<small>Échéance sous 7 jours</small>':''}</td><td><span class="payment-status ${a.status}">${a.status==='paid'?'Payé':a.status==='late'?'En retard':'En cours'}</span></td><td class="payment-actions">${btn('add','Ajouter un versement',!activeShopId||a.remaining===0)}${btn('history',"Voir l’historique")}${btn('invoice','Voir la facture')}${btn('receipt','Générer un reçu',!a.entries.length)}${btn('remind','Rappeler le client',a.remaining===0)}${btn('settle','Marquer comme payé',!activeShopId||a.remaining===0)}</td></tr>`;
    }).join('')||'<tr><td colspan="10">Aucun paiement dans cette sélection.</td></tr>';
    const open=rows.filter(a=>a.remaining>0),late=open.filter(a=>a.status==='late'),soon=open.filter(a=>a.soon);
    const panel=document.getElementById('paymentDashboard');panel.hidden=!salePaymentsReady;
    panel.innerHTML='<h2>Paiements clients à suivre</h2><div class="shop-metrics">'+[
        ['Paiements en cours',open.length],['Reste à récupérer',formatMoney(open.reduce((s,a)=>s+a.remaining,0))],
        ['Échéances sous 7 jours',soon.length],['Paiements en retard',late.length]
    ].map(([label,value])=>`<div class="shop-metric"><span>${label}</span><strong>${value}</strong></div>`).join('')+'</div>';
}
function openSalePayment(a,settle=false){
    if(!activeShopId || a.shop_id!==activeShopId)throw new Error('Sélectionnez la boutique de cette vente.');
    paymentEditing=a.id;pendingPayment=null;
    const form=document.getElementById('salePaymentForm');form.reset();
    document.getElementById('paymentClientSummary').textContent=a.customer_name+' — Reste à payer : '+formatMoney(a.remaining);
    document.getElementById('newPaymentAmount').value=settle?a.remaining:'';
    document.getElementById('newPaymentAmount').max=a.remaining;
    const date=document.getElementById('newPaymentDate');date.value=paymentToday();date.max=paymentToday();date.min=a.entries.at(-1)?.paid_on||a.initial_date;
    document.getElementById('newPaymentDue').value=settle?'':a.next_due_date||'';
    document.getElementById('newPaymentFeedback').textContent=settle?'Le solde sera enregistré comme un nouveau versement. Vérifiez la date et le mode de paiement.':'';
    updateNewPaymentRemaining();document.getElementById('salePaymentModal').showModal();
}
function updateNewPaymentRemaining(){
    const a=paymentRows().find(a=>a.id===paymentEditing);if(!a)return;
    document.getElementById('newPaymentRemaining').textContent='Nouveau reste : '+formatMoney(Math.max(0,a.remaining-Number(document.getElementById('newPaymentAmount').value)));
}
async function saveSalePayment(event){
    event.preventDefault();if(paymentSaving)return;
    const form=document.getElementById('salePaymentForm'),feedback=document.getElementById('newPaymentFeedback');
    if(!form.reportValidity())return;
    let committed=false;
    try{
        const args={p_account_id:paymentEditing,p_amount:Number(document.getElementById('newPaymentAmount').value),
            p_method:document.getElementById('newPaymentMethod').value,p_paid_on:document.getElementById('newPaymentDate').value,
            p_next_due_date:document.getElementById('newPaymentDue').value||null};
        const key=JSON.stringify({shop:activeShopId,...args});
        if(!pendingPayment||pendingPayment.key!==key)pendingPayment={key,id:crypto.randomUUID()};
        paymentSaving=true;form.inert=true;
        const result=await shopRpc('add_sale_payment',{...args,p_request_id:pendingPayment.id});
        if(result.error)throw result.error;if(!result.data)throw new Error('Confirmation manquante. Actualisez avant de réessayer.');
        committed=true;await refreshAll();document.getElementById('salePaymentModal').close();
        showToast('Versement enregistré. Historique conservé.');
        openPaymentReceipt(paymentEditing,result.data);pendingPayment=null;
    }catch(error){feedback.textContent=committed?'Versement enregistré, mais affichage indisponible. Fermez puis actualisez ; ne ressaisissez pas ce versement.':friendlyError(error);}
    finally{paymentSaving=false;form.inert=false;}
}
function openPaymentReceipt(accountId,entryId){
    const a=paymentRows().find(a=>a.id===accountId);if(!a)return;
    const entry=entryId?a.entries.find(e=>e.id===entryId):a.entries.at(-1);if(!entry)return;
    const f=shopData.factures.find(f=>f.sale_id===a.sale_id);if(!f)return;
    const model={...invoiceModel(f),document_title:'REÇU DE VERSEMENT',numero:entry.receipt_number,
        date:paymentDateLabel(entry.paid_on),paid:Number(entry.paid_after),remaining:Number(entry.remaining_after),
        receipt_amount:Number(entry.amount),payment_note:`Facture n° ${f.numero} · Mode : ${paymentMethods[entry.method]}\n${Number(entry.remaining_after)===0?'Payé':'Paiement en cours'} — Situation après ce versement`};
    openInvoice({receiptModel:model});
}
function openPaymentHistory(a){
    const content=document.getElementById('paymentHistoryContent');
    content.innerHTML=`<p>${escapeHtml(a.customer_name)} — Total versé : ${formatMoney(a.paid)}</p><div class="table-wrapper"><table><thead><tr><th>Date</th><th>Montant</th><th>Mode</th><th>Reçu</th></tr></thead><tbody>${a.entries.map(e=>`<tr><td>${paymentDateLabel(e.paid_on)}</td><td>${formatMoney(e.amount)}</td><td>${escapeHtml(paymentMethods[e.method])}</td><td><button class="btn-secondary" data-receipt="${e.id}">${escapeHtml(e.receipt_number)}</button></td></tr>`).join('')||'<tr><td colspan="4">Aucun versement enregistré.</td></tr>'}</tbody></table></div>`;
    content.querySelectorAll('[data-receipt]').forEach(b=>b.onclick=()=>{document.getElementById('paymentHistoryModal').close();openPaymentReceipt(a.id,b.dataset.receipt);});
    document.getElementById('paymentHistoryModal').showModal();
}
function openPaymentReminder(a){
    const f=shopData.factures.find(f=>f.sale_id===a.sale_id);
    let phone=a.customer_phone.replace(/\D/g,'');if(phone.startsWith('00'))phone=phone.slice(2);if(phone.length===9)phone='221'+phone;
    document.getElementById('reminderPhone').value='+'+phone;
    document.getElementById('reminderMessage').value=`Bonjour ${a.customer_name}, petit rappel concernant votre paiement auprès de Darou Salam Business (${f?.shop_name||''}). Il vous reste ${formatMoney(a.remaining)} CFA à régler sur votre achat/facture n° ${f?.numero||''}. Merci beaucoup.`;
    document.getElementById('reminderFeedback').textContent='';document.getElementById('paymentReminderModal').showModal();
}
document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('[data-payment-method]').forEach(s=>s.innerHTML=Object.entries(paymentMethods).map(([value,label])=>`<option value="${value}">${label}</option>`).join(''));
    document.getElementById('salePaymentFields').addEventListener('input',()=>updateSalePaymentFields());
    document.getElementById('saleCustomer').addEventListener('change',()=>{
        const c=customers.find(c=>String(c.id)===document.getElementById('saleCustomer').value);
        document.getElementById('salePaymentName').value=c?.full_name||'';
        document.getElementById('salePaymentPhone').value=c?.phone||'';
    });
    document.getElementById('saleForm').addEventListener('reset',()=>setTimeout(()=>updateSalePaymentFields(),0));
    document.getElementById('receivablesFilter').addEventListener('change',renderSalePayments);
    document.getElementById('newPaymentAmount').addEventListener('input',updateNewPaymentRemaining);
    document.getElementById('salePaymentForm').addEventListener('submit',saveSalePayment);
    document.getElementById('receivablesRows').addEventListener('click',e=>{
        const b=e.target.closest('[data-payment-action]');if(!b)return;
        const a=paymentRows().find(a=>a.id===b.dataset.account);if(!a)return;
        try{switch(b.dataset.paymentAction){
            case 'add':openSalePayment(a);break;case 'settle':openSalePayment(a,true);break;
            case 'history':openPaymentHistory(a);break;case 'receipt':openPaymentReceipt(a.id);break;
            case 'invoice':openInvoice(shopData.factures.find(f=>f.sale_id===a.sale_id));break;
            case 'remind':openPaymentReminder(a);break;
        }}catch(error){showToast(friendlyError(error));}
    });
    document.getElementById('openPaymentWhatsApp').onclick=()=>{
        const phone=document.getElementById('reminderPhone').value.replace(/\D/g,'');
        if(!/^[1-9]\d{7,14}$/.test(phone)){document.getElementById('reminderFeedback').textContent='Vérifiez le numéro avec son indicatif international.';return;}
        window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(document.getElementById('reminderMessage').value),'_blank','noopener,noreferrer');
    };
    // Le statut d'échéance reste à jour si l'écran demeure ouvert après minuit.
    setInterval(()=>{if(shopReady&&salePaymentsReady)renderSalePayments();},60000);
});
