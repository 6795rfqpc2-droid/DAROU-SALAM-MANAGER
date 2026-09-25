/* PDF vectoriel autonome : aucune donnée client envoyée à un service externe. */
(function(root){
    const clean=s=>String(s??'').replace(/[’‘]/g,"'").replace(/[–—]/g,'-').replace(/[\u202f\u00a0]/g,' ').replace(/œ/g,'oe').replace(/Œ/g,'OE').replace(/€/g,'EUR');
    const hex=s=>Array.from(clean(s)).map(c=>(c.charCodeAt(0)<=255?c.charCodeAt(0):63).toString(16).padStart(2,'0')).join('');
    const width=(s,size)=>Array.from(clean(s)).reduce((n,c)=>n+(/[MW@%]/.test(c)?0.95:/[ilI.,:;' ]/.test(c)?0.3:0.62)*size,0);
    function wrap(s,max,size){
        const lines=[]; let line='';
        for(const c of clean(s)) {
            if(c==='\n' || width(line+c,size)>max) {lines.push(line); line=c==='\n'?'':c;}
            else line+=c;
        }
        lines.push(line);return lines;
    }
    function create(m){
        const pages=[]; let commands=[],y=0;
        const money=n=>Number(n).toLocaleString('fr-FR',{maximumFractionDigits:2})+' F CFA';
        const text=(s,x,top,size=10,bold=false,color='0.18 0.14 0.17')=>commands.push(`BT /${bold?'F2':'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x} ${842-top} Tm <${hex(s)}> Tj ET`);
        const rect=(x,top,w,h,color)=>commands.push(`${color} rg ${x} ${842-top-h} ${w} ${h} re f`);
        const rule=top=>rect(40,top,515,0.6,'0.89 0.86 0.87');
        function footer(){
            rule(800);text('DAROU SALAM MANAGER',40,818,8);text('Page '+(pages.length+1),500,818,8);
        }
        function pageStart(){
            commands=[];rect(0,0,595,10,'0.40 0.12 0.25');
            text('DAROU SALAM MANAGER',40,43,9,true,'0.55 0.26 0.37');
            y=72;
            for(const line of wrap(m.shop_name,505,21)){text(line,40,y,21,true);y+=25;}
            text('FACTURE',40,y+13,12,true);y+=33;
            for(const line of wrap(m.numero,505,10)){text(line,40,y,10);y+=14;}
            text('Date : '+m.date,40,y,10);y+=22;
            if(m.cancelled){text('VENTE ANNULÉE - document conservé',40,y,11,true,'0.65 0.10 0.18');y+=22;}
            rule(y); y+=22;
        }
        function nextPage(){footer();pages.push(commands.join('\n'));pageStart();}
        function ensure(height){if(y+height>780) nextPage();}
        function tableHead(){
            rect(40,y,515,27,'0.96 0.92 0.94');
            text('Produit',49,y+18,10,true);text('Qté',298,y+18,10,true);
            text('Prix unitaire',351,y+18,10,true);text('Total',467,y+18,10,true);y+=27;
        }
        pageStart();text('CLIENTE',40,y,9,true,'0.55 0.26 0.37');y+=18;
        for(const value of [m.customer_name,m.customer_phone,m.customer_address].filter(Boolean)) {
            for(const line of wrap(value,505,11)){ensure(16);text(line,40,y,11);y+=16;}
        }
        y+=18;ensure(60);tableHead();
        for(const item of m.items){
            const names=wrap(item.product_name,231,10), qty=wrap(item.quantity,42,9), unit=wrap(money(item.unit_price),104,9), total=wrap(money(item.total_amount),82,9);
            const count=Math.max(names.length,qty.length,unit.length,total.length);
            // Long descriptions may continue on the next page without clipping.
            for(let i=0;i<count;i++){
                if(y+30>780){nextPage();tableHead();}
                if(names[i]!=null)text(names[i],49,y+18,10);
                if(qty[i]!=null)text(qty[i],298,y+18,9);
                if(unit[i]!=null)text(unit[i],351,y+18,9);
                if(total[i]!=null)text(total[i],467,y+18,9,true);
                y+=16;
            }
            y+=13;rule(y);
        }
        y+=22;ensure(150);
        for(const [label,value,bold] of [['Total général',m.total,true],['Montant payé',m.paid,false],['Reste à payer',m.remaining,true]]){
            if(bold)rect(275,y-14,280,27,'0.96 0.92 0.94');
            text(label,286,y+4,11,bold);const amount=money(value);
            text(amount,545-width(amount,10),y+4,10,bold);y+=31;
        }
        y+=17;text('Merci pour votre confiance',40,y,13,true,'0.55 0.26 0.37');
        if(m.legacy){y+=19;text('Archive établie à partir des données disponibles.',40,y,9);}
        footer();pages.push(commands.join('\n'));
        const objects=['<< /Type /Catalog /Pages 2 0 R >>','',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
        const kids=[];
        for(const stream of pages){
            const page=objects.length+1;kids.push(page+' 0 R');
            objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${page+1} 0 R >>`);
            objects.push('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
        }
        objects[1]='<< /Type /Pages /Count '+pages.length+' /Kids ['+kids.join(' ')+'] >>';
        let pdf='%PDF-1.4\n',offsets=[0];
        objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});
        const xref=pdf.length;
        pdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
        pdf+='trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
        return new Blob([pdf],{type:'application/pdf'});
    }
    if(typeof module!=='undefined'&&module.exports)module.exports={create};
    else root.InvoicePdf={create};
})(typeof window!=='undefined'?window:globalThis);
