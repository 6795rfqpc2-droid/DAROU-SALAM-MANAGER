const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {create}=require('../report-pdf');
test('bilan professionnel : plusieurs pages, valeurs et lignes conservées',async()=>{
 const model={title:'BILAN MENSUEL',shop:'Boutique Khady Faye',period:'septembre 2026',generated:'30/09/2026 15:30',
  sections:[{title:'Activité et trésorerie',headers:['Indicateur','Montant / Nombre'],rows:[
   ['Ventes réalisées','67 000 F CFA'],['Nombre de ventes','5'],['Encaissé sur les nouvelles ventes','57 000 F CFA'],
   ['Versements clients sur anciennes factures','4 000 F CFA'],['Encaissements des réservations','0 F CFA'],
   ['Total réellement encaissé','61 000 F CFA'],['Créances clients restantes','6 000 F CFA'],
   ['Remis à l’administratrice','61 000 F CFA'],['Solde à remettre','0 F CFA'],['Marge estimée avant charges','Coûts historiques incomplets']]},
   {title:'Répartition des encaissements',headers:['Mode de paiement','Montant'],rows:[['Espèces','27 000 F CFA'],['Wave','20 000 F CFA'],['Orange Money','14 000 F CFA']]},
   {title:'Produits les plus vendus',headers:['Produit','Quantité','Ventes'],rows:[['Voile brodé','3 pièces','15 000 F CFA'],['Tissu de cérémonie','3,5 m','8 750 F CFA']]}],
  notes:['Un règlement de dette est un encaissement, jamais une nouvelle vente.','Les créances sont celles d’aujourd’hui. La marge est estimée avant charges.']};
 const bytes=Buffer.from(await create(model).arrayBuffer()),text=bytes.toString('ascii');
 assert.ok(text.startsWith('%PDF-1.4'));assert.match(text,/363120303030204620434641/);
 assert.ok((text.match(/\/Type \/Page\b/g)||[]).length>=2);
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/bilan-finance.pdf',bytes);
});
