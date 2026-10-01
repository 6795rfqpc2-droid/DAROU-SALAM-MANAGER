/* Détecter un déploiement dans un onglet déjà ouvert, sans perdre une saisie. */
document.addEventListener('DOMContentLoaded',()=>{
 const initial=document.querySelector('meta[name="app-version"]')?.content;if(!initial)return;
 let checking=false;
 async function check(){
  if(checking||document.hidden||document.getElementById('versionNotice'))return;
  checking=true;
  try{
   const response=await fetch('version.json',{cache:'no-store'});if(!response.ok)return;
   const next=await response.json();if(!next.version||next.version===initial)return;
   const box=document.createElement('aside');box.id='versionNotice';box.setAttribute('role','status');
   box.innerHTML='<span>Une nouvelle version est disponible. Terminez votre saisie puis actualisez.</span><button type="button" class="btn-primary">Charger la nouvelle version</button>';
   box.querySelector('button').onclick=()=>location.reload();document.body.append(box);
  }catch(_){}finally{checking=false;}
 }
 window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);setInterval(check,120000);check();
});
