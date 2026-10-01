const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const {setup,kh,ad,admin,p1}=require('./payment-fixture.cjs');
test('annuler novembre puis octobre sans toucher aux opérations, réessais et droits',async()=>{
 const db=new PGlite();try{
 await setup(db);await db.exec('RESET ROLE');for(const f of ['migration-paiements-en-cours.sql','migration-suivi-caisse.sql','migration-periodes-mensuelles.sql','migration-annulation-clotures.sql'])await db.exec(fs.readFileSync('supabase/'+f,'utf8'));
 const q=async(s,p=[])=>(await db.query(s,p)).rows[0];
 await db.exec(`UPDATE shop_activity_periods SET active_month='2026-10-01' WHERE shop_id='${kh}';SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${admin}',false)`);
 const oct=(await q("select close_activity_month($1,'2026-10-01') c",[kh])).c;
 const nov=(await q("select close_activity_month($1,'2026-11-01') c",[kh])).c;
 // Opération enregistrée en décembre : elle doit rester en décembre après réouverture.
 await q('select create_sale_order($1,null,$2,gen_random_uuid())',[kh,JSON.stringify([{product_id:p1,quantity:1,unit_price:1000}])]);
 const snapshot=async()=>{const r={};for(const t of ['ventes','produits','reservations','payments','sale_payment_accounts','sale_payment_entries','factures','versements'])r[t]=(await db.query(`select to_jsonb(x) row from ${t} x order by id`)).rows;return r;};
 const before=await snapshot();const other=await q('select active_month from shop_activity_periods where shop_id=$1',[ad]);
 const cancel=c=>q('select cancel_monthly_closure($1,$2,$3,$4)::text m',[kh,c.month,c.closed_at,'Erreur de clôture']);
 await assert.rejects(cancel(oct),/plus récente/);
 assert.equal((await cancel(nov)).m,'2026-11-01');assert.equal((await cancel(nov)).m,'2026-11-01');
 assert.equal((await cancel(oct)).m,'2026-10-01');assert.deepEqual(await snapshot(),before);
 assert.deepEqual(await q('select active_month from shop_activity_periods where shop_id=$1',[ad]),other);
 assert.equal(Number((await q('select count(*) n from cancelled_monthly_closures')).n),2);
 const newOct=(await q("select close_activity_month($1,'2026-10-01') c",[kh])).c;
 await cancel(oct);assert.equal(Number((await q('select count(*) n from monthly_closures')).n),1);
 const staff='10000000-0000-4000-8000-000000000088';await db.exec(`RESET ROLE; INSERT INTO auth.users VALUES('${staff}');INSERT INTO profiles(id,nom_complet,role) VALUES('${staff}','Personnel','vendeuse');INSERT INTO profile_shops VALUES('${staff}','${kh}');SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${staff}',false)`);
 await assert.rejects(cancel(newOct),/Administratrice/);
 await db.exec(`SELECT set_config('request.jwt.claim.sub','${admin}',false)`);await cancel(newOct);
 await db.exec('RESET ROLE');await db.exec(fs.readFileSync('supabase/migration-annulation-clotures.sql','utf8'));assert.deepEqual(await snapshot(),before);
 await db.exec('SET ROLE anon');await assert.rejects(cancel(newOct));
 }finally{await db.close();}
});
