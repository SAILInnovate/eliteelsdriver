-- Backfill global_users with dummy phone numbers for missing users
INSERT INTO public.global_users (id, phone_number, role, created_at)
SELECT 
  id, 
  COALESCE(phone, 'unknown_' || substr(id::text, 1, 8)), 
  'driver'::user_role, 
  created_at
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.global_users)
ON CONFLICT (id) DO NOTHING;
