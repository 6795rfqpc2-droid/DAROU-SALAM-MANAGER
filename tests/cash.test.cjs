const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {randomUUID}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const {setup,kh,ad,admin,p1}=require('./payment-fixture.cjs');
test('caisse : trois flux, remises successives, conservation et sécurité',async t=>{
 const db=new PGlite();try{
 await setup(db);await db.exec('RESET ROLE');await db.exec(fs.readFileSync('supabase/migration-paiements-en-cours.sql','utf8'));
 const sql=fs.readFileSync('supabase/migration-suivi-caisse.sql','utf8');
 const one=async(q,p=[])=>(await db.query(q,p)).rows[0];
 const login=async()=>db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${admin}',false)`);
 const today=(await one("SELECT (now() AT TIME ZONE 'Africa/Dakar')::date::text d")).d;
 await t.test('migration répétée sans réécriture historique',async()=>{
  await login();await db.exec(`SELECT create_sale_order('${kh}',null,'[{"product_id":"${p1}","quantity":1,"unit_price":1000}]',gen_random_uuid()); SELECT record_versement('${kh}',1000,'Ancienne remise'); RESET ROLE;`);
  const sale=(await one('SELECT to_jsonb(v) j FROM ventes v')).j,remit=(await one('SELECT to_jsonb(v) j FROM versements v')).j;
  await db.exec(sql);await db.exec(sql);
  const afterSale=(await one("SELECT to_jsonb(v)-'cash_recorded_at' j FROM ventes v")).j;
  const afterRemit=(await one("SELECT to_jsonb(v)-ARRAY['request_id','cash_cutoff_at','receipts_total','remitted_before','balance_before','balance_after','recorded_by_name','covered_sale_ids'] j FROM versements v")).j;
  assert.deepEqual(afterSale,sale);assert.deepEqual(afterRemit,remit);await login();
 });
 const order=async(price,paid,method='especes')=>(await one('SELECT create_sale_with_payment($1,null,$2,$3,$4) id',[kh,JSON.stringify([{product_id:p1,quantity:1,unit_price:price}]),randomUUID(),JSON.stringify({status:paid===price?'full':'partial',paid,name:'Awa',phone:'771234567',mode:method,date:today,due:today})])).id;
 const remit=async(amount,id=randomUUID(),shop=kh)=>(await one('SELECT record_cash_remittance($1,$2,\'Remise test\',$3) id',[shop,amount,id])).id;
 let sale,account;
 await t.test('15 000 de vente, 5 000 encaissés : seule la somme encaissée est remise',async()=>{
  sale=await order(15000,5000,'wave');account=(await one('SELECT id FROM sale_payment_accounts WHERE sale_id=$1',[sale])).id;
  await assert.rejects(remit(15000));const req=randomUUID(),id=await remit(5000,req);assert.equal(await remit(5000,req),id);
  await assert.rejects(remit(5001,req));const row=await one('SELECT * FROM versements WHERE id=$1',[id]);
  assert.equal(Number(row.balance_before),5000);assert.equal(Number(row.balance_after),0);assert.ok(row.covered_sale_ids.includes(sale));
  assert.equal(row.recorded_by_name,'Administratrice test');assert.ok(row.cash_cutoff_at);
 });
 await t.test('4 000 sur ancienne facture : pas de vente ni stock supplémentaire, reste 6 000',async()=>{
  const before=await one('SELECT (SELECT count(*) FROM ventes) n,(SELECT stock_quantite FROM produits WHERE id=$1) stock',[p1]);
  await one('SELECT add_sale_payment($1,$2,4000,\'orange_money\',$3,null,$4)',[kh,account,today,randomUUID()]);
  assert.deepEqual(await one('SELECT (SELECT count(*) FROM ventes) n,(SELECT stock_quantite FROM produits WHERE id=$1) stock',[p1]),before);
  const entry=await one('SELECT * FROM sale_payment_entries WHERE account_id=$1 ORDER BY sequence DESC LIMIT 1',[account]);
  assert.equal(Number(entry.remaining_after),6000);assert.equal(Number(entry.amount)+Number(entry.remaining_after),10000);
  assert.equal(entry.recorded_by_name,'Administratrice test');assert.ok(entry.cash_recorded_at);
  const part=await remit(2000);assert.equal(Number((await one('SELECT balance_after FROM versements WHERE id=$1',[part])).balance_after),2000);
  await assert.rejects(remit(2001));await remit(2000);
 });
 await t.test('nouvelles ventes 7 000 + 15 000 + 10 000 + 20 000 : remise 52 000 puis zéro',async()=>{
  for(const [i,amount] of [7000,15000,10000,20000].entries())await order(amount,amount,['especes','wave','orange_money','especes'][i]);
  const id=await remit(52000),row=await one('SELECT * FROM versements WHERE id=$1',[id]);
  assert.equal(Number(row.balance_before),52000);assert.equal(Number(row.balance_after),0);
  await assert.rejects(remit(1));await assert.rejects(remit(-1));await assert.rejects(remit(0.001));
  await assert.rejects(db.exec(`UPDATE versements SET amount=1 WHERE id=${id}`));
 });
 await t.test('reprise après activité conserve les repères et refus anonyme',async()=>{
  const before=(await db.query('SELECT * FROM versements ORDER BY id')).rows;
  await db.exec('RESET ROLE');await db.exec(sql);assert.deepEqual((await db.query('SELECT * FROM versements ORDER BY id')).rows,before);
  await db.exec('SET ROLE anon');await assert.rejects(remit(1));await assert.rejects(db.exec(`SELECT shop_cash_receipts('${kh}')`));
 });
 }finally{await db.close();}
});
