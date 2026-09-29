const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {randomUUID}=require('node:crypto');const {PGlite}=require('@electric-sql/pglite');
const {setup,kh,ad,admin,p1}=require('./payment-fixture.cjs');
test('paiements de ventes : conservation, échéances, reçus, idempotence et isolation',async t=>{
 const db=new PGlite();try{
 await setup(db);const scalar=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
 const migration=fs.readFileSync('supabase/migration-paiements-en-cours.sql','utf8');
 const today=(await scalar("SELECT (now() AT TIME ZONE 'Africa/Dakar')::date::text d")).d;
 const login=async(id=admin)=>db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE authenticated;`);
 const snapshot=async()=>{
  const result={};for(const table of ['produits','ventes','vente_lignes','factures','reservations','payments','versements','customers','profiles','profile_shops','shops']){
   result[table]=(await scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') j FROM ${table==='profile_shops'?'(SELECT profile_id AS id,* FROM profile_shops)':table} t`)).j;
  }return result;
 };
 await t.test('aucune ancienne donnée changée ; deux exécutions',async()=>{
  await db.exec(`SELECT create_sale_order('${kh}',1,'[{"product_id":"${p1}","quantity":1,"unit_price":5000}]',gen_random_uuid())`);
  const before=await snapshot();await db.exec('RESET ROLE');await db.exec(migration);await db.exec(migration);
  assert.deepEqual(await snapshot(),before);await login();
 });
 const payment={status:'partial',name:'Awa Test',phone:'+221771234567',paid:2000,mode:'wave',date:today,due:today};
 const items=[{product_id:p1,quantity:2,unit_price:5000}];
 const order=async(p=payment,id=randomUUID(),customer=1)=>(await scalar('SELECT create_sale_with_payment($1,$5,$2,$3,$4) id',[kh,JSON.stringify(items),id,JSON.stringify(p),customer])).id;
 let sale,account,first;
 await t.test('vente 10 000, avance 2 000 ; stock déduit une fois et réessai identique',async()=>{
  const id=randomUUID();sale=await order(payment,id);assert.equal(await order(payment,id),sale);
  await assert.rejects(order({...payment,paid:3000},id));
  account=(await scalar('SELECT * FROM sale_payment_accounts WHERE sale_id=$1',[sale])).id;
  first=await scalar('SELECT * FROM sale_payment_entries WHERE account_id=$1',[account]);
  assert.equal(Number(first.amount),2000);assert.equal(Number(first.remaining_after),8000);
  assert.equal(Number((await scalar('SELECT stock_quantite n FROM produits WHERE id=$1',[p1])).n),17);
  assert.equal(Number((await scalar('SELECT paid_amount FROM factures WHERE sale_id=$1',[sale])).paid_amount),2000);
 });
 const pay=async(amount,id=randomUUID(),shop=kh,method='especes')=>(await scalar('SELECT add_sale_payment($1,$2,$3,$4,$5,null,$6) id',[shop,account,amount,method,today,id])).id;
 await t.test('nouveaux versements et reçus figés ; double clic ne double pas le paiement',async()=>{
  const id=randomUUID();const second=await pay(3000,id);assert.equal(await pay(3000,id),second);
  await assert.rejects(pay(3100,id));
  const e=await scalar('SELECT * FROM sale_payment_entries WHERE id=$1',[second]);
  assert.equal(Number(e.paid_after),5000);assert.equal(Number(e.remaining_after),5000);
  assert.deepEqual(await scalar('SELECT * FROM sale_payment_entries WHERE id=$1',[first.id]),first);
  await assert.rejects(pay(5000.01));await assert.rejects(pay(0));await assert.rejects(pay(-1));await assert.rejects(pay(0.001));
  await assert.rejects(pay(1,randomUUID(),ad));
 });
 await t.test('solde intégral, aucun surpaiement, historique non modifiable',async()=>{
  await pay(5000);await assert.rejects(pay(1));
  assert.equal(Number((await scalar('SELECT paid_amount FROM factures WHERE sale_id=$1',[sale])).paid_amount),10000);
  assert.equal((await scalar('SELECT next_due_date FROM sale_payment_accounts WHERE id=$1',[account])).next_due_date,null);
  assert.equal(Number((await scalar('SELECT count(*) n FROM sale_payment_entries WHERE account_id=$1',[account])).n),3);
  await assert.rejects(db.exec(`UPDATE sale_payment_entries SET amount=1 WHERE id='${first.id}'`));
  await assert.rejects(db.exec(`DELETE FROM sale_payment_entries WHERE id='${first.id}'`));
  await assert.rejects(db.exec(`UPDATE sale_payment_accounts SET total_amount=0 WHERE id='${account}'`));
  await db.exec('RESET ROLE');await assert.rejects(db.exec(`UPDATE sale_payment_entries SET amount=1 WHERE id='${first.id}'`));await login();
 });
 await t.test('annulation avec versements refusée et stocks préservés',async()=>{
  const stock=await scalar('SELECT stock_quantite FROM produits WHERE id=$1',[p1]);
  await assert.rejects(db.exec(`SELECT supprimer_vente_admin('${kh}','${sale}')`));
  assert.deepEqual(await scalar('SELECT stock_quantite FROM produits WHERE id=$1',[p1]),stock);
 });
 await t.test('sans avance, payé intégralement et échec atomique',async()=>{
  const zero=await order({...payment,paid:0});
  assert.equal(Number((await scalar('SELECT paid_amount FROM factures WHERE sale_id=$1',[zero])).paid_amount),0);
  await db.exec(`SELECT supprimer_vente_admin('${kh}','${zero}')`);
  const full=await order({...payment,status:'full'});
  assert.equal(Number((await scalar('SELECT paid_amount FROM factures WHERE sale_id=$1',[full])).paid_amount),10000);
  const before=await snapshot();await assert.rejects(order({...payment,paid:10001}));await assert.rejects(order({...payment,name:'',phone:''},randomUUID(),null));
  assert.deepEqual(await snapshot(),before);
 });
 await t.test('réexécution avec historique sans perte',async()=>{
  const before=await snapshot(),history=(await db.query('SELECT * FROM sale_payment_entries ORDER BY id')).rows;
  await db.exec('RESET ROLE');await db.exec(migration);assert.deepEqual(await snapshot(),before);
  assert.deepEqual((await db.query('SELECT * FROM sale_payment_entries ORDER BY id')).rows,history);await login();
 });
 await t.test('paiement en retard : échéance conservée et personnel de la boutique autorisé',async()=>{
  const yesterday=(await scalar("SELECT ((now() AT TIME ZONE 'Africa/Dakar')::date-1)::text d")).d;
  const overdue=await order({...payment,paid:0,date:yesterday,due:yesterday});
  const a=(await scalar('SELECT id FROM sale_payment_accounts WHERE sale_id=$1',[overdue])).id;
  const staff='10000000-0000-4000-8000-000000000008';await db.exec(`RESET ROLE; INSERT INTO auth.users VALUES('${staff}'); INSERT INTO profiles(id,nom_complet,role) VALUES('${staff}','Personnel Khady','vendeuse'); INSERT INTO profile_shops VALUES('${staff}','${kh}');`);
  await login(staff);
  await scalar('SELECT add_sale_payment($1,$2,500,\'wave\',$3,$4,$5)',[kh,a,today,yesterday,randomUUID()]);
  assert.equal((await scalar('SELECT next_due_date::text d FROM sale_payment_accounts WHERE id=$1',[a])).d,yesterday);
  await assert.rejects(scalar('SELECT add_sale_payment($1,$2,500,\'wave\',$3,null,$4)',[kh,a,'2099-01-01',randomUUID()]));
  await login();
 });
 await t.test('RLS : personnel autre boutique, anonyme et compte désactivé',async()=>{
  const staff='10000000-0000-4000-8000-000000000009';await db.exec(`RESET ROLE; INSERT INTO auth.users VALUES('${staff}'); INSERT INTO profiles(id,nom_complet,role) VALUES('${staff}','Personnel Adama','vendeuse'); INSERT INTO profile_shops VALUES('${staff}','${ad}');`);
  await login(staff);assert.equal(Number((await scalar('SELECT count(*) n FROM sale_payment_accounts')).n),0);
  assert.equal(Number((await scalar('SELECT count(*) n FROM sale_payment_entries')).n),0);
  await assert.rejects(pay(1));await assert.rejects(order());
  await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(db.exec('SELECT * FROM sale_payment_entries'));await assert.rejects(pay(1));
  await db.exec(`RESET ROLE; UPDATE profiles SET active=false WHERE id='${admin}'`);await login();await assert.rejects(order());
 });
 }finally{await db.close();}
});
