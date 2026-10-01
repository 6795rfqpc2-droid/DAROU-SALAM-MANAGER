const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {mockClient}=require('./mock-client.cjs');
async function boot(selected='kh',role='admin',version=null){
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'http://localhost'});
 const {window:w}=dom;const client=mockClient(role); w.supabase={createClient:()=>client};
 const originalRpc=client.rpc;
 client.rpc=(name,args)=>name==='sales_api_version'
  ? Promise.resolve(version==='missing'?{data:null,error:{code:'PGRST202',message:'Function not found'}}:{data:version,error:null})
  : originalRpc(name,args);
 w.sessionStorage.setItem('shop:user',selected); w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
 w.URL.createObjectURL=blob=>{w.lastPdf=blob;return 'blob:test'};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){};
 w.eval(['shops-core.js','units.js','script.js','shops.js','invoice-pdf.js','sales-orders.js','sale-payments.js','brand.js','report-pdf.js','finance.js','periods.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n')+`
 window.testApi={saveSale,refreshAll,shopTable,shopRpc,allShopRows,renderStaffAccess,downloadPdf,uploadProductPhoto,attachProductPhotos,invoiceModel,
 setFinanceData:raw=>{hydrateShopData(raw,[],[]);salePaymentsReady=true;cashManagementReady=true;renderSalesHistory();renderSalePayments();renderMonthlyReport();},
 setPeriodData:(periods,closures)=>{activityPeriodsReady=true;activityPeriods=periods;monthlyClosures=closures;renderMonthlyReport();},reportModel:()=>financeReportModel(),getState:()=>({activeShopId,sales,products,shopData}),setScope:id=>{activeShopId=id}};`);
 await new Promise(resolve=>w.setTimeout(resolve,50));
 assert.equal(w.document.getElementById('loginMessage').textContent,'');
 return {dom,w,client};
}
test('finance : règlement final masqué, archives conservées, repère placé entre ventes et règlements',async()=>{
 const {dom,w}=await boot();try{
 const data={products:[],reservations:[],payments:[],
  sales:[{id:'s1',shop_id:'kh',quantite:1,montant_total:15000,date_vente:'2026-09-30T10:00:00Z',request_id:'initial'},
   {id:'s2',shop_id:'kh',quantite:1,montant_total:7000,date_vente:'2026-09-30T12:00:00Z',request_id:'second'}],
  factures:[{id:'f1',sale_id:'s1',shop_id:'kh',numero:'KHF-1',shop_name:'Khady',customer_name:'Awa',total_amount:15000,issued_at:'2026-09-30T10:00:00Z',items:[{product_name:'Voile',quantity:2,unit_price:5000,total_amount:10000},{product_name:'Foulard',quantity:1,unit_price:5000,total_amount:5000}]},
   {id:'f2',sale_id:'s2',shop_id:'kh',numero:'KHF-2',shop_name:'Khady',customer_name:'Amina',total_amount:7000,issued_at:'2026-09-30T12:00:00Z'}],
  paymentAccounts:[{id:'a1',sale_id:'s1',shop_id:'kh',customer_name:'Awa',total_amount:15000},{id:'a2',sale_id:'s2',shop_id:'kh',customer_name:'Amina',total_amount:7000}],
  paymentEntries:[{id:'e1',shop_id:'kh',account_id:'a1',amount:5000,sequence:1,paid_on:'2026-09-30',created_at:'2026-09-30T10:00:00Z',method:'wave',request_id:'initial'},
   {id:'e2',shop_id:'kh',account_id:'a1',amount:4000,sequence:2,paid_on:'2026-09-30',created_at:'2026-09-30T11:00:00Z',method:'orange_money',request_id:'debt'},
   {id:'e3',shop_id:'kh',account_id:'a2',amount:7000,sequence:1,paid_on:'2026-09-30',created_at:'2026-09-30T12:00:00Z',method:'especes',request_id:'second'}],
  versements:[{id:1,shop_id:'kh',amount:5000,balance_after:0,created_at:'2026-09-30T10:30:00Z',recorded_by_name:'Khady'}]};
 w.testApi.setFinanceData(data);
 assert.equal(w.document.getElementById('receivablesFilter').value,'open');
 assert.match(w.document.getElementById('receivablesRows').textContent,/Awa/);assert.doesNotMatch(w.document.getElementById('receivablesRows').textContent,/Amina/);
 const timeline=[...w.document.querySelectorAll('#historyTableBody tr')];
 assert.equal(timeline[0].dataset.saleId,'s2');assert.ok(timeline[1].classList.contains('cash-collection'));
 assert.equal(timeline[2].dataset.remittanceId,'1');assert.equal(timeline[3].dataset.saleId,'s1');
 assert.match(w.document.getElementById('historyCashSummary').textContent,/11.*000/);
 const model=w.testApi.invoiceModel(data.factures[0]);assert.equal(model.items.length,2);assert.equal(model.paid,9000);assert.equal(model.remaining,6000);assert.match(model.payment_note,/Paiement partiel/);
 const blob=require('../invoice-pdf').create(model);fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/facture-finance.pdf',Buffer.from(await blob.arrayBuffer()));
 data.paymentEntries.push({id:'e4',shop_id:'kh',account_id:'a1',amount:6000,sequence:3,paid_on:'2026-09-30',created_at:'2026-09-30T13:00:00Z',method:'especes',request_id:'final'});
 w.testApi.setFinanceData(data);assert.match(w.document.getElementById('receivablesRows').textContent,/Aucun paiement/);
 assert.equal(w.testApi.getState().shopData.paymentEntries.length,4);assert.match(w.testApi.invoiceModel(data.factures[0]).payment_note,/Payé/);
 w.document.getElementById('receivablesFilter').value='paid';w.document.getElementById('receivablesFilter').dispatchEvent(new w.Event('change'));
 assert.match(w.document.getElementById('receivablesRows').textContent,/Awa/);
 }finally{dom.window.close();}
});
test('navigation : une seule page visible et titre correct après le bilan',async()=>{
 const {dom,w}=await boot();try{
  for(const [page,title] of [['reports','Bilan mensuel'],['dashboard','Tableau de bord'],['history','Historique'],['invoices','Factures']]){
   w.document.querySelector(`[data-page="${page}"]`).click();
   assert.equal(w.document.getElementById('pageTitle').textContent,title);
   assert.equal(w.document.querySelectorAll('.page.active').length,1);
   assert.equal(w.document.querySelector('.page.active').id,page+'Page');
   assert.equal(w.document.getElementById('mobileMenu').classList.contains('open'),false);
  }
 }finally{dom.window.close();}
});

test('facture : téléchargement possible même si le logo échoue',async()=>{
 const {dom,w}=await boot();try{
  w.BusinessBrand.pdfImage=async()=>{throw new Error('Image indisponible');};
  w.openInvoice({id:'demo',sale_id:'demo',numero:'TEST-1',shop_name:'Khady',customer_name:'Test',issued_at:'2026-09-30',total_amount:5000,items:[{product_name:'Voile',quantity:1,unit_price:5000,total_amount:5000}]});
  assert.equal(w.document.getElementById('invoiceModal').open,true);
  await w.document.getElementById('invoicePdf').onclick();
  assert.ok(w.lastPdf);assert.equal(w.lastPdf.type,'application/pdf');
  const overview=w.document.getElementById('shopOverview').textContent;
  assert.doesNotMatch(overview,/Ventes réalisées/);
  assert.match(overview,/Total réellement encaissé/);
 }finally{dom.window.close();}
});

test('ventes : compatibilité avant migration et total affiché',async()=>{
 const {dom,w,client}=await boot('kh','admin','missing');try{
  assert.equal(w.document.getElementById('addSaleItem').hidden,true);
  const row=w.document.querySelector('.sale-item');
  row.querySelector('select').value='p1';row.querySelector('select').dispatchEvent(new w.Event('change',{bubbles:true}));
  row.querySelector('[data-field="quantity"]').value='2';row.querySelector('[data-field="quantity"]').dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.match(w.document.getElementById('saleTotal').textContent,/1.*000/);
  client.rpc=async(name,args)=>{client.calls.push({rpc:name,args});return {data:'legacy-sale',error:null};};
  await w.testApi.saveSale({preventDefault(){}});
  const call=client.calls.find(c=>c.rpc==='create_sale');
  assert.equal(call.args.p_quantity,2);assert.equal(call.args.p_shop_id,'kh');
  assert.match(w.document.getElementById('saleFeedback').textContent,/succès/);
 }finally{dom.window.close()}
});

test('ventes : double clic ignoré et réessai après erreur avec même identifiant',async()=>{
 const {dom,w,client}=await boot('kh','admin',2);try{
  const row=w.document.querySelector('.sale-item');
  row.querySelector('select').value='p1';row.querySelector('select').dispatchEvent(new w.Event('change',{bubbles:true}));
  let release;const calls=[];
  client.rpc=(name,args)=>{calls.push({name,args});return new Promise(resolve=>{release=resolve});};
  const pending=w.testApi.saveSale({preventDefault(){}});
  await w.testApi.saveSale({preventDefault(){}});
  assert.equal(calls.length,1);
  release({data:null,error:{message:'Connexion interrompue'}});await pending;
  const id=calls[0].args.p_request_id;
  client.rpc=async(name,args)=>{calls.push({name,args});return {data:'order-sale',error:null};};
  await w.testApi.saveSale({preventDefault(){}});
  assert.equal(calls[1].args.p_request_id,id);
  assert.equal(calls[1].name,'create_sale_order');
  assert.equal(calls[1].args.p_items.length,1);
  assert.match(w.document.getElementById('saleFeedback').textContent,/succès/);
 }finally{dom.window.close()}
});

test('catégories : le bouton Ajouter utilise le champ visible dans chaque boutique',async()=>{
 for(const shop of ['kh','ad','am']){
  const {dom,w,client}=await boot(shop);try{
   const original=client.from;
   client.from=function(table){
    const query=original.call(this,table);
    if(table==='categories') query.insert=rows=>{
     client.calls.at(-1).insert=rows;
     client.tables.categories.push({id:'new-'+shop,...rows});
     query.single=async()=>({data:{id:'new-'+shop,...rows},error:null});
     return query;
    };
    return query;
   };
   const input=w.document.getElementById('newCategoryName');
   input.value=' sacs ';
   w.document.getElementById('addCategoryButton').click();
   await new Promise(resolve=>w.setTimeout(resolve,20));
   const inserts=client.calls.filter(c=>c.table==='categories'&&c.insert);
   assert.equal(inserts.length,1);
   assert.equal(inserts[0].insert.nom,'sacs');
   assert.equal(inserts[0].insert.shop_id,shop);
   assert.equal(input.value,'');
   assert.match(w.document.getElementById('categoriesList').textContent,/sacs/);
  }finally{dom.window.close()}
 }
});

test('interface : boutique active, chargement filtré et actualisation complète',async()=>{
 const {dom,w,client}=await boot();try{
 assert.equal(w.testApi.getState().sales.length,1);
 assert.equal(w.testApi.getState().sales[0].total_amount,500000);
 assert.equal(w.document.querySelectorAll('#shopSelector option').length,4);
 const graphMonth=w.document.getElementById('statisticsMonth');graphMonth.value='2026-09';
 graphMonth.dispatchEvent(new w.Event('change'));
 assert.equal(w.document.querySelectorAll('#statisticsChart svg rect').length,30);
 assert.match(w.document.getElementById('statisticsChartSummary').textContent,/500/);
 const reportPeriod=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(new Date(w.document.getElementById('reportMonth').value+'-01T12:00:00'));
 assert.ok(w.document.getElementById('monthlyReport').textContent.includes(reportPeriod));
 assert.match(w.document.getElementById('shopOverview').textContent,/500/);
 for(const c of client.calls.filter(c=>['produits','ventes','factures','customers','reservations','payments','versements'].includes(c.table)))
  assert.ok(c.filters.some(([k,v])=>k==='shop_id'&&v==='kh'),JSON.stringify(c));
 await w.testApi.shopTable('customers').insert({nom:'Test',shop_id:'ad'});
 assert.equal(client.calls.at(-1).insert.shop_id,'kh');
 await w.testApi.shopRpc('create_sale',{p_shop_id:'ad',p_product_id:'p1'});
 assert.equal(client.calls.at(-1).args.p_shop_id,'kh');
 w.document.querySelector('[data-page="invoices"]').click();
 w.document.querySelector('[data-invoice]').click();
 assert.ok(w.document.getElementById('invoiceModal').hasAttribute('open'));
 assert.match(w.document.getElementById('invoiceContent').textContent,/Khady/);
 }finally{dom.window.close()}
});
test('interface : global réservé admin, écritures interdites en global',async()=>{
 const {dom,w}=await boot('all');try{
 assert.equal(w.testApi.getState().sales.length,2);
 assert.equal(w.testApi.getState().activeShopId,null);
 assert.throws(()=>w.testApi.shopTable('customers').insert({nom:'Non'}));
 assert.throws(()=>w.testApi.shopRpc('create_sale',{}));
 assert.ok(w.document.body.classList.contains('global-shops'));
 assert.ok(w.document.getElementById('remittanceForm').hidden);
 }finally{dom.window.close()}
 const staff=await boot('all','vendeuse');try{
 assert.equal(staff.w.testApi.getState().activeShopId,'kh');
 assert.equal(staff.w.document.querySelectorAll('#shopSelector option').length,1);
 }finally{staff.dom.window.close()}
});
test('interface : pagination au-delà de 1000 lignes et PDF autonome',async()=>{
 const {dom,w,client}=await boot();try{
 client.tables.customers=Array.from({length:1205},(_,id)=>({id,shop_id:'kh',nom:'Client '+id}));
 assert.equal((await w.testApi.allShopRows('customers')).length,1205);
 w.testApi.downloadPdf(['DAROU SALAM MANAGER','Boutique Khady Faye','Bilan mensuel : 2026-09','Chiffre d’affaires : 500 000 F','Bénéfice estimé : 100 000 F'],'test');
 assert.equal(w.lastPdf.type,'application/pdf');
 const bytes=await new Promise(resolve=>{const r=new w.FileReader();r.onload=()=>resolve(Buffer.from(r.result));r.readAsArrayBuffer(w.lastPdf)});
 assert.ok(bytes.toString().startsWith('%PDF-1.4'));
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/bilan-test.pdf',bytes);
 }finally{dom.window.close()}
});

test('personnel : ouverture de page, nouveau profil sans boutique et profil invisible',async()=>{
 const {dom,w,client}=await boot();try{
 client.tables.profiles.push({id:'new-staff',nom_complet:'Personnel test',role:'personnel',active:true});
 w.document.querySelector('[data-page="staff"]').click();
 await new Promise(resolve=>w.setTimeout(resolve,0));
 const list=w.document.getElementById('staffList');
 assert.match(list.textContent,/Personnel test/);
 assert.match(list.textContent,/Aucune boutique attribuée/);
 assert.equal(list.querySelectorAll('input[type="checkbox"]').length,3);
 assert.equal(await w.testApi.renderStaffAccess('new-staff'),true);
 assert.equal(await w.testApi.renderStaffAccess('missing-profile'),false);
 assert.match(list.textContent,/profil personnel n’est pas visible/);
 assert.match(list.textContent,/Ne recréez pas/);
 }finally{dom.window.close()}
});

test('personnel : erreur de lecture explicite, sans faux succès',async()=>{
 const {dom,w,client}=await boot();try{
 const original=client.from;
 client.from=function(table){
  if(table==='profile_shops') return {select:()=>Promise.resolve({data:null,error:{message:'permission denied'}})};
  return original.call(this,table);
 };
 assert.equal(await w.testApi.renderStaffAccess('new-staff'),false);
 assert.match(w.document.getElementById('staffList').textContent,/accès aux boutiques/);
 assert.match(w.document.getElementById('staffList').textContent,/Ne le recréez pas/);
 }finally{dom.window.close()}
});

test('personnel : la réponse Hello ne confirme aucune création',async()=>{
 const {dom,w,client}=await boot();try{
 client.functions={invoke:async()=>({data:{message:'Hello admin!'},error:null})};
 w.document.getElementById('staffFullName').value='Personnel exemple';
 w.document.getElementById('staffEmail').value='staff@example.test';
 w.document.getElementById('staffPassword').value='test-only-password';
 w.document.getElementById('staffModal').showModal();
 w.document.getElementById('staffForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await new Promise(resolve=>w.setTimeout(resolve,0));
 assert.match(w.document.getElementById('toastMessage').textContent,/Création non confirmée/);
 assert.equal(w.document.getElementById('staffFullName').value,'Personnel exemple');
 assert.ok(w.document.getElementById('staffModal').hasAttribute('open'));
 }finally{dom.window.close()}
});

test('photos : envoi par boutique et affichage privé par lien temporaire',async()=>{
 const {dom,w,client}=await boot();try{
 let uploadedPath;
 client.storage={from:bucket=>{
  assert.equal(bucket,'product-photos');
  return {upload:async(path)=>{uploadedPath=path;return {error:null}},
   createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'https://storage.example.test/signed/'+path})),error:null})};
 }};
 const uploaded=await w.testApi.uploadProductPhoto(new w.File(['photo'],'photo.jpeg',{type:'image/jpeg'}));
 assert.match(uploadedPath,/^kh\/user\/.+\.jpg$/);
 assert.equal(uploaded.url,null);
 const rows=await w.testApi.attachProductPhotos([{id:'p',photo_path:uploaded.path}]);
 assert.match(rows[0].photo_url,/^https:\/\/storage.example.test\/signed\/kh\//);
 await assert.rejects(w.testApi.uploadProductPhoto(new w.File(['text'],'photo.svg',{type:'image/svg+xml'})),/JPG/);
 }finally{dom.window.close()}
});

test('bilan clôturé : données figées et PDF indépendant des paiements ultérieurs',async()=>{
 const {dom,w}=await boot();try{
  const snapshot={shop_name:'Boutique Khady Faye',products:[],reservations:[],payments:[],versements:[],sales:[{id:'s',shop_id:'kh',date_vente:'2026-09-30',montant_total:5000,activity_month:'2026-09-01',sales_channel:'whatsapp'}],factures:[],paymentAccounts:[],paymentEntries:[]};
  w.document.getElementById('reportMonth').value='2026-09';
  w.testApi.setPeriodData([{shop_id:'kh',active_month:'2026-10-01'}],[{shop_id:'kh',month:'2026-09-01',closed_at:'2026-09-30T18:00:00Z',snapshot}]);
  const model=w.testApi.reportModel();assert.match(model.title,/CLÔTURÉ/);
  assert.ok(model.sections.some(s=>s.rows.some(r=>r[0]==='WhatsApp')));
  assert.match(model.sections[0].rows[0][1],/5.*000/);
  assert.equal(w.document.getElementById('closeMonth').disabled,true);
  const pdf=require('../report-pdf').create({...model,logo:fs.existsSync('test-results/logo-pdf.json')?JSON.parse(fs.readFileSync('test-results/logo-pdf.json','utf8')):null});
  fs.writeFileSync('test-results/bilan-cloture.pdf',Buffer.from(await pdf.arrayBuffer()));
  assert.notEqual(w.testApi.getState().shopData,snapshot);
 }finally{dom.window.close();}
});
