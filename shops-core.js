/* Calculs purs partagés par l'interface, les rapports et les tests. */
(function(root) {
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
            if (invoice?.purchase_price == null) unknownCosts++;
            else profit += Number(sale.montant_total) - Number(invoice.purchase_price) * Number(sale.quantite);
        }
        const receipts = sum(sales.filter(row => !linked.has(row.id)), 'montant_total') + sum(payments, 'amount');
        const stock = scoped(data.products);
        return {
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
    const api = {summarize,dailyRevenue};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ShopMetrics = api;
})(typeof window !== 'undefined' ? window : globalThis);
