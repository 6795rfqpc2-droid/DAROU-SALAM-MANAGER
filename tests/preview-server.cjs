// Aperçu local avec données fictives, aucune connexion Supabase.
const http=require('http'),fs=require('fs');const {mockClient,shops}=require('./mock-client.cjs');
const allowed=new Set(['style.css','units.js','script.js','shops.js','shops-core.js','invoice-pdf.js','sales-orders.js','sale-payments.js','brand.js','report-pdf.js','finance.js','periods.js','update-check.js','assets/darou-salam-logo.png']);
http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!name){let s=fs.readFileSync('index.html','utf8').replace(/<script[^>]+src="https:[^"]+"[^>]*><\/script>/g,'');
 const setup=`const shops=${JSON.stringify(shops)}; const mockClient=${mockClient.toString()}; const demo=mockClient(); demo.tables.shop_activity_periods=[{shop_id:'kh',active_month:'2026-09-01'}];demo.tables.monthly_closures=[];demo.rpc=async(name)=>({data:({period_api_version:1,cash_management_version:1,payment_api_version:1,sales_api_version:3})[name]||null,error:null});window.supabase={createClient:()=>demo}; sessionStorage.setItem('shop:user','kh');`;
 s=s.replace('<script src="units.js">','<script>'+setup+'</script><script src="units.js">');res.setHeader('Content-Type','text/html');return res.end(s);}
 if(!allowed.has(name)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',name.endsWith('.png')?'image/png':name.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(name));
}).listen(8787,'127.0.0.1',()=>console.log('Aperçu fictif http://127.0.0.1:8787'));
