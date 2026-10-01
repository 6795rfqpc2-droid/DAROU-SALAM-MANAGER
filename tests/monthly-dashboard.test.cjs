const {test}=require('node:test'),assert=require('node:assert/strict');const {summarizeMonth}=require('../shops-core');
test('tableau mensuel : zéro sans opérations et créances par cohorte de ventes',()=>{
 const data={products:[],reservations:[],payments:[],versements:[],factures:[{sale_id:'s',items:[{quantity:1,purchase_price:3000}]}],sales:[{id:'s',shop_id:'kh',montant_total:5000,date_vente:'2026-09-30',activity_month:'2026-09-01',quantite:1,request_id:'i'}],paymentAccounts:[{id:'a',shop_id:'kh',sale_id:'s',total_amount:5000}],paymentEntries:[{id:'e1',account_id:'a',shop_id:'kh',amount:2000,paid_on:'2026-09-30',activity_month:'2026-09-01',request_id:'i'}]};
 const sept=summarizeMonth(data,'kh','2026-09'),oct=summarizeMonth(data,'kh','2026-10');
 assert.equal(sept.revenue,5000);assert.equal(sept.profit,2000);assert.equal(sept.customerDebt,3000);
 for(const k of ['revenue','salesCount','receipts','profit','customerDebt'])assert.equal(oct[k],0);
 data.paymentEntries.push({id:'e2',account_id:'a',shop_id:'kh',amount:3000,paid_on:'2026-10-01',activity_month:'2026-10-01',request_id:'later'});
 assert.equal(summarizeMonth(data,'kh','2026-09').customerDebt,3000);
 const paid=summarizeMonth(data,'kh','2026-10');assert.equal(paid.receipts,3000);assert.equal(paid.revenue,0);assert.equal(paid.salesCount,0);
 assert.equal(summarizeMonth(data,'ad','2026-09').revenue,0);
});
