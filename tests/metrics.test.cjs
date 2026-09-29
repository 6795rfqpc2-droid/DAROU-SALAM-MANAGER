const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summarize,dailyRevenue}=require('../shops-core');
test('paiements : encaissements datés sans compter deux fois la vente, soldes et échéances',()=>{
 const data={products:[],reservations:[],payments:[],versements:[],factures:[],sales:[{id:'v',shop_id:'kh',montant_total:10000,date_vente:'2026-08-20'}],
  paymentAccounts:[{id:'a',sale_id:'v',shop_id:'kh',total_amount:10000,next_due_date:'2026-09-28'}],
  paymentEntries:[{account_id:'a',shop_id:'kh',sequence:1,amount:2000,paid_on:'2026-08-20'},
   {account_id:'a',shop_id:'kh',sequence:2,amount:3000,paid_on:'2026-09-01'}]};
 assert.equal(summarize(data,'kh').receipts,5000);
 assert.equal(summarize(data,'kh','2026-08').receipts,2000);
 assert.equal(summarize(data,'kh','2026-09').receipts,3000);
 assert.equal(summarize(data,'kh','2026-09').revenue,0);
 const balances=require('../shops-core').paymentBalances;
 assert.equal(balances(data,'2026-09-29')[0].status,'late');
 assert.equal(balances(data,'2026-09-29')[0].remaining,5000);
 assert.equal(balances(data,'2026-09-25')[0].soon,true);
 assert.equal(balances(data,'2026-09-28')[0].status,'open');
 data.paymentEntries.push({account_id:'a',shop_id:'kh',sequence:3,amount:5000,paid_on:'2026-09-29'});
 assert.equal(balances(data,'2026-09-29')[0].status,'paid');
 assert.equal(summarize(data,'ad').receipts,0);
 data.sales[0].cancelled_at='2026-09-29';assert.deepEqual(balances(data,'2026-09-29'),[]);
});
test('mètres et pièces : stocks séparés, chiffre d’affaires et coût décimaux',()=>{
 const data={products:[{shop_id:'ad',unit:'metre',stock_quantite:46.5,reserved_quantity:1.25},
  {shop_id:'ad',unit:'piece',stock_quantite:8,reserved_quantity:0}],reservations:[],payments:[],versements:[],
  sales:[{id:'m',shop_id:'ad',montant_total:8950,quantite:1,date_vente:'2026-09-29'}],
  factures:[{sale_id:'m',items:[{quantity:3.5,unit:'metre',purchase_price:1500},
   {quantity:2,unit:'piece',purchase_price:50}]}]};
 const m=summarize(data,'ad');
 assert.deepEqual(m.stockByUnit,{metre:46.5,piece:8});
 assert.deepEqual(m.availableByUnit,{metre:45.25,piece:8});
 assert.deepEqual(m.soldByUnit,{metre:3.5,piece:2});
 assert.equal(m.revenue,8950);assert.equal(m.profit,3600);
 data.sales[0].cancelled_at='2026-09-29';
 assert.deepEqual(summarize(data,'ad').soldByUnit,{});
});
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
