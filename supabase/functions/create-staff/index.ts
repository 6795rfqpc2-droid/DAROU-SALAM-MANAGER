// Remplacer tout le code de la fonction Supabase create-staff par ce fichier.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
Deno.serve(async request => {
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), {status, headers: {...cors, 'Content-Type':'application/json'}});
  if (request.method === 'OPTIONS') return new Response(null, {headers:cors});
  if (request.method !== 'POST') return reply(405, {error:'Méthode non autorisée'});
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
  if (!token) return reply(401, {error:'Connexion requise'});
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError} = await admin.auth.getUser(token);
  if (userError || !userData.user) return reply(401, {error:'Session invalide'});
  const {data:profile,error:profileError} = await admin.from('profiles').select('role,active').eq('id',userData.user.id).single();
  if (profileError || profile?.role !== 'admin' || profile.active !== true) return reply(403, {error:'Administratrice active uniquement'});
  let body;
  try { body = await request.json(); } catch { return reply(400,{error:'Requête invalide'}); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400,{error:'Requête invalide'});
  const {full_name,email,password} = body;
  if (typeof full_name!=='string' || !full_name.trim() || full_name.length>200 || typeof email!=='string'
      || !email.includes('@') || typeof password!=='string' || password.length<6) return reply(400,{error:'Nom, email ou mot de passe invalide'});
  const {data:created,error:createError} = await admin.auth.admin.createUser({email:email.trim(),password,email_confirm:true});
  if (createError || !created.user) return reply(400,{error:createError?.message || 'Création impossible'});
  const {error:saveError} = await admin.from('profiles').upsert({id:created.user.id,nom_complet:full_name.trim(),role:'personnel',active:true});
  if (saveError) {
    // Aucun accès métier n'est attribué. Retour explicite pour reprendre ce compte.
    return reply(500,{error:'Compte créé mais profil incomplet. Contactez l’administratrice.',user_id:created.user.id});
  }
  // Aucune boutique par défaut pour les nouveaux employés : affectation explicite via set_staff_shops.
  return reply(200,{user_id:created.user.id,message:'Personnel créé. Attribuez ses boutiques dans Personnel.'});
});
