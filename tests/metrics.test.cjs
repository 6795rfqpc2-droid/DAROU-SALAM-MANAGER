const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summarize,dailyRevenue}=require('../shops-core');
test('commande multi-produits : une vente, coûts de chaque article et annulation',()=>{
 const data={products:[],reservations:[],payments:[],versements:[],
  sales:[{id:'a',shop_id:'kh',montant_total:1950,quantite:1,date_vente:'2026-09-24'}],
  factures:[{sale_id:'a',items:[{quantity:2,purchase_price:200},{quantity:4,purchase_price:100}]}]};
 const m=summarize(data,'kh');
 assert.equal(m.salesCount,1);assert.equal(m.revenue,1950);assert.equal(m.receipts,1950);assert.equal(m.profit,1150);
 data.factures[0].items[1].purchase_price=null;
 assert.equal(summarize(data,'kh').unknownCosts,1);
 data.sales[0].cancelled_at='2026-09-25';
 assert.equal(summarize(data,'kh').revenue,0);assert.equal(summarize(data,'kh').receipts,0);
});
test('graphique quotidien : mois, boutique, jours vides et annulations',()=>{
 const rows=[{shop_id:'kh',date_vente:'2026-09-02',montant_total:500},
 {shop_id:'ad',date_vente:'2026-09-02',montant_total:300},
 {shop_id:'kh',date_vente:'2026-08-02',montant_total:100},
 {shop_id:'kh',date_vente:'2026-09-02',montant_total:50,cancelled_at:'2026-09-03'}];
 const daily=dailyRevenue(rows,'kh','2026-09');
 assert.equal(daily.length,30);assert.equal(daily[0].revenue,0);assert.equal(daily[1].revenue,500);
 assert.equal(dailyRevenue(rows,null,'2026-09')[1].revenue,800);
 assert.equal(dailyRevenue([],'kh','2028-02').length,29);
});
test('500 000 Khady et 300 000 Adama restent séparés',()=>{
 const data={products:[],reservations:[],payments:[],versements:[],factures:[],sales:[
  {id:'a',shop_id:'kh',montant_total:500000,date_vente:'2026-09-01'},
  {id:'b',shop_id:'ad',montant_total:300000,date_vente:'2026-09-02'}]};
 assert.equal(summarize(data,'kh').revenue,500000);
 assert.equal(summarize(data,'ad').revenue,300000);
 assert.equal(summarize(data,null).revenue,800000);
 assert.equal(summarize(data,'am').revenue,0);
});
test('réservation remise : encaissements non doublés, versements et mois distincts',()=>{
 const data={products:[],reservations:[{sale_id:'a',shop_id:'kh',status:'remis'}],
 payments:[{shop_id:'kh',amount:100,created_at:'2026-08-15'}, {shop_id:'kh',amount:400,created_at:'2026-09-01'}],
 versements:[{shop_id:'kh',amount:300,created_at:'2026-09-02'}],
 factures:[{sale_id:'a',purchase_price:200}],
 sales:[{id:'a',shop_id:'kh',montant_total:500,quantite:1,date_vente:'2026-09-01'}]};
 assert.equal(summarize(data,'kh').receipts,500);
 assert.equal(summarize(data,'kh','2026-09').receipts,400);
 assert.equal(summarize(data,'kh','2026-09').toRemit,100);
 assert.equal(summarize(data,'kh','2026-09').profit,300);
 assert.equal(summarize(data,'kh','2026-08').revenue,0);
});
test('coût inconnu non traité comme achat gratuit, ventes annulées exclues',()=>{
 const data={products:[],reservations:[],payments:[],versements:[],factures:[],sales:[
  {id:'a',shop_id:'kh',montant_total:500,date_vente:'2026-09-01'},
  {id:'b',shop_id:'kh',montant_total:300,date_vente:'2026-09-01',cancelled_at:'2026-09-02'}]};
 assert.equal(summarize(data,'kh').revenue,500);
 assert.equal(summarize(data,'kh').unknownCosts,1);
});
