/* L'unité est portée par le produit et figée sur les lignes/factures. */
let measuredUnitsReady=false;
function quantityNumber(value) {
    const text=String(value??'').trim();
    return /^\d+(?:[.,]\d{1,2})?$/.test(text)?Number(text.replace(',','.')):NaN;
}
function validQuantity(value,unit='piece',zero=false) {
    return Number.isFinite(value) && (value>0 || (zero && value===0))
        && Math.abs(value*100-Math.round(value*100))<0.000001 && (unit==='metre'||Number.isInteger(value));
}
function formatQuantity(value,unit='piece') {
    return formatNumber(value)+(unit==='metre'?' m':Number(value)===1?' pièce':' pièces');
}
function formatUnitGroups(groups) {
    return Object.entries(groups||{piece:0}).map(([u,q])=>formatQuantity(q,u)).join(' + ')||'0 pièce';
}
function quantityInput(input,unit) {
    if (!input) return;
    if(unit==='metre') {
        input.type='text';input.inputMode='decimal';input.pattern='[0-9]+([,.][0-9]{1,2})?';
        input.placeholder='Ex. 3,5'; input.removeAttribute('step');
    } else {
        input.type='number';input.step='1';input.removeAttribute('pattern');input.removeAttribute('placeholder');
    }
}
function configureProductUnit(product=null) {
    const select=document.getElementById('productUnit');
    select.value=product?.unit || (measuredUnitsReady && availableShops.find(s=>s.id===activeShopId)?.code==='ADF'?'metre':'piece');
    select.disabled=!measuredUnitsReady || !!product;
    document.getElementById('productUnitNote').textContent=product
        ? 'L’unité est conservée pour protéger le stock et l’historique de ce produit.'
        : measuredUnitsReady?'Les prix correspondent à une pièce ou à un mètre selon votre choix.':'La vente au mètre sera disponible après activation de la mise à jour.';
    updateProductUnitFields();
}
function updateProductUnitFields() {
    const metre=document.getElementById('productUnit').value==='metre';
    document.querySelector('label[for="productStock"]').textContent=metre?'Mètres disponibles *':'Quantité en stock *';
    document.querySelector('label[for="productPurchasePrice"]').textContent=metre?'Prix d’achat par mètre (F) *':'Prix d’achat par pièce (F) *';
    document.querySelector('label[for="productSellingPrice"]').textContent=metre?'Prix de vente par mètre (F) *':'Prix de vente par pièce (F) *';
    quantityInput(document.getElementById('productStock'),metre?'metre':'piece');
}
function updateOrderUnit(row,p) {
    const unit=p?.unit||'piece';const input=row.querySelector('[data-field="quantity"]');
    quantityInput(input,unit);input.min=unit==='metre'?'0.01':'1';
    row.querySelector(`label[for="${input.id}"]`).textContent=unit==='metre'?'Métrage (m)':'Quantité (pièces)';
    const price=row.querySelector('[data-field="price"]');
    row.querySelector(`label[for="${price.id}"]`).textContent=unit==='metre'?'Prix par mètre (F CFA)':'Prix unitaire (F CFA)';
}
document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('productUnit').addEventListener('change',updateProductUnitFields);
});
