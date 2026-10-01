// Copie uniquement les fichiers publics de l'application, sans SQL ni outils de test.
const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'dist');
fs.mkdirSync(output, {recursive: true});
for (const file of ['index.html', 'style.css', 'units.js','script.js', 'shops.js', 'shops-core.js', 'invoice-pdf.js', 'sales-orders.js','sale-payments.js','brand.js','report-pdf.js','finance.js','periods.js','update-check.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(output, file));
}
// HTML revalidé et URLs propres au contenu : un nouveau déploiement ne réutilise
// jamais un ancien JS/CSS mis en cache sous la même URL.
const crypto=require('node:crypto');
let html=fs.readFileSync(path.join(output,'index.html'),'utf8');
html=html.replace(/(src|href)="([^"?:]+\.(?:js|css))"/g,(match,attr,file)=>{
    const local=path.join(output,file);if(!fs.existsSync(local))return match;
    return `${attr}="${file}?v=${crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex').slice(0,16)}"`;
});
const version=crypto.createHash('sha256').update(html).digest('hex').slice(0,16);
html=html.replace('</head>',`<meta name="app-version" content="${version}"></head>`);
fs.writeFileSync(path.join(output,'index.html'),html);
fs.writeFileSync(path.join(output,'_headers'),'/*\n  Cache-Control: public, max-age=0, must-revalidate\n  X-Content-Type-Options: nosniff\n');
fs.writeFileSync(path.join(output,'version.json'),JSON.stringify({version}));
console.log('Les fichiers du site sont prêts.');
const logoFile=require('./brand.js').logoSrc;
if(logoFile){
    const logoPath=path.resolve(__dirname,logoFile),assets=path.resolve(__dirname,'assets')+path.sep;
    if(!logoPath.startsWith(assets))throw new Error('Le logo doit être conservé dans assets/.');
    fs.mkdirSync(path.join(output,'assets'),{recursive:true});
    fs.copyFileSync(logoPath,path.join(output,logoFile));
}
