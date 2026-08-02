-- El trigger handle_new_user() (20260701_block_new_users_by_default.sql) crea
-- la fila de profiles al registrarse, pero solo guardaba nombre/email/whatsapp:
-- los salones que la persona elige en el formulario de alta (raw_user_meta_data
-- ->'salons', un array de strings mandado por app.js en signUp()) se enviaban
-- a Supabase pero nunca se guardaban en profiles.salons. Resultado: todo
-- usuario nuevo quedaba con salons vacío, así que ni el selector de salón de
-- "Nuevo cliente" ni el panel "Cuentas de Drive" en Ajustes tenían nada para
-- mostrarle hasta que alguien se lo cargara a mano por SQL.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email, whatsapp, salons, status, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email,
    new.raw_user_meta_data->>'whatsapp',
    coalesce(new.raw_user_meta_data->'salons', '[]'::jsonb),
    'blocked',
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
