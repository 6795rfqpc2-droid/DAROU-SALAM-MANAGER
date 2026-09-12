const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {mockClient}=require('./mock-client.cjs');
async function boot(selected='kh',role='admin'){
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'http://localhost'});
 const {window:w}=dom;const client=mockClient(role); w.supabase={createClient:()=>client};
 w.sessionStorage.setItem('shop:user',selected); w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
 w.URL.createObjectURL=blob=>{w.lastPdf=blob;return 'blob:test'};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){};
 w.eval(['shops-core.js','script.js','shops.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n')+`
 window.testApi={refreshAll,shopTable,shopRpc,allShopRows,renderStaffAccess,downloadPdf,uploadProductPhoto,attachProductPhotos,getState:()=>({activeShopId,sales,products,shopData}),setScope:id=>{activeShopId=id}};`);
 await new Promise(resolve=>w.setTimeout(resolve,50));
 assert.equal(w.document.getElementById('loginMessage').textContent,'');
 return {dom,w,client};
}
test('interface : boutique active, chargement filtré et actualisation complète',async()=>{
 const {dom,w,client}=await boot();try{
 assert.equal(w.testApi.getState().sales.length,1);
 assert.equal(w.testApi.getState().sales[0].total_amount,500000);
 assert.equal(w.document.querySelectorAll('#shopSelector option').length,4);
 const graphMonth=w.document.getElementById('statisticsMonth');graphMonth.value='2026-09';
 graphMonth.dispatchEvent(new w.Event('change'));
 assert.equal(w.document.querySelectorAll('#statisticsChart svg rect').length,30);
 assert.match(w.document.getElementById('statisticsChartSummary').textContent,/500/);
 assert.ok(w.document.getElementById('monthlyReport').textContent.includes(w.document.getElementById('reportMonth').value));
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
