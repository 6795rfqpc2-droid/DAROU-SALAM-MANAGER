/* Calculs purs partagés par l'interface, les rapports et les tests. */
(function(root) {
    const cents=n=>Math.round(Number(n||0)*100)/100;
    const monthOf=(row,key)=>String(row.activity_month||row[key]||'').slice(0,7);
    function receiptEvents(data) {
        const active=new Map(data.sales.filter(s=>!s.cancelled_at).map(s=>[s.id,s]));
        const tracked=new Set((data.paymentAccounts||[]).map(a=>a.sale_id));
        const linked=new Set(data.reservations.map(r=>r.sale_id).filter(Boolean));
        const accounts=new Map((data.paymentAccounts||[]).map(a=>[a.id,a]));
        const legacy=[...active.values()].filter(s=>!tracked.has(s.id)&&!linked.has(s.id)).map(s=>({
            activity_month:s.activity_month,id:'sale:'+s.id,shop_id:s.shop_id,sale_id:s.id,amount:Number(s.montant_total),date:String(s.date_vente).slice(0,10),
            recorded_at:s.cash_recorded_at||s.date_vente,kind:'sale',method:s.mode_paiement||'unknown'}));
        const entries=(data.paymentEntries||[]).flatMap(e=>{
            const a=accounts.get(e.account_id),sale=active.get(a?.sale_id);if(!a||!sale)return [];
            return [{...e,id:'entry:'+e.id,entry_id:e.id,sale_id:sale.id,date:String(e.paid_on).slice(0,10),
                recorded_at:e.cash_recorded_at||e.created_at,amount:Number(e.amount),
                kind:e.request_id&&e.request_id===sale.request_id?'sale':'debt'}];
        });
        const reservations=data.payments.map(p=>({...p,id:'reservation:'+p.id,amount:Number(p.amount),
            date:String(p.created_at).slice(0,10),recorded_at:p.cash_recorded_at||p.created_at,kind:'reservation',method:p.method||'unknown'}));
        return [...legacy,...entries,...reservations];
    }
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
        const dated = (rows, key) => scoped(rows).filter(row => !month || (month.length===7?monthOf(row,key)===month:String(row[key]).startsWith(month)));
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
        const events=scoped(receiptEvents(data)),periodEvents=events.filter(e=>!month||(month.length===7?monthOf(e,'date')===month:e.date.startsWith(month)));
        const receipts=cents(sum(periodEvents,'amount'));
        const salesReceipts=cents(sum(periodEvents.filter(e=>e.kind==='sale'),'amount'));
        const debtReceipts=cents(sum(periodEvents.filter(e=>e.kind==='debt'),'amount'));
        const reservationReceipts=cents(sum(periodEvents.filter(e=>e.kind==='reservation'),'amount'));
        const paymentModes={};for(const e of periodEvents)paymentModes[e.method]=cents((paymentModes[e.method]||0)+e.amount);
        const cumulativeReceipts=cents(sum(events.filter(e=>!month||(month.length===7?monthOf(e,'date'):e.date.slice(0,month.length))<=month),'amount'));
        const cumulativeRemittances=cents(sum(scoped(data.versements).filter(v=>!month||(month.length===7?monthOf(v,'created_at'):String(v.created_at).slice(0,month.length))<=month),'amount'));
        const debts=(data.paymentAccounts||[]).filter(a=>(!shopId||a.shop_id===shopId)&&allSales.some(s=>s.id===a.sale_id&&!s.cancelled_at))
            .reduce((total,a)=>total+Math.max(0,Number(a.total_amount)-(data.paymentEntries||[]).filter(e=>e.account_id===a.id).reduce((s,e)=>s+Number(e.amount),0)),0);
        const stock = scoped(data.products);
        const sold=sales.flatMap(s=>invoices.get(s.id)?.items||[{quantity:s.quantite,unit:'piece'}]);
        return {
            stockByUnit:unitTotals(stock,'stock_quantite'),
            availableByUnit:unitTotals(stock,p=>Number(p.stock_quantite)-Number(p.reserved_quantity||0)),
            soldByUnit:unitTotals(sold,'quantity'),
            revenue: sum(sales, 'montant_total'), salesCount: sales.length,
            receipts,salesReceipts,debtReceipts,reservationReceipts,paymentModes,cumulativeReceipts,cumulativeRemittances,
            remittances: sum(remittances, 'amount'),cashBalance:cents(cumulativeReceipts-cumulativeRemittances),
            toRemit: receipts - sum(remittances, 'amount'), profit, unknownCosts,
            stock: sum(stock, 'stock_quantite'),
            available: stock.reduce((n,p) => n + Number(p.stock_quantite) - Number(p.reserved_quantity || 0), 0),
            alerts: stock.filter(p => Number(p.stock_quantite) - Number(p.reserved_quantity || 0) <= 2),
            saleDebt:cents(debts),customerDebt:cents(debts+sum(scoped(data.reservations).filter(r => r.status === 'en_cours'), 'remaining_amount')),
            cancellations: allSales.filter(s => s.cancelled_at && (!month || s.cancelled_at.startsWith(month))).length
        };
    }
    function summarizeMonth(data,shopId,month){
        const m=summarize(data,shopId,month);
        const scoped=r=>!shopId||r.shop_id===shopId;
        const sales=data.sales.filter(s=>scoped(s)&&!s.cancelled_at&&monthOf(s,'date_vente')===month);
        const ids=new Set(sales.map(s=>s.id));
        const entries=(data.paymentEntries||[]).filter(e=>scoped(e)&&monthOf(e,'paid_on')<=month);
        m.saleDebt=cents((data.paymentAccounts||[]).filter(a=>scoped(a)&&ids.has(a.sale_id)).reduce((n,a)=>n+Math.max(0,Number(a.total_amount)-entries.filter(e=>e.account_id===a.id).reduce((v,e)=>v+Number(e.amount),0)),0));
        const reservations=data.reservations.filter(r=>scoped(r)&&monthOf(r,'created_at')===month&&r.status!=='annule');
        m.reservationDebt=cents(reservations.reduce((n,r)=>n+Math.max(0,Number(r.quantity)*Number(r.unit_price)-data.payments.filter(p=>scoped(p)&&p.reservation_id===r.id&&monthOf(p,'created_at')<=month).reduce((v,p)=>v+Number(p.amount),0)),0));
        m.customerDebt=cents(m.saleDebt+m.reservationDebt);m.reservationsCount=reservations.length;
        return m;
    }
    function dailyRevenue(rows, shopId, month) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
        const [year,number] = month.split('-').map(Number);
        const days = new Date(Date.UTC(year,number,0)).getUTCDate();
        const totals = Array.from({length:days},(_,i)=>({day:i+1,revenue:0}));
        for (const row of rows) {
            if (row.cancelled_at || (shopId && row.shop_id !== shopId)) continue;
            const date = String(row.date_vente || '');
            if (monthOf(row,'date_vente')!==month) continue;
            const index = Math.min(Number(date.slice(8,10)),days)-1;
            if (totals[index]) totals[index].revenue += Number(row.montant_total || 0);
        }
        return totals;
    }
    const api = {monthOf,summarizeMonth,summarize,dailyRevenue,unitTotals,paymentBalances,receiptEvents};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ShopMetrics = api;
})(typeof window !== 'undefined' ? window : globalThis);
