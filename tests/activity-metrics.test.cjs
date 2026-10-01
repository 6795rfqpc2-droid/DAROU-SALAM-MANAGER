const {test}=require('node:test'),assert=require('node:assert/strict');const {summarize,dailyRevenue}=require('../shops-core');
test('activité : vente et paiements affectés au mois suivant malgré la date civile',()=>{
 const data={products:[],factures:[],reservations:[],versements:[],payments:[],sales:[{id:'s',shop_id:'kh',date_vente:'2026-09-30',activity_month:'2026-10-01',montant_total:5000,request_id:'r'}],paymentAccounts:[{id:'a',sale_id:'s',shop_id:'kh',total_amount:5000}],paymentEntries:[{id:'e',account_id:'a',shop_id:'kh',amount:2000,paid_on:'2026-09-30',activity_month:'2026-10-01',request_id:'r',method:'wave'}]};
 assert.equal(summarize(data,'kh','2026-09').revenue,0);assert.equal(summarize(data,'kh','2026-09').receipts,0);
 const oct=summarize(data,'kh','2026-10');assert.equal(oct.revenue,5000);assert.equal(oct.receipts,2000);assert.equal(oct.saleDebt,3000);
 assert.equal(dailyRevenue(data.sales,'kh','2026-10').reduce((n,d)=>n+d.revenue,0),5000);
});
