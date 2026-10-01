const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const {setup,kh,ad,admin,p1}=require('./payment-fixture.cjs');const {randomUUID}=require('node:crypto');
test('périodes : clôture, snapshots, stock, règlement ultérieur, sécurité et reprise',async()=>{
 const db=new PGlite();try{
 await setup(db);await db.exec('RESET ROLE');
 for(const file of ['migration-paiements-en-cours.sql','migration-suivi-caisse.sql','migration-periodes-mensuelles.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
 const q=async(s,p=[])=>(await db.query(s,p)).rows[0];
 const month=(await q("select active_month::text m from shop_activity_periods where shop_id=$1",[kh])).m;
 const today=(await q("select (now() at time zone 'Africa/Dakar')::date::text d")).d;
 await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${admin}',false)`);
 const sale=async(paid)=> (await q('select create_period_sale($1,null,$2,$3,$4,\'whatsapp\') id',[kh,JSON.stringify([{product_id:p1,quantity:1,unit_price:5000}]),randomUUID(),JSON.stringify({status:paid===5000?'full':'partial',paid,name:'Test',phone:'770000000',mode:'wave',date:today})])).id;
 const id=await sale(2000);
 const before=await q('select stock_quantite from produits where id=$1',[p1]);
 const closed=(await q('select close_activity_month($1,$2) x',[kh,month])).x;
 assert.equal(closed.snapshot.sales[0].sales_channel,'whatsapp');assert.equal(closed.snapshot.paymentEntries.length,1);
 assert.deepEqual((await q('select close_activity_month($1,$2) x',[kh,month])).x,closed);
 const nextId=await sale(5000);
 const newer=await q('select activity_month::text m from ventes where id=$1',[nextId]);assert.notEqual(newer.m,month);
 const account=(await q('select id from sale_payment_accounts where sale_id=$1',[id])).id;
 await q("select add_sale_payment($1,$2,3000,'especes',$3,null,$4)",[kh,account,today,randomUUID()]);
 assert.equal(Number((await q('select stock_quantite from produits where id=$1',[p1])).stock_quantite),Number(before.stock_quantite)-1);
 const last=await q('select activity_month::text m from sale_payment_entries where account_id=$1 order by sequence desc limit 1',[account]);assert.equal(last.m,newer.m);
 assert.deepEqual((await q('select snapshot from monthly_closures where shop_id=$1',[kh])).snapshot,closed.snapshot);
 await assert.rejects(db.exec(`DELETE FROM monthly_closures WHERE shop_id='${kh}'`));
 await db.exec('RESET ROLE');await assert.rejects(db.query('update ventes set cancelled_at=now() where id=$1',[id]));
 await db.exec(fs.readFileSync('supabase/migration-periodes-mensuelles.sql','utf8'));
 assert.equal((await q('select active_month::text m from shop_activity_periods where shop_id=$1',[kh])).m,newer.m);
 assert.equal((await q('select active_month::text m from shop_activity_periods where shop_id=$1',[ad])).m,month);
 await db.exec('SET ROLE anon');await assert.rejects(db.query('select close_activity_month($1,$2)',[kh,newer.m]));
 }finally{await db.close();}
});
