/* Périodes par boutique : Supabase attribue le mois, jamais l'horloge du téléphone. */
let activityPeriodsReady=false,activityPeriods=[],monthlyClosures=[],periodScope,closingMonth=false;
let cancellationReady=false,cancelledClosures=[],dashboardScope,dashboardActiveMonth;
shopRpcNames.add('cancel_monthly_closure');
shopRpcNames.add('close_activity_month');shopRpcNames.add('create_period_sale');
async function loadActivityPeriods(){
 const version=await supabaseClient.rpc('period_api_version');
 if(version.error&&!['PGRST202','42883'].includes(version.error.code))throw version.error;
 activityPeriodsReady=!version.error&&version.data===1;
 activityPeriods=[];monthlyClosures=[];cancelledClosures=[];cancellationReady=false;
 if(activityPeriodsReady){const v=await supabaseClient.rpc('closure_cancellation_version');if(v.error&&!['PGRST202','42883'].includes(v.error.code))throw v.error;cancellationReady=!v.error&&v.data===1;}
 if(activityPeriodsReady){
  for(const [table,target] of [['shop_activity_periods',activityPeriods],['monthly_closures',monthlyClosures],...(cancellationReady?[['cancelled_monthly_closures',cancelledClosures]]:[])]){
   for(let offset=0;;offset+=100){
    const {data,error}=await shopTable(table).select('*').order('shop_id').order(table==='shop_activity_periods'?'active_month':'month').range(offset,offset+99);
    if(error)throw error;target.push(...data);if(data.length<100)break;
   }
  }
  if(periodScope!==activeShopId){const p=activityPeriods.find(p=>p.shop_id===activeShopId);if(p)document.getElementById('reportMonth').value=String(p.active_month).slice(0,7);}
 }
 const nextActive=String(activityPeriods.find(p=>p.shop_id===activeShopId)?.active_month||'').slice(0,7);
 if(dashboardScope!==activeShopId||dashboardActiveMonth!==nextActive){selectedDashboardMonth=nextActive||paymentToday().slice(0,7);dashboardScope=activeShopId;dashboardActiveMonth=nextActive;}
 periodScope=activeShopId;
 const channel=document.getElementById('saleChannel');if(channel)channel.disabled=!activityPeriodsReady;
 renderActivityPeriods();
}
function renderActivityPeriods(){
 const active=activityPeriods.find(p=>p.shop_id===activeShopId),month=reportMonth();
 document.getElementById('activityPeriodStatus').textContent=!activityPeriodsReady?'Clôture disponible après installation de la migration des périodes mensuelles.':!activeShopId?'Choisissez une boutique pour consulter ou clôturer sa période.':`Mois d’activité en cours : ${String(active?.active_month||'').slice(0,7)}. Les nouvelles opérations sont affectées à ce mois par le serveur.`;
 const button=document.getElementById('closeMonth');button.hidden=!activityPeriodsReady||!activeShopId||!isAdmin();button.disabled=closingMonth||String(active?.active_month).slice(0,7)!==month;
 document.getElementById('monthlyClosures').innerHTML=activeShopId&&activityPeriodsReady?'<h3>Historique des bilans</h3><div class="shop-report-actions">'+monthlyClosures.filter(c=>c.shop_id===activeShopId).sort((a,b)=>String(b.month).localeCompare(String(a.month))).map(c=>`<button class="btn-secondary" data-closed-month="${escapeHtml(String(c.month).slice(0,7))}">${escapeHtml(String(c.month).slice(0,7))} — Clôturé</button>${cancellationReady&&isAdmin()?`<button class="btn-secondary" ${closingMonth||monthlyClosures.some(later=>later.shop_id===c.shop_id&&String(later.month)>String(c.month))?'disabled':''} data-cancel-month="${escapeHtml(String(c.month).slice(0,7))}">Annuler la clôture</button>`:''}`).join('')+`<button class="btn-secondary" data-closed-month="${escapeHtml(String(active?.active_month).slice(0,7))}">${escapeHtml(String(active?.active_month).slice(0,7))} — En cours</button></div>`:'';
 const cancelled=cancelledClosures.filter(c=>c.shop_id===activeShopId);
 if(cancelled.length)document.getElementById('monthlyClosures').innerHTML+='<details><summary>Clôtures annulées — traces conservées</summary>'+cancelled.map(c=>`<p>${escapeHtml(String(c.month).slice(0,7))} — annulation le ${escapeHtml(financeDate(c.cancelled_at))} : ${escapeHtml(c.reason)}</p>`).join('')+'</details>';

}
const liveReportModel=financeReportModel;
financeReportModel=function(){
 const archive=monthlyClosures.find(c=>c.shop_id===activeShopId&&String(c.month).slice(0,7)===reportMonth());
 const liveData=shopData;
 try{
  if(archive)shopData=archive.snapshot;
  const model=liveReportModel(),month=reportMonth();
  if(archive){model.shop=archive.snapshot.shop_name;model.generated=financeDate(archive.closed_at);model.title='BILAN MENSUEL — CLÔTURÉ';
   for(const section of model.sections){section.title=section.title.replace('Stocks actuels','Stocks à la clôture');for(const row of section.rows)row[0]=row[0].replace('(aujourd’hui)','(à la clôture)');}
  }
  const rows=shopData.sales.filter(s=>!s.cancelled_at&&(!activeShopId||s.shop_id===activeShopId)&&ShopMetrics.monthOf(s,'date_vente')===month);
  const channels=new Map(),names={whatsapp:'WhatsApp',tiktok:'TikTok',snapchat:'Snapchat',instagram:'Instagram',facebook:'Facebook',boutique:'En boutique',autre:'Autre'};
  for(const s of rows){const key=names[s.sales_channel]||'Non renseigné (historique)',v=channels.get(key)||{count:0,total:0};v.count++;v.total+=Number(s.montant_total);channels.set(key,v);}
  model.sections.push({title:'Origine des ventes',headers:['Canal','Ventes','Chiffre d’affaires'],rows:[...channels].map(([k,v])=>[k,String(v.count),financeMoney(v.total)])});
  const rs=shopData.reservations.filter(r=>(!activeShopId||r.shop_id===activeShopId)&&ShopMetrics.monthOf(r,'created_at')===month);
  model.sections.push({title:'Réservations créées pendant la période',headers:['Indicateur','Valeur'],rows:[['Nombre de réservations',String(rs.length)],['Valeur réservée (hors chiffre d’affaires tant que non remise)',financeMoney(rs.reduce((n,r)=>n+Number(r.quantity)*Number(r.unit_price),0))]]});
  model.notes=model.notes.filter(n=>!n.includes('dates de paiement')&&!n.includes('aujourd’hui'));
  model.notes.push('Les nouvelles écritures utilisent le mois d’activité défini par Supabase. Les écritures antérieures à la migration conservent leur mois de date historique.');
  model.notes.push(archive?'Créances, réservations et stocks figés à la clôture. Les paiements ultérieurs figurent dans leur nouvelle période.':'Bilan provisoire : créances, réservations et stocks à la date de consultation.');
  model.notes.push('Les créances comprennent les soldes encore dus, y compris ceux de périodes précédentes. Les avances ne sont jamais ajoutées au chiffre d’affaires.');
  return model;
 }finally{shopData=liveData;}
};
const renderReportBeforePeriods=renderMonthlyReport;
renderMonthlyReport=function(){renderReportBeforePeriods();renderActivityPeriods();};
async function periodReportFile(){
 let logo=null;try{logo=await Promise.race([BusinessBrand.pdfImage(),new Promise(resolve=>setTimeout(()=>resolve(null),4000))]);}catch(_){}
 return new File([ReportPdf.create({...financeReportModel(),logo})],'bilan-'+reportMonth()+'.pdf',{type:'application/pdf'});
}
document.addEventListener('DOMContentLoaded',()=>{
 const group=document.createElement('div');group.className='form-group';group.innerHTML='<label for="saleChannel">Origine de la vente (facultatif)</label><select id="saleChannel"><option value="">Non renseigné</option><option value="boutique">En boutique</option><option value="whatsapp">WhatsApp</option><option value="tiktok">TikTok</option><option value="snapchat">Snapchat</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="autre">Autre</option></select>';
 document.getElementById('saleForm').prepend(group);
 document.getElementById('monthlyClosures').addEventListener('click',e=>{const b=e.target.closest('[data-closed-month]');if(b){document.getElementById('reportMonth').value=b.dataset.closedMonth;renderMonthlyReport();}});
 document.getElementById('closeMonth').onclick=async()=>{
  if(closingMonth)return;const month=reportMonth(),shop=activeShopId;
  if(!confirm(`Clôturer ${month} pour ${currentShopName()} ? Le bilan sera figé, les ventes de ce mois ne pourront plus être annulées et les nouvelles opérations passeront au mois suivant, même si la date civile n’a pas changé.`))return;
  closingMonth=true;renderActivityPeriods();
  try{const {error}=await supabaseClient.rpc('close_activity_month',{p_shop_id:shop,p_month:month+'-01'});if(error)throw error;await refreshAll();document.getElementById('reportMonth').value=month;renderMonthlyReport();showToast('Mois clôturé. Le bilan est conservé dans l’historique.');}
  catch(e){showToast('Clôture non confirmée : '+friendlyError(e)+' Actualisez pour vérifier avant de réessayer.');}
  finally{closingMonth=false;renderActivityPeriods();}
 };
 document.getElementById('reportPdf').onclick=async()=>{try{saveInvoiceBlob(await periodReportFile(),'bilan-'+reportMonth());}catch(e){showToast(friendlyError(e));}};
 document.getElementById('shareReport').onclick=async()=>{try{const file=await periodReportFile();if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:'Bilan '+reportMonth()});else{saveInvoiceBlob(file,'bilan-'+reportMonth());showToast('Bilan téléchargé. Joignez ce PDF dans WhatsApp ou un e-mail au propriétaire.');}}catch(e){if(e.name!=='AbortError')showToast('Téléchargez le PDF puis joignez-le à votre message.');}};
});

let selectedDashboardMonth='';
function dashboardData(month){
 const combined={products:[],sales:[],reservations:[],payments:[],versements:[],factures:[],paymentAccounts:[],paymentEntries:[]};
 const shops=availableShops.filter(s=>!activeShopId||s.id===activeShopId);
 for(const shop of shops){const source=monthlyClosures.find(c=>c.shop_id===shop.id&&String(c.month).slice(0,7)===month)?.snapshot||shopData;
  for(const key of Object.keys(combined))combined[key].push(...(source[key]||[]).filter(r=>r.shop_id===shop.id));
 }
 return combined;
}
function renderMonthlyDashboard(){
 const month=selectedDashboardMonth||paymentToday().slice(0,7);selectedDashboardMonth=month;
 const data=dashboardData(month),m=ShopMetrics.summarizeMonth(data,activeShopId,month);
 const rows=[['Chiffre d’affaires',financeMoney(m.revenue)],['Ventes',String(m.salesCount)],['Encaissements du mois',financeMoney(m.receipts)],['Marge estimée avant charges',m.unknownCosts?'Coûts incomplets':financeMoney(m.profit)],['Encaissé à la vente',financeMoney(m.salesReceipts)],['Règlements de dettes reçus ce mois',financeMoney(m.debtReceipts)],['Encaissements des réservations',financeMoney(m.reservationReceipts)],['Créances des ventes de ce mois',financeMoney(m.saleDebt)],['Créances des réservations de ce mois',financeMoney(m.reservationDebt)],['Remises à l’administratrice ce mois',financeMoney(m.remittances)],['Produits vendus',formatUnitGroups(m.soldByUnit)],['Réservations du mois',String(m.reservationsCount)]];
 const invoiceBySale=new Map(data.factures.map(f=>[f.sale_id,f])),sold=data.sales.filter(s=>!s.cancelled_at&&ShopMetrics.monthOf(s,'date_vente')===month);
 document.getElementById('dashboardPage').classList.add('monthly-dashboard');
 document.getElementById('shopOverview').innerHTML=`<h2>${escapeHtml(currentShopName())}</h2><div class="shop-report-actions"><label for="dashboardMonth">Mois du tableau de bord</label><input id="dashboardMonth" type="month" value="${month}" required></div><p>Les opérations sont regroupées par mois d’activité. Les dates et les ventes enregistrées ne sont pas déplacées.</p><div class="shop-metrics">${rows.map(([k,v])=>`<div class="shop-metric"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('')}</div><p>Les créances concernent uniquement les ventes et réservations de ce mois, après les règlements enregistrés jusqu’à cette période. Les bilans clôturés utilisent leur archive figée. Les stocks sont consultables dans Stock et dans le bilan à la clôture.</p><h3>Ventes du mois</h3>${sold.map(s=>`<div class="list-item"><span>${escapeHtml(invoiceBySale.get(s.id)?.numero||'Vente')} — ${escapeHtml(invoiceBySale.get(s.id)?.product_name||'Commande')}</span><strong>${financeMoney(s.montant_total)}</strong></div>`).join('')||'<p>Aucune vente pour ce mois.</p>'}`;
 document.getElementById('dashboardMonth').onchange=e=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)){selectedDashboardMonth=e.target.value;renderMonthlyDashboard();}};
}
const reportsBeforeMonthlyDashboard=renderShopReports;
renderShopReports=function(){reportsBeforeMonthlyDashboard();renderMonthlyDashboard();};
document.addEventListener('DOMContentLoaded',()=>{
 document.getElementById('monthlyClosures').addEventListener('click',async e=>{
  const button=e.target.closest('[data-cancel-month]');if(!button||closingMonth)return;
  const month=button.dataset.cancelMonth,closure=monthlyClosures.find(c=>c.shop_id===activeShopId&&String(c.month).slice(0,7)===month);if(!closure)return;
  if(!confirm(`Annuler la clôture de ${month} ? Le mois sera rouvert. Aucune vente, réservation ou paiement ne sera supprimé ni déplacé. Annulez les mois du plus récent au plus ancien.`))return;
  const reason=prompt('Motif de l’annulation','Clôture effectuée par erreur');if(!reason||reason.trim().length<3)return;
  closingMonth=true;button.disabled=true;
  try{const {error}=await shopRpc('cancel_monthly_closure',{p_month:month+'-01',p_closed_at:closure.closed_at,p_reason:reason.trim()});if(error)throw error;await refreshAll();document.getElementById('reportMonth').value=month;renderMonthlyReport();showToast('Clôture annulée. Toutes les opérations sont conservées.');}
  catch(error){showToast(friendlyError(error));}
  finally{closingMonth=false;renderActivityPeriods();}
 });
});
