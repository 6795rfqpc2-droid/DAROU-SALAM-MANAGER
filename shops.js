/* Séparation explicite des requêtes. La sécurité reste imposée par les RLS/RPC. */
let availableShops = [];
let activeShopId = null;
let shopData = {products: [], sales: [], reservations: [], payments: [], versements: [], factures: []};
let shopReady = false;
let refreshPromise = null;
const shopRpcNames = new Set(['create_sale','create_sale_order','restock_product','create_reservation','add_payment',
    'mark_reservation_remis','cancel_reservation','supprimer_vente_admin','record_versement']);

function currentShopName() {
    return activeShopId ? availableShops.find(s => s.id === activeShopId)?.nom || 'Boutique' : 'Rapport global DAROU SALAM';
}
function requireSelectedShop() {
    if (!shopReady || !activeShopId) throw new Error('Choisissez une boutique pour effectuer cette opération.');
    return activeShopId;
}
function shopTable(table) {
    if (!shopReady) throw new Error('Les boutiques ne sont pas encore chargées.');
    const id = activeShopId;
    const base = () => supabaseClient.from(table);
    const scope = query => id ? query.eq('shop_id', id) : query.in('shop_id', availableShops.map(s => s.id));
    const write = () => {
        if (!id) throw new Error('Choisissez une boutique avant de modifier des données.');
    };
    return {
        select: (...args) => scope(base().select(...args)),
        insert: (rows, ...args) => {
            write();
            const attach = row => ({...row, shop_id: id});
            return base().insert(Array.isArray(rows) ? rows.map(attach) : attach(rows), ...args);
        },
        update: (row, ...args) => { write(); return scope(base().update({...row, shop_id: id}, ...args)); },
        delete: (...args) => { write(); return scope(base().delete(...args)); }
    };
}
function shopRpc(name, args = {}) {
    return supabaseClient.rpc(name, shopRpcNames.has(name) ? {...args, p_shop_id: requireSelectedShop()} : args);
}
async function allShopRows(table) {
    // Pages stables : aucune limite Supabase implicite de 1 000 lignes dans les totaux.
    let rows = [], offset = 0;
    const pageSize = 500;
    for (;;) {
        const {data, error} = await shopTable(table).select('*').order('id').range(offset, offset + pageSize - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < pageSize) return rows;
        offset += pageSize;
    }
}
async function initializeShops() {
    const {data, error} = await supabaseClient.from('shops').select('*').eq('active', true).order('code');
    if (error) throw new Error('La migration multi-boutiques doit être installée dans Supabase avant d’utiliser cette version. ' + error.message);
    availableShops = data || [];
    if (!availableShops.length) throw new Error('Aucune boutique autorisée. Contactez l’administratrice.');
    const saved = sessionStorage.getItem('shop:' + currentUser.id);
    activeShopId = saved === 'all' && isAdmin() ? null : availableShops.find(s => s.id === saved)?.id
        || availableShops.find(s => s.code === 'KHF')?.id || availableShops[0].id;
    shopReady = true;
    const selector = document.getElementById('shopSelector');
    selector.innerHTML = availableShops.map(s => `<option value="${s.id}">${escapeHtml(s.nom)}</option>`).join('')
        + (isAdmin() ? '<option value="all">Toutes les boutiques</option>' : '');
    selector.value = activeShopId || 'all';
    document.getElementById('shopContext').textContent = currentShopName();
    document.body.classList.toggle('global-shops', !activeShopId);
    selector.onchange = () => {
        sessionStorage.setItem('shop:' + currentUser.id, selector.value);
        // Un nouveau document empêche une ancienne réponse réseau de repeupler la boutique choisie.
        document.getElementById('app').inert = true;
        document.getElementById('shopContext').textContent = 'Chargement de la boutique…';
        location.reload();
    };
}

function hydrateShopData(raw, categoryRows, customerRows) {
    categories = categoryRows;
    customers = customerRows.map(normalizeCustomerRow);
    products = raw.products.map(p => normalizeProductRow({...p, categories: categories.find(c => c.id === p.categorie_id)}));
    const invoices = new Map(raw.factures.map(f => [f.sale_id, f]));
    sales = raw.sales.filter(s => !s.cancelled_at).sort((a,b) => b.date_vente.localeCompare(a.date_vente)).map(s => {
        const invoice = invoices.get(s.id);
        return normalizeSaleRow({...s,
            items: invoice?.items,
            quantity: invoice?.items?.reduce((n,l)=>n+Number(l.quantity),0) ?? s.quantite,
            unit_price: invoice?.items?.length===1 ? invoice.items[0].unit_price : s.prix_unitaire,
            products: invoice ? {name: invoice.product_name, purchase_price: invoice.purchase_price} : undefined,
            customers: invoice ? {full_name: invoice.customer_name} : undefined});
    });
    reservations = raw.reservations.map(r => ({...r,
        products: products.find(p => p.id === r.product_id), customers: customers.find(c => c.id === r.customer_id)}));
    shopData = raw;
}
async function attachProductPhotos(rows) {
    const paths = [...new Set(rows.map(p => p.photo_path).filter(Boolean))];
    if (!paths.length) return rows;
    const links = new Map();
    // Petits lots pour éviter une requête démesurée sur un catalogue important.
    for (let i=0; i<paths.length; i+=100) {
        const {data,error} = await supabaseClient.storage.from('product-photos').createSignedUrls(paths.slice(i,i+100),3600);
        if (error) {showToast('Photos indisponibles : '+friendlyError(error)); continue;}
        for (const item of data || []) if (!item.error && item.signedUrl) links.set(item.path,item.signedUrl);
    }
    return rows.map(p => p.photo_path ? {...p,photo_url:links.get(p.photo_path)||null} : p);
}
refreshAll = async function() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
        const app = document.getElementById('app');
        const status = document.getElementById('shopLoadStatus');
        app.inert = true;
        status.textContent = 'Chargement des données…';
        status.hidden = false;
        try {
            const [categoryRows, customerRows, productRows, saleRows, reservationRows, payments, versements, factures] = await Promise.all([
                allShopRows('categories'), allShopRows('customers'), allShopRows('produits'), allShopRows('ventes'),
                allShopRows('reservations'), allShopRows('payments'), allShopRows('versements'), allShopRows('factures')]);
            const withPhotos = await attachProductPhotos(productRows);
            hydrateShopData({products: withPhotos, sales: saleRows, reservations: reservationRows, payments, versements, factures}, categoryRows, customerRows);
            renderCategories(); populateCategorySelects(); populateProductSelects(); populateCustomerSelects();
            renderDashboard(); renderProducts(); renderCustomers(); renderStock(); renderSalesHistory();
            renderPayments(); renderStatistics(); updateUserInterface(); renderShopReports();
            if (isAdmin()) {
                await loadAuditLogs();
                if (document.getElementById('staffPage').classList.contains('active')) await renderStaffAccess();
            }
            if (!document.querySelector('.page.active')) showPage('dashboard');
            status.hidden = true;
        } catch (error) {
            // Pas de résultats partiels ou de chiffres périmés présentés comme actuels.
            categories = []; products = []; customers = []; sales = []; reservations = [];
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            status.textContent = 'Données indisponibles : ' + friendlyError(error) + ' Utilisez Actualiser pour réessayer.';
            showToast(status.textContent);
            throw error;
        } finally { app.inert = false; }
    })();
    try { await refreshPromise; } finally { refreshPromise = null; }
};
// Les rafraîchissements après écriture rechargent aussi les factures et les totaux associés.
loadCategories = loadProducts = loadCustomers = loadSales = loadReservations = refreshAll;

const originalShowPage = showPage;
showPage = function(name) {
    if (!activeShopId && ['sales','products','customers','payments','stock','history','settings'].includes(name)) {
        showToast('Sélectionnez une boutique pour ouvrir cette page.');
        name = 'dashboard';
    }
    originalShowPage(name);
    const titles = {reports: 'Bilan mensuel', remittances: 'Versements', invoices: 'Factures', statistics: 'Statistiques'};
    if (titles[name]) document.getElementById('pageTitle').textContent = titles[name];
};
const originalShowLogin = showLogin;
showLogin = function() {
    shopReady = false;
    availableShops = []; activeShopId = null;
    categories = []; products = []; customers = []; sales = []; reservations = [];
    shopData = {products: [], sales: [], reservations: [], payments: [], versements: [], factures: []};
    originalShowLogin();
};
const originalRenderStatistics = renderStatistics;
renderStatistics = function() {
    originalRenderStatistics();
    const metrics = ShopMetrics.summarize(shopData, activeShopId);
    const target = document.getElementById('statisticsProfit');
    if (target) target.textContent = metrics.unknownCosts ? 'Coûts incomplets' : formatMoney(metrics.profit);
    renderStatisticsChart();
};
function renderStatisticsChart() {
    const input=document.getElementById('statisticsMonth');
    if (!input.value) input.value=new Date().toISOString().slice(0,7);
    const days=ShopMetrics.dailyRevenue(shopData.sales,activeShopId,input.value);
    const max=Math.max(1,...days.map(d=>d.revenue));
    const step=700/days.length;
    const ceiling=Math.ceil(max/5)*5;
    const y=value=>225-value/ceiling*180;
    const grid=Array.from({length:5},(_,i)=>{
        const amount=ceiling*i/4, height=y(amount);
        return `<line x1="110" y1="${height}" x2="810" y2="${height}" stroke="#eadfe5"/><text x="98" y="${height+4}" text-anchor="end">${formatNumber(amount)}</text>`;
    }).join('');
    const bars=days.map((d,i)=>{
        const x=110+i*step+step*0.15, width=step*0.7;
        return `<rect x="${x}" y="${y(d.revenue)}" width="${width}" height="${225-y(d.revenue)}" rx="3" fill="#c85b86"><title>${d.day}/${input.value.slice(5)} : ${formatMoney(d.revenue)}</title></rect>
            <text x="${x+width/2}" y="246" text-anchor="middle">${d.day}</text>`;
    }).join('');
    document.getElementById('statisticsChartContext').textContent=currentShopName()+' — '+input.value;
    document.getElementById('statisticsChart').innerHTML=`<svg viewBox="0 0 840 270" role="img" aria-label="Chiffre d’affaires quotidien en F CFA pour ${escapeHtml(currentShopName())}, ${input.value}"><text x="110" y="24">Montant (F CFA)</text>${grid}${bars}</svg>`;
    const total=days.reduce((n,d)=>n+d.revenue,0);
    document.getElementById('statisticsChartSummary').textContent=total>0
        ? 'Total du mois : '+formatMoney(total)+'. Chaque barre représente un jour. Ventes annulées exclues.'
        : 'Aucune vente non nulle enregistrée pour ce mois. Le graphique se remplira après les ventes ; ajouter un produit ne crée pas de chiffre d’affaires.';
    document.getElementById('statisticsComparison').innerHTML=!activeShopId
        ? '<h3>Chiffre d’affaires par boutique — '+input.value+'</h3>'+comparisonHtml(input.value) : '';
}
renderTopProducts = function() {
    const totals = new Map();
    for (const order of sales) for (const sale of order.items?.length ? order.items.map(l=>({shop_id:order.shop_id,product_id:l.product_id,quantity:l.quantity,products:{name:l.product_name}})) : [order]) {
        const key = sale.shop_id + ':' + sale.product_id;
        const row = totals.get(key) || {name: sale.products?.name || 'Produit', shop_id: sale.shop_id, quantity: 0};
        row.quantity += Number(sale.quantity);
        totals.set(key, row);
    }
    document.getElementById('topProducts').innerHTML = [...totals.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,10)
        .map(row=>`<div class="list-item"><strong>${escapeHtml(row.name)}${!activeShopId ? ' — '+escapeHtml(availableShops.find(s=>s.id===row.shop_id)?.nom) : ''}</strong><span>${formatNumber(row.quantity)} vendu(s)</span></div>`).join('') || '<p>Aucune vente.</p>';
};

function metricsCards(m) {
    const cards = [
        ['Chiffre d’affaires', formatMoney(m.revenue)], ['Ventes', formatNumber(m.salesCount)],
        ['Encaissements clients', formatMoney(m.receipts)], ['Versements', formatMoney(m.remittances)],
        ['Reste à verser', formatMoney(m.toRemit)],
        ['Bénéfice estimé', m.unknownCosts ? 'Coûts incomplets' : formatMoney(m.profit)],
        ['Stock actuel', formatNumber(m.stock)], ['Stock disponible', formatNumber(m.available)]
    ];
    return cards.map(([label,value]) => `<div class="shop-metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
}
function comparisonHtml(month = '') {
    const rows = availableShops.filter(s => !activeShopId || s.id === activeShopId).map(s => ({s,m:ShopMetrics.summarize(shopData,s.id,month)}));
    const max = Math.max(1, ...rows.map(r => r.m.revenue));
    return rows.map(({s,m}) => `<div class="shop-comparison"><div><strong>${escapeHtml(s.nom)}</strong><span>${formatMoney(m.revenue)}</span></div>
        <div class="shop-bar" role="img" aria-label="${escapeHtml(s.nom)} : ${formatMoney(m.revenue)}"><span style="width:${m.revenue/max*100}%"></span></div></div>`).join('');
}
function renderShopReports() {
    const metrics = ShopMetrics.summarize(shopData, activeShopId);
    document.getElementById('shopOverview').innerHTML = `<h2>${escapeHtml(currentShopName())}</h2>
        <div class="shop-metrics">${metricsCards(metrics)}</div><h3>Chiffre d’affaires par boutique</h3>${comparisonHtml()}
        <h3>Alertes de stock par boutique</h3>${metrics.alerts.length ? '<ul>' + metrics.alerts.map(p => `<li>${escapeHtml(availableShops.find(s=>s.id===p.shop_id)?.nom)} — ${escapeHtml(p.nom_modele)} : ${Number(p.stock_quantite)-Number(p.reserved_quantity)} disponible(s)</li>`).join('') + '</ul>' : '<p>Aucune alerte.</p>'}
        <p class="shop-note">Les versements sont les remises à l’administratrice. Les encaissements comprennent les avances clients sans compter deux fois les réservations remises. Un solde négatif indique des versements supérieurs aux encaissements enregistrés.</p>`;
    renderMonthlyReport(); renderRemittances(); renderInvoices();
}
function reportMonth() {
    const input = document.getElementById('reportMonth');
    if (!input.value) input.value = new Date().toISOString().slice(0,7);
    return input.value;
}
function renderMonthlyReport() {
    const month = reportMonth();
    const m = ShopMetrics.summarize(shopData, activeShopId, month);
    document.getElementById('monthlyReport').innerHTML = `<h2>${escapeHtml(currentShopName())}</h2><p>Bilan de ${escapeHtml(month)} — F CFA</p>
        <div class="shop-metrics">${metricsCards(m)}</div><h3>Comparaison des boutiques</h3>${comparisonHtml(month)}
        <p class="shop-note">Le stock et les créances sont ceux d’aujourd’hui. Les ventes annulées sont exclues selon leur état actuel. Le reste à verser correspond aux flux du mois, hors solde antérieur. ${m.unknownCosts ? `${m.unknownCosts} vente(s) sans coût d’achat historique : bénéfice total non déterminable.` : 'Bénéfice estimé avant charges.'}</p>`;
}
function renderRemittances() {
    document.getElementById('remittanceForm').hidden = !activeShopId;
    document.getElementById('remittanceList').innerHTML = shopData.versements.length ? `<div class="table-container"><table><thead><tr><th>Date</th><th>Boutique</th><th>Montant</th><th>Note</th></tr></thead><tbody>${[...shopData.versements].reverse().map(v=>`<tr><td>${formatDate(v.created_at)}</td><td>${escapeHtml(availableShops.find(s=>s.id===v.shop_id)?.nom)}</td><td>${formatMoney(v.amount)}</td><td>${escapeHtml(v.note)}</td></tr>`).join('')}</tbody></table></div>` : '<p>Aucun versement enregistré.</p>';
}
function renderInvoices() {
    document.getElementById('invoiceList').innerHTML = shopData.factures.length ? `<div class="table-container"><table><thead><tr><th>Numéro</th><th>Boutique</th><th>Date</th><th>Montant</th><th>Document</th></tr></thead><tbody>${[...shopData.factures].sort((a,b)=>b.issued_at.localeCompare(a.issued_at)).map(f=>`<tr><td>${escapeHtml(f.numero)}${shopData.sales.find(s=>s.id===f.sale_id)?.cancelled_at ? ' — Annulée' : ''}</td><td>${escapeHtml(f.shop_name)}</td><td>${formatDateOnly(f.issued_at)}</td><td>${formatMoney(f.total_amount)}</td><td><button class="btn-secondary" data-invoice="${f.id}">Afficher</button></td></tr>`).join('')}</tbody></table></div>` : '<p>Aucune facture pour cette boutique.</p>';
}
function invoiceLines(f) {
    return ['DAROU SALAM MANAGER', f.shop_name, 'Facture ' + f.numero, 'Date : ' + formatDateOnly(f.issued_at),
        'Client : ' + f.customer_name, 'Produit : ' + f.product_name, 'Quantité : ' + f.quantity,
        'Prix unitaire : ' + formatMoney(f.unit_price), 'Total : ' + formatMoney(f.total_amount),
        ...(shopData.sales.find(s=>s.id===f.sale_id)?.cancelled_at ? ['VENTE ANNULÉE — facture conservée'] : []),
        ...(f.legacy ? ['Archive créée lors de la migration à partir des données disponibles.'] : [])];
}
function reportLines() {
    const m=ShopMetrics.summarize(shopData,activeShopId,reportMonth());
    return ['DAROU SALAM MANAGER',currentShopName(),'Bilan mensuel : '+reportMonth(),
        'Chiffre d’affaires : '+formatMoney(m.revenue),'Nombre de ventes : '+m.salesCount,
        'Encaissements clients : '+formatMoney(m.receipts),'Versements : '+formatMoney(m.remittances),
        'Reste à verser du mois (hors solde antérieur) : '+formatMoney(m.toRemit),
        'Bénéfice estimé avant charges : '+(m.unknownCosts?'indéterminé — coûts historiques incomplets':formatMoney(m.profit)),
        'Stock actuel (pas le stock de clôture du mois) : '+m.stock,
        'Ventes annulées exclues selon leur état actuel.',
        ...availableShops.filter(s=>!activeShopId||s.id===activeShopId).map(s=>s.nom+' : '+formatMoney(ShopMetrics.summarize(shopData,s.id,reportMonth()).revenue))];
}
function printLines(lines) {
    document.getElementById('shopPrintArea').innerHTML = '<h1>'+escapeHtml(lines[0])+'</h1>'+lines.slice(1).map(x=>'<p>'+escapeHtml(x)+'</p>').join('');
    window.print();
}
function downloadPdf(lines, name) {
    // PDF autonome, police Helvetica WinAnsi. Pas de service externe ni de CDN.
    const ascii = text => text.replace(/[’‘]/g,"'").replace(/[–—]/g,'-').replace(/\u202f|\u00a0/g,' ');
    const hex = text => Array.from(ascii(text)).map(c=>(c.charCodeAt(0)<=255?c.charCodeAt(0):63).toString(16).padStart(2,'0')).join('');
    // Largeurs conservatrices en points pour Helvetica 12, y compris les mots longs.
    const width = c => 'MW@'.includes(c) ? 12 : /[ilI1.,:;' ]/.test(c) ? 4 : 8;
    const wrapped = lines.flatMap(line => {
        const result=[]; let current='', points=0;
        for (const c of ascii(line)) {
            if (points+width(c)>500) { result.push(current); current=''; points=0; }
            current+=c; points+=width(c);
        }
        result.push(current); return result;
    });
    const pages=[]; for(let i=0;i<wrapped.length;i+=42) pages.push(wrapped.slice(i,i+42));
    const objects=['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
    const kids=[];
    for(const page of pages) {
        const pageId=objects.length+1, streamId=pageId+1; kids.push(pageId+' 0 R');
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
        const stream='BT /F1 12 Tf 45 795 Td 17 TL\n'+page.map((line,i)=>(i?'T* ':'')+'<'+hex(line)+'> Tj').join('\n')+'\nET';
        objects.push('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
    }
    objects[1]='<< /Type /Pages /Count '+pages.length+' /Kids ['+kids.join(' ')+'] >>';
    let pdf='%PDF-1.4\n', offsets=[0];
    objects.forEach((obj,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
    const xref=pdf.length;
    pdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('');
    pdf+='trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
    const url=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'}));
    const a=document.createElement('a'); a.href=url; a.download=name+'.pdf'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function renderStaffAccess(expectedId = null) {
    if (!isAdmin()) return false;
    const container=document.getElementById('staffList');
    container.textContent = 'Chargement du personnel…';
    try {
    const [staffResult, membershipResult]=await Promise.all([
        supabaseClient.from('profiles').select('*').in('role',['personnel','vendeuse']).order('nom_complet'),
        supabaseClient.from('profile_shops').select('*')]);
    if (staffResult.error || membershipResult.error) {
        const error = staffResult.error || membershipResult.error;
        container.textContent = 'Impossible de charger ' + (staffResult.error ? 'les profils' : 'les accès aux boutiques')
            + ' : ' + friendlyError(error) + ' Le compte peut déjà exister. Ne le recréez pas.';
        return false;
    }
    container.innerHTML=staffResult.data.map(p=>`<div class="staff-item shop-staff"><strong>${escapeHtml(p.nom_complet)}</strong><span>${p.active?'Actif':'Désactivé'}</span>
        ${membershipResult.data.some(m=>m.profile_id===p.id) ? '' : '<p>Aucune boutique attribuée. Cochez les boutiques autorisées ci-dessous.</p>'}
        <fieldset data-staff="${p.id}"><legend>Boutiques autorisées</legend>${availableShops.map(s=>`<label><input type="checkbox" value="${s.id}" ${membershipResult.data.some(m=>m.profile_id===p.id&&m.shop_id===s.id)?'checked':''}> ${escapeHtml(s.nom)}</label>`).join('')}</fieldset>
        <button class="btn-primary" data-save-access="${p.id}">Enregistrer les accès</button>
        <button class="btn-secondary" data-staff-toggle="${p.id}" data-active="${p.active}">${p.active?'Désactiver':'Réactiver'}</button></div>`).join('')||'<p>Aucun personnel enregistré.</p>';
    if (expectedId && !staffResult.data.some(p => p.id === expectedId)) {
        const notice = document.createElement('p');
        notice.textContent = 'Le compte a été créé, mais son profil personnel n’est pas visible dans la liste. Il faut vérifier le profil et les droits de lecture dans Supabase. Ne recréez pas ce compte.';
        container.prepend(notice);
        return false;
    }
    return true;
    } catch (error) {
        container.textContent = 'Chargement du personnel interrompu : ' + friendlyError(error) + ' Réessayez avec Actualiser sans recréer le compte.';
        return false;
    }
}
document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('statisticsMonth').addEventListener('change',renderStatisticsChart);
    const month=document.getElementById('reportMonth'); month.value=new Date().toISOString().slice(0,7);
    month.addEventListener('change',renderMonthlyReport);
    document.getElementById('reportPdf').onclick=()=>downloadPdf(reportLines(),'bilan-'+reportMonth());
    document.getElementById('reportPrint').onclick=()=>printLines(reportLines());
    document.getElementById('remittanceForm').onsubmit=async event=>{
        event.preventDefault(); const button=event.target.querySelector('button'); button.disabled=true;
        try {
            const {error}=await shopRpc('record_versement',{p_amount:Number(document.getElementById('remittanceAmount').value),p_note:document.getElementById('remittanceNote').value.trim()});
            if(error) throw error; event.target.reset(); await refreshAll(); showToast('Versement enregistré.');
        } catch(error) {showToast(friendlyError(error));} finally {button.disabled=false;}
    };
    document.addEventListener('click',async event=>{
        const invoice=event.target.closest('[data-invoice]');
        if(invoice) {
            const f=shopData.factures.find(x=>x.id===invoice.dataset.invoice); if(!f)return;
            openInvoice(f); return;
        }
        const save=event.target.closest('[data-save-access]'), toggle=event.target.closest('[data-staff-toggle]');
        if(!save&&!toggle)return;
        const button=save||toggle; button.disabled=true;
        try {
            let result;
            if(save) {
                const ids=[...document.querySelectorAll(`fieldset[data-staff="${save.dataset.saveAccess}"] input:checked`)].map(x=>x.value);
                result=await supabaseClient.rpc('set_staff_shops',{p_profile_id:save.dataset.saveAccess,p_shop_ids:ids});
            } else result=await supabaseClient.from('profiles').update({active:toggle.dataset.active!=='true'}).eq('id',toggle.dataset.staffToggle);
            if(result.error)throw result.error; await renderStaffAccess(); showToast('Accès mis à jour.');
        } catch(error) {showToast(friendlyError(error));} finally {button.disabled=false;}
    });
});
