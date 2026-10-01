/* Le fichier de logo fourni par la propriétaire sera conservé dans assets/. */
(function(root){
    const brand={name:'DAROU SALAM BUSINESS',logoSrc:'assets/darou-salam-logo.png'};
    let imagePromise;
    brand.pdfImage=()=>{
        if(!brand.logoSrc)return Promise.resolve(null);
        if(!imagePromise)imagePromise=new Promise((resolve,reject)=>{
            const img=new Image();img.onload=()=>{
                try{
                const scale=Math.min(1,1200/Math.max(img.naturalWidth,img.naturalHeight));
                const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
                const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
                const bytes=atob(canvas.toDataURL('image/jpeg',0.94).split(',')[1]);
                resolve({width:canvas.width,height:canvas.height,hex:Array.from(bytes,c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')});
                }catch(error){reject(error);}
            };img.onerror=()=>reject(new Error('Le logo ne peut pas être chargé.'));img.src=brand.logoSrc;
        });return imagePromise;
    };
    if(typeof module!=='undefined'&&module.exports)module.exports=brand;else root.BusinessBrand=brand;
})(typeof window==='undefined'?globalThis:window);
