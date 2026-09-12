const shops=[{id:'kh',nom:'Boutique Khady Faye',code:'KHF',active:true},{id:'ad',nom:'Boutique Adama Faye',code:'ADF',active:true},{id:'am',nom:'Boutique Amary Faye',code:'AMF',active:true}];
function mockClient(role='admin'){
 const calls=[];
 const tables={shops:role==='admin'?shops:[shops[0]],profiles:[{id:'user',nom_complet:'Test',role,active:true}],
 categories:[{id:'cat',shop_id:'kh',nom:'Dialabès'}],customers:[],reservations:[],payments:[],versements:[],audit_logs:[],profile_shops:[],
 produits:[{id:'p1',shop_id:'kh',categorie_id:'cat',nom_modele:'Dialabè',prix:500,stock_quantite:10}, {id:'p2',shop_id:'ad',nom_modele:'Tissu',prix:300,stock_quantite:4}],
 ventes:[{id:'v1',shop_id:'kh',produit_id:'p1',quantite:1,prix_unitaire:500000,montant_total:500000,date_vente:'2026-09-01T00:00:00Z'},
 {id:'v2',shop_id:'ad',produit_id:'p2',quantite:1,prix_unitaire:300000,montant_total:300000,date_vente:'2026-09-01T00:00:00Z'}],
 factures:[{id:'f1',shop_id:'kh',sale_id:'v1',numero:'KHF-2026-000001',shop_name:'Boutique Khady Faye',product_name:'Dialabè',customer_name:'Client',quantity:1,unit_price:500000,total_amount:500000,issued_at:'2026-09-01T00:00:00Z',purchase_price:100000}]};
 return {calls,tables,auth:{getSession:async()=>({data:{session:{user:{id:'user',email:'test@example.test'}}}}),onAuthStateChange:()=>{},signOut:async()=>({})},
 from(table){let result=[...(tables[table]||[])], single=false;const call={table,filters:[]};calls.push(call);
 const b={select(){return b},eq(k,v){call.filters.push([k,v]);result=result.filter(r=>r[k]===v);return b},
 in(k,v){call.filters.push([k,v]);result=result.filter(r=>v.includes(r[k]));return b},order(){return b},
 range(a,z){result=result.slice(a,z+1);return b},limit(n){result=result.slice(0,n);return b},single(){single=true;return b},
 insert(rows){call.insert=rows;return b},update(row){call.update=row;return b},delete(){call.delete=true;return b},
 then(resolve,reject){return Promise.resolve({data:single?result[0]:result,error:null}).then(resolve,reject)}};return b},
 rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:null,error:null}}};
}

module.exports={mockClient,shops};
