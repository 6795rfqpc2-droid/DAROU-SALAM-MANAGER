/* Trois flux distincts : ventes, encaissements clients, remises à l'administratrice. */
let cashManagementReady=false,remittanceSaving=false,pendingRemittance=null;
const financeMoney=n=>formatMoney(n)+' CFA';
const financePerson=row=>row.recorded_by_name||(row.created_by===currentProfile?.id?currentProfile.nom_complet:null)||'Utilisateur '+String(row.created_by||row.vendeuse_id||'non renseigné').slice(0,8);
const financeDate=value=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Dakar',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const originalInitializeFinance=initializeShops;
initializeShops=async function(){
    await originalInitializeFinance();
    const {data,error}=await supabaseClient.rpc('cash_management_version');
    if(error&&!['PGRST202','42883'].includes(error.code))throw error;
    cashManagementReady=!error&&data>=1;
    BusinessBrand.pdfImage().then(logo=>InvoicePdf.setLogo(logo)).catch(error=>{InvoicePdf.setLogo(null);showToast('Logo indisponible : '+friendlyError(error));});
};
shopRpcNames.add('record_cash_remittance');
function financeMetricRows(m){return [
    ['Ventes réalisées',financeMoney(m.revenue)],['Nombre de ventes',formatNumber(m.salesCount)],
    ['Encaissé sur les nouvelles ventes',financeMoney(m.salesReceipts)],
    ['Versements clients sur anciennes factures',financeMoney(m.debtReceipts)],
    ['Encaissements des réservations',financeMoney(m.reservationReceipts)],
    ['Total réellement encaissé',financeMoney(m.receipts)],
    ['Créances clients restantes (aujourd’hui)',financeMoney(m.customerDebt)],
    ['Remis à l’administratrice',financeMoney(m.remittances)],
    ['Solde à remettre, reports antérieurs inclus',financeMoney(m.cashBalance)],
    ['Marge estimée avant charges',m.unknownCosts?'Coûts historiques incomplets':financeMoney(m.profit)]
];}
metricsCards=function(m){return financeMetricRows(m).filter(([label])=>label!=='Ventes réalisées').map(([label,value])=>`<div class="shop-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')
    +`<div class="shop-metric"><span>Stock disponible</span><strong>${formatUnitGroups(m.availableByUnit)}</strong></div>`;};
function financeModeRows(m){
    const names={...paymentMethods,unknown:'Non renseigné (historique)'};
    return [...new Set(['especes','wave','orange_money',...Object.keys(m.paymentModes)])].map(k=>[names[k]||k,financeMoney(m.paymentModes[k]||0)]);
}
function financeTopProducts(month){
    const ids=new Set(shopData.sales.filter(s=>!s.cancelled_at&&(!activeShopId||s.shop_id===activeShopId)&&ShopMetrics.monthOf(s,'date_vente')===month).map(s=>s.id));
    const map=new Map();
    for(const f of shopData.factures.filter(f=>ids.has(f.sale_id))){
        const items=f.items?.length?f.items:[{product_name:f.product_name,quantity:f.quantity,unit:f.unit, total_amount:f.total_amount}];
        for(const l of items){const key=f.shop_id+':'+(l.product_id||l.product_name)+':'+(l.unit||'piece');
            const row=map.get(key)||{name:l.product_name,unit:l.unit||'piece',quantity:0,amount:0};
            row.quantity+=Number(l.quantity);row.amount+=Number(l.total_amount);map.set(key,row);}
    }
    return [...map.values()].sort((a,b)=>b.amount-a.amount).map(p=>[p.name,formatQuantity(p.quantity,p.unit),financeMoney(p.amount)]);
}
function financeReportModel(){
    const month=reportMonth(),m=ShopMetrics.summarize(shopData,activeShopId,month);
    const period=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(new Date(month+'-01T12:00:00'));
    return {title:'BILAN MENSUEL',shop:currentShopName(),period,generated:financeDate(new Date()),
        sections:[
            {title:'Activité et trésorerie',headers:['Indicateur','Montant / Nombre'],rows:financeMetricRows(m)},
            {title:'Répartition des encaissements',headers:['Mode de paiement','Montant'],rows:financeModeRows(m)},
            {title:'Produits vendus — classés par chiffre d’affaires',headers:['Produit','Quantité','Ventes'],rows:financeTopProducts(month)},
            {title:'Stocks actuels',headers:['Indicateur','Quantité'],rows:[['Stock total',formatUnitGroups(m.stockByUnit)],['Stock disponible',formatUnitGroups(m.availableByUnit)],['Quantités vendues',formatUnitGroups(m.soldByUnit)]]}
        ],notes:[
            'Un règlement de dette est un encaissement, jamais une nouvelle vente.',
            'Le solde à remettre inclut les reports antérieurs et les encaissements de réservations. Les dates de paiement déterminent le mois des encaissements.',
            'Les créances et stocks sont ceux d’aujourd’hui. Les annulations sont prises en compte selon leur état actuel.',
            'Dépenses non suivies dans les données actuelles : la marge indiquée est avant charges, pas un bénéfice net.',
            'Les modes de paiement historiques inconnus restent « Non renseigné ».'
        ]};
}
function reportHtml(model){return `<article class="business-report"><header class="business-report-header">${BusinessBrand.logoSrc?`<img class="business-logo" src="${BusinessBrand.logoSrc}" alt="DAROU SALAM — DIALABÉ & VOILES">`:''}<div><p class="business-kicker">DAROU SALAM BUSINESS</p><h2>${escapeHtml(model.title)}</h2><p>${escapeHtml(model.shop)}</p></div><div class="report-period"><strong>${escapeHtml(model.period)}</strong><small>Édité le ${escapeHtml(model.generated)}</small></div></header>
    ${model.sections.map(s=>`<section class="report-section"><h3>${escapeHtml(s.title)}</h3><div class="table-container"><table><thead><tr>${s.headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${s.rows.length?s.rows.map((row,i)=>`<tr class="${i%2?'alternate':''}">${row.map(cell=>`<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${s.headers.length}">Aucune donnée pour cette période.</td></tr>`}</tbody></table></div></section>`).join('')}
    <footer class="report-notes">${model.notes.map(n=>`<p>${escapeHtml(n)}</p>`).join('')}</footer></article>`;}
renderMonthlyReport=function(){document.getElementById('monthlyReport').innerHTML=reportHtml(financeReportModel());};
const statisticsBeforeFinance=renderStatistics;
renderStatistics=function(){statisticsBeforeFinance();renderDailyFinance();};
function renderDailyFinance(){
    const date=document.getElementById('financeDay');if(!date.value)date.value=paymentToday();
    const m=ShopMetrics.summarize(shopData,activeShopId,date.value);
    document.getElementById('dailyFinance').innerHTML=`<h3>Journée du ${paymentDateLabel(date.value)}</h3><div class="shop-metrics">${metricsCards(m)}</div><div class="finance-modes">${financeModeRows(m).map(([k,v])=>`<span>${escapeHtml(k)} : <strong>${v}</strong></span>`).join('')}</div>`;
}
function remittanceExplanation(v){
    if(v.balance_after==null)return 'Remise historique — le périmètre des encaissements n’avait pas été figé.';
    return Number(v.balance_after)===0?'Tous les encaissements enregistrés avant ce repère ont été remis. Les créances non payées restent dues.':`Remise partielle : ${financeMoney(v.balance_after)} restent à remettre après ce repère.`;
}
renderSalesHistory=function(){
    const m=ShopMetrics.summarize(shopData,activeShopId),date=document.getElementById('historyDate').value;
    document.getElementById('historyCashSummary').innerHTML=`<div><span>Montant à verser à l’administratrice</span><strong>${financeMoney(m.cashBalance)}</strong><small>Argent réellement encaissé, avances et règlements de dettes compris, moins les remises déjà enregistrées.</small></div><button id="goToCashRemittance" class="btn-primary" ${!activeShopId||m.cashBalance<=0?'disabled':''}>Enregistrer une remise</button>`;
    document.getElementById('goToCashRemittance').onclick=()=>{showPage('remittances');document.getElementById('remittanceAmount').value=Math.max(0,m.cashBalance);};
    const invoices=new Map(shopData.factures.map(f=>[f.sale_id,f])),receipts=ShopMetrics.receiptEvents(shopData);
    const events=sales.map(s=>({kind:'sale',date:s.cash_recorded_at||s.sold_at,s}));
    events.push(...shopData.versements.map(v=>({kind:'remittance',date:v.cash_cutoff_at||v.created_at,v})));
    events.push(...receipts.filter(r=>r.kind!=='sale').map(r=>({kind:r.kind,date:r.recorded_at,r})));
    const rows=events.filter(e=>!date||String(e.date).slice(0,10)===date).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    document.getElementById('historyEmpty').style.display=rows.length?'none':'';
    document.getElementById('historyTableBody').innerHTML=rows.map(e=>{
        if(e.kind==='remittance'){const v=e.v;return `<tr class="cash-divider" data-remittance-id="${v.id}"><td colspan="7"><strong>VERSEMENT À L’ADMINISTRATRICE : ${financeMoney(v.amount)}</strong><p>${financeDate(e.date)} · ${escapeHtml(financePerson(v))}</p><p>${escapeHtml(remittanceExplanation(v))}</p>${v.note?'<small>'+escapeHtml(v.note)+'</small>':''}</td></tr>`;}
        if(e.kind!=='sale'){const r=e.r,f=invoices.get(r.sale_id);return `<tr class="cash-collection"><td>${financeDate(e.date)}</td><td><strong>${e.kind==='debt'?'Versement client — ancienne facture':'Paiement de réservation'}</strong><small>${escapeHtml(f?.numero||'')}</small></td><td>${escapeHtml(f?.customer_name||'Client réservation')}</td><td>—</td><td>${financeMoney(r.amount)}<small>${escapeHtml(paymentMethods[r.method]||'Mode non renseigné')}</small></td><td>${escapeHtml(financePerson(r))}</td><td>${f?`<button class="btn-secondary" data-invoice="${f.id}">Facture</button>`:''}</td></tr>`;}
        const s=e.s,f=invoices.get(s.id),paid=receipts.filter(r=>r.sale_id===s.id&&r.kind==='sale').reduce((n,r)=>n+r.amount,0);
        return `<tr data-sale-id="${s.id}"><td>${financeDate(e.date)}</td><td>${escapeHtml(s.products?.name||'Vente')}</td><td>${escapeHtml(s.customers?.full_name||'Client comptant')}</td><td>${formatUnitGroups(ShopMetrics.unitTotals(s.items?.length?s.items:[{quantity:s.quantity,unit:'piece'}],'quantity'))}</td><td><strong>${financeMoney(s.total_amount)}</strong><small>Encaissé à la vente : ${financeMoney(paid)}</small></td><td>${escapeHtml(financePerson({...s,created_by:s.vendeuse_id}))}</td><td>${f?`<button class="btn-secondary" data-invoice="${f.id}">Facture</button>`:''}${isAdmin()?`<button class="btn-danger" onclick="deleteSale('${s.id}')">Annuler la vente</button>`:''}</td></tr>`;
    }).join('');
};
renderRemittances=function(){
    const form=document.getElementById('remittanceForm');form.hidden=!activeShopId;
    form.querySelector('button').disabled=!cashManagementReady;
    document.getElementById('cashRemittanceNotice').textContent=cashManagementReady
        ?'Disponible à remettre : '+financeMoney(ShopMetrics.summarize(shopData,activeShopId).cashBalance)
        :'Les repères sécurisés seront disponibles après la migration du suivi de caisse.';
    document.getElementById('remittanceList').innerHTML='<div class="table-container"><table><thead><tr><th>Date et heure</th><th>Montant</th><th>Enregistré par</th><th>Solde après remise</th><th>Note</th></tr></thead><tbody>'+[...shopData.versements].sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(v=>`<tr><td>${financeDate(v.created_at)}</td><td>${financeMoney(v.amount)}</td><td>${escapeHtml(financePerson(v))}</td><td>${v.balance_after==null?'Non figé à l’époque':financeMoney(v.balance_after)}</td><td>${escapeHtml(v.note||'')}</td></tr>`).join('')+'</tbody></table></div>';
};
document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('financeDay').addEventListener('change',renderDailyFinance);
    document.getElementById('reportPdf').onclick=async()=>{
        try{saveInvoiceBlob(ReportPdf.create({...financeReportModel(),logo:await BusinessBrand.pdfImage()}),'bilan-'+reportMonth());}catch(e){showToast(friendlyError(e));}
    };
    document.getElementById('reportPrint').onclick=()=>{document.getElementById('shopPrintArea').innerHTML=reportHtml(financeReportModel());window.print();};
    document.getElementById('remittanceAmount').step='0.01';document.getElementById('remittanceAmount').min='0.01';
    document.getElementById('remittanceForm').onsubmit=async event=>{
        event.preventDefault();if(remittanceSaving||!cashManagementReady)return;
        const form=event.target,args={p_amount:Number(document.getElementById('remittanceAmount').value),p_note:document.getElementById('remittanceNote').value.trim()};
        const key=JSON.stringify({shop:activeShopId,...args});if(!pendingRemittance||pendingRemittance.key!==key)pendingRemittance={key,id:crypto.randomUUID()};
        let committed=false;
        try{remittanceSaving=true;form.inert=true;
            const {data,error}=await shopRpc('record_cash_remittance',{...args,p_request_id:pendingRemittance.id});if(error)throw error;if(!data)throw new Error('Confirmation manquante : actualisez avant de réessayer.');
            committed=true;form.reset();await refreshAll();pendingRemittance=null;showPage('history');showToast('Remise enregistrée. Repère ajouté dans l’historique.');
        }catch(e){showToast(committed?'Remise enregistrée ; actualisez l’affichage sans ressaisir le montant.':friendlyError(e));}
        finally{remittanceSaving=false;form.inert=false;}
    };
});
