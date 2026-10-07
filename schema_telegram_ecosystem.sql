-- =========================================================================
-- REXON ENTERPRISE OMNICHANNEL SCHEMA: TELEGRAM & DETERMINISTIC AUDIT
-- =========================================================================

-- 1. Extend profiles table with Telegram metadata
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT UNIQUE,
ADD COLUMN IF NOT EXISTS telegram_username TEXT,
ADD COLUMN IF NOT EXISTS telegram_auth_date TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_profiles_telegram_chat ON public.profiles(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_profiles_telegram_user ON public.profiles(telegram_username);

-- 2. Deterministic Financial Transactions Ledger Table (Section 73)
CREATE TABLE IF NOT EXISTS public.financial_transactions (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    amount_cents BIGINT NOT NULL,
    account TEXT NOT NULL,
    category TEXT NOT NULL,
    reference TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Settled'
);

CREATE INDEX IF NOT EXISTS idx_fin_tx_cat ON public.financial_transactions(category);
CREATE INDEX IF NOT EXISTS idx_fin_tx_created ON public.financial_transactions(created_at);

-- 3. System Audit Log Table (Section 74)
CREATE TABLE IF NOT EXISTS public.system_audit_logs (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    actor TEXT NOT NULL,
    type TEXT NOT NULL,
    entity TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'Success'
);

CREATE INDEX IF NOT EXISTS idx_audit_type ON public.system_audit_logs(type);
CREATE INDEX IF NOT EXISTS idx_audit_time ON public.system_audit_logs(timestamp);

-- 4. Omnichannel Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    channel TEXT DEFAULT 'both', -- 'web', 'telegram', 'both'
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_read ON public.notifications(is_read);

-- 5. Open RLS Policies for Production Integrity
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all financial_transactions" ON public.financial_transactions;
CREATE POLICY "Allow all financial_transactions" ON public.financial_transactions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all system_audit_logs" ON public.system_audit_logs;
CREATE POLICY "Allow all system_audit_logs" ON public.system_audit_logs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all notifications" ON public.notifications;
CREATE POLICY "Allow all notifications" ON public.notifications FOR ALL USING (true) WITH CHECK (true);
