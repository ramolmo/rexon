-- =========================================================================
-- REXON SUPABASE FIX: REMOVE INFINITE RECURSION ON PROFILES TABLE
-- Run this once in your Supabase Dashboard -> SQL Editor -> New Query -> RUN
-- =========================================================================

-- 1. Drop all recursive policies on public.profiles that cause the loop
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow all profiles" ON public.profiles;

-- 2. Drop recursive helper function if exists
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;

-- 3. Disable RLS on profiles to eliminate all recursion errors completely
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

-- 4. RPC to safely set user department without any RLS issues
DROP FUNCTION IF EXISTS public.admin_set_user_department(UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_set_user_department(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.admin_set_user_department(
    p_user_id TEXT,
    p_new_department TEXT
)
RETURNS JSONB AS $$
BEGIN
    UPDATE public.profiles
    SET department = p_new_department
    WHERE id::text = p_user_id;

    RETURN jsonb_build_object('success', true, 'message', 'Department updated successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
