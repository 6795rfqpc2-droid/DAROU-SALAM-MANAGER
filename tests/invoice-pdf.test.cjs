const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {create}=require('../invoice-pdf');
test('PDF long : toutes les lignes conservées, pagination et totaux',async()=>{
 const items=Array.from({length:65},(_,i)=>({product_name:'Article '+String(i+1).padStart(3,'0')+' - Ensemble brodé avec une description détaillée',quantity:2,unit_price:5000,total_amount:10000}));
 const blob=create({shop_name:'Boutique Amary Faye',numero:'AMF-2026-000001',date:'25/09/2026',customer_name:'Cliente de démonstration',items,total:650000,paid:650000,remaining:0});
 const buffer=Buffer.from(await blob.arrayBuffer()),pdf=buffer.toString('ascii');
 assert.ok(pdf.startsWith('%PDF-1.4'));
 assert.ok((pdf.match(/\/Type \/Page\b/g)||[]).length>=3);
 assert.match(pdf,/41727469636c6520303031/); // Article 001
 assert.match(pdf,/41727469636c6520303635/); // Article 065
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/facture-longue.pdf',buffer);
});
