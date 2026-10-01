/* Bilan vectoriel autonome, avec tableaux paginés et logo intégré au fichier. */
(function(root){
    const clean=s=>String(s??'').replace(/[’‘]/g,"'").replace(/[–—]/g,'-').replace(/•/g,'·').replace(/[\u202f\u00a0]/g,' ').replace(/œ/g,'oe');
    const hex=s=>Array.from(clean(s),c=>(c.charCodeAt(0)<256?c.charCodeAt(0):63).toString(16).padStart(2,'0')).join('');
    const width=(s,size)=>Array.from(clean(s)).reduce((n,c)=>n+(/[MW@%]/.test(c)?0.95:/[ilI.,:;' ]/.test(c)?0.3:0.62)*size,0);
    function wrap(s,max,size){
        const result=[];for(const paragraph of clean(s).split('\n')){
            let line='';for(const word of paragraph.split(' ')){
                if(line&&width(line+' '+word,size)>max){result.push(line);line='';}
                for(const c of (line?' ':'')+word){if(width(line+c,size)>max){result.push(line);line='';}line+=c;}
            }result.push(line);
        }return result;
    }
    function create(m){
        const pages=[];let commands=[],y=0;
        const text=(s,x,top,size=10,bold=false,color='0.20 0.15 0.18')=>commands.push(`BT /${bold?'F2':'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x} ${842-top} Tm <${hex(s)}> Tj ET`);
        const rect=(x,top,w,h,color)=>commands.push(`${color} rg ${x} ${842-top-h} ${w} ${h} re f`);
        function footer(){rect(40,800,515,0.5,'0.86 0.80 0.83');text('DAROU SALAM BUSINESS • Bilan de gestion',40,817,8);text('Page '+(pages.length+1),502,817,8);}
        function start(){
            commands=[];rect(0,0,595,12,'0.40 0.12 0.25');
            if(m.logo){const k=Math.min(78/m.logo.width,60/m.logo.height),w=m.logo.width*k,h=m.logo.height*k;commands.push(`q ${w} 0 0 ${h} 40 ${842-32-h} cm /Logo Do Q`);}
            text('DAROU SALAM BUSINESS',m.logo?136:40,46,10,true,'0.5 0.2 0.32');
            text(m.title,m.logo?136:40,77,21,true);y=108;
            for(const line of wrap(m.shop,510,12)){text(line,40,y,12);y+=17;}
            text(m.period.toUpperCase(),40,y+8,12,true);y+=30;
            text('Édité le '+m.generated+' • Montants en F CFA',40,y,9);y+=26;
        }
        function next(){footer();pages.push(commands.join('\n'));start();}
        function ensure(height){if(y+height>778)next();}
        function tableHead(headers,widths){
            ensure(30);rect(40,y,515,25,'0.93 0.88 0.91');let x=48;
            headers.forEach((h,i)=>{text(h,x,y+16,9,true);x+=widths[i];});y+=25;
        }
        start();
        for(const section of m.sections){
            ensure(80);for(const line of wrap(section.title,510,12)){text(line,40,y,12,true,'0.45 0.17 0.29');y+=16;}y+=7;
            const widths=section.headers.length===3?[283,95,137]:[340,175];tableHead(section.headers,widths);
            const rows=section.rows.length?section.rows:[['Aucune donnée pour cette période.','']];
            for(let rowIndex=0;rowIndex<rows.length;rowIndex++){
                const lines=rows[rowIndex].map((s,i)=>wrap(s,widths[i]-16,10));const count=Math.max(...lines.map(a=>a.length));
                for(let i=0;i<count;i++){
                    if(y+25>778){next();tableHead(section.headers,widths);}
                    if(rowIndex%2===0)rect(40,y,515,17,'0.98 0.96 0.97');
                    let x=48;lines.forEach((parts,j)=>{if(parts[i]!=null)text(parts[i],x,y+13,10,j===lines.length-1);x+=widths[j];});y+=17;
                }
                y+=8;rect(40,y,515,0.4,'0.91 0.87 0.89');y+=5;
            }y+=23;
        }
        ensure(50);text('Notes de lecture',40,y,11,true);y+=20;
        for(const note of m.notes){for(const line of wrap(note,505,9)){ensure(14);text(line,40,y,9);y+=14;}y+=7;}
        footer();pages.push(commands.join('\n'));
        const objects=['<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
        if(m.logo)objects.push(`<< /Type /XObject /Subtype /Image /Width ${m.logo.width} /Height ${m.logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${m.logo.hex.length+1} >>\nstream\n${m.logo.hex}>\nendstream`);
        const kids=[];for(const stream of pages){const id=objects.length+1;kids.push(id+' 0 R');objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${m.logo?'/XObject << /Logo 5 0 R >>':''} >> /Contents ${id+1} 0 R >>`);objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);}
        objects[1]=`<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
        let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const xref=pdf.length;
        pdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
        pdf+=`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        return new Blob([pdf],{type:'application/pdf'});
    }
    if(typeof module!=='undefined'&&module.exports)module.exports={create};else root.ReportPdf={create};
})(typeof window==='undefined'?globalThis:window);
