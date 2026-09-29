/* Calculs purs partagés par l'interface, les rapports et les tests. */
(function(root) {
    function paymentBalances(data,today) {
        const active=new Set(data.sales.filter(s=>!s.cancelled_at).map(s=>s.id));
        const soonDate=new Date(today+'T12:00:00Z');soonDate.setUTCDate(soonDate.getUTCDate()+7);
        const horizon=soonDate.toISOString().slice(0,10);
        return (data.paymentAccounts||[]).filter(a=>active.has(a.sale_id)).map(a=>{
            const entries=(data.paymentEntries||[]).filter(e=>e.account_id===a.id&&e.shop_id===a.shop_id)
                .map(e=>({...e,paid_on:String(e.paid_on).slice(0,10)})).sort((a,b)=>a.sequence-b.sequence);
            const paid=Math.round(entries.reduce((s,e)=>s+Number(e.amount),0)*100)/100;
            const remaining=Math.max(0,Math.round((Number(a.total_amount)-paid)*100)/100);
            const due=a.next_due_date?String(a.next_due_date).slice(0,10):null;
            const status=remaining===0?'paid':due&&due<today?'late':'open';
            return {...a,initial_date:String(a.initial_date||'').slice(0,10),next_due_date:due,entries,paid,remaining,status,soon:remaining>0&&!!due&&due>=today&&due<=horizon};
        });
    }
    function unitTotals(rows,key) {
        const totals={};
        for(const r of rows){const u=r.unit||'piece';totals[u]=Math.round(((totals[u]||0)+Number(typeof key==='function'?key(r):r[key]||0))*100)/100;}
        return totals;
    }
    function summarize(data, shopId = null, month = '') {
        const scoped = rows => rows.filter(row => !shopId || row.shop_id === shopId);
        const dated = (rows, key) => scoped(rows).filter(row => !month || String(row[key]).startsWith(month));
        const allSales = scoped(data.sales);
        const sales = dated(data.sales, 'date_vente').filter(row => !row.cancelled_at);
        const linked = new Set(data.reservations.map(row => row.sale_id).filter(Boolean));
        const sum = (rows, key) => rows.reduce((n, row) => n + Number(row[key] || 0), 0);
        const payments = dated(data.payments, 'created_at');
        const remittances = dated(data.versements, 'created_at');
        const invoices = new Map(data.factures.map(row => [row.sale_id, row]));
        let profit = 0, unknownCosts = 0;
        for (const sale of sales) {
            const invoice = invoices.get(sale.id);
            const items = invoice?.items?.length ? invoice.items : [{purchase_price:invoice?.purchase_price,quantity:sale.quantite}];
            if (items.some(l=>l.purchase_price == null)) unknownCosts++;
            else profit += Number(sale.montant_total) - items.reduce((n,l)=>n+Number(l.purchase_price)*Number(l.quantity),0);
        }
        const tracked=new Set((data.paymentAccounts||[]).map(a=>a.sale_id));
        const activeAccountIds=new Set((data.paymentAccounts||[]).filter(a=>allSales.some(s=>s.id===a.sale_id&&!s.cancelled_at)).map(a=>a.id));
        const saleReceipts=dated(data.paymentEntries||[],'paid_on').filter(e=>activeAccountIds.has(e.account_id));
        const receipts = sum(sales.filter(row => !linked.has(row.id)&&!tracked.has(row.id)), 'montant_total') + sum(payments, 'amount')+sum(saleReceipts,'amount');
        const stock = scoped(data.products);
        const sold=sales.flatMap(s=>invoices.get(s.id)?.items||[{quantity:s.quantite,unit:'piece'}]);
        return {
            stockByUnit:unitTotals(stock,'stock_quantite'),
            availableByUnit:unitTotals(stock,p=>Number(p.stock_quantite)-Number(p.reserved_quantity||0)),
            soldByUnit:unitTotals(sold,'quantity'),
            revenue: sum(sales, 'montant_total'), salesCount: sales.length,
            receipts, remittances: sum(remittances, 'amount'),
            toRemit: receipts - sum(remittances, 'amount'), profit, unknownCosts,
            stock: sum(stock, 'stock_quantite'),
            available: stock.reduce((n,p) => n + Number(p.stock_quantite) - Number(p.reserved_quantity || 0), 0),
            alerts: stock.filter(p => Number(p.stock_quantite) - Number(p.reserved_quantity || 0) <= 2),
            customerDebt: sum(scoped(data.reservations).filter(r => r.status === 'en_cours'), 'remaining_amount'),
            cancellations: allSales.filter(s => s.cancelled_at && (!month || s.cancelled_at.startsWith(month))).length
        };
    }
    function dailyRevenue(rows, shopId, month) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
        const [year,number] = month.split('-').map(Number);
        const days = new Date(Date.UTC(year,number,0)).getUTCDate();
        const totals = Array.from({length:days},(_,i)=>({day:i+1,revenue:0}));
        for (const row of rows) {
            if (row.cancelled_at || (shopId && row.shop_id !== shopId)) continue;
            const date = String(row.date_vente || '');
            if (!date.startsWith(month+'-')) continue;
            const index = Number(date.slice(8,10))-1;
            if (totals[index]) totals[index].revenue += Number(row.montant_total || 0);
        }
        return totals;
    }
    const api = {summarize,dailyRevenue,unitTotals,paymentBalances};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ShopMetrics = api;
})(typeof window !== 'undefined' ? window : globalThis);
