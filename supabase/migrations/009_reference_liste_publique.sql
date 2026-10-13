-- 009 : références fournisseur sur la liste de courses PUBLIQUE (lien envoyé au client).
-- La fonction renvoie { "nom de l'article en minuscules": "référence" } pour le devis dont le jeton de liste est fourni.
-- Elle ne renvoie QUE la référence (jamais le fournisseur, les prix d'achat ni la marge).
create or replace function public.get_devis_public_liste_refs(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(lower(dl.nom), btrim(pf.reference)), '{}'::jsonb)
  from devis d
  join devis_lignes dl on dl.devis_id = d.id
  join prestation_fournisseurs pf on pf.id::text = dl.fournisseur_id::text
  where d.liste_courses_token::text = p_token and dl.nom is not null
    and pf.reference is not null and btrim(pf.reference) <> '';
$$;

revoke all on function public.get_devis_public_liste_refs(text) from public;
grant execute on function public.get_devis_public_liste_refs(text) to anon, authenticated;
