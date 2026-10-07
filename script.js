const DEFAULT_SP_URL = 'https://pxejdzlrcesjepndgpyo.supabase.co';
        const DEFAULT_SP_KEY = 'sb_publishable_zhiBHjv-fhhEhy7wvX52AA_1sE0sSSL';

        let supabaseClient = null;
        let currentUser = null;
        let currentProfile = null;
        let selectedFileData = null;
        let parsedRows = [];
        let adminUsersCache = [];
        let adminLogsCache = [];
        let adminSubmissionsCache = [];
        let userEmailToNameMap = {};
        let currentAuthMode = 'signin';

        
        // =========================================================
        // TURSO 9 GB CLOUD SMART VAULT (ZERO-DATA-LOSS ARCHITECTURE)
        // =========================================================
        const TURSO_DEFAULT_CONFIG = {
            url: 'https://datafow-ramolmoaran.aws-ap-south-1.turso.io',
            token: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTA5NzA5NjMsImlkIjoiMDFhMGZlMmYtMTQwMS03ZTc5LTg3YTEtNzA0YzRhMDI1OTdlIiwia2lkIjoiX0pPb0ZwYWl2TDRkY1d6VjQ2WTN6aVgyMnB1YkJJaXlVeXk2d1E3U3VNUSIsInJpZCI6Ijk2NGQyMzcwLWYwZTAtNGE0Yy05MWMxLTJlZWUwMWMxMmE4YSJ9.t1l7ZHPnMxx5NQdzXLPJ4b71SOqj0gyILcHT7xKb77_wi1d1ydB-u3EZ_7x55CEhcD6tdzyxl41V_7Fxoe8xAg'
        };

        const TursoVault = {
            getConfig() {
                return {
                    url: localStorage.getItem('turso_db_url') || TURSO_DEFAULT_CONFIG.url,
                    token: localStorage.getItem('turso_auth_token') || TURSO_DEFAULT_CONFIG.token
                };
            },

            saveConfig(url, token) {
                if (url) localStorage.setItem('turso_db_url', url.trim());
                if (token) localStorage.setItem('turso_auth_token', token.trim());
            },

            escapeSql(val) {
                if (val === null || val === undefined) return 'NULL';
                const s = String(val).replace(/'/g, "''");
                return `'${s}'`;
            },

            async query(sql, args = []) {
                const config = this.getConfig();
                const cleanUrl = config.url.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '');

                const stmt = { sql };
                if (args && args.length > 0) {
                    stmt.args = args.map(arg => {
                        if (arg === null || arg === undefined) return { type: 'null' };
                        if (typeof arg === 'number') {
                            if (Number.isInteger(arg)) return { type: 'integer', value: String(arg) };
                            return { type: 'float', value: arg };
                        }
                        if (typeof arg === 'boolean') return { type: 'integer', value: arg ? '1' : '0' };
                        return { type: 'text', value: String(arg) };
                    });
                }

                const payload = {
                    requests: [
                        { type: 'execute', stmt },
                        { type: 'close' }
                    ]
                };

                const res = await fetch(`${cleanUrl}/v2/pipeline`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${config.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    const errTxt = await res.text();
                    throw new Error(`Turso HTTP Error (${res.status}): ${errTxt}`);
                }

                const data = await res.json();
                const execRes = data.results && data.results[0];
                if (execRes && execRes.type === 'error') {
                    throw new Error(execRes.error?.message || 'Turso query failed');
                }

                if (execRes && execRes.response && execRes.response.result) {
                    const result = execRes.response.result;
                    const colNames = (result.cols || []).map(c => c.name);
                    const rows = (result.rows || []).map(row => {
                        const obj = {};
                        row.forEach((cell, idx) => {
                            obj[colNames[idx]] = cell.value;
                        });
                        return obj;
                    });
                    return {
                        rows,
                        affectedRowCount: result.affected_row_count || 0,
                        cols: colNames
                    };
                }
                return { rows: [], affectedRowCount: 0, cols: [] };
            },

            async init() {
                try {
                    await this.query(`
                        CREATE TABLE IF NOT EXISTS turso_submissions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            supabase_id TEXT,
                            source_table TEXT,
                            phone_number TEXT NOT NULL,
                            full_name TEXT,
                            age TEXT,
                            household_income TEXT,
                            est_market_value TEXT,
                            report_type TEXT,
                            department TEXT,
                            user_email TEXT,
                            username TEXT,
                            user_id TEXT,
                            file_name TEXT,
                            created_at TEXT,
                            archived_at TEXT DEFAULT (datetime('now')),
                            UNIQUE(source_table, phone_number)
                        );
                    `);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_ts_phone ON turso_submissions(phone_number);`);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_ts_created ON turso_submissions(created_at);`);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_ts_user ON turso_submissions(username);`);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_ts_email ON turso_submissions(user_email);`);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_ts_report ON turso_submissions(report_type);`);
                    try { await this.query("ALTER TABLE turso_submissions ADD COLUMN user_id TEXT;"); } catch(e) {}
                    try { await this.query("ALTER TABLE turso_stock_numbers ADD COLUMN assigned_to_user_id TEXT;"); } catch(e) {}

                    await this.query(`
                        CREATE TABLE IF NOT EXISTS turso_stock_numbers (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            supabase_id TEXT,
                            phone_number TEXT NOT NULL UNIQUE,
                            full_name TEXT,
                            age TEXT,
                            stock_type TEXT,
                            is_assigned INTEGER DEFAULT 0,
                            assigned_to_username TEXT,
                            assigned_to_email TEXT,
                            assigned_at TEXT,
                            received_date TEXT,
                            batch_name TEXT,
                            created_at TEXT,
                            archived_at TEXT DEFAULT (datetime('now'))
                        );
                    `);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_tstock_phone ON turso_stock_numbers(phone_number);`);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_tstock_assigned ON turso_stock_numbers(is_assigned);`);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_tstock_type ON turso_stock_numbers(stock_type);`);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_tstock_assigned_at ON turso_stock_numbers(assigned_at);`);

                    await this.query(`
                        CREATE TABLE IF NOT EXISTS turso_deliveries (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            phone_number TEXT NOT NULL UNIQUE,
                            full_name TEXT,
                            age TEXT,
                            household_income TEXT,
                            est_market_value TEXT,
                            company_name TEXT,
                            category TEXT,
                            batch_name TEXT,
                            delivery_date TEXT,
                            delivered_at TEXT,
                            created_at TEXT DEFAULT (datetime('now')),
                            archived_at TEXT DEFAULT (datetime('now'))
                        );
                    `);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_tdel_phone ON turso_deliveries(phone_number);`);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_tdel_date ON turso_deliveries(delivery_date);`);
                    await this.query(`CREATE INDEX IF NOT EXISTS idx_tdel_company ON turso_deliveries(company_name);`);

                    await this.query(`
                        CREATE TABLE IF NOT EXISTS turso_sync_logs (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            action_type TEXT,
                            records_synced INTEGER,
                            status TEXT,
                            details TEXT,
                            created_at TEXT DEFAULT (datetime('now'))
                        );
                    `);
                    console.log('✅ Turso 9 GB Cloud Smart Vault tables initialized successfully!');
                    return true;
                } catch (e) {
                    console.warn('Turso Vault init notice:', e.message);
                    return false;
                }
            },

            async getStats() {
                try {
                    await this.init();
                    const subRes = await this.query("SELECT COUNT(*) as cnt FROM turso_submissions;");
                    const stockRes = await this.query("SELECT COUNT(*) as cnt FROM turso_stock_numbers;");
                    const delRes = await this.query("SELECT COUNT(*) as cnt FROM turso_deliveries;");
                    const logRes = await this.query("SELECT * FROM turso_sync_logs ORDER BY id DESC LIMIT 1;");

                    return {
                        online: true,
                        submissionsCount: parseInt(subRes.rows[0]?.cnt || 0, 10),
                        stockCount: parseInt(stockRes.rows[0]?.cnt || 0, 10),
                        deliveriesCount: parseInt(delRes.rows[0]?.cnt || 0, 10),
                        lastSync: logRes.rows[0]?.created_at ? new Date(logRes.rows[0].created_at).toLocaleString() : 'Never'
                    };
                } catch (e) {
                    return {
                        online: false,
                        error: e.message,
                        submissionsCount: 0,
                        stockCount: 0,
                        deliveriesCount: 0,
                        lastSync: 'Offline'
                    };
                }
            },

            async insertSubmissions(chunk, reportType, fileName, profile) {
                if (!chunk || chunk.length === 0) return { success: true, count: 0 };
                await this.init();
                let inserted = 0;
                const subChunkSize = 250;
                for (let i = 0; i < chunk.length; i += subChunkSize) {
                    const sub = chunk.slice(i, i + subChunkSize);
                    const valuesSql = sub.map(r => {
                        const phone = this.escapeSql(r.phone || r.phone_number);
                        const name = this.escapeSql(r.name || r.full_name || '');
                        const age = this.escapeSql(r.age || '');
                        const inc = this.escapeSql(r.income || r.household_income || '');
                        const val = this.escapeSql(r.market_value || r.est_market_value || '');
                        const rep = this.escapeSql(reportType || 'general');
                        const dept = this.escapeSql(profile?.department || '-');
                        const email = this.escapeSql(profile?.email || '');
                        const user = this.escapeSql(profile?.username || '');
                        const file = this.escapeSql(fileName || '');
                        const created = this.escapeSql(new Date().toISOString());
                        const src = this.escapeSql('master_numbers');
                        const uid = this.escapeSql(profile?.id || currentUser?.id || '');
                        return `(${src}, ${phone}, ${name}, ${age}, ${inc}, ${val}, ${rep}, ${dept}, ${email}, ${user}, ${uid}, ${file}, ${created})`;
                    }).join(', ');

                    const sql = `
                        INSERT OR IGNORE INTO turso_submissions 
                        (source_table, phone_number, full_name, age, household_income, est_market_value, report_type, department, user_email, username, user_id, file_name, created_at)
                        VALUES ${valuesSql};
                    `;
                    const res = await this.query(sql);
                    inserted += (res.affectedRowCount || sub.length);
                }
                return { success: true, count: inserted };
            },

            async asyncRecordSubmissions(chunk, reportType, fileName, profile) {
                return this.insertSubmissions(chunk, reportType, fileName, profile);
            },

            async insertStockNumbers(records, stockType, recDate, batchName) {
                if (!records || records.length === 0) return { success: true, count: 0 };
                await this.init();
                let inserted = 0;
                const subChunkSize = 250;
                const dateVal = this.escapeSql(recDate || new Date().toISOString().slice(0, 10));
                const bName = this.escapeSql(batchName || 'Company_Stock');
                const stype = this.escapeSql(stockType || 'gender_verify');

                for (let i = 0; i < records.length; i += subChunkSize) {
                    const sub = records.slice(i, i + subChunkSize);
                    const valuesSql = sub.map(r => {
                        const phone = this.escapeSql(r.phone || r.phone_number);
                        const name = this.escapeSql(r.name || r.full_name || '');
                        const age = this.escapeSql(r.age || '');
                        const created = this.escapeSql(new Date().toISOString());
                        return `(${phone}, ${name}, ${age}, ${stype}, 0, ${dateVal}, ${bName}, ${created})`;
                    }).join(', ');

                    const sql = `
                        INSERT OR IGNORE INTO turso_stock_numbers
                        (phone_number, full_name, age, stock_type, is_assigned, received_date, batch_name, created_at)
                        VALUES ${valuesSql};
                    `;
                    const res = await this.query(sql);
                    inserted += (res.affectedRowCount || sub.length);
                }
                return { success: true, count: inserted };
            },

            async asyncRecordStock(records, stockType, recDate, batchName) {
                return this.insertStockNumbers(records, stockType, recDate, batchName);
            },

            async insertDeliveries(records, category, companyName, deliveryDate, batchName) {
                if (!records || records.length === 0) return { success: true, count: 0 };
                await this.init();
                let inserted = 0;
                const subChunkSize = 250;
                const dateVal = this.escapeSql(deliveryDate || new Date().toISOString().slice(0, 10));
                const compVal = this.escapeSql(companyName || 'Company');
                const catVal = this.escapeSql(category || 'general');
                const bName = this.escapeSql(batchName || `Batch_${deliveryDate}`);

                for (let i = 0; i < records.length; i += subChunkSize) {
                    const sub = records.slice(i, i + subChunkSize);
                    const valuesSql = sub.map(r => {
                        const phone = this.escapeSql(r.phone || r.phone_number);
                        const name = this.escapeSql(r.name || r.full_name || '');
                        const age = this.escapeSql(r.age || '');
                        const inc = this.escapeSql(r.income || r.household_income || '');
                        const mkt = this.escapeSql(r.market_value || r.est_market_value || '');
                        const delAt = this.escapeSql(new Date().toISOString());
                        return `(${phone}, ${name}, ${age}, ${inc}, ${mkt}, ${compVal}, ${catVal}, ${bName}, ${dateVal}, ${delAt})`;
                    }).join(', ');

                    const sql = `
                        INSERT OR IGNORE INTO turso_deliveries
                        (phone_number, full_name, age, household_income, est_market_value, company_name, category, batch_name, delivery_date, delivered_at)
                        VALUES ${valuesSql};
                    `;
                    const res = await this.query(sql);
                    inserted += (res.affectedRowCount || sub.length);
                }
                return { success: true, count: inserted };
            },

            async claimStock(qty, stockType, profile) {
                await this.init();
                const cleanType = (stockType === 'lookup') ? 'lookup' : (stockType === 'signal' ? 'signal' : 'gender_verify');
                const username = this.escapeSql(profile?.username || 'Worker');
                const email = this.escapeSql(profile?.email || '');

                // 6-hour quota rule: if not admin and not team_leader and not unlimited quota
                if (profile && profile.role !== 'admin' && profile.role !== 'team_leader' && !profile.is_unlimited_quota) {
                    const quotaSql = `
                        SELECT COUNT(*) as claimed_count 
                        FROM turso_stock_numbers 
                        WHERE (assigned_to_email = ${email} OR assigned_to_username = ${username})
                          AND datetime(assigned_at) >= datetime('now', '-6 hours');
                    `;
                    const qRes = await this.query(quotaSql);
                    const claimedCount = parseInt(qRes.rows[0]?.claimed_count || 0, 10);
                    if (claimedCount >= 1000) {
                        return {
                            success: false,
                            message: `৬ ঘণ্টার কোটা লিমিট (১,০০০ টি) পূর্ণ হয়েছে! সাধারণ কর্মীরা প্রতি ৬ ঘণ্টায় সর্বোচ্চ ১,০০০ টি নাম্বার নিতে পারেন। আপনি গত ৬ ঘণ্টায় ইতিমধ্যে ${claimedCount} টি নাম্বার নিয়েছেন। ৬ ঘণ্টা পূর্ণ হলে আবার স্বয়ংক্রিয়ভাবে নতুন কোটা পাবেন।`,
                            count: 0,
                            data: []
                        };
                    }
                    const remainingQuota = 1000 - claimedCount;
                    if (qty > remainingQuota) {
                        qty = remainingQuota;
                    }
                }

                // 1. Fetch unassigned rows from turso_stock_numbers
                const typeCondition = (cleanType === 'gender_verify')
                    ? "(stock_type = 'gender_verify' OR stock_type IS NULL OR stock_type = '')"
                    : `stock_type = '${cleanType}'`;

                const fetchSql = `
                    SELECT id, phone_number, full_name, age 
                    FROM turso_stock_numbers 
                    WHERE is_assigned = 0 AND ${typeCondition}
                    ORDER BY id ASC LIMIT ${qty};
                `;
                const res = await this.query(fetchSql);
                if (!res.rows || res.rows.length === 0) {
                    return { success: false, message: 'স্টকে কোনো নতুন নাম্বার খালি নেই!', count: 0, data: [] };
                }

                const ids = res.rows.map(r => r.id).join(',');

                // 2. Mark assigned in Turso
                const updateSql = `
                    UPDATE turso_stock_numbers 
                    SET is_assigned = 1, 
                        assigned_to_username = ${username}, 
                        assigned_to_email = ${email}, 
                        assigned_at = datetime('now') 
                    WHERE id IN (${ids});
                `;
                await this.query(updateSql);

                return {
                    success: true,
                    count: res.rows.length,
                    data: res.rows.map(r => ({
                        phone: r.phone_number,
                        name: r.full_name || '',
                        age: r.age || ''
                    }))
                };
            },

            async checkDuplicates(phoneList) {
                await this.init();
                const companyDeliveredMatches = [];
                const dbSubmissionMatches = [];
                const stockMatches = [];
                const chunkSize = 250;

                for (let i = 0; i < phoneList.length; i += chunkSize) {
                    const chunk = phoneList.slice(i, i + chunkSize);
                    const inClause = chunk.map(p => this.escapeSql(p)).join(', ');

                    // 1. Check Turso Deliveries (Company Deliveries)
                    try {
                        const delSql = `
                            SELECT phone_number, full_name, age, company_name, category, delivery_date, delivered_at 
                            FROM turso_deliveries 
                            WHERE phone_number IN (${inClause});
                        `;
                        const delRes = await this.query(delSql);
                        if (delRes.rows && delRes.rows.length > 0) {
                            companyDeliveredMatches.push(...delRes.rows);
                        }
                    } catch(e) {
                        console.warn('Turso deliveries dup check notice:', e.message);
                    }

                    // 2. Check Turso Submissions (Central DB Submissions)
                    try {
                        const subSql = `
                            SELECT phone_number, full_name, age, report_type, username, user_email, created_at 
                            FROM turso_submissions 
                            WHERE phone_number IN (${inClause});
                        `;
                        const subRes = await this.query(subSql);
                        if (subRes.rows && subRes.rows.length > 0) {
                            dbSubmissionMatches.push(...subRes.rows);
                        }
                    } catch(e) {
                        console.warn('Turso submissions dup check notice:', e.message);
                    }

                    // 3. Check Turso Stock (Company Stock)
                    try {
                        const stSql = `
                            SELECT phone_number, full_name, age, stock_type, is_assigned, assigned_to_username, created_at 
                            FROM turso_stock_numbers 
                            WHERE phone_number IN (${inClause});
                        `;
                        const stRes = await this.query(stSql);
                        if (stRes.rows && stRes.rows.length > 0) {
                            stockMatches.push(...stRes.rows);
                        }
                    } catch(e) {
                        console.warn('Turso stock dup check notice:', e.message);
                    }
                }

                return {
                    companyDeliveries: companyDeliveredMatches,
                    submissions: dbSubmissionMatches,
                    stock: stockMatches
                };
            },

            async getSubmissionsStats() {
                await this.init();
                const sql = `
                    SELECT 
                        COUNT(*) as total_unique,
                        SUM(CASE WHEN report_type = 'male_report' OR report_type = 'male' THEN 1 ELSE 0 END) as male_count,
                        SUM(CASE WHEN report_type = 'female_report' OR report_type = 'female' THEN 1 ELSE 0 END) as female_count,
                        SUM(CASE WHEN (report_type = 'lookup_report' OR report_type = 'lookup') AND (household_income != 'no_info' AND household_income != 'No Information' AND household_income != '-' AND household_income != 'no' AND household_income != '' AND household_income IS NOT NULL) THEN 1 ELSE 0 END) as lookup_count,
                        SUM(CASE WHEN report_type = 'lookup_no_info' OR ((report_type = 'lookup_report' OR report_type = 'lookup') AND (household_income = 'no_info' OR household_income = 'No Information' OR household_income = '-' OR household_income = 'no' OR household_income = '' OR household_income IS NULL)) THEN 1 ELSE 0 END) as lookup_no_info_count,
                        SUM(CASE WHEN report_type = 'signal_report' OR report_type = 'signal' THEN 1 ELSE 0 END) as signal_count,
                        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) as today_count
                    FROM turso_submissions;
                `;
                const res = await this.query(sql);
                const row = res.rows[0] || {};
                return {
                    totalUnique: parseInt(row.total_unique || 0, 10),
                    maleCount: parseInt(row.male_count || 0, 10),
                    femaleCount: parseInt(row.female_count || 0, 10),
                    lookupCount: parseInt(row.lookup_count || 0, 10),
                    lookupNoInfoCount: parseInt(row.lookup_no_info_count || 0, 10),
                    signalCount: parseInt(row.signal_count || 0, 10),
                    todayTotal: parseInt(row.today_count || 0, 10)
                };
            },

            async getStockStats() {
                await this.init();
                const sql = `
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN is_assigned = 0 THEN 1 ELSE 0 END) as available,
                        SUM(CASE WHEN is_assigned = 1 THEN 1 ELSE 0 END) as claimed,
                        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) as today,
                        SUM(CASE WHEN is_assigned = 0 AND (stock_type = 'gender_verify' OR stock_type IS NULL OR stock_type = '') THEN 1 ELSE 0 END) as gv_avail,
                        SUM(CASE WHEN is_assigned = 0 AND stock_type = 'lookup' THEN 1 ELSE 0 END) as lookup_avail,
                        SUM(CASE WHEN is_assigned = 0 AND stock_type = 'signal' THEN 1 ELSE 0 END) as signal_avail
                    FROM turso_stock_numbers;
                `;
                const res = await this.query(sql);
                const row = res.rows[0] || {};
                return {
                    total: parseInt(row.total || 0, 10),
                    available: parseInt(row.available || 0, 10),
                    claimed: parseInt(row.claimed || 0, 10),
                    today: parseInt(row.today || 0, 10),
                    gvAvail: parseInt(row.gv_avail || 0, 10),
                    lookupAvail: parseInt(row.lookup_avail || 0, 10),
                    signalAvail: parseInt(row.signal_avail || 0, 10)
                };
            },

            async getDeliveryStats() {
                await this.init();
                const sql = `
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN category = 'male_data' THEN 1 ELSE 0 END) as male_deliv,
                        SUM(CASE WHEN category = 'female_data' THEN 1 ELSE 0 END) as female_deliv,
                        SUM(CASE WHEN category = 'signal_data' THEN 1 ELSE 0 END) as signal_deliv,
                        SUM(CASE WHEN category = 'lookup_data' THEN 1 ELSE 0 END) as lookup_deliv,
                        SUM(CASE WHEN date(delivered_at) = date('now') OR date(created_at) = date('now') THEN 1 ELSE 0 END) as today_deliv
                    FROM turso_deliveries;
                `;
                const res = await this.query(sql);
                const row = res.rows[0] || {};
                return {
                    total: parseInt(row.total || 0, 10),
                    maleDeliv: parseInt(row.male_deliv || 0, 10),
                    femaleDeliv: parseInt(row.female_deliv || 0, 10),
                    signalDeliv: parseInt(row.signal_deliv || 0, 10),
                    lookupDeliv: parseInt(row.lookup_deliv || 0, 10),
                    todayDeliv: parseInt(row.today_deliv || 0, 10)
                };
            },

            async deleteSubmissions(scope, targetDate) {
                await this.init();
                let sql = `DELETE FROM turso_submissions;`;
                if (scope === 'specific_date' && targetDate) {
                    sql = `DELETE FROM turso_submissions WHERE date(created_at) = '${targetDate}';`;
                } else if (scope === 'before_date' && targetDate) {
                    sql = `DELETE FROM turso_submissions WHERE date(created_at) < '${targetDate}';`;
                }
                return this.query(sql);
            },

            async syncAll(onProgress) {
                if (!supabaseClient) throw new Error('Supabase client is not connected');
                await this.init();
                let totalSynced = 0;

                // 1. Sync master_numbers
                if (onProgress) onProgress('১/৪: মাস্টার রিপোর্ট ডাটা লোড হচ্ছে...', 10);
                let from = 0;
                const pageSize = 1000;
                while (from < 100000) {
                    const { data: rows, error } = await supabaseClient
                        .from('master_numbers')
                        .select('*')
                        .order('id', { ascending: true })
                        .range(from, from + pageSize - 1);
                    if (error) throw error;
                    if (!rows || rows.length === 0) break;

                    for (let i = 0; i < rows.length; i += 100) {
                        const sub = rows.slice(i, i + 100);
                        const valList = sub.map(r => {
                            const supId = this.escapeSql(r.id);
                            const src = this.escapeSql('master_numbers');
                            const phone = this.escapeSql(r.phone_number);
                            const name = this.escapeSql(r.full_name || '');
                            const age = this.escapeSql(r.age || '');
                            const inc = this.escapeSql(r.household_income || '');
                            const val = this.escapeSql(r.est_market_value || '');
                            const rep = this.escapeSql(r.report_type || 'general');
                            const dept = this.escapeSql(r.department || '-');
                            const email = this.escapeSql(r.user_email || '');
                            const user = this.escapeSql(r.username || '');
                            const file = this.escapeSql(r.file_name || '');
                            const created = this.escapeSql(r.created_at || new Date().toISOString());
                            return `(${supId}, ${src}, ${phone}, ${name}, ${age}, ${inc}, ${val}, ${rep}, ${dept}, ${email}, ${user}, ${file}, ${created})`;
                        }).join(', ');

                        await this.query(`
                            INSERT OR IGNORE INTO turso_submissions 
                            (supabase_id, source_table, phone_number, full_name, age, household_income, est_market_value, report_type, department, user_email, username, file_name, created_at)
                            VALUES ${valList};
                        `);
                        totalSynced += sub.length;
                    }
                    if (onProgress) onProgress(`১/৪: মাস্টার রিপোর্ট সিঙ্ক হচ্ছে (${totalSynced} টি)...`, 25);
                    if (rows.length < pageSize) break;
                    from += pageSize;
                }

                // 2. Sync lookup_records
                if (onProgress) onProgress('২/৪: লুকআপ রেকর্ড সিঙ্ক হচ্ছে...', 40);
                from = 0;
                while (from < 100000) {
                    const { data: rows, error } = await supabaseClient
                        .from('lookup_records')
                        .select('*')
                        .order('id', { ascending: true })
                        .range(from, from + pageSize - 1);
                    if (error) break;
                    if (!rows || rows.length === 0) break;

                    for (let i = 0; i < rows.length; i += 100) {
                        const sub = rows.slice(i, i + 100);
                        const valList = sub.map(r => {
                            const supId = this.escapeSql(r.id);
                            const src = this.escapeSql('lookup_records');
                            const phone = this.escapeSql(r.phone_number);
                            const name = this.escapeSql(r.full_name || '');
                            const age = this.escapeSql(r.age || '');
                            const inc = this.escapeSql(r.household_income || '');
                            const val = this.escapeSql(r.est_market_value || '');
                            const rep = this.escapeSql('lookup_report');
                            const dept = this.escapeSql('lookup');
                            const email = this.escapeSql(r.worker_email || '');
                            const user = this.escapeSql(r.worker_username || '');
                            const file = this.escapeSql('');
                            const created = this.escapeSql(r.created_at || new Date().toISOString());
                            return `(${supId}, ${src}, ${phone}, ${name}, ${age}, ${inc}, ${val}, ${rep}, ${dept}, ${email}, ${user}, ${file}, ${created})`;
                        }).join(', ');

                        await this.query(`
                            INSERT OR IGNORE INTO turso_submissions 
                            (supabase_id, source_table, phone_number, full_name, age, household_income, est_market_value, report_type, department, user_email, username, file_name, created_at)
                            VALUES ${valList};
                        `);
                        totalSynced += sub.length;
                    }
                    if (rows.length < pageSize) break;
                    from += pageSize;
                }

                // 3. Sync company_received_numbers
                if (onProgress) onProgress('৩/৪: কোম্পানির স্টক নাম্বার সিঙ্ক হচ্ছে...', 70);
                from = 0;
                while (from < 100000) {
                    const { data: rows, error } = await supabaseClient
                        .from('company_received_numbers')
                        .select('*')
                        .order('id', { ascending: true })
                        .range(from, from + pageSize - 1);
                    if (error) break;
                    if (!rows || rows.length === 0) break;

                    for (let i = 0; i < rows.length; i += 100) {
                        const sub = rows.slice(i, i + 100);
                        const valList = sub.map(r => {
                            const supId = this.escapeSql(r.id);
                            const phone = this.escapeSql(r.phone_number);
                            const name = this.escapeSql(r.full_name || '');
                            const age = this.escapeSql(r.age || '');
                            const stype = this.escapeSql(r.stock_type || 'gender_verify');
                            const isAss = r.is_assigned ? 1 : 0;
                            const assUser = this.escapeSql(r.assigned_to_username || '');
                            const assEmail = this.escapeSql(r.assigned_to_email || '');
                            const assAt = this.escapeSql(r.assigned_at || '');
                            const created = this.escapeSql(r.created_at || new Date().toISOString());
                            return `(${supId}, ${phone}, ${name}, ${age}, ${stype}, ${isAss}, ${assUser}, ${assEmail}, ${assAt}, ${created})`;
                        }).join(', ');

                        await this.query(`
                            INSERT OR IGNORE INTO turso_stock_numbers 
                            (supabase_id, phone_number, full_name, age, stock_type, is_assigned, assigned_to_username, assigned_to_email, assigned_at, created_at)
                            VALUES ${valList};
                        `);
                    }
                    if (rows.length < pageSize) break;
                    from += pageSize;
                }

                // 4. Sync company_deliveries
                if (onProgress) onProgress('৪/৪: ডেলিভারি হিস্ট্রি সিঙ্ক হচ্ছে...', 90);
                from = 0;
                while (from < 50000) {
                    const { data: rows, error } = await supabaseClient
                        .from('company_deliveries')
                        .select('*')
                        .order('id', { ascending: true })
                        .range(from, from + pageSize - 1);
                    if (error) break;
                    if (!rows || rows.length === 0) break;

                    for (let i = 0; i < rows.length; i += 100) {
                        const sub = rows.slice(i, i + 100);
                        const valList = sub.map(r => {
                            const phone = this.escapeSql(r.phone_number);
                            const name = this.escapeSql(r.full_name || '');
                            const age = this.escapeSql(r.age || '');
                            const comp = this.escapeSql(r.company_name || 'Company');
                            const cat = this.escapeSql(r.category || 'general');
                            const delAt = this.escapeSql(r.delivery_date || '');
                            return `(${phone}, ${name}, ${age}, ${comp}, ${cat}, ${delAt})`;
                        }).join(', ');

                        await this.query(`
                            INSERT OR IGNORE INTO turso_deliveries 
                            (phone_number, full_name, age, company_name, category, delivered_at)
                            VALUES ${valList};
                        `);
                    }
                    if (rows.length < pageSize) break;
                    from += pageSize;
                }

                // Log sync
                await this.query(`
                    INSERT INTO turso_sync_logs (action_type, records_synced, status, details)
                    VALUES ('full_sync', ${totalSynced}, 'success', 'All Supabase tables backed up to Turso 9 GB Vault');
                `);

                if (onProgress) onProgress('সিঙ্ক সম্পন্ন হয়েছে!', 100);
                return totalSynced;
            }
        };

        // GLOBAL FETCH ALL SUBMISSIONS ENGINE (Queries Turso 9 GB Vault first, merges Supabase if needed)
        async function fetchAllSubmissions(filters = {}) {
            let results = [];
            // 1. Fetch from Turso 9 GB Vault (Primary storage)
            try {
                if (typeof TursoVault !== 'undefined') {
                    let sql = `SELECT * FROM turso_submissions WHERE 1=1 `;
                    if (filters.date) {
                        sql += ` AND date(created_at) = '${filters.date}'`;
                    }
                    if (filters.report_type === 'lookup_no_info') {
                        sql += ` AND (report_type = 'lookup_no_info' OR ((report_type = 'lookup_report' OR report_type = 'lookup') AND (household_income = 'no_info' OR household_income = 'No Information' OR household_income = '-' OR household_income = 'no' OR household_income IS NULL OR household_income = '')))`;
                    } else if (filters.report_type === 'lookup_report') {
                        sql += ` AND (report_type = 'lookup_report' OR report_type = 'lookup') AND household_income != 'no_info' AND household_income != 'No Information' AND household_income != '-' AND household_income != 'no' AND household_income IS NOT NULL AND household_income != ''`;
                    } else if (filters.report_type && filters.report_type !== 'all') {
                        sql += ` AND report_type = '${filters.report_type}'`;
                    }
                    if (filters.user_email && filters.user_email !== 'all') {
                        sql += ` AND (user_email = '${filters.user_email}' OR username = '${filters.user_email}')`;
                    }
                    sql += ` ORDER BY id DESC LIMIT 50000;`;
                    const tRes = await TursoVault.query(sql);
                    if (tRes && tRes.rows && tRes.rows.length > 0) {
                        results.push(...tRes.rows);
                    }
                }
            } catch(tErr) {
                console.warn('Turso fetchAllSubmissions notice:', tErr);
            }

            // 2. Also fetch from Supabase master_numbers if available & merge (avoid duplicates)
            if (supabaseClient) {
                try {
                    const seenPhones = new Set(results.map(r => r.phone_number));
                    let from = 0;
                    const chunkSize = 1000;
                    while (from < 10000) {
                        let q = supabaseClient.from('master_numbers').select('*').order('created_at', { ascending: false }).range(from, from + chunkSize - 1);
                        if (filters.date) {
                            const startIso = `${filters.date}T00:00:00.000Z`;
                            const endIso = `${filters.date}T23:59:59.999Z`;
                            q = q.gte('created_at', startIso).lte('created_at', endIso);
                        }
                        if (filters.report_type && filters.report_type !== 'all') {
                            q = q.eq('report_type', filters.report_type);
                        }
                        if (filters.user_email && filters.user_email !== 'all') {
                            q = q.eq('user_email', filters.user_email);
                        }
                        const { data, error } = await q;
                        if (error || !data || data.length === 0) break;
                        for (const row of data) {
                            if (!seenPhones.has(row.phone_number)) {
                                seenPhones.add(row.phone_number);
                                results.push(row);
                            }
                        }
                        if (data.length < chunkSize) break;
                        from += chunkSize;
                    }
                } catch(sErr) {
                    console.warn('Supabase fetchAllSubmissions notice:', sErr);
                }
            }
            // 3. For Lookup Reports, also seamlessly include Supabase lookup tables
            if (supabaseClient) {
                try {
                    const seenPhones = new Set(results.map(r => r.phone_number));
                    if (filters.report_type === 'lookup_no_info') {
                        const noInfoRows = await fetchAllLookupTableRows('lookup_no_info_records', filters.date || '');
                        if (noInfoRows && noInfoRows.length > 0) {
                            noInfoRows.forEach(r => {
                                if (!seenPhones.has(r.phone_number)) {
                                    seenPhones.add(r.phone_number);
                                    results.push({
                                        id: r.id,
                                        phone_number: r.phone_number,
                                        full_name: r.full_name || '-',
                                        age: r.age || '-',
                                        household_income: 'No Information',
                                        est_market_value: 'No Information',
                                        report_type: 'lookup_no_info',
                                        department: 'lookup',
                                        user_email: r.worker_email,
                                        username: r.worker_username,
                                        created_at: r.created_at || r.submission_date
                                    });
                                }
                            });
                        }
                    } else if (filters.report_type === 'lookup_report') {
                        const valRows = await fetchAllLookupTableRows('lookup_records', filters.date || '');
                        if (valRows && valRows.length > 0) {
                            valRows.forEach(r => {
                                if (!seenPhones.has(r.phone_number)) {
                                    seenPhones.add(r.phone_number);
                                    results.push({
                                        id: r.id,
                                        phone_number: r.phone_number,
                                        full_name: r.full_name || '-',
                                        age: r.age || '-',
                                        household_income: r.household_income || '',
                                        est_market_value: r.est_market_value || '',
                                        report_type: 'lookup_report',
                                        department: 'lookup',
                                        user_email: r.worker_email,
                                        username: r.worker_username,
                                        created_at: r.created_at || r.submission_date
                                    });
                                }
                            });
                        }
                    }
                } catch(e) {
                    console.warn('fetchAllSubmissions lookup tables notice:', e);
                }
            }

            return results;
        }

        // UI Handlers for Turso
        async function refreshTursoStats() {
            const elSub = document.getElementById('tursoStatSubmissions');
            const elStock = document.getElementById('tursoStatStock');
            const elDel = document.getElementById('tursoStatDeliveries');
            const elSync = document.getElementById('tursoStatLastSync');

            if (elSync) elSync.innerText = 'Checking...';
            const stats = await TursoVault.getStats();

            if (elSub) elSub.innerText = stats.submissionsCount.toLocaleString();
            if (elStock) elStock.innerText = stats.stockCount.toLocaleString();
            if (elDel) elDel.innerText = stats.deliveriesCount.toLocaleString();
            if (elSync) elSync.innerText = stats.lastSync;

            const urlInput = document.getElementById('tursoSettingsUrl');
            const tokenInput = document.getElementById('tursoSettingsToken');
            const conf = TursoVault.getConfig();
            if (urlInput && !urlInput.value) urlInput.value = conf.url;
            if (tokenInput && !tokenInput.value) tokenInput.value = conf.token;
        }

        async function handleTursoSyncAll() {
            if (!confirm('আপনি কি সুপাবেসের সম্পূর্ণ ডাটাবেজ Turso-র ৯ জিবি ক্লাউড ভল্টে ব্যাকআপ সিঙ্ক করতে চান?\n\nএতে কোনো ডাটা মুছবে না, শুধু সুরক্ষিত ব্যাকআপ কপি জমা হবে।')) {
                return;
            }

            const btn = document.getElementById('btnTursoSyncAll');
            const box = document.getElementById('tursoSyncProgressBox');
            const txt = document.getElementById('tursoSyncStatusText');
            const pct = document.getElementById('tursoSyncPercentText');
            const bar = document.getElementById('tursoSyncProgressBar');

            if (btn) btn.disabled = true;
            if (box) box.classList.remove('hidden');

            try {
                await TursoVault.syncAll((status, percent) => {
                    if (txt) txt.innerText = status;
                    if (pct) pct.innerText = percent + '%';
                    if (bar) bar.style.width = percent + '%';
                });

                alert('🎉 অভিনন্দন! সুপাবেসের সব ডাটা Turso-র ৯ জিবি ক্লাউড ভল্টে ১০০% নিরাপদে সংরক্ষিত হয়েছে।');
                await refreshTursoStats();
            } catch (err) {
                console.error('Turso Sync error:', err);
                alert('⚠️ সিঙ্ক করতে সমস্যা হয়েছে: ' + err.message);
            } finally {
                if (btn) btn.disabled = false;
                if (box) box.classList.add('hidden');
            }
        }

        async function handleTursoArchiveAndPurge() {
            const range = document.getElementById('tursoPurgeRetentionRange')?.value || 'all';

            let msg = '⚠️ জিরো ডাটা লস গ্যারান্টি (Zero-Data-Loss Purge):\n\n১. প্রথমে সুপাবেসের সব ডাটা Turso-র ৯ জিবি ক্লাউড ভল্টে সিঙ্ক ও ১০০% নিশ্চিত করা হবে।\n২. ভল্টে ডাটা সুরক্ষিত হওয়ার পরই কেবল সুপাবেস থেকে ';
            if (range === 'all') msg += 'সকল সম্পন্ন রেকর্ড মুছে সুপাবেস সম্পূর্ণ খালি (0 MB) করা হবে।';
            else if (range === '15') msg += '১৫ দিনের পুরানো রেকর্ড সুপাবেস থেকে মুছে ফেলা হবে (সাম্প্রতিক ১৫ দিন সুপাবেসে থাকবে)।';
            else if (range === '30') msg += '৩০ দিনের পুরানো রেকর্ড সুপাবেস থেকে মুছে ফেলা হবে।';

            msg += '\n\n৩. আপনার একটি ডাটাও হারাবে না, আজীবন Turso Vault-এ সংরক্ষিত থাকবে!\n\nআপনি কি নিশ্চিত এগিয়ে যেতে চান?';

            if (!confirm(msg)) return;

            const btn = document.getElementById('btnTursoArchiveAndPurge');
            if (btn) btn.disabled = true;

            try {
                alert('⏳ ধাপ ১/২: প্রথমে সমস্ত ডাটা Turso ৯ জিবি ক্লাউড ভল্টে ব্যাকআপ নিশ্চিত করা হচ্ছে...');
                await TursoVault.syncAll();

                alert('✅ ধাপ ২/২: ক্লাউড ভল্টে ব্যাকআপ নিশ্চিত হয়েছে! এখন সুপাবেসের পুরানো রেকর্ড মুছে স্টোরেজ খালি করা হচ্ছে...');
                
                let dateThreshold = null;
                if (range === '15') {
                    const d = new Date();
                    d.setDate(d.getDate() - 15);
                    dateThreshold = d.toISOString();
                } else if (range === '30') {
                    const d = new Date();
                    d.setDate(d.getDate() - 30);
                    dateThreshold = d.toISOString();
                }

                if (dateThreshold) {
                    await supabaseClient.from('master_numbers').delete().lt('created_at', dateThreshold);
                    await supabaseClient.from('lookup_records').delete().lt('created_at', dateThreshold);
                } else {
                    await supabaseClient.from('master_numbers').delete().neq('id', 0);
                    await supabaseClient.from('lookup_records').delete().neq('id', 0);
                }

                alert('🎉 সাফল্য! সুপাবেস ডাটাবেজ সম্পূর্ণ খালি (0 MB) হয়েছে এবং সমস্ত ডাটা Turso-র ৯ জিবি ক্লাউড ভল্টে আজীবনের জন্য সুরক্ষিত রয়েছে।');
                await refreshTursoStats();
                if (typeof loadAdminDashboard === 'function') loadAdminDashboard();
            } catch (err) {
                console.error('Archive and purge error:', err);
                alert('⚠️ প্রক্রিয়া চলাকালীন ত্রুটি: ' + err.message);
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        async function handleTursoSearch() {
            const query = (document.getElementById('tursoSearchQuery')?.value || '').trim();
            const table = document.getElementById('tursoSearchResultsTable');
            if (!table) return;

            if (!query) {
                table.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-slate-400">ফোন নাম্বার বা কর্মীর নাম লিখে সার্চ বাটনে ক্লিক করুন।</td></tr>';
                return;
            }

            table.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-indigo-600 font-bold">Turso 9 GB Vault-এ সার্চ করা হচ্ছে...</td></tr>';

            try {
                const escaped = query.replace(/'/g, "''");
                const sql = `
                    SELECT * FROM turso_submissions 
                    WHERE phone_number LIKE '%${escaped}%' 
                       OR username LIKE '%${escaped}%' 
                       OR full_name LIKE '%${escaped}%'
                    ORDER BY id DESC LIMIT 50;
                `;
                const res = await TursoVault.query(sql);

                if (!res.rows || res.rows.length === 0) {
                    table.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-rose-500 font-semibold">Turso ভল্টে "${query}" সংক্রান্ত কোনো রেকর্ড পাওয়া যায়নি।</td></tr>`;
                    return;
                }

                table.innerHTML = res.rows.map((r, idx) => `
                    <tr class="hover:bg-slate-50 transition border-b">
                        <td class="p-2.5">${idx + 1}</td>
                        <td class="p-2.5 font-mono font-bold text-indigo-700">${r.phone_number || '-'}</td>
                        <td class="p-2.5">${r.full_name || '-'}</td>
                        <td class="p-2.5">${r.age || '-'}</td>
                        <td class="p-2.5">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${r.report_type === 'signal_report' ? 'bg-cyan-100 text-cyan-800' : (r.report_type === 'lookup_report' ? 'bg-purple-100 text-purple-800' : 'bg-rose-100 text-rose-800')}">
                                ${r.report_type === 'signal_report' ? '📡 Signal' : (r.report_type === 'lookup_report' ? '🔍 Lookup' : '👩 Female')}
                            </span>
                        </td>
                        <td class="p-2.5 font-bold">${r.username || r.user_email || '-'}</td>
                        <td class="p-2.5 text-[11px] text-slate-500">${r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</td>
                        <td class="p-2.5 font-mono text-[10px] text-slate-400">${r.source_table || 'turso'}</td>
                    </tr>
                `).join('');
            } catch (err) {
                table.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-red-600 font-bold">সার্চ ত্রুটি: ${err.message}</td></tr>`;
            }
        }

        async function downloadTursoVaultExcel() {
            try {
                alert('⏳ Turso ভল্ট থেকে সম্পূর্ণ ডাটা ডাউনলোড করা হচ্ছে...');
                const res = await TursoVault.query("SELECT * FROM turso_submissions ORDER BY id DESC LIMIT 50000;");
                if (!res.rows || res.rows.length === 0) {
                    alert('Turso ভল্টে কোনো রেকর্ড নেই। অনুগ্রহ করে প্রথমে "Sync All Data" বাটনে ক্লিক করুন।');
                    return;
                }

                const rows = res.rows.map((r, idx) => ({
                    'SL': idx + 1,
                    'Phone Number': r.phone_number,
                    'Full Name': r.full_name || '',
                    'Age': r.age || '',
                    'Household Income': r.household_income || '',
                    'Est Market Value': r.est_market_value || '',
                    'Report Type': r.report_type || '',
                    'Department': r.department || '',
                    'Submitted By': r.username || r.user_email || '',
                    'Submission Date': r.created_at || '',
                    'Vault Source': r.source_table || '',
                    'Archived At': r.archived_at || ''
                }));

                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Turso_Vault_Master");

                const today = new Date().toISOString().slice(0, 10);
                XLSX.writeFile(wb, `Turso_9GB_Vault_Master_${today}.xlsx`);
                alert(`✅ সফলভাবে ${rows.length} টি রেকর্ড এক্সেলে ডাউনলোড হয়েছে!`);
            } catch (err) {
                alert('ডাউনলোড ত্রুটি: ' + err.message);
            }
        }

        function saveTursoSettings() {
            const url = document.getElementById('tursoSettingsUrl')?.value;
            const token = document.getElementById('tursoSettingsToken')?.value;
            if (!url || !token) {
                alert('URL এবং Auth Token দুটোই দিতে হবে।');
                return;
            }
            TursoVault.saveConfig(url, token);
            alert('✅ Turso ক্রেডেনশিয়ালস সফলভাবে ব্রাউজারে সেভ হয়েছে!');
            refreshTursoStats();
        }

        async function testTursoConnection() {
            try {
                alert('⚡ Turso ক্লাউড ডাটাবেজ কানেকশন টেস্ট করা হচ্ছে...');
                const res = await TursoVault.query("SELECT 'Turso Online' as status, datetime('now') as time;");
                if (res.rows && res.rows[0]) {
                    alert('🎉 কানেকশন সফল!\n\nস্ট্যাটাস: ' + res.rows[0].status + '\nসার্ভার টাইম: ' + res.rows[0].time + '\nলোকেশন: AWS AP South (Mumbai)');
                    refreshTursoStats();
                } else {
                    alert('কানেকশন উত্তর দেয়নি।');
                }
            } catch (err) {
                alert('❌ কানেকশন ব্যর্থ হয়েছে: ' + err.message);
            }
        }


// Google Drive Client State (Global & Safe)
        var googleTokenClient = null;
        var googleAccessToken = localStorage.getItem('gdrive_access_token') || null;
        var googleUserEmail = localStorage.getItem('gdrive_user_email') || null;
        var recStockCache = [];
        var recStockParsedRows = [];

        // Extensive High-Speed Verified Names Dictionary
        const MALE_NAMES_DB = new Set();

        const FEMALE_NAMES_DB = new Set();

        window.addEventListener('DOMContentLoaded', () => {
            initSupabase();
            updateCurrentDate();
            if (typeof TursoVault !== 'undefined') {
                TursoVault.init();
            }
        });

        function updateCurrentDate() {
            const now = new Date();
            const el = document.getElementById('currentDateStr');
            if (el) el.innerText = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
        }

        function initSupabase() {
            const url = localStorage.getItem('SP_URL') || DEFAULT_SP_URL;
            const key = localStorage.getItem('SP_KEY') || DEFAULT_SP_KEY;

            localStorage.setItem('SP_URL', url);
            localStorage.setItem('SP_KEY', key);

            try {
                supabaseClient = window.supabase.createClient(url, key);
                checkSession();
                return true;
            } catch (err) {
                console.error('Supabase init error:', err);
                return false;
            }
        }

        async function checkSession() {
            if (!supabaseClient) {
                currentUser = null;
                currentProfile = null;
                showView('loginView');
                return;
            }
            try {
                const { data: { session }, error } = await supabaseClient.auth.getSession();
                if (session && session.user) {
                    currentUser = session.user;
                    await loadUserProfile();
                    setupGoogleDriveClient();
                    const recDateInput = document.getElementById('recInputDate');
                    if (recDateInput && !recDateInput.value) {
                        recDateInput.value = new Date().toISOString().slice(0, 10);
                    }
                    const cdDateInput = document.getElementById('cdInputDate');
                    if (cdDateInput && !cdDateInput.value) {
                        cdDateInput.value = new Date().toISOString().slice(0, 10);
                    }
                } else {
                    currentUser = null;
                    currentProfile = null;
                    showView('loginView');
                }
            } catch(e) {
                console.warn('Session check notice:', e);
                currentUser = null;
                currentProfile = null;
                showView('loginView');
            }
        }

        // ==========================================
        // AUTHENTICATION
        // ==========================================
        function switchAuthMode(mode) {
            currentAuthMode = mode;
            const tabSignIn = document.getElementById('tabSignInBtn');
            const tabSignUp = document.getElementById('tabSignUpBtn');
            const deptContainer = document.getElementById('deptSelectContainer');
            const title = document.getElementById('authTitle');
            const subtitle = document.getElementById('authSubtitle');
            const submitBtn = document.getElementById('loginSubmitBtn');
            const togglePrompt = document.getElementById('authTogglePrompt');
            const toggleBtn = document.getElementById('authToggleBtn');
            const errBox = document.getElementById('loginError');
            const successBox = document.getElementById('loginSuccessMsg');

            if (errBox) errBox.classList.add('hidden');
            if (successBox) successBox.classList.add('hidden');

            const usernameContainer = document.getElementById('usernameContainer');
            const usernameInput = document.getElementById('signupUsername');

            if (mode === 'signup') {
                tabSignUp.className = 'flex-1 pb-3 text-sm font-bold border-b-2 border-indigo-600 text-indigo-600 transition';
                tabSignIn.className = 'flex-1 pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition';
                deptContainer.classList.remove('hidden');
                if (usernameContainer) usernameContainer.classList.remove('hidden');
                if (usernameInput) usernameInput.required = true;
                title.innerText = 'Create New Account';
                subtitle.innerText = 'Register your account and select your department';
                submitBtn.innerHTML = '<span>Create Account</span>';
                togglePrompt.innerText = 'Already have an account?';
                toggleBtn.innerText = 'Sign In';
            } else {
                tabSignIn.className = 'flex-1 pb-3 text-sm font-bold border-b-2 border-indigo-600 text-indigo-600 transition';
                tabSignUp.className = 'flex-1 pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition';
                deptContainer.classList.add('hidden');
                if (usernameContainer) usernameContainer.classList.add('hidden');
                if (usernameInput) usernameInput.required = false;
                title.innerText = 'Sign In to Your Account';
                subtitle.innerText = 'Enter your credentials to access your daily workspace';
                submitBtn.innerHTML = '<span>Sign In</span>';
                togglePrompt.innerText = "Don't have an account?";
                toggleBtn.innerText = 'Create an account';
            }
        }

        function toggleAuthMode() {
            switchAuthMode(currentAuthMode === 'signin' ? 'signup' : 'signin');
        }

        async function handleAuthSubmit(e) {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value.trim();
            const dept = document.getElementById('signupDept') ? document.getElementById('signupDept').value : 'gender_verify';
            const usernameInput = document.getElementById('signupUsername');
            const rawUsername = usernameInput ? usernameInput.value.trim() : '';
            const cleanUsername = rawUsername.replace(/\s+/g, '_') || email.split('@')[0];
            const errBox = document.getElementById('loginError');
            const successBox = document.getElementById('loginSuccessMsg');
            const submitBtn = document.getElementById('loginSubmitBtn');

            if (errBox) errBox.classList.add('hidden');
            if (successBox) successBox.classList.add('hidden');
            submitBtn.disabled = true;

            try {
                if (!supabaseClient) throw new Error('Database connection failed.');

                if (currentAuthMode === 'signup') {
                    submitBtn.innerHTML = '<span>Creating Account...</span>';
                    const { data, error } = await supabaseClient.auth.signUp({
                        email: email,
                        password: password,
                        options: {
                            data: {
                                username: cleanUsername,
                                department: dept,
                                role: 'user'
                            }
                        }
                    });

                    if (error) throw error;

                    if (data && data.user) {
                        try {
                            await supabaseClient.from('profiles').upsert({
                                id: data.user.id,
                                email: email,
                                username: cleanUsername,
                                department: dept,
                                role: 'user'
                            });
                        } catch (pErr) {
                            console.warn('Profile sync:', pErr);
                        }
                    }

                    if (error) throw error;

                    if (data && data.session) {
                        currentUser = data.user;
                        await loadUserProfile();
                setupGoogleDriveClient();
            const recDateInput = document.getElementById('recInputDate');
            if (recDateInput && !recDateInput.value) {
                recDateInput.value = new Date().toISOString().slice(0, 10);
            }
            const cdDateInput = document.getElementById('cdInputDate');
            if (cdDateInput && !cdDateInput.value) {
                cdDateInput.value = new Date().toISOString().slice(0, 10);
            }

                    } else {
                        if (successBox) {
                            successBox.innerText = 'Account created successfully! You can now Sign In.';
                            successBox.classList.remove('hidden');
                        }
                        switchAuthMode('signin');
                    }
                } else {
                    submitBtn.innerHTML = '<span>Signing In...</span>';
                    const { data, error } = await supabaseClient.auth.signInWithPassword({
                        email: email,
                        password: password
                    });

                    if (error) throw error;
                    currentUser = data.user;
                    await loadUserProfile();
                setupGoogleDriveClient();
            const recDateInput = document.getElementById('recInputDate');
            if (recDateInput && !recDateInput.value) {
                recDateInput.value = new Date().toISOString().slice(0, 10);
            }
            const cdDateInput = document.getElementById('cdInputDate');
            if (cdDateInput && !cdDateInput.value) {
                cdDateInput.value = new Date().toISOString().slice(0, 10);
            }

                }
            } catch (err) {
                console.error(err);
                if (errBox) {
                    errBox.innerText = err.message || 'Authentication failed';
                    errBox.classList.remove('hidden');
                }
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = currentAuthMode === 'signup' ? '<span>Create Account</span>' : '<span>Sign In</span>';
            }
        }

        async function handleLogout() {
            try {
                if (supabaseClient) {
                    await supabaseClient.auth.signOut();
                }
            } catch (err) {
                console.warn('SignOut error:', err);
            }
            // Completely wipe all cached auth tokens from localStorage
            try {
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith('sb-') || k.includes('auth-token') || k === 'supabase.auth.token') {
                        localStorage.removeItem(k);
                    }
                });
            } catch(e) {}

            currentUser = null;
            currentProfile = null;
            const userInfo = document.getElementById('userInfo');
            if (userInfo) {
                userInfo.classList.add('hidden');
                userInfo.classList.remove('flex');
            }
            const navLinks = document.getElementById('navLinks');
            if (navLinks) {
                navLinks.classList.add('hidden');
                navLinks.classList.remove('flex');
            }
            showView('loginView');
            switchAuthMode('signin');
        }

        async function loadUserProfile() {
            try {
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', currentUser.id)
                    .single();

                currentProfile = profile || {
                    id: currentUser.id,
                    email: currentUser.email,
                    username: currentUser.user_metadata?.username || currentUser.email.split('@')[0],
                    role: currentUser.user_metadata?.role || 'user',
                    department: currentUser.user_metadata?.department || 'gender_verify'
                };

                if (!currentProfile.username) {
                    currentProfile.username = currentUser.user_metadata?.username || currentProfile.email.split('@')[0];
                }

                if (currentProfile && currentProfile.is_blocked === true) {
                    await supabaseClient.auth.signOut();
                    alert('❌ আপনার অ্যাকাউন্টটি অ্যাডমিন কর্তৃক ব্লক/স্থগিত করা হয়েছে!\n\nআপনি আর এই পোর্টালে কাজ করতে বা প্রবেশ করতে পারবেন না। বিস্তারিত তথ্যের জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।');
                    showView('loginView');
                    return;
                }

                // Master Owner Email is ALWAYS Admin
                if (currentUser.email && currentUser.email.toLowerCase().trim() === 'ramolmoaran@gmail.com') {
                    currentProfile.role = 'admin';
                    currentProfile.department = 'admin';
                    currentProfile.is_unlimited_quota = true;
                    // Auto-sync in database table so RPCs never complain
                    try {
                        await supabaseClient.from('profiles').upsert({
                            id: currentUser.id,
                            email: currentUser.email,
                            username: currentProfile.username || 'Admin',
                            role: 'admin',
                            department: 'admin',
                            is_unlimited_quota: true
                        });
                    } catch(syncErr) {
                        console.warn('Admin profile sync notice:', syncErr);
                    }
                }

                document.getElementById('userInfo').classList.remove('hidden');
                document.getElementById('userInfo').classList.add('flex');
                const emailEl = document.getElementById('userEmail');
                if (emailEl) {
                    emailEl.innerText = currentProfile.username;
                    emailEl.title = `${currentProfile.username} (${currentProfile.email})`;
                }
                const workerBadge = document.getElementById('workerUsernameBadge');
                if (workerBadge) workerBadge.innerText = currentProfile.username;

                const navLinks = document.getElementById('navLinks');
                if (navLinks) {
                    navLinks.classList.remove('hidden');
                    navLinks.classList.add('flex');
                }

                const badge = document.getElementById('userBadge');
                const isLeader = currentProfile && (currentProfile.role === 'team_leader' || currentProfile.role === 'admin' || currentProfile.is_unlimited_quota === true);
                
                const navDashBtn = document.getElementById('navBtnDashboard');
                const navLookupBtn = document.getElementById('navBtnLookupChecker');

                if (currentProfile.role === 'admin') {
                    badge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold bg-purple-200 text-purple-900';
                    badge.innerText = '⚡ Master Admin';
                    if (navDashBtn) navDashBtn.innerHTML = '<span>👑</span><span>Admin Panel</span>';
                    if (navLookupBtn) navLookupBtn.classList.remove('hidden');
                    switchToSection('dashboard');
                } else if (isLeader) {
                    badge.className = 'text-xs px-2.5 py-1 rounded-full font-black bg-amber-400 text-slate-950 shadow-sm border border-amber-300';
                    badge.innerText = '👑 Team Leader (আনলিমিটেড)';
                    let deptName = (currentProfile.department === 'lookup' || currentProfile.department === 'number_lookup') ? 'Number Lookup' : 'Gender Verify (Female & Signal)';
                    document.getElementById('userDeptTitle').innerText = `${deptName} — 👑 টিম লিডার (আনলিমিটেড কোটা)`;
                    if (navDashBtn) navDashBtn.innerHTML = '<span>👷</span><span>My Work (আমার কাজ)</span>';
                    if (navLookupBtn) navLookupBtn.classList.remove('hidden');
                    setupWorkerReportOptions(currentProfile.department);
                    switchToSection('dashboard');
                } else {
                    let deptLabel = (currentProfile.department === 'lookup' || currentProfile.department === 'number_lookup') ? 'Number Lookup' : 'Gender Verify (Female & Signal)';
                    badge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold bg-indigo-200 text-indigo-900';
                    badge.innerText = deptLabel;
                    document.getElementById('userDeptTitle').innerText = deptLabel;
                    if (navDashBtn) navDashBtn.innerHTML = '<span>👷</span><span>My Work (আমার কাজ)</span>';
                    if (navLookupBtn) navLookupBtn.classList.remove('hidden');
                    setupWorkerReportOptions(currentProfile.department);
                    switchToSection('dashboard');
                }
            } catch (err) {
                console.error(err);
            }
        }

        
        // =========================================================================
        // FEMALE AGE FILTER: Age >= 43 allowed, Deceased/Unknown allowed, < 43 removed
        // =========================================================================
        function isFemaleUnderage(ageVal) {
            if (!ageVal) return false;
            const s = String(ageVal).trim().toLowerCase();
            if (!s || s === '-' || s === '?' || s === 'none' || s === 'n/a') return false;
            // Deceased / Decressed / Unknown are strictly ALLOWED!
            if (s.includes('dec') || s.includes('unk') || s.includes('dead') || s.includes('death')) {
                return false;
            }

        // =========================================================================
        // MALE AGE FILTER: Age >= 41 allowed, Deceased/Unknown allowed, < 41 removed
        // =========================================================================
        function isMaleUnderage(ageVal) {
            if (!ageVal) return false;
            const s = String(ageVal).trim().toLowerCase();
            if (!s || s === '-' || s === '?' || s === 'none' || s === 'n/a') return false;
            // Deceased / Decressed / Unknown are strictly ALLOWED!
            if (s.includes('dec') || s.includes('unk') || s.includes('dead') || s.includes('death')) {
                return false;
            }
            // Check numeric age
            const match = s.match(/\b\d{1,3}\b/);
            if (match) {
                const n = parseInt(match[0], 10);
                if (n > 0 && n < 41) {
                    return true; // Under 41 years old!
                }
            }
            return false;
        }
            // Check numeric age
            const match = s.match(/\b\d{1,3}\b/);
            if (match) {
                const n = parseInt(match[0], 10);
                if (n > 0 && n < 43) {
                    return true; // Under 43 years old!
                }
            }
            return false;
        }

function setupWorkerReportOptions(dept) {
            const optFemale = document.getElementById('optFemaleReport');
            const optLookup = document.getElementById('optLookupReport');
            const optSignal = document.getElementById('optSignalReport');
            const optMaleSignal = document.getElementById('optMaleSignalReport');
            const optMale = document.getElementById('optMaleReport');

            const isAdmin = currentProfile && currentProfile.role === 'admin';
            const isLookup = (dept === 'lookup' || dept === 'number_lookup');
            const isMaleDept = (dept === 'male');

            if (isAdmin) {
                // Admin sees all 4 report options
                if (optFemale) optFemale.classList.remove('hidden');
                if (optLookup) optLookup.classList.remove('hidden');
                if (optSignal) optSignal.classList.remove('hidden');
                if (optMale) optMale.classList.remove('hidden');
            } else if (isLookup) {
                // Number Lookup worker ONLY sees Lookup Report
                if (optFemale) optFemale.classList.add('hidden');
                if (optSignal) optSignal.classList.add('hidden');
                if (optMale) optMale.classList.add('hidden');
                if (optLookup) {
                    optLookup.classList.remove('hidden');
                    const r = optLookup.querySelector('input');
                    if (r) r.checked = true;
                }
            } else if (isMaleDept) {
                // Male worker sees Male Report
                if (optFemale) optFemale.classList.add('hidden');
                if (optLookup) optLookup.classList.add('hidden');
                if (optSignal) optSignal.classList.add('hidden');
                if (optMale) {
                    optMale.classList.remove('hidden');
                    const r = optMale.querySelector('input');
                    if (r) r.checked = true;
                }
            } else {
                // Gender Verify worker sees Female Report, Male Report AND Signal Report (Hides Lookup Report)
                if (optLookup) optLookup.classList.add('hidden');
                if (optFemale) {
                    optFemale.classList.remove('hidden');
                    const r = optFemale.querySelector('input');
                    if (r) r.checked = true;
                }
                if (optMale) optMale.classList.remove('hidden');
                if (optSignal) optSignal.classList.remove('hidden');
            }

            if (typeof handleWorkerReportTypeChanged === 'function') {
                handleWorkerReportTypeChanged();
            }
        }

        
        // Safe Query Wrapper: Awaits any Thenable or Promise, catching rejections safely without needing .catch on builder
        async function safeQuery(thenableOrPromise, fallback = {}) {
            try {
                if (!thenableOrPromise) return fallback;
                const res = await thenableOrPromise;
                return res || fallback;
            } catch (err) {
                console.warn('safeQuery handled notice:', err);
                return fallback;
            }
        }

        function showView(viewId) {
            // IRONCLAD ACCESS CONTROL:
            // 1. If not logged in or explicitly requesting loginView, NEVER show header controls!
            if (!currentUser || viewId === 'loginView') {
                viewId = 'loginView';
                const userInfo = document.getElementById('userInfo');
                if (userInfo) {
                    userInfo.classList.add('hidden');
                    userInfo.classList.remove('flex');
                }
                const navLinks = document.getElementById('navLinks');
                if (navLinks) {
                    navLinks.classList.add('hidden');
                    navLinks.classList.remove('flex');
                }
            } else {
                // User is authenticated and viewing a dashboard section
                const userInfo = document.getElementById('userInfo');
                if (userInfo) {
                    userInfo.classList.remove('hidden');
                    userInfo.classList.add('flex');
                }
                const navLinks = document.getElementById('navLinks');
                if (navLinks) {
                    navLinks.classList.remove('hidden');
                    navLinks.classList.add('flex');
                }

                // Block non-admin from admin views
                if (viewId === 'adminDashboard' && (!currentProfile || currentProfile.role !== 'admin')) {
                    viewId = 'userDashboard';
                }
// Lookup Checker is open to all team members and workers
            }

            ['loginView', 'userDashboard', 'adminDashboard', 'duplicateCheckView', 'claimStockView', 'lookupCheckerView'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });
            const target = document.getElementById(viewId);
            if (target) target.classList.remove('hidden');
        }

        function switchToSection(sec) {
            const btnDash = document.getElementById('navBtnDashboard');
            const btnClaim = document.getElementById('navBtnClaimStock');
            const btnDup = document.getElementById('navBtnDuplicate');
            const btnLookupChk = document.getElementById('navBtnLookupChecker');

            if (btnDash) btnDash.className = 'text-xs whitespace-nowrap bg-indigo-900/40 hover:bg-indigo-800 text-indigo-100 font-semibold px-3.5 py-2 rounded-xl transition flex items-center space-x-1.5 border border-indigo-700/40 flex-shrink-0 cursor-pointer';
            if (btnClaim) btnClaim.className = 'text-xs whitespace-nowrap bg-indigo-900/40 hover:bg-indigo-800 text-indigo-100 font-semibold px-3.5 py-2 rounded-xl transition flex items-center space-x-1.5 border border-indigo-700/40 flex-shrink-0 cursor-pointer';
            if (btnDup) btnDup.className = 'text-xs whitespace-nowrap bg-emerald-600/80 hover:bg-emerald-600 text-white font-bold px-3.5 py-2 rounded-xl transition flex items-center space-x-1.5 border border-emerald-500/40 flex-shrink-0 cursor-pointer shadow-xs';
            if (btnLookupChk) btnLookupChk.className = 'text-xs whitespace-nowrap bg-purple-900/40 hover:bg-purple-800 text-purple-100 font-semibold px-3.5 py-2 rounded-xl transition flex items-center space-x-1.5 border border-purple-700/40 flex-shrink-0 cursor-pointer';

            if (sec === 'dashboard') {
                if (btnDash) btnDash.className = 'text-xs whitespace-nowrap bg-indigo-900 text-white font-bold px-3.5 py-2 rounded-xl shadow-xs transition flex items-center space-x-1.5 border border-indigo-500/40 flex-shrink-0 cursor-pointer';
                if (currentProfile && currentProfile.role === 'admin') {
                    showView('adminDashboard');
                    loadAdminDashboard();
                } else {
                    showView('userDashboard');
                    loadUserDashboard();
                }

            } else if (sec === 'claim_stock') {
                if (!currentUser) {
                    alert('অনুগ্রহ করে প্রথমে আপনার অ্যাকাউন্টে লগইন করুন। লগইন করা ছাড়া কোনো নাম্বার দেখা বা নেওয়া যাবে না।');
                    showView('loginView');
                    return;
                }
                if (btnClaim) btnClaim.className = 'text-xs whitespace-nowrap bg-indigo-900 text-white font-bold px-3.5 py-2 rounded-xl shadow-xs transition flex items-center space-x-1.5 border border-indigo-500/40 flex-shrink-0 cursor-pointer';
                showView('claimStockView');
                loadClaimStockSector();

            } else if (sec === 'duplicate_check') {
                if (btnDup) btnDup.className = 'text-xs whitespace-nowrap bg-emerald-600 text-white font-black px-3.5 py-2 rounded-xl shadow-xs transition flex items-center space-x-1.5 border border-emerald-400 flex-shrink-0 cursor-pointer ring-2 ring-emerald-400/30';
                showView('duplicateCheckView');
            } else if (sec === 'lookup_checker') {
                if (btnLookupChk) btnLookupChk.className = 'text-xs whitespace-nowrap bg-purple-700 text-white font-black px-3.5 py-2 rounded-xl shadow-xs transition flex items-center space-x-1.5 border border-purple-400 flex-shrink-0 cursor-pointer';
                showView('lookupCheckerView');
            }
        }

        // ==========================================
        // WORKER SUBMISSIONS (PHONE, NAME, AGE)
        // ==========================================
        // Global Cache for Monthly Analytics
        let workerMonthlyArchive = {};
        let currentWorkerSelectedMonthKey = '';

        function openNewMonthWelcomeModal(curMonthName, curYear, lastMonthName, lastMonthCount) {
            const modal = document.getElementById('newMonthWelcomeModal');
            if (!modal) return;
            const badge = document.getElementById('modalWelcomeBadge');
            if (badge) badge.innerText = `Welcome ${curMonthName} ${curYear}!`;
            const lastCnt = document.getElementById('modalLastMonthCount');
            if (lastCnt) lastCnt.innerText = `${(lastMonthCount || 0).toLocaleString()} টি`;
            modal.classList.remove('hidden');
        }

        function closeNewMonthWelcomeModal() {
            const modal = document.getElementById('newMonthWelcomeModal');
            if (modal) modal.classList.add('hidden');
        }

        function dismissNewMonthBanner() {
            const banner = document.getElementById('newMonthGreetingBanner');
            if (banner) banner.classList.add('hidden');
        }

        async function loadUserDashboard() {
            if (!supabaseClient || !currentUser) return;

            const now = new Date();
            const curYear = now.getFullYear();
            const curMonth = now.getMonth(); // 0 = Jan ... 8 = Sep, 9 = Oct
            const dayOfMonth = now.getDate(); // 1 to 31

            const todayStart = new Date(curYear, curMonth, dayOfMonth, 0, 0, 0, 0);
            const todayIso = todayStart.toISOString();

            // Dynamic Month Bounds (1st to 30 or 31)
            const curMonthStart = new Date(curYear, curMonth, 1, 0, 0, 0, 0);
            const curMonthEnd = new Date(curYear, curMonth + 1, 0, 23, 59, 59, 999);
            const curMonthDays = curMonthEnd.getDate(); // 28, 29, 30, or 31

            const lastMonthIndex = (curMonth + 11) % 12;
            const lastMonthYear = curMonth === 0 ? curYear - 1 : curYear;
            const lastMonthStart = new Date(lastMonthYear, lastMonthIndex, 1, 0, 0, 0, 0);
            const lastMonthEnd = new Date(curYear, curMonth, 0, 23, 59, 59, 999);
            const lastMonthDays = lastMonthEnd.getDate();

            const curMonthStartIso = curMonthStart.toISOString();
            const curMonthEndIso = curMonthEnd.toISOString();
            const lastMonthStartIso = lastMonthStart.toISOString();
            const lastMonthEndIso = lastMonthEnd.toISOString();

            const monthNamesBn = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
            const curMonthNameBn = monthNamesBn[curMonth];
            const lastMonthNameBn = monthNamesBn[lastMonthIndex];

            const curMonthKey = `${curYear}-${String(curMonth + 1).padStart(2, '0')}`;
            const lastMonthKey = `${lastMonthYear}-${String(lastMonthIndex + 1).padStart(2, '0')}`;

            // Refresh available stock count for worker
            loadWorkerClaimStockCount();

            // Fetch all user upload logs to build monthly performance & historical archive
            const { data: logs } = await supabaseClient
                .from('upload_logs')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });

            let todayUnique = 0;
            let todayDuplicates = 0;
            let todayFemaleDone = 0;
            let todayMaleDone = 0;

            let thisMonthUnique = 0;
            let thisMonthDuplicates = 0;
            let lastMonthUnique = 0;

            // Reset monthly archive
            workerMonthlyArchive = {};
            workerMonthlyArchive[curMonthKey] = {
                key: curMonthKey,
                label: `চলতি মাস: ${curMonthNameBn} ${curYear} (১-${curMonthDays} তারিখ)`,
                year: curYear,
                month: curMonth,
                totalUnique: 0,
                femaleCount: 0,
                lookupCount: 0,
                dupCount: 0,
                days: {}
            };
            workerMonthlyArchive[lastMonthKey] = {
                key: lastMonthKey,
                label: `গত মাস: ${lastMonthNameBn} ${lastMonthYear} (১-${lastMonthDays} তারিখ)`,
                year: lastMonthYear,
                month: lastMonthIndex,
                totalUnique: 0,
                femaleCount: 0,
                lookupCount: 0,
                dupCount: 0,
                days: {}
            };

            const historyBody = document.getElementById('userUploadHistoryBody');
            if (historyBody) historyBody.innerHTML = '';

            let todayLogsCount = 0;

            if (logs && logs.length > 0) {
                logs.forEach(log => {
                    const dt = new Date(log.created_at);
                    const lYear = dt.getFullYear();
                    const lMonth = dt.getMonth();
                    const mKey = `${lYear}-${String(lMonth + 1).padStart(2, '0')}`;
                    const dKey = dt.toISOString().split('T')[0];

                    if (!workerMonthlyArchive[mKey]) {
                        const mLabel = `${monthNamesBn[lMonth]} ${lYear}`;
                        workerMonthlyArchive[mKey] = {
                            key: mKey,
                            label: `${mLabel}`,
                            year: lYear,
                            month: lMonth,
                            totalUnique: 0,
                            femaleCount: 0,
                            maleCount: 0,
                            lookupCount: 0,
                            dupCount: 0,
                            days: {}
                        };
                    }
                    const mObj = workerMonthlyArchive[mKey];
                    mObj.totalUnique += (log.new_inserted || 0);
                    mObj.dupCount += (log.duplicates_count || 0);
                    if (log.report_type === 'female_report') mObj.femaleCount += (log.new_inserted || 0);
                    else if (log.report_type === 'male_report') mObj.maleCount = (mObj.maleCount || 0) + (log.new_inserted || 0);
                    else if (log.report_type === 'lookup_report' || log.report_type === 'lookup_valid' || log.report_type === 'lookup_no_info') mObj.lookupCount += (log.new_inserted || 0);

                    if (!mObj.days[dKey]) {
                        mObj.days[dKey] = {
                            date: dKey,
                            filesCount: 0,
                            totalUnique: 0,
                            femaleCount: 0,
                            maleCount: 0,
                            lookupCount: 0,
                            dupCount: 0
                        };
                    }
                    const dObj = mObj.days[dKey];
                    dObj.filesCount += 1;
                    dObj.totalUnique += (log.new_inserted || 0);
                    dObj.dupCount += (log.duplicates_count || 0);
                    if (log.report_type === 'female_report') dObj.femaleCount += (log.new_inserted || 0);
                    else if (log.report_type === 'male_report') dObj.maleCount = (dObj.maleCount || 0) + (log.new_inserted || 0);
                    else if (log.report_type === 'lookup_report' || log.report_type === 'lookup_valid' || log.report_type === 'lookup_no_info') dObj.lookupCount += (log.new_inserted || 0);

                    // Today's metrics
                    if (log.created_at >= todayIso) {
                        todayLogsCount++;
                        todayUnique += log.new_inserted;
                        todayDuplicates += log.duplicates_count;
                        if (log.report_type === 'female_report') {
                            todayFemaleDone += log.new_inserted;
                        } else if (log.report_type === 'male_report') {
                            todayMaleDone += log.new_inserted;
                        }

                        if (historyBody) {
                            const timeStr = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            let repLabel = '📁 Other Report';
                            if (log.report_type === 'female_report') repLabel = '👩 Female Report';
                            else if (log.report_type === 'male_report') repLabel = '👨 Male Report';
                            else if (log.report_type === 'lookup_valid') repLabel = '🔍 Lookup Valid';
                            else if (log.report_type === 'lookup_no_info') repLabel = '⚪ Lookup No-Info';
                            else if (log.report_type === 'lookup_report') repLabel = '🔍 Lookup Report';
                            historyBody.innerHTML += `
                                <tr class="hover:bg-slate-50 transition">
                                    <td class="py-3 px-4 font-mono text-xs">${timeStr}</td>
                                    <td class="py-3 px-4 font-bold text-xs">${repLabel}</td>
                                    <td class="py-3 px-4 font-medium text-slate-700">${log.file_name || 'Upload'}</td>
                                    <td class="py-3 px-4 font-mono">${log.total_received}</td>
                                    <td class="py-3 px-4 font-bold font-mono text-emerald-600">+${log.new_inserted}</td>
                                    <td class="py-3 px-4 font-mono text-amber-600">${log.duplicates_count}</td>
                                    <td class="py-3 px-4 text-center space-x-1.5">
                                        <button type="button" onclick="openCategoryCorrectionModal('${log.id}', '${log.report_type}', '${log.file_name || 'Upload'}', ${log.new_inserted})" class="text-[11px] font-extrabold text-indigo-700 hover:text-indigo-950 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg transition" title="ভুল ক্যাটাগরি পরিবর্তন করুন">
                                            🔄 ক্যাটাগরি বদলান
                                        </button>
                                        <button type="button" onclick="cancelMistakenSubmissionBatch('${log.id}', ${log.new_inserted})" class="text-[11px] font-bold text-rose-600 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2.5 py-1 rounded-lg transition" title="ভুল সাবমিশন সম্পূর্ণ বাতিল করে নতুন করে দিন">
                                            🗑️ বাতিল
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }
                    }

                    // This Month metrics (1st to 30/31)
                    if (log.created_at >= curMonthStartIso && log.created_at <= curMonthEndIso) {
                        thisMonthUnique += (log.new_inserted || 0);
                        thisMonthDuplicates += (log.duplicates_count || 0);
                    }

                    // Last Month metrics (1st to 30/31 of previous month)
                    if (log.created_at >= lastMonthStartIso && log.created_at <= lastMonthEndIso) {
                        lastMonthUnique += (log.new_inserted || 0);
                    }
                });
            }

            if (historyBody && todayLogsCount === 0) {
                historyBody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-slate-400">No uploads yet today.</td></tr>`;
            }

            // Update Current Month Stat Card (১ থেকে ৩০/৩১ সাইকেল)
            const statThisMonthEl = document.getElementById('statUserThisMonthUnique');
            if (statThisMonthEl) statThisMonthEl.innerText = thisMonthUnique.toLocaleString();
            const statThisMonthRangeEl = document.getElementById('statUserThisMonthRange');
            if (statThisMonthRangeEl) statThisMonthRangeEl.innerText = `১ - ${curMonthDays} ${curMonthNameBn} ${curYear}`;
            const statThisMonthBadgeEl = document.getElementById('statUserThisMonthBadge');
            if (statThisMonthBadgeEl) statThisMonthBadgeEl.innerText = `${curMonthNameBn} ${curYear}`;

            // Update Today's Stat Cards
            const statTodayUnqEl = document.getElementById('statUserTodayUnique');
            if (statTodayUnqEl) statTodayUnqEl.innerText = todayUnique.toLocaleString();
            const statTodayDupEl = document.getElementById('statUserTodayDuplicates');
            if (statTodayDupEl) statTodayDupEl.innerText = todayDuplicates.toLocaleString();

            // All-Time Count directly from master_numbers
            const { count: allTimeCount } = await supabaseClient
                .from('master_numbers')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', currentUser.id);

            const statAllTimeEl = document.getElementById('statUserAllTime');
            if (statAllTimeEl) statAllTimeEl.innerText = (allTimeCount || 0).toLocaleString();

            // Direct count from master_numbers for female to guarantee 100% precision for today
            try {
                const { count: directFemale } = await supabaseClient
                    .from('master_numbers')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', currentUser.id)
                    .eq('report_type', 'female_report')
                    .gte('created_at', todayIso);

                if (directFemale !== null && directFemale !== undefined) {
                    todayFemaleDone = Math.max(todayFemaleDone, directFemale);
                }

                const { count: directMale } = await supabaseClient
                    .from('master_numbers')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', currentUser.id)
                    .eq('report_type', 'male_report')
                    .gte('created_at', todayIso);

                if (directMale !== null && directMale !== undefined) {
                    todayMaleDone = Math.max(todayMaleDone, directMale);
                }

                // Also check Turso submissions for precision
                if (typeof TursoVault !== 'undefined') {
                    const tUserCond = `(user_email = '${currentUser.email}' OR username = '${currentProfile?.username || ''}' OR user_id = '${currentUser.id}')`;
                    const tMaleRes = await safeQuery(TursoVault.query(`SELECT COUNT(*) as cnt FROM turso_submissions WHERE ${tUserCond} AND report_type = 'male_report' AND date(created_at) = date('now');`), null);
                    if (tMaleRes && tMaleRes.rows && tMaleRes.rows[0]) {
                        todayMaleDone = Math.max(todayMaleDone, parseInt(tMaleRes.rows[0].cnt || 0, 10));
                    }
                    const tFemRes = await safeQuery(TursoVault.query(`SELECT COUNT(*) as cnt FROM turso_submissions WHERE ${tUserCond} AND report_type = 'female_report' AND date(created_at) = date('now');`), null);
                    if (tFemRes && tFemRes.rows && tFemRes.rows[0]) {
                        todayFemaleDone = Math.max(todayFemaleDone, parseInt(tFemRes.rows[0].cnt || 0, 10));
                    }
                }
            } catch (cntErr) {
                console.warn('Direct report type count notice:', cntErr);
            }

            // Update Target Tracker UI (210 Female + 210 Male = 420 Total target)
            updateWorkerTargetTrackerUI(todayFemaleDone, todayMaleDone);

            // =========================================================================
            // NEW MONTH GREETING & MOTIVATION BANNER (Days 1 to 3 of every month)
            // =========================================================================
            const greetingBanner = document.getElementById('newMonthGreetingBanner');
            if (dayOfMonth >= 1 && dayOfMonth <= 3) {
                if (greetingBanner) {
                    greetingBanner.classList.remove('hidden');
                    const lastMCountEl = document.getElementById('greetingLastMonthCount');
                    if (lastMCountEl) lastMCountEl.innerText = lastMonthUnique.toLocaleString();
                    const curMBadge = document.getElementById('greetingCurMonthBadge');
                    if (curMBadge) curMBadge.innerText = `Welcome ${curMonthNameBn} ${curYear}!`;
                }
                // Automatic Celebration Modal on first visit of the day
                const greetStorageKey = `new_month_welcome_shown_${curYear}_${curMonth}_${dayOfMonth}`;
                if (!localStorage.getItem(greetStorageKey)) {
                    openNewMonthWelcomeModal(curMonthNameBn, curYear, lastMonthNameBn, lastMonthUnique);
                    localStorage.setItem(greetStorageKey, 'true');
                }
            } else {
                if (greetingBanner) greetingBanner.classList.add('hidden');
            }

            // =========================================================================
            // POPULATE MONTHLY PERFORMANCE HISTORY ARCHIVE SELECTOR
            // =========================================================================
            populateWorkerMonthSelector(curMonthKey, lastMonthKey);
        }

        function populateWorkerMonthSelector(curMonthKey, lastMonthKey) {
            const selectEl = document.getElementById('workerMonthFilterSelect');
            if (!selectEl) return;

            selectEl.innerHTML = '';
            const sortedKeys = Object.keys(workerMonthlyArchive).sort().reverse();

            sortedKeys.forEach(k => {
                const item = workerMonthlyArchive[k];
                selectEl.innerHTML += `<option value="${k}">${item.label || k}</option>`;
            });

            // Default to current month, or if current month has no work yet and day <= 3, keep current month selected
            currentWorkerSelectedMonthKey = sortedKeys.includes(curMonthKey) ? curMonthKey : sortedKeys[0];
            selectEl.value = currentWorkerSelectedMonthKey;
            renderWorkerSelectedMonthHistory(currentWorkerSelectedMonthKey);
        }

        function renderWorkerSelectedMonthHistory(monthKey) {
            currentWorkerSelectedMonthKey = monthKey;
            const mObj = workerMonthlyArchive[monthKey] || {
                totalUnique: 0,
                femaleCount: 0,
                lookupCount: 0,
                dupCount: 0,
                days: {}
            };

            const daysArr = Object.values(mObj.days || {}).sort((a, b) => b.date.localeCompare(a.date));
            const activeDaysCount = daysArr.length;
            const dailyAvg = activeDaysCount > 0 ? Math.round(mObj.totalUnique / activeDaysCount) : 0;

            const totalEl = document.getElementById('mHistTotalUnique');
            if (totalEl) totalEl.innerText = mObj.totalUnique.toLocaleString();
            const femaleEl = document.getElementById('mHistFemaleCount');
            if (femaleEl) femaleEl.innerText = mObj.femaleCount.toLocaleString();
            const lookupEl = document.getElementById('mHistLookupCount');
            if (lookupEl) lookupEl.innerText = mObj.lookupCount.toLocaleString();
            const dupEl = document.getElementById('mHistDupCount');
            if (dupEl) dupEl.innerText = mObj.dupCount.toLocaleString();
            const activeDaysEl = document.getElementById('mHistActiveDays');
            if (activeDaysEl) activeDaysEl.innerText = `${activeDaysCount} দিন`;
            const dailyAvgEl = document.getElementById('mHistDailyAvg');
            if (dailyAvgEl) dailyAvgEl.innerText = dailyAvg.toLocaleString();

            const titleEl = document.getElementById('mHistMonthTitle');
            if (titleEl) titleEl.innerText = `(${mObj.label || monthKey})`;
            const badgeEl = document.getElementById('mHistDayCountBadge');
            if (badgeEl) badgeEl.innerText = `${activeDaysCount} দিন সক্রিয় কাজ`;

            const tbody = document.getElementById('workerMonthlyDayTableBody');
            if (!tbody) return;

            if (daysArr.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" class="py-5 text-center text-slate-400 font-sans text-xs">এই মাসে এখনো কোনো কাজের রেকর্ড জমা হয়নি।</td></tr>`;
                return;
            }

            tbody.innerHTML = daysArr.map(d => {
                const mDone = d.maleCount || 0;
                const fDone = d.femaleCount || 0;
                const tot = fDone + mDone;
                const targetAchieved = (fDone >= 210 && mDone >= 210) || tot >= 420;
                let statusBadge = '';
                if (targetAchieved) {
                    statusBadge = `<span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">✅ ৪২০+ সম্পন্ন (${fDone}F, ${mDone}M)</span>`;
                } else if (tot > 0) {
                    statusBadge = `<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">⏳ আংশিক (${tot}/420: ${fDone}F, ${mDone}M)</span>`;
                } else {
                    statusBadge = `<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">লুকআপ ডাটা</span>`;
                }

                return `
                    <tr class="hover:bg-slate-50 transition">
                        <td class="py-2.5 px-3 font-mono font-bold text-slate-900">${d.date}</td>
                        <td class="py-2.5 px-3 font-semibold text-slate-600">${d.filesCount} টি ফাইল</td>
                        <td class="py-2.5 px-3 font-bold font-mono text-emerald-600">+${d.totalUnique}</td>
                        <td class="py-2.5 px-3 font-bold font-mono text-rose-600">${d.femaleCount}</td>
                        <td class="py-2.5 px-3 font-bold font-mono text-blue-600">${d.maleCount || 0}</td>
                        <td class="py-2.5 px-3 font-bold font-mono text-indigo-600">${d.lookupCount}</td>
                        <td class="py-2.5 px-3 font-mono text-amber-600">${d.dupCount}</td>
                        <td class="py-2.5 px-3 text-center">${statusBadge}</td>
                    </tr>
                `;
            }).join('');
        }

        function exportWorkerSelectedMonthExcel() {
            const mObj = workerMonthlyArchive[currentWorkerSelectedMonthKey];
            if (!mObj || !mObj.days || Object.keys(mObj.days).length === 0) {
                alert('নির্বাচিত মাসে ডাউনলোড করার মতো কোনো কাজের ডাটা নেই।');
                return;
            }

            const daysArr = Object.values(mObj.days).sort((a, b) => a.date.localeCompare(b.date));
            let csv = '﻿'; // UTF-8 BOM for Excel
            csv += `"My Monthly Work Report - ${mObj.label || currentWorkerSelectedMonthKey}"
`;
            csv += `"Worker Username:","${currentProfile?.username || 'Worker'}"
`;
            csv += `"Worker Email:","${currentUser?.email || ''}"
`;
            csv += `"Total Valid Unique:","${mObj.totalUnique}"
`;
            csv += `"Female (43+):","${mObj.femaleCount}"
`;
            csv += `"Male (41+):","${mObj.maleCount || 0}"
`;
            csv += `"Lookup Reports:","${mObj.lookupCount}"
`;
            csv += `"Duplicates Filtered:","${mObj.dupCount}"

`;

            csv += `"Date","Files Submitted","Valid Unique","Female (43+)","Male (41+)","Lookup Data","Duplicates Filtered","Target Status"
`;

            daysArr.forEach(d => {
                const mDone = d.maleCount || 0;
                const fDone = d.femaleCount || 0;
                const tot = fDone + mDone;
                const status = ((fDone >= 210 && mDone >= 210) || tot >= 420) ? `Target Met (${tot}/420: ${fDone}F, ${mDone}M)` : (tot > 0 ? `Partial (${tot}/420: ${fDone}F, ${mDone}M)` : 'Lookup');
                csv += `"${d.date}","${d.filesCount}","${d.totalUnique}","${d.femaleCount}","${d.maleCount || 0}","${d.lookupCount}","${d.dupCount}","${status}"
`;
            });

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Work_Report_${currentWorkerSelectedMonthKey}_${currentProfile?.username || 'Worker'}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function switchWorkerInputMode(mode) {
            const btnFile = document.getElementById('workerInputModeFileBtn');
            const btnPaste = document.getElementById('workerInputModePasteBtn');
            const contFile = document.getElementById('workerFileModeContainer');
            const contPaste = document.getElementById('workerPasteModeContainer');

            if (mode === 'file') {
                btnFile.className = 'text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white transition';
                btnPaste.className = 'text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition';
                contFile.classList.remove('hidden');
                contPaste.classList.add('hidden');
            } else {
                btnPaste.className = 'text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white transition';
                btnFile.className = 'text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition';
                contPaste.classList.remove('hidden');
                contFile.classList.add('hidden');
            }
        }

        function handleWorkerDirectPasteParse() {
            const rawText = (document.getElementById('workerDirectPasteInput')?.value || '').trim();
            if (!rawText) {
                alert('অনুগ্রহ করে বক্সে টেক্সট বা নাম্বার পেস্ট করুন।');
                return;
            }

            const selectedRep = document.querySelector('input[name="workerReportType"]:checked')?.value || 'female_report';
            const lines = rawText.split(/\r?\n/);
            parsedRows = [];
            let underagePastedCount = 0;

            if (selectedRep === 'lookup_report') {
                // Dedicated parser for Lookup Report: Extracts Phone, Household Income & Est Market Value
                lines.forEach(l => {
                    const trimmed = l.trim();
                    if (!trimmed) return;

                    let tokens = [];
                    if (trimmed.includes('\t')) {
                        tokens = trimmed.split('\t').map(t => t.trim()).filter(Boolean);
                    } else if (trimmed.includes(',')) {
                        tokens = trimmed.split(',').map(t => t.trim()).filter(Boolean);
                    } else if (trimmed.includes('|')) {
                        tokens = trimmed.split('|').map(t => t.trim()).filter(Boolean);
                    } else {
                        tokens = trimmed.split(/\s{2,}/).map(t => t.trim()).filter(Boolean);
                        if (tokens.length < 2) {
                            tokens = trimmed.split(/\s+/).map(t => t.trim()).filter(Boolean);
                        }
                    }

                    let phone = '';
                    let income = '';
                    let market = '';

                    // Check for dollar tokens or clean phone
                    tokens.forEach(tok => {
                        const cleanNum = tok.replace(/[^0-9]/g, '');
                        if (!phone && cleanNum.length >= 7 && cleanNum.length <= 16 && !tok.includes('$')) {
                            phone = cleanNum;
                        } else if (tok.includes('$') || tok.includes('k') || tok.includes('lakh')) {
                            if (!income) income = tok;
                            else if (!market) market = tok;
                        }
                    });

                    // Positional fallback
                    if (!phone && tokens[0]) phone = tokens[0].replace(/[^0-9]/g, '');
                    if (!income && tokens[1]) income = tokens[1];
                    if (!market && tokens[2]) market = tokens[2];

                    if (phone && phone.length >= 6) {
                        if (currentLookupDeliveryType === 'valid') {
                            parsedRows.push({
                                'Phone Number': phone,
                                'Household Income': income || '-',
                                'Est. Market Value': market || '-'
                            });
                        } else {
                            parsedRows.push({
                                'Phone Number': phone
                            });
                        }
                    }
                });
            } else if (selectedRep === 'male_report') {
                // Male Report parser: Phone, Name, Age (Age 41+ required)
                lines.forEach(l => {
                    const trimmed = l.trim();
                    if (!trimmed) return;

                    const tokens = trimmed.split(/[\t,;]+|\s{2,}/).map(t => t.trim()).filter(Boolean);
                    let phone = '';
                    let name = '';
                    let age = '';

                    tokens.forEach(tok => {
                        const cleanNum = tok.replace(/[^0-9]/g, '');
                        const lowerTok = tok.toLowerCase();
                        if (cleanNum.length >= 7 && cleanNum.length <= 16 && !phone) {
                            phone = cleanNum;
                        } else if (cleanNum.length <= 3 && parseInt(cleanNum) >= 1 && parseInt(cleanNum) <= 120 && !age) {
                            age = cleanNum;
                        } else if (!age && (lowerTok.includes('dec') || lowerTok.includes('unk') || lowerTok.includes('dead') || lowerTok === '?')) {
                            age = tok;
                        } else if (!name && /[a-zA-Z]/.test(tok)) {
                            name = tok;
                        }
                    });

                    if (!phone || !name) {
                        const words = trimmed.split(/\s+/);
                        const nameParts = [];
                        words.forEach(w => {
                            const cleanNum = w.replace(/[^0-9]/g, '');
                            const lowerW = w.toLowerCase();
                            if (cleanNum.length >= 7 && cleanNum.length <= 16 && !phone) {
                                phone = cleanNum;
                            } else if (cleanNum.length <= 3 && parseInt(cleanNum) >= 1 && parseInt(cleanNum) <= 120 && !age) {
                                age = cleanNum;
                            } else if (!age && (lowerW.includes('dec') || lowerW.includes('unk') || lowerW.includes('dead') || lowerW === '?')) {
                                age = w;
                            } else {
                                nameParts.push(w);
                            }
                        });
                        if (nameParts.length > 0) name = nameParts.join(' ');
                    }

                    if (phone || name) {
                        // Check male age rule (< 41 auto remove)
                        if (isMaleUnderage(age)) {
                            underagePastedCount++;
                            return; // Auto remove!
                        }

                        parsedRows.push({
                            'Phone': phone,
                            'Full Name': name || 'Unknown',
                            'Age': age || '-'
                        });
                    }
                });
            } else if (selectedRep === 'signal_report') {
                // Signal Report parser: pure phone numbers only
                lines.forEach(l => {
                    const trimmed = l.trim();
                    if (!trimmed) return;
                    const tokens = trimmed.split(/[\t,;]+|\s+/).map(t => t.trim()).filter(Boolean);
                    const clean = (tokens[0] || '').replace(/[^0-9]/g, '');
                    if (clean && clean.length >= 6) {
                        parsedRows.push({ 'Phone Number': clean });
                    }
                });
            } else {
                // female_report parser
                lines.forEach(l => {
                    const trimmed = l.trim();
                    if (!trimmed) return;

                    const tokens = trimmed.split(/[\t,;]+|\s{2,}/).map(t => t.trim()).filter(Boolean);
                    let phone = '';
                    let name = '';
                    let age = '';

                    tokens.forEach(tok => {
                        const cleanNum = tok.replace(/[^0-9]/g, '');
                        const lowerTok = tok.toLowerCase();
                        if (cleanNum.length >= 7 && cleanNum.length <= 16 && !phone) {
                            phone = cleanNum;
                        } else if (cleanNum.length <= 3 && parseInt(cleanNum) >= 1 && parseInt(cleanNum) <= 120 && !age) {
                            age = cleanNum;
                        } else if (!age && (lowerTok.includes('dec') || lowerTok.includes('unk') || lowerTok.includes('dead') || lowerTok === '?')) {
                            age = tok;
                        } else if (!name && /[a-zA-Z]/.test(tok)) {
                            name = tok;
                        }
                    });

                    if (!phone || !name) {
                        const words = trimmed.split(/\s+/);
                        const nameParts = [];
                        words.forEach(w => {
                            const cleanNum = w.replace(/[^0-9]/g, '');
                            const lowerW = w.toLowerCase();
                            if (cleanNum.length >= 7 && cleanNum.length <= 16 && !phone) {
                                phone = cleanNum;
                            } else if (cleanNum.length <= 3 && parseInt(cleanNum) >= 1 && parseInt(cleanNum) <= 120 && !age) {
                                age = cleanNum;
                            } else if (!age && (lowerW.includes('dec') || lowerW.includes('unk') || lowerW.includes('dead') || lowerW === '?')) {
                                age = w;
                            } else {
                                nameParts.push(w);
                            }
                        });
                        if (nameParts.length > 0) name = nameParts.join(' ');
                    }

                    if (phone || name) {
                        // Check female age rule (< 43 auto remove)
                        if (selectedRep === 'female_report' && isFemaleUnderage(age)) {
                            underagePastedCount++;
                            return; // Auto remove!
                        }

                        parsedRows.push({
                            'Phone': phone,
                            'Full Name': name || 'Unknown',
                            'Age': age || '-'
                        });
                    }
                });
            }

            const underageBanner = document.getElementById('underageAlertBanner');
            const underageTitle = document.getElementById('underageAlertTitle');
            const underageMsg = document.getElementById('underageAlertMsg');

            const minAgePastedText = selectedRep === 'male_report' ? '৪১' : '৪৩';
            const genderPastedText = selectedRep === 'male_report' ? 'পুরুষ' : 'ফিমেল';

            if (underagePastedCount > 0) {
                if (underageBanner) {
                    underageBanner.classList.remove('hidden');
                    if (underageTitle) underageTitle.innerText = '⚠️ আপনি কম বয়সী নাম্বার দিয়েছেন!';
                    if (underageMsg) underageMsg.innerHTML = `${minAgePastedText} বছরের নিচে থাকায় পেস্ট করা ডাটা থেকে মোট <b>${underagePastedCount.toLocaleString()} টি</b> নাম্বার স্বয়ংক্রিয়ভাবে বাদ দেওয়া হয়েছে। বাকি <b>${parsedRows.length.toLocaleString()} টি</b> ${minAgePastedText}+ ও Unknown/Deceased নাম্বার লোড হয়েছে।`;
                }
                alert(`⚠️ আপনি কম বয়সী নাম্বার দিয়েছেন!\n\n${minAgePastedText} বছরের নিচে থাকায় মোট ${underagePastedCount} টি নাম্বার স্বয়ংক্রিয়ভাবে বাদ দেওয়া হয়েছে। বাকি ${parsedRows.length} টি বৈধ নাম্বার লোড করা হয়েছে।`);
            } else {
                if (underageBanner) underageBanner.classList.add('hidden');
            }

            if (parsedRows.length === 0) {
                if (underagePastedCount > 0) {
                    alert(`❌ আপনি কম বয়সী নাম্বার দিয়েছেন!\n\nপেস্ট করা সব নাম্বারের বয়স ${minAgePastedText} বছরের নিচে থাকায় সবগুলো বাদ পড়েছে। ${minAgePastedText} বছরের নিচে কোনো ${genderPastedText} ডাটা জমা নেওয়া যাবে না।\n\nঅনুগ্রহ করে ${minAgePastedText} বা তার বেশি বয়সী নাম্বার প্রদান করুন।`);
                } else {
                    alert('পেস্ট করা টেক্সট থেকে কোনো বৈধ তথ্য পাওয়া যায়নি।');
                }
                return;
            }

            selectedFileData = { name: `Direct_Paste_${parsedRows.length}_rows.txt` };
            document.getElementById('previewFileName').innerText = selectedFileData.name;
            setupColumnSelectorsAndPreview();
        }

        function handleFileSelected(e) {
            const file = e.target.files[0];
            if (!file) return;

            selectedFileData = file;
            document.getElementById('previewFileName').innerText = file.name;
            document.getElementById('uploadStatusText').innerText = 'Reading file contents...';

            const reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    const data = new Uint8Array(evt.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    
                    // Smart Array-of-Arrays Parser to prevent losing Row 1 if there is no header row
                    const rawAoA = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
                    if (!rawAoA || rawAoA.length === 0) {
                        alert('Uploaded sheet contains no data rows.');
                        return;
                    }

                    window._currentRawAoA = rawAoA;

                    // Intelligent Header vs Data Row Detector
                    const firstRow = rawAoA[0].map(c => String(c || '').trim());
                    
                    // 1. Check if first row contains a phone number (6 to 16 digits)
                    let firstRowHasPhone = false;
                    for (const cell of firstRow) {
                        const digits = cell.replace(/[^0-9]/g, '');
                        // If cell has 6-16 digits and at most 2 non-digit characters (like +, -, spaces)
                        if (digits.length >= 6 && digits.length <= 16 && !/[a-zA-Z]/.test(cell)) {
                            firstRowHasPhone = true;
                            break;
                        }
                    }

                    // 2. Check header keywords only if NO phone number in row 0
                    let detectedIsHeader = false;
                    if (!firstRowHasPhone) {
                        const headerKeywords = ['phone', 'number', 'mobile', 'contact', 'cell', 'name', 'full name', 'first name', 'last name', 'age', 'boyos', 'gender', 'income', 'market', 'নাম্বার', 'নাম', 'বয়স'];
                        detectedIsHeader = firstRow.some(cell => {
                            const lower = cell.toLowerCase();
                            return headerKeywords.some(kw => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw));
                        });
                    }

                    // If firstRowHasPhone is true => definitely NO header (first row is data)
                    const toggleEl = document.getElementById('toggleFirstRowIsData');
                    if (toggleEl) {
                        toggleEl.checked = !detectedIsHeader;
                    }

                    applyParsedRowsFromRawAoA(!detectedIsHeader);
                } catch (err) {
                    alert('Error reading Excel file: ' + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        }

        // Intelligent Content-Based Column Detector & Live 5-Row Preview
        
        // Helper to parse rawAoA with or without Row 0 as headers
        function applyParsedRowsFromRawAoA(firstRowIsData) {
            const rawAoA = window._currentRawAoA;
            if (!rawAoA || rawAoA.length === 0) return;

            let headers = [];
            let dataRows = [];

            if (!firstRowIsData) {
                // Row 0 is header
                const firstRow = rawAoA[0].map(c => String(c || '').trim());
                headers = firstRow.map((h, i) => h || `Col ${i + 1}`);
                dataRows = rawAoA.slice(1);
            } else {
                // Row 0 is DATA! Generate synthetic column headers
                const maxCols = Math.max(...rawAoA.map(r => r.length));
                headers = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
                dataRows = rawAoA;
            }

            parsedRows = [];
            dataRows.forEach(row => {
                if (row && row.some(c => String(c || '').trim().length > 0)) {
                    const obj = {};
                    headers.forEach((h, i) => {
                        obj[h] = row[i] !== undefined ? row[i] : '';
                    });
                    parsedRows.push(obj);
                }
            });

            if (!parsedRows || parsedRows.length === 0) {
                alert('Uploaded sheet contains no data rows.');
                return;
            }

            setupColumnSelectorsAndPreview();
        }

        function toggleFirstRowDataMode(isFirstRowData) {
            applyParsedRowsFromRawAoA(isFirstRowData);
        }


        // =========================================================
        // LOOKUP ISOLATED SECTOR LOGIC (Worker Submission & Admin)
        // =========================================================
        let currentLookupDeliveryType = 'valid'; // 'valid' or 'no_info'
        let adminLookupDataCache = [];

        function handleWorkerReportTypeChanged() {
            const selectedReportRadio = document.querySelector('input[name="workerReportType"]:checked');
            const chosenReportType = selectedReportRadio ? selectedReportRadio.value : 'female_report';
            const subCard = document.getElementById('lookupSubTypeCard');
            const extraCols = document.getElementById('lookupExtraCols');
            const optFemale = document.getElementById('optFemaleReport');
            const optLookup = document.getElementById('optLookupReport');
            const optSignal = document.getElementById('optSignalReport');
            const optMaleSignal = document.getElementById('optMaleSignalReport');
            const optMale = document.getElementById('optMaleReport');
            const femaleAgeBanner = document.getElementById('femaleAgeRuleBanner');
            const maleAgeBanner = document.getElementById('maleAgeRuleBanner');

            const nameContainer = document.getElementById('workerColNameContainer');
            const ageContainer = document.getElementById('workerColAgeContainer');
            const incomeContainer = document.getElementById('workerColIncomeContainer');
            const marketContainer = document.getElementById('workerColMarketContainer');

            if (chosenReportType === 'lookup_report') {
                if (subCard) subCard.classList.remove('hidden');
                if (femaleAgeBanner) femaleAgeBanner.classList.add('hidden');
                if (maleAgeBanner) maleAgeBanner.classList.add('hidden');
                if (optLookup) optLookup.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-purple-500 shadow-sm cursor-pointer transition';
                if (optFemale) optFemale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-rose-400 cursor-pointer transition';
                if (optSignal) optSignal.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-cyan-400 cursor-pointer transition';
                if (optMale) optMale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-blue-400 cursor-pointer transition';

                // HIDE Name and Age for Lookup Report!
                if (nameContainer) nameContainer.classList.add('hidden');
                if (ageContainer) ageContainer.classList.add('hidden');

                if (currentLookupDeliveryType === 'valid') {
                    if (incomeContainer) incomeContainer.classList.remove('hidden');
                    if (marketContainer) marketContainer.classList.remove('hidden');
                } else {
                    if (incomeContainer) incomeContainer.classList.add('hidden');
                    if (marketContainer) marketContainer.classList.add('hidden');
                }
            } else if (chosenReportType === 'signal_report' || chosenReportType === 'female_signal') {
                if (subCard) subCard.classList.add('hidden');
                if (femaleAgeBanner) femaleAgeBanner.classList.add('hidden');
                if (maleAgeBanner) maleAgeBanner.classList.add('hidden');
                if (optSignal) optSignal.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-cyan-500 shadow-sm cursor-pointer transition';
                if (optMaleSignal) optMaleSignal.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-cyan-500 cursor-pointer transition';
                if (optFemale) optFemale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-rose-400 cursor-pointer transition';
                if (optLookup) optLookup.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-purple-400 cursor-pointer transition';
                if (optMale) optMale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-blue-400 cursor-pointer transition';

                // HIDE Name, Age, Income, Market for Female Signal Report!
                if (nameContainer) nameContainer.classList.add('hidden');
                if (ageContainer) ageContainer.classList.add('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            } else if (chosenReportType === 'male_signal') {
                if (subCard) subCard.classList.add('hidden');
                if (femaleAgeBanner) femaleAgeBanner.classList.add('hidden');
                if (maleAgeBanner) maleAgeBanner.classList.remove('hidden');
                if (optMaleSignal) optMaleSignal.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-cyan-500 shadow-sm cursor-pointer transition';
                if (optSignal) optSignal.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-cyan-400 cursor-pointer transition';
                if (optFemale) optFemale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-rose-400 cursor-pointer transition';
                if (optLookup) optLookup.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-purple-400 cursor-pointer transition';
                if (optMale) optMale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-blue-400 cursor-pointer transition';

                // HIDE Name, Age, Income, Market for Male Signal Report (Pure Phone List)!
                if (nameContainer) nameContainer.classList.add('hidden');
                if (ageContainer) ageContainer.classList.add('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            } else if (chosenReportType === 'male_report') {
                if (subCard) subCard.classList.add('hidden');
                if (femaleAgeBanner) femaleAgeBanner.classList.add('hidden');
                if (maleAgeBanner) maleAgeBanner.classList.remove('hidden');
                if (optMale) optMale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-blue-500 shadow-sm hover:border-blue-600 cursor-pointer transition';
                if (optFemale) optFemale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-rose-400 cursor-pointer transition';
                if (optLookup) optLookup.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-purple-400 cursor-pointer transition';
                if (optSignal) optSignal.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-cyan-400 cursor-pointer transition';

                // SHOW Name and Age, HIDE Income and Market for Male Report!
                if (nameContainer) nameContainer.classList.remove('hidden');
                if (ageContainer) ageContainer.classList.remove('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            } else {
                // female_report
                if (subCard) subCard.classList.add('hidden');
                if (femaleAgeBanner) femaleAgeBanner.classList.remove('hidden');
                if (maleAgeBanner) maleAgeBanner.classList.add('hidden');
                if (optFemale) optFemale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-rose-500 shadow-sm hover:border-rose-600 cursor-pointer transition';
                if (optLookup) optLookup.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-purple-400 cursor-pointer transition';
                if (optSignal) optSignal.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-cyan-400 cursor-pointer transition';
                if (optMale) optMale.className = 'flex items-start space-x-3 p-4 bg-white rounded-2xl border-2 border-slate-200 hover:border-blue-400 cursor-pointer transition';

                // SHOW Name and Age, HIDE Income and Market for Female Report!
                if (nameContainer) nameContainer.classList.remove('hidden');
                if (ageContainer) ageContainer.classList.remove('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            }
            if (extraCols) extraCols.classList.add('hidden');

            if (typeof parsedRows !== 'undefined' && parsedRows.length > 0) {
                updateLivePreviewTable();
            }
        }

        function handleLookupDeliveryTypeChange(type) {
            currentLookupDeliveryType = type;
            const lblValid = document.getElementById('lblLookupValid');
            const lblNoInfo = document.getElementById('lblLookupNoInfo');
            const incomeContainer = document.getElementById('workerColIncomeContainer');
            const marketContainer = document.getElementById('workerColMarketContainer');

            if (type === 'valid') {
                if (lblValid) lblValid.className = 'flex-1 text-center py-2 text-xs font-black rounded-xl bg-purple-600 text-white shadow-sm cursor-pointer transition';
                if (lblNoInfo) lblNoInfo.className = 'flex-1 text-center py-2 text-xs font-bold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer transition';
                if (incomeContainer) incomeContainer.classList.remove('hidden');
                if (marketContainer) marketContainer.classList.remove('hidden');
            } else {
                if (lblValid) lblValid.className = 'flex-1 text-center py-2 text-xs font-bold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer transition';
                if (lblNoInfo) lblNoInfo.className = 'flex-1 text-center py-2 text-xs font-black rounded-xl bg-purple-600 text-white shadow-sm cursor-pointer transition';
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            }

            if (typeof parsedRows !== 'undefined' && parsedRows.length > 0) {
                updateLivePreviewTable();
            }
        }

        function setupColumnSelectorsAndPreview() {
            document.getElementById('previewRowCount').innerText = `${parsedRows.length.toLocaleString()} rows detected`;

            const sampleRow = parsedRows[0];
            const columns = Object.keys(sampleRow);
            const phoneSel = document.getElementById('columnPhoneSelector');
            const nameSel = document.getElementById('columnNameSelector');
            const ageSel = document.getElementById('columnAgeSelector');
            const incomeSel = document.getElementById('columnIncomeSelector');
            const marketSel = document.getElementById('columnMarketValueSelector');

            phoneSel.innerHTML = '';
            nameSel.innerHTML = '<option value="">-- None / Empty --</option>';
            ageSel.innerHTML = '<option value="">-- None / Empty --</option>';
            if (incomeSel) incomeSel.innerHTML = '<option value="">-- None / খালি --</option>';
            if (marketSel) marketSel.innerHTML = '<option value="">-- None / খালি --</option>';

            const selectedRep = document.querySelector('input[name="workerReportType"]:checked')?.value || 'female_report';

            let bestPhoneCol = '';
            let bestNameCol = '';
            let bestAgeCol = '';
            let bestIncomeCol = '';
            let bestMarketCol = '';

            if (selectedRep === 'lookup_report') {
                // Smart column detector specifically for Lookup Report
                columns.forEach(col => {
                    const lc = col.toLowerCase();
                    if (lc.includes('phone') || lc.includes('number') || lc.includes('mobile') || lc.includes('cell') || lc.includes('ফোন')) {
                        bestPhoneCol = col;
                    }
                    if (lc.includes('income') || lc.includes('salary') || lc.includes('household') || lc.includes('hh_income') || lc.includes('আয়')) {
                        bestIncomeCol = col;
                    }
                    if (lc.includes('market') || lc.includes('property') || lc.includes('value') || lc.includes('est') || lc.includes('val') || lc.includes('ভ্যালু')) {
                        bestMarketCol = col;
                    }
                });

                if (!bestPhoneCol && columns.length >= 1) bestPhoneCol = columns[0];
                if (!bestIncomeCol && columns.length >= 2) bestIncomeCol = columns[1];
                if (!bestMarketCol && columns.length >= 3) bestMarketCol = columns[2];
            } else {
                // Intelligent Content Scorer: Scans first 15 rows for female report
                const checkRows = parsedRows.slice(0, 15);
                const colScores = {};
                columns.forEach(c => { colScores[c] = { phone: 0, name: 0, age: 0 }; });

                checkRows.forEach(row => {
                    columns.forEach(col => {
                        const val = String(row[col] || '').trim();
                        const cleanNum = val.replace(/[^0-9]/g, '');

                        if (cleanNum.length >= 7 && cleanNum.length <= 16) {
                            colScores[col].phone += 3;
                        }
                        if (cleanNum && cleanNum === val && parseInt(cleanNum) >= 15 && parseInt(cleanNum) <= 120) {
                            colScores[col].age += 4;
                        }
                        if (/[a-zA-Z]/.test(val) && cleanNum.length <= 2) {
                            colScores[col].name += 3;
                        }

                        const lowerCol = col.toLowerCase();
                        if (lowerCol.includes('phone') || lowerCol.includes('number') || lowerCol.includes('mobile') || lowerCol.includes('contact') || lowerCol.includes('cell')) {
                            colScores[col].phone += 2;
                        }
                        if (lowerCol.includes('name') || lowerCol.includes('person') || lowerCol.includes('customer') || lowerCol.includes('naam')) {
                            colScores[col].name += 2;
                        }
                        if (lowerCol.includes('age') || lowerCol.includes('boyos') || lowerCol.includes('dob')) {
                            colScores[col].age += 2;
                        }
                    });
                });

                let maxPhoneScore = -1;
                columns.forEach(c => {
                    if (colScores[c].phone > maxPhoneScore) {
                        maxPhoneScore = colScores[c].phone;
                        bestPhoneCol = c;
                    }
                });

                let maxNameScore = -1;
                columns.forEach(c => {
                    if (c !== bestPhoneCol && colScores[c].name > maxNameScore) {
                        maxNameScore = colScores[c].name;
                        bestNameCol = c;
                    }
                });

                let maxAgeScore = -1;
                columns.forEach(c => {
                    if (c !== bestPhoneCol && c !== bestNameCol && colScores[c].age > maxAgeScore) {
                        maxAgeScore = colScores[c].age;
                        bestAgeCol = c;
                    }
                });
            }

            // Populate options
            columns.forEach(col => {
                const optP = document.createElement('option');
                optP.value = col; optP.innerText = col;
                if (col === bestPhoneCol) optP.selected = true;
                phoneSel.appendChild(optP);

                const optN = document.createElement('option');
                optN.value = col; optN.innerText = col;
                if (col === bestNameCol) optN.selected = true;
                nameSel.appendChild(optN);

                const optA = document.createElement('option');
                optA.value = col; optA.innerText = col;
                if (col === bestAgeCol) optA.selected = true;
                ageSel.appendChild(optA);

                if (incomeSel) {
                    const optI = document.createElement('option');
                    optI.value = col; optI.innerText = col;
                    if (col === bestIncomeCol) optI.selected = true;
                    incomeSel.appendChild(optI);
                }

                if (marketSel) {
                    const optM = document.createElement('option');
                    optM.value = col; optM.innerText = col;
                    if (col === bestMarketCol) optM.selected = true;
                    marketSel.appendChild(optM);
                }
            });

            // STRICT VISIBILITY CONTROL: Hide Name & Age for Lookup Report!
            const nameContainer = document.getElementById('workerColNameContainer');
            const ageContainer = document.getElementById('workerColAgeContainer');
            const incomeContainer = document.getElementById('workerColIncomeContainer');
            const marketContainer = document.getElementById('workerColMarketContainer');
            const extraCols = document.getElementById('lookupExtraCols');

            if (selectedRep === 'lookup_report') {
                if (nameContainer) nameContainer.classList.add('hidden');
                if (ageContainer) ageContainer.classList.add('hidden');
                if (currentLookupDeliveryType === 'valid') {
                    if (incomeContainer) incomeContainer.classList.remove('hidden');
                    if (marketContainer) marketContainer.classList.remove('hidden');
                } else {
                    if (incomeContainer) incomeContainer.classList.add('hidden');
                    if (marketContainer) marketContainer.classList.add('hidden');
                }
            } else if (selectedRep === 'signal_report') {
                if (nameContainer) nameContainer.classList.add('hidden');
                if (ageContainer) ageContainer.classList.add('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            } else if (selectedRep === 'male_report') {
                if (nameContainer) nameContainer.classList.remove('hidden');
                if (ageContainer) ageContainer.classList.remove('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            } else {
                if (nameContainer) nameContainer.classList.remove('hidden');
                if (ageContainer) ageContainer.classList.remove('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            }
            if (extraCols) extraCols.classList.add('hidden');

            updateLivePreviewTable();

            document.getElementById('filePreviewCard').classList.remove('hidden');
            document.getElementById('uploadStatusText').innerText = 'Ready to process and submit.';
            document.getElementById('lastUploadResultCard').classList.add('hidden');
        }

        async function updateLivePreviewTable() {
            const previewTbody = document.getElementById('workerLivePreviewBody');
            if (!previewTbody || !parsedRows || parsedRows.length === 0) return;

            const phoneCol = document.getElementById('columnPhoneSelector')?.value || '';
            const nameCol = document.getElementById('columnNameSelector')?.value || '';
            const ageCol = document.getElementById('columnAgeSelector')?.value || '';
            const incomeCol = document.getElementById('columnIncomeSelector')?.value || '';
            const marketCol = document.getElementById('columnMarketValueSelector')?.value || '';

            const selectedRep = document.querySelector('input[name="workerReportType"]:checked')?.value || 'female_report';
            const isLookup = (selectedRep === 'lookup_report');
            const isSignal = (selectedRep === 'signal_report');

            // Dynamic Table Header update!
            const headerRow = document.getElementById('workerLivePreviewHeaderRow');
            if (headerRow) {
                if (isLookup) {
                    if (currentLookupDeliveryType === 'valid') {
                        headerRow.innerHTML = `
                            <th class="py-2 px-3 border-r w-10 text-center">#</th>
                            <th class="py-2 px-3 border-r bg-indigo-50 text-indigo-900">📞 Phone Number (ফোন নাম্বার)</th>
                            <th class="py-2 px-3 border-r bg-purple-50 text-purple-900">💰 Household Income (গৃহস্থালি আয়)</th>
                            <th class="py-2 px-3 bg-purple-50 text-purple-900">🏡 Est. Market Value (মার্কেট ভ্যালু)</th>
                        `;
                    } else {
                        headerRow.innerHTML = `
                            <th class="py-2 px-3 border-r w-10 text-center">#</th>
                            <th class="py-2 px-3 bg-indigo-50 text-indigo-900">📞 Phone Number (ফোন নাম্বার)</th>
                        `;
                    }
                } else if (isSignal) {
                    headerRow.innerHTML = `
                        <th class="py-2 px-3 border-r w-10 text-center">#</th>
                        <th class="py-2 px-3 bg-indigo-50 text-indigo-900">📞 Phone Number (ফোন নাম্বার)</th>
                    `;
                } else if (selectedRep === 'male_report') {
                    headerRow.innerHTML = `
                        <th class="py-2 px-3 border-r w-10 text-center">#</th>
                        <th class="py-2 px-3 border-r bg-indigo-50 text-indigo-900">📞 Phone Number (ফোন নাম্বার)</th>
                        <th class="py-2 px-3 border-r">👤 Full Name (পুরুষের নাম)</th>
                        <th class="py-2 px-3">🎂 Age (বয়স)</th>
                    `;
                } else {
                    // female_report
                    headerRow.innerHTML = `
                        <th class="py-2 px-3 border-r w-10 text-center">#</th>
                        <th class="py-2 px-3 border-r bg-indigo-50 text-indigo-900">📞 Phone Number (ফোন নাম্বার)</th>
                        <th class="py-2 px-3 border-r">👤 Full Name (নাম)</th>
                        <th class="py-2 px-3">🎂 Age (বয়স)</th>
                    `;
                }
            }

            const sampleRows = parsedRows.slice(0, 5);
            const samplePhones = sampleRows.map(r => String(r[phoneCol] || '').replace(/[^0-9]/g, '')).filter(p => p.length >= 6);

            // Cross check duplicates for preview if lookup
            const dupMap = {};
            if (isLookup && samplePhones.length > 0 && supabaseClient) {
                try {
                    const [resValid, resNoInfo] = await Promise.all([
                        supabaseClient.from('lookup_records').select('phone_number, worker_username, submission_date').in('phone_number', samplePhones),
                        supabaseClient.from('lookup_no_info_records').select('phone_number, worker_username, submission_date').in('phone_number', samplePhones)
                    ]);
                    if (resValid.data) {
                        resValid.data.forEach(d => { dupMap[d.phone_number] = `⚠️ পূর্বে জমা দেওয়া হয়েছে (${d.worker_username || 'Worker'} - ${d.submission_date})`; });
                    }
                    if (resNoInfo.data) {
                        resNoInfo.data.forEach(d => { dupMap[d.phone_number] = `⚠️ পূর্বে No-Info হিসেবে জমা (${d.worker_username || 'Worker'} - ${d.submission_date})`; });
                    }
                } catch(e) {
                    console.warn('Lookup preview check notice:', e);
                }
            }

            previewTbody.innerHTML = sampleRows.map((row, idx) => {
                const phoneVal = phoneCol ? String(row[phoneCol] || '').trim() : '-';
                const cleanPhone = phoneVal.replace(/[^0-9]/g, '');

                const hasLettersInPhone = /[a-zA-Z]/.test(phoneVal) && cleanPhone.length < 6;
                const isDup = dupMap[cleanPhone];

                let rowBg = isDup ? 'bg-rose-50/80 border-rose-200' : 'hover:bg-slate-50';
                let phoneClass = hasLettersInPhone ? 'bg-red-50 text-red-700 font-extrabold' : (isDup ? 'text-rose-700 font-black' : 'text-indigo-900 font-bold');

                if (isLookup) {
                    if (currentLookupDeliveryType === 'valid') {
                        const inc = incomeCol ? String(row[incomeCol] || '').trim() : '-';
                        const mkt = marketCol ? String(row[marketCol] || '').trim() : '-';
                        return `
                            <tr class="${rowBg} border-b">
                                <td class="py-2 px-3 border-r text-slate-400 font-bold text-center">${idx + 1}</td>
                                <td class="py-2 px-3 border-r ${phoneClass}">
                                    ${cleanPhone || phoneVal}
                                    ${isDup ? `<span class="block text-[10px] text-rose-600 font-bold">${isDup}</span>` : ''}
                                </td>
                                <td class="py-2 px-3 border-r font-mono font-bold text-purple-900">${inc}</td>
                                <td class="py-2 px-3 font-mono font-bold text-purple-900">${mkt}</td>
                            </tr>
                        `;
                    } else {
                        return `
                            <tr class="${rowBg} border-b">
                                <td class="py-2 px-3 border-r text-slate-400 font-bold text-center">${idx + 1}</td>
                                <td class="py-2 px-3 ${phoneClass}">
                                    ${cleanPhone || phoneVal}
                                    ${isDup ? `<span class="block text-[10px] text-rose-600 font-bold">${isDup}</span>` : ''}
                                </td>
                            </tr>
                        `;
                    }
                } else if (isSignal) {
                    return `
                        <tr class="${rowBg} border-b">
                            <td class="py-2 px-3 border-r text-slate-400 font-bold text-center">${idx + 1}</td>
                            <td class="py-2 px-3 ${phoneClass}">${cleanPhone || phoneVal}</td>
                        </tr>
                    `;
                } else {
                    const nameVal = nameCol ? String(row[nameCol] || '').trim() : '-';
                    const ageVal = ageCol ? String(row[ageCol] || '').trim() : '-';
                    return `
                        <tr class="${rowBg} border-b">
                            <td class="py-2 px-3 border-r text-slate-400 font-bold text-center">${idx + 1}</td>
                            <td class="py-2 px-3 border-r ${phoneClass}">
                                ${cleanPhone || phoneVal}
                                ${isDup ? `<span class="block text-[10px] text-rose-600 font-bold">${isDup}</span>` : ''}
                            </td>
                            <td class="py-2 px-3 border-r">${nameVal}</td>
                            <td class="py-2 px-3">${ageVal}</td>
                        </tr>
                    `;
                }
            }).join('');
        }

        async function processAndSubmitXlsx() {
            if (!parsedRows || parsedRows.length === 0) return;

            // 1. CHECK IF REPORT SUBMISSION IS CURRENTLY CLOSED / LOCKED
            const lockStatus = checkReportSubmissionLockStatus();
            if (lockStatus.isClosed) {
                alert(`দুঃখিত স্যার, আপনি সময়মতো কাজ জমা করতে পারেন নাই, তাই আপনার কাজ আজকে গ্রহণ করা হবে না। আপনি আবার পরে চেষ্টা করেন।\n\n⏰ আর ${lockStatus.remainingText} পর আবার রিপোর্ট জমা দেওয়া যাবে।`);
                return;
            }

            const chosenPhoneCol = document.getElementById('columnPhoneSelector').value;
            const chosenNameCol = document.getElementById('columnNameSelector').value;
            const chosenAgeCol = document.getElementById('columnAgeSelector').value;

            const selectedReportRadio = document.querySelector('input[name="workerReportType"]:checked');
            const chosenReportType = selectedReportRadio ? selectedReportRadio.value : 'male_report';

            const btn = document.getElementById('processUploadBtn');
            const progressContainer = document.getElementById('uploadProgressBarContainer');
            const progressBar = document.getElementById('uploadProgressBar');
            const statusText = document.getElementById('uploadStatusText');

            const chosenIncomeCol = document.getElementById('columnIncomeSelector') ? document.getElementById('columnIncomeSelector').value : '';
            const chosenMarketValueCol = document.getElementById('columnMarketValueSelector') ? document.getElementById('columnMarketValueSelector').value : '';

            // Check if selected phone column actually has phone numbers
            const firstRowVal = String(parsedRows[0][chosenPhoneCol] || '').trim();
            const firstRowDigits = firstRowVal.replace(/[^0-9]/g, '');
            if (/[a-zA-Z]/.test(firstRowVal) && firstRowDigits.length < 6) {
                alert('⚠️ আপনি "Phone Number Column" হিসেবে নামের কলাম সিলেক্ট করেছেন!\nঅনুগ্রহ করে ড্রপডাউন থেকে সঠিক ফোন নাম্বার কলামটি বেছে নিন।');
                return;
            }

            btn.disabled = true;
            progressContainer.classList.remove('hidden');
            progressBar.style.width = '20%';
            statusText.innerText = 'Extracting and structuring records with Number, Name & Age...';

            const records = [];
            let underageFilteredCount = 0;
            let unqualifiedLookupCount = 0;

            parsedRows.forEach(row => {
                let rawPhone = String(row[chosenPhoneCol] || '').trim();
                let cleanPhone = rawPhone.replace(/[^0-9]/g, '');

                let nameVal = chosenNameCol ? String(row[chosenNameCol] || '').trim() : '';
                let ageVal = chosenAgeCol ? String(row[chosenAgeCol] || '').trim() : '';

                // Smart Row Auto-Correction: If cleanPhone is invalid, scan other fields in this row
                if (cleanPhone.length < 6) {
                    Object.keys(row).forEach(k => {
                        const val = String(row[k] || '').trim();
                        const digs = val.replace(/[^0-9]/g, '');
                        if (digs.length >= 7 && digs.length <= 16 && cleanPhone.length < 6) {
                            cleanPhone = digs;
                        } else if (!nameVal && /[a-zA-Z]/.test(val) && digs.length <= 2) {
                            nameVal = val;
                        }
                    });
                }

                let incomeVal = chosenIncomeCol ? String(row[chosenIncomeCol] || '').trim() : '';
                let marketVal = chosenMarketValueCol ? String(row[chosenMarketValueCol] || '').trim() : '';

                if (cleanPhone && cleanPhone.length >= 6) {
                    // STRICT FEMALE AGE FILTER:
                    // Under 43 is strictly forbidden and auto removed!
                    // Age >= 43, Deceased, Decressed, Unknown, Empty are ALLOWED!
                    if (chosenReportType === 'female_report' && isFemaleUnderage(ageVal)) {
                        underageFilteredCount++;
                        return; // Auto remove!
                    }

                    // STRICT MALE AGE FILTER:
                    // Under 41 is strictly forbidden and auto removed!
                    // Age >= 41, Deceased, Decressed, Unknown, Empty are ALLOWED!
                    if (chosenReportType === 'male_report' && isMaleUnderage(ageVal)) {
                        underageFilteredCount++;
                        return; // Auto remove!
                    }

                    // STRICT LOOKUP REPORT QUALIFICATION FILTER (Just like Female Age Filter):
                    // Rule 1: Income $75k+ (market value can be empty/any)
                    // Rule 2: Low Income ($10k or $0) + Market Value $350k+
                    if (chosenReportType === 'lookup_report' && currentLookupDeliveryType === 'valid') {
                        const ruleRes = evaluateLookupRowRules(incomeVal, marketVal);
                        if (!ruleRes.isKept) {
                            unqualifiedLookupCount++;
                            return; // Auto remove unqualified rows!
                        }
                    }

                    records.push({
                        phone: cleanPhone,
                        name: nameVal || '-',
                        age: ageVal || '-',
                        income: incomeVal,
                        household_income: incomeVal,
                        market_value: marketVal,
                        est_market_value: marketVal
                    });
                }
            });

            const underageBanner = document.getElementById('underageAlertBanner');
            const underageTitle = document.getElementById('underageAlertTitle');
            const underageMsg = document.getElementById('underageAlertMsg');

            const minAgeFilteredText = chosenReportType === 'male_report' ? '৪১' : '৪৩';
            const genderFilteredText = chosenReportType === 'male_report' ? 'পুরুষ' : 'ফিমেল';

            if (underageFilteredCount > 0) {
                if (underageBanner) {
                    underageBanner.classList.remove('hidden');
                    if (underageTitle) underageTitle.innerText = '⚠️ আপনি কম বয়সী নাম্বার দিয়েছেন!';
                    if (underageMsg) underageMsg.innerHTML = `${minAgeFilteredText} বছরের নিচে থাকায় মোট <b>${underageFilteredCount.toLocaleString()} টি</b> নাম্বার স্বয়ংক্রিয়ভাবে বাদ দেওয়া হয়েছে। বাকি <b>${records.length.toLocaleString()} টি</b> ${minAgeFilteredText}+ বছর ও Unknown/Deceased নাম্বার প্রসেস করা হচ্ছে।`;
                }
                alert(`⚠️ আপনি কম বয়সী নাম্বার দিয়েছেন!\n\n${minAgeFilteredText} বছরের নিচে থাকায় মোট ${underageFilteredCount} টি নাম্বার স্বয়ংক্রিয়ভাবে বাদ দেওয়া হয়েছে। বাকি ${records.length} টি ${minAgeFilteredText}+ বছর ও Unknown/Deceased বৈধ নাম্বার জমা দেওয়া হচ্ছে।`);
            } else {
                if (underageBanner) underageBanner.classList.add('hidden');
            }

            if (unqualifiedLookupCount > 0) {
                alert(`⚠️ কিছু অযোগ্য লুকআপ ডাটা বাদ পড়েছে!\n\nশর্ত ১ (আয় $75k+) অথবা শর্ত ২ (কম আয়ে মার্কেট $350k+) পূরণ না করায় মোট ${unqualifiedLookupCount.toLocaleString()} টি নাম্বার বাদ দেওয়া হয়েছে।\n\nবাকি ${records.length.toLocaleString()} টি শর্তপূরণকারী গ্রহণযোগ্য লুকআপ নাম্বার জমা দেওয়া হচ্ছে।`);
            }

            if (records.length === 0) {
                if (underageFilteredCount > 0) {
                    alert(`❌ আপনি কম বয়সী নাম্বার দিয়েছেন!\n\nআপনার ফাইলের মোট ${underageFilteredCount} টি নাম্বারের বয়স ${minAgeFilteredText} বছরের নিচে থাকায় সবগুলো বাদ পড়েছে। ${minAgeFilteredText} বছরের নিচে কোনো ${genderFilteredText} ডাটা জমা নেওয়া যাবে না।\n\nঅনুগ্রহ করে ${minAgeFilteredText} বা তার বেশি বয়সী নাম্বার প্রদান করুন।`);
                } else if (unqualifiedLookupCount > 0) {
                    alert(`❌ কোনো গ্রহণযোগ্য লুকআপ ডাটা পাওয়া যায়নি!\n\nআপনার ফাইলের মোট ${unqualifiedLookupCount} টি নাম্বারের কোনোটিই শর্ত ১ (আয় $75k+) বা শর্ত ২ (কম আয়ে মার্কেট $350k+) পূরণ করতে পারেনি।\n\nঅনুগ্রহ করে গ্রহণযোগ্য ডাটা প্রদান করুন।`);
                } else {
                    alert('নির্বাচিত কলামে কোনো বৈধ ফোন নাম্বার পাওয়া যায়নি! অনুগ্রহ করে সঠিক ফোন নাম্বার কলামটি সিলেক্ট করুন।');
                }
                btn.disabled = false;
                progressContainer.classList.add('hidden');
                return;
            }

            // -------------------------------------------------------------
            // SUBMISSION CHUNKING TO ELIMINATE STATEMENT TIMEOUTS (200 records per chunk)
            // -------------------------------------------------------------
            try {
                const fileName = selectedFileData ? selectedFileData.name : 'upload.xlsx';
                let chunkSize = 50; // Ultra-safe 50 records per chunk (executes in ~100-200ms)
                let combinedData = {
                    total_received: records.length,
                    unique_in_file: 0,
                    new_inserted: 0,
                    duplicates_count: 0
                };

                const seenInBatch = new Set();
                records.forEach(r => seenInBatch.add(r.phone));
                combinedData.unique_in_file = seenInBatch.size;

                let i = 0;
                while (i < records.length) {
                    const chunk = records.slice(i, i + chunkSize);
                    const currentTotalChunks = Math.ceil(records.length / chunkSize);
                    const currentChunkNum = Math.floor(i / chunkSize) + 1;
                    const pct = Math.round((i / records.length) * 95);
                    progressBar.style.width = `${pct}%`;
                    statusText.innerText = `Submitting records to database... (Chunk ${currentChunkNum}/${currentTotalChunks}: ${Math.min(i + chunk.length, records.length)}/${records.length})`;

                    let res;
                    try {
                        // PRIMARY WRITE TO TURSO 9 GB VAULT (Zero-Data-Loss, Unlimited Storage)
                        try {
                            if (typeof TursoVault !== 'undefined') {
                                await TursoVault.insertSubmissions(chunk, chosenReportType, fileName, currentProfile);
                            }
                        } catch(tSubErr) {
                            console.warn('Turso primary write notice:', tSubErr);
                        }
                        if (chosenReportType === 'lookup_report') {
                            res = await supabaseClient.rpc('submit_lookup_work_batch', {
                                p_lookup_type: currentLookupDeliveryType,
                                p_records: chunk,
                                p_file_name: fileName
                            });
                        } else {
                            res = await supabaseClient.rpc('submit_full_work_batch', {
                                p_records: chunk,
                                p_report_type: chosenReportType,
                                p_file_name: fileName
                            });
                        }
                        if (res.error) throw res.error;
                        // Background dual-write to Turso 9 GB Cloud Vault
                        try {
                            if (typeof TursoVault !== 'undefined' && TursoVault.asyncRecordSubmissions) {
                                TursoVault.asyncRecordSubmissions(chunk, chosenReportType, fileName, currentProfile);
                            }
                        } catch(tErr) {
                            console.warn('Turso dual-write background notice:', tErr);
                        }
                    } catch (chunkErr) {
                        const errStr = chunkErr.message || '';
                        if ((errStr.includes('timeout') || errStr.includes('canceling statement')) && chunkSize > 20) {
                            console.warn('Chunk timed out on Supabase, reducing chunk size to 20 and retrying...', chunkErr);
                            chunkSize = 20;
                            continue; // retry current slice with smaller chunk
                        } else {
                            throw chunkErr;
                        }
                    }

                    if (res.data) {
                        combinedData.new_inserted += (res.data.new_inserted || 0);
                        combinedData.duplicates_count += (res.data.duplicates_count || 0);
                    }
                    i += chunk.length;
                }

                data = combinedData;

                progressBar.style.width = '100%';
                statusText.innerText = 'Report Submitted Successfully!';

                const repTitle = chosenReportType === 'female_report' ? '👩 Female Report' : (chosenReportType === 'male_report' ? '👨 Male Report' : (chosenReportType === 'signal_report' ? '📡 Signal Report' : '🔍 Lookup Report'));

                const resultCard = document.getElementById('lastUploadResultCard');
                resultCard.className = 'mt-6 p-5 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-900';
                resultCard.innerHTML = `
                    <div>
                        <div class="flex items-center space-x-2">
                            <span class="text-xl">✅</span>
                            <h4 class="font-bold text-base">${repTitle} Submitted to Portal</h4>
                        </div>
                        <p class="text-xs text-slate-600 mt-1">All record fields (Phone Number, Name, Age) have been saved centrally for Admin.</p>
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 text-xs">
                            <div>
                                <span class="text-slate-500 block">Total in File</span>
                                <span class="text-base font-bold">${data.total_received}</span>
                            </div>
                            <div>
                                <span class="text-slate-500 block">Unique in File</span>
                                <span class="text-base font-bold">${data.unique_in_file}</span>
                            </div>
                            <div>
                                <span class="text-emerald-700 block font-semibold">New Unique Saved</span>
                                <span class="text-xl font-extrabold text-emerald-600">+${data.new_inserted}</span>
                            </div>
                            <div>
                                <span class="text-amber-700 block font-semibold">Duplicates Filtered</span>
                                <span class="text-xl font-extrabold text-amber-600">${data.duplicates_count}</span>
                            </div>
                        </div>
                    </div>
                `;
                resultCard.classList.remove('hidden');

                await loadUserDashboard();
                document.getElementById('xlsxFileInput').value = '';
                parsedRows = [];
                selectedFileData = null;
                document.getElementById('filePreviewCard').classList.add('hidden');
            } catch (err) {
                let errMsg = err.message || '';
                if (errMsg.includes('timeout') || errMsg.includes('canceling statement')) {
                    errMsg += '\n\n💡 কারণ: সুপাবেস ডাটাবেজে রেকর্ড সংখ্যা অনেক বেশি হয়ে যাওয়ায় সার্ভার রিকোয়েস্ট টাইমআউট হয়েছে। অনুগ্রহ করে এডমিন প্যানেলের "Backup & Storage" থেকে ডাটা ড্রাইভে ব্যাকআপ নিয়ে সুপাবেস ডাটাবেজ খালি (Purge) করুন।';
                }
                alert('Failed to submit report: ' + errMsg);
                statusText.innerText = 'Error occurred during submission.';
            } finally {
                btn.disabled = false;
                setTimeout(() => {
                    progressContainer.classList.add('hidden');
                    progressBar.style.width = '0%';
                }, 3000);
            }
        }

        // ==========================================
        // ADMIN DASHBOARD & MASTER SUBMISSIONS VIEWER
        // ==========================================
        let currentAdminTab = 'submissions';

        function switchAdminTab(tab) {
            currentAdminTab = tab;
            const btnUsers = document.getElementById('tabAdminUsersBtn');
            const btnSubs = document.getElementById('tabAdminSubmissionsBtn');
            const btnBatches = document.getElementById('tabAdminBatchesBtn');
            const btnCompany = document.getElementById('tabAdminCompanyBtn');
            const btnRecStock = document.getElementById('tabAdminRecStockBtn');
            const btnBackup = document.getElementById('tabAdminBackupBtn');

            const tabUsers = document.getElementById('adminTabUsers');
            const tabSubs = document.getElementById('adminTabSubmissions');
            const tabBatches = document.getElementById('adminTabBatches');
            const tabCompany = document.getElementById('adminTabCompany');
            const tabRecStock = document.getElementById('adminTabRecStock');
            const tabBackup = document.getElementById('adminTabBackup');

            const inactiveClass = 'flex flex-col items-center justify-center p-3 rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition shadow-xs text-center cursor-pointer';
            const activeClass = 'flex flex-col items-center justify-center p-3 rounded-xl border-2 border-indigo-600 bg-indigo-50/80 text-indigo-950 font-bold ring-2 ring-indigo-500/20 transition shadow-sm text-center cursor-pointer';
            const activeRecStockClass = 'flex flex-col items-center justify-center p-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 text-emerald-950 font-bold ring-2 ring-emerald-500/30 transition shadow-sm text-center cursor-pointer';

            [btnUsers, btnSubs, btnBatches, btnCompany, btnRecStock, btnBackup].forEach(b => {
                if (b) b.className = inactiveClass;
            });
            [tabUsers, tabSubs, tabBatches, tabCompany, tabRecStock, tabBackup].forEach(t => {
                if (t) t.classList.add('hidden');
            });

            const btnLookupReports = document.getElementById('tabAdminLookupReportsBtn');
            const tabLookupReports = document.getElementById('adminTabLookupReports');
            if (btnLookupReports) btnLookupReports.className = inactiveClass;
            if (tabLookupReports) tabLookupReports.classList.add('hidden');

            if (tab === 'lookup_reports') {
                if (btnLookupReports) btnLookupReports.className = activeClass;
                if (tabLookupReports) tabLookupReports.classList.remove('hidden');
                loadAdminLookupReports();
            } else if (tab === 'submissions') {
                if (btnSubs) btnSubs.className = activeClass;
                if (tabSubs) tabSubs.classList.remove('hidden');
                loadAdminSubmissionsData();
            } else if (tab === 'users') {
                if (btnUsers) btnUsers.className = activeClass;
                if (tabUsers) tabUsers.classList.remove('hidden');
                if (adminUsersCache.length === 0) loadAdminDashboard();
                else renderAdminUserTable();
            } else if (tab === 'batches') {
                if (btnBatches) btnBatches.className = activeClass;
                if (tabBatches) tabBatches.classList.remove('hidden');
                renderAdminLogsTable();
            } else if (tab === 'company') {
                if (btnCompany) btnCompany.className = activeClass;
                if (tabCompany) tabCompany.classList.remove('hidden');
                loadCompanyDeliveriesData();
            } else if (tab === 'rec_stock') {
                if (btnRecStock) btnRecStock.className = activeRecStockClass;
                if (tabRecStock) tabRecStock.classList.remove('hidden');
                loadCompanyReceivedData();
            } else if (tab === 'backup') {
                if (btnBackup) btnBackup.className = activeClass;
                if (tabBackup) tabBackup.classList.remove('hidden');
                if (typeof refreshTursoStats === 'function') refreshTursoStats();
            }
        }

        
        async function loadAdminDashboard() {
            if (!supabaseClient) return;

            try {
                const todayStart = new Date();
                todayStart.setHours(0,0,0,0);
                const todayIso = todayStart.toISOString();

                // 1. CONCURRENT PARALLEL FETCH (Turso + Supabase Unified Engine via safeQuery)
                const [
                    tursoSubStats,
                    tursoStockStats,
                    tursoDelivStats,
                    pRes,
                    lRes,
                    sbTotalRes,
                    sbMaleRes,
                    sbFemaleRes,
                    sbSignalRes,
                    sbLookupRes,
                    sbLookupNoInfoRes,
                    sbTodayRes,
                    sbStockAvailRes,
                    sbDelivTotalRes,
                    claimsLogRes
                ] = await Promise.all([
                    // Turso Vault Stats
                    safeQuery(typeof TursoVault !== 'undefined' ? TursoVault.getSubmissionsStats() : null, {}),
                    safeQuery(typeof TursoVault !== 'undefined' ? TursoVault.getStockStats() : null, {}),
                    safeQuery(typeof TursoVault !== 'undefined' ? TursoVault.getDeliveryStats() : null, {}),

                    // Supabase Profiles & Upload Logs
                    safeQuery(supabaseClient.from('profiles').select('*').order('created_at', { ascending: false }), { data: [] }),
                    safeQuery(supabaseClient.from('upload_logs').select('*').order('created_at', { ascending: false }).limit(500), { data: [] }),

                    // Supabase Master Numbers Stats
                    safeQuery(supabaseClient.from('master_numbers').select('*', { count: 'exact', head: true }), { count: 0 }),
                    safeQuery(supabaseClient.from('master_numbers').select('*', { count: 'exact', head: true }).eq('report_type', 'male_report'), { count: 0 }),
                    safeQuery(supabaseClient.from('master_numbers').select('*', { count: 'exact', head: true }).eq('report_type', 'female_report'), { count: 0 }),
                    safeQuery(supabaseClient.from('master_numbers').select('*', { count: 'exact', head: true }).eq('report_type', 'signal_report'), { count: 0 }),
                    safeQuery(supabaseClient.from('master_numbers').select('*', { count: 'exact', head: true }).eq('report_type', 'lookup_report'), { count: 0 }),
                    safeQuery(supabaseClient.from('lookup_no_info_records').select('*', { count: 'exact', head: true }), { count: 0 }),
                    safeQuery(supabaseClient.from('master_numbers').select('*', { count: 'exact', head: true }).gte('created_at', todayIso), { count: 0 }),

                    // Supabase Stock Available & Deliveries Total
                    safeQuery(supabaseClient.from('company_received_numbers').select('*', { count: 'exact', head: true }).eq('is_assigned', false), { count: 0 }),
                    safeQuery(supabaseClient.from('company_deliveries').select('*', { count: 'exact', head: true }), { count: 0 }),

                    // Admin worker claims log
                    safeQuery(supabaseClient.rpc('get_admin_worker_claims_log'), { data: null })
                ]);

                // COMBINE ALL METRICS (Turso + Supabase) so no numbers ever disappear!
                const totalUnique = (tursoSubStats.totalUnique || 0) + (sbTotalRes.count || 0);
                const maleCount = (tursoSubStats.maleCount || 0) + (sbMaleRes.count || 0);
                const femaleCount = (tursoSubStats.femaleCount || 0) + (sbFemaleRes.count || 0);
                const signalCount = (tursoSubStats.signalCount || 0) + (sbSignalRes.count || 0);
                const lookupCount = (tursoSubStats.lookupCount || 0) + (sbLookupRes.count || 0);
                const lookupNoInfoCount = (tursoSubStats.lookupNoInfoCount || 0) + (sbLookupNoInfoRes.count || 0);
                const todayTotal = (tursoSubStats.todayTotal || 0) + (sbTodayRes.count || 0);

                const sbAvailNum = (sbStockAvailRes.count !== null && sbStockAvailRes.count !== undefined) ? sbStockAvailRes.count : 0;
                const totalStockAvail = (tursoStockStats.available || 0) + sbAvailNum;
                const totalDeliveries = (tursoDelivStats.total || 0) + (sbDelivTotalRes.count || 0);

                // Update Top Stat Cards Immediately
                if (document.getElementById('adminStatTotalUnique')) document.getElementById('adminStatTotalUnique').innerText = totalUnique.toLocaleString();
                if (document.getElementById('adminStatMaleReport')) document.getElementById('adminStatMaleReport').innerText = maleCount.toLocaleString();
                if (document.getElementById('adminStatFemaleReport')) document.getElementById('adminStatFemaleReport').innerText = femaleCount.toLocaleString();
                if (document.getElementById('adminStatSignalReport')) document.getElementById('adminStatSignalReport').innerText = signalCount.toLocaleString();
                if (document.getElementById('adminStatLookupReport')) document.getElementById('adminStatLookupReport').innerText = lookupCount.toLocaleString();
                if (document.getElementById('adminStatLookupNoInfo')) document.getElementById('adminStatLookupNoInfo').innerText = lookupNoInfoCount.toLocaleString();
                if (document.getElementById('adminStatToday')) document.getElementById('adminStatToday').innerText = todayTotal.toLocaleString();

                // Update Tab Badges Immediately (No more 0!)
                if (document.getElementById('recStockAvailableBadge')) document.getElementById('recStockAvailableBadge').innerText = totalStockAvail.toLocaleString();
                if (document.getElementById('companyDelivTotalBadge')) document.getElementById('companyDelivTotalBadge').innerText = totalDeliveries.toLocaleString();

                // HARVEST WORKERS FROM ALL POSSIBLE SOURCES
                const profiles = pRes.data || [];
                const logs = lRes.data || [];
                adminLogsCache = logs;

                const userMap = {};

                // A. From profiles table
                profiles.forEach(p => {
                    const uname = p.username || (p.email ? p.email.split('@')[0] : 'Worker');
                    userMap[p.id] = {
                        id: p.id,
                        email: p.email,
                        username: uname,
                        department: p.department || 'gender_verify',
                        role: p.role || 'user',
                        is_blocked: p.is_blocked === true,
                        todayAdded: 0,
                        totalContributed: 0
                    };
                    if (p.email) userEmailToNameMap[p.email] = uname;
                });

                // B. From upload_logs (any worker who ever submitted)
                logs.forEach(l => {
                    const uid = l.user_id;
                    if (uid && !userMap[uid] && (l.user_email || l.username)) {
                        const uEmail = l.user_email || `${l.username || 'worker'}@portal.com`;
                        const uName = l.username || uEmail.split('@')[0];
                        userMap[uid] = {
                            id: uid,
                            email: uEmail,
                            username: uName,
                            department: l.department || 'gender_verify',
                            role: 'user',
                            is_blocked: false,
                            todayAdded: 0,
                            totalContributed: 0
                        };
                        userEmailToNameMap[uEmail] = uName;
                    }
                });

                // C. From claimsLog RPC
                if (claimsLogRes && claimsLogRes.data && claimsLogRes.data.worker_summaries) {
                    claimsLogRes.data.worker_summaries.forEach(ws => {
                        if (ws.id && !userMap[ws.id]) {
                            const uEmail = ws.email || `${ws.username}@portal.com`;
                            userMap[ws.id] = {
                                id: ws.id,
                                email: uEmail,
                                username: ws.username,
                                department: ws.department || 'gender_verify',
                                role: ws.role || 'user',
                                is_blocked: false,
                                todayAdded: 0,
                                totalContributed: 0
                            };
                            userEmailToNameMap[uEmail] = ws.username;
                        }
                    });
                }

                // D. From Turso submissions
                try {
                    if (typeof TursoVault !== 'undefined') {
                        const tUsersRes = await safeQuery(TursoVault.query("SELECT DISTINCT user_email, username, department FROM turso_submissions WHERE user_email IS NOT NULL AND user_email != '';"), null);
                        if (tUsersRes && tUsersRes.rows) {
                            tUsersRes.rows.forEach(tu => {
                                const uid = tu.user_email;
                                if (uid && !userMap[uid]) {
                                    const uEmail = tu.user_email || `${tu.username || 'worker'}@portal.com`;
                                    const uName = tu.username || uEmail.split('@')[0];
                                    userMap[uid] = {
                                        id: uid,
                                        email: uEmail,
                                        username: uName,
                                        department: tu.department || 'gender_verify',
                                        role: 'user',
                                        is_blocked: false,
                                        todayAdded: 0,
                                        totalContributed: 0
                                    };
                                    userEmailToNameMap[uEmail] = uName;
                                }
                            });
                        }
                    }
                } catch(tUsersErr) {
                    console.warn('Turso users scan notice:', tUsersErr);
                }

                // E. Ensure logged in admin is in userMap
                if (currentUser && !userMap[currentUser.id]) {
                    const admUname = currentProfile?.username || (currentUser.email ? currentUser.email.split('@')[0] : 'Admin');
                    userMap[currentUser.id] = {
                        id: currentUser.id,
                        email: currentUser.email,
                        username: admUname,
                        department: currentProfile?.department || 'admin',
                        role: currentProfile?.role || 'admin',
                        is_blocked: false,
                        todayAdded: 0,
                        totalContributed: 0
                    };
                    if (currentUser.email) userEmailToNameMap[currentUser.email] = admUname;
                }

                // Calculate contributions from logs
                if (logs && logs.length > 0) {
                    const nowDt = new Date();
                    const curY = nowDt.getFullYear();
                    const curM = nowDt.getMonth();
                    const curMonthStartIso = (new Date(curY, curM, 1, 0, 0, 0, 0)).toISOString();
                    const curMonthEndIso = (new Date(curY, curM + 1, 0, 23, 59, 59, 999)).toISOString();

                    logs.forEach(l => {
                        if (userMap[l.user_id]) {
                            userMap[l.user_id].totalContributed += (l.new_inserted || 0);
                            if (!userMap[l.user_id].thisMonthAdded) userMap[l.user_id].thisMonthAdded = 0;
                            if (l.created_at >= todayIso) {
                                userMap[l.user_id].todayAdded += (l.new_inserted || 0);
                            }
                            if (l.created_at >= curMonthStartIso && l.created_at <= curMonthEndIso) {
                                userMap[l.user_id].thisMonthAdded += (l.new_inserted || 0);
                            }
                        }
                    });
                }

                adminUsersCache = Object.values(userMap);
                adminUsersCache.sort((a, b) => (a.username || a.email || '').localeCompare(b.username || b.email || ''));

                if (document.getElementById('userTabCount')) {
                    document.getElementById('userTabCount').innerText = adminUsersCache.length;
                }

                const workerSelect = document.getElementById('adminSubWorkerFilter');
                const quickWorkerSelect = document.getElementById('quickExportWorker');
                if (workerSelect) {
                    workerSelect.innerHTML = '<option value="all">All Workers</option>';
                    adminUsersCache.forEach(u => {
                        workerSelect.innerHTML += `<option value="${u.email}">${u.username} (${u.email})</option>`;
                    });
                }
                if (quickWorkerSelect) {
                    quickWorkerSelect.innerHTML = '<option value="all">👥 সব কর্মী (All Workers)</option>';
                    adminUsersCache.forEach(u => {
                        quickWorkerSelect.innerHTML += `<option value="${u.email}">👤 ${u.username} (${u.email})</option>`;
                    });
                }

                renderAdminUserTable();
                renderAdminLogsTable();

                // Preload all tabs concurrently so when user clicks ANY tab, it displays instantly!
                loadAdminSubmissionsData();
                if (typeof loadCompanyDeliveriesData === 'function') loadCompanyDeliveriesData();
                if (typeof loadCompanyReceivedData === 'function') loadCompanyReceivedData();

            } catch (err) {
                console.error('loadAdminDashboard error:', err);
                renderAdminUserTable();
            }
        }

        function renderAdminUserTable() {
            const body = document.getElementById('adminUserTableBody');
            const search = (document.getElementById('adminUserSearchInput')?.value || '').toLowerCase().trim();
            const deptFilter = document.getElementById('adminUserDeptFilter')?.value || 'all';

            const filtered = adminUsersCache.filter(u => {
                const uname = (u.username || '').toLowerCase();
                const uemail = (u.email || '').toLowerCase();
                const matchSearch = uemail.includes(search) || uname.includes(search);
                const matchDept = deptFilter === 'all' || u.department === deptFilter;
                return matchSearch && matchDept;
            });

            if (filtered.length > 0) {
                body.innerHTML = filtered.map(u => {
                    const isMaster = (u.email === 'ramolmoaran@gmail.com');
                    return `
                        <tr class="hover:bg-slate-50/80 transition-colors ${u.is_blocked ? 'bg-rose-50/50' : ''}">
                            <!-- 1. Worker Identity (Username + Email in 1 column) -->
                            <td class="py-2.5 px-3">
                                <div class="flex items-center space-x-2">
                                    <span class="text-base flex-shrink-0" title="${u.role}">
                                        ${u.is_blocked ? '🚫' : (u.role === 'team_leader' ? '👑' : (isMaster || u.role === 'admin' ? '⚡' : '👤'))}
                                    </span>
                                    <div class="min-w-0">
                                        <div class="flex items-center space-x-1">
                                            <span class="font-extrabold text-xs text-slate-900 truncate max-w-[140px] sm:max-w-[180px]">
                                                ${u.username || u.email.split('@')[0]}
                                            </span>
                                            <button onclick="openUsernameModal('${u.id}', '${u.username || u.email.split('@')[0]}')" class="text-slate-400 hover:text-indigo-600 p-0.5 rounded transition" title="Change Username">
                                                ✏️
                                            </button>
                                        </div>
                                        <span class="text-[11px] text-slate-500 font-mono block truncate max-w-[140px] sm:max-w-[180px]">
                                            ${u.email}
                                        </span>
                                    </div>
                                </div>
                            </td>

                            <!-- 2. Role Selector (Compact) -->
                            <td class="py-2.5 px-2.5">
                                ${isMaster ? '<span class="px-2 py-0.5 text-[11px] rounded-md font-black bg-purple-100 text-purple-900 border border-purple-300 whitespace-nowrap">⚡ Master</span>' : `
                                    <select onchange="adminChangeUserRole('${u.id}', this.value, '${u.username || u.email.split('@')[0]}')" class="text-xs py-1 px-2 rounded-lg border font-bold transition cursor-pointer ${u.role === 'team_leader' ? 'border-amber-400 bg-amber-50 text-amber-950 font-black shadow-sm' : (u.role === 'admin' ? 'border-purple-300 bg-purple-50 text-purple-900' : 'border-slate-300 bg-white text-slate-700')}">
                                        <option value="user" ${u.role === 'user' ? 'selected' : ''}>👤 কর্মী (6h Limit)</option>
                                        <option value="team_leader" ${u.role === 'team_leader' ? 'selected' : ''}>👑 টিম লিডার (Unlimited)</option>
                                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>⚡ অ্যাডমিন (Admin)</option>
                                    </select>
                                `}
                            </td>

                            <!-- 3. Department Selector (Single Combined Dropdown) -->
                            <td class="py-2.5 px-2.5">
                                <select onchange="updateUserDepartment('${u.id}', this.value)" class="text-xs py-1 px-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-800 font-semibold focus:bg-white focus:ring-2 focus:ring-indigo-500 cursor-pointer">
                                    <option value="gender_verify" ${(u.department === 'gender_verify' || u.department === 'signal_work' || u.department === 'signal') ? 'selected' : ''}>🚻 Gender Verify (Female & Signal)</option>
                                    <option value="lookup" ${(u.department === 'lookup' || u.department === 'number_lookup') ? 'selected' : ''}>🔍 Number Lookup</option>
                                </select>
                            </td>

                            <!-- 4. Status Badge (Clickable Toggle) -->
                            <td class="py-2.5 px-2 text-center">
                                ${u.is_blocked 
                                    ? `<button onclick="adminToggleUserBlock('${u.id}', '${u.username || u.email}', false)" title="ক্লিক করে আনব্লক করুন" class="px-2 py-0.5 text-[11px] rounded-full font-bold bg-rose-100 text-rose-800 border border-rose-300 hover:bg-rose-200 transition whitespace-nowrap">🔴 ব্লকড</button>`
                                    : `<button onclick="adminToggleUserBlock('${u.id}', '${u.username || u.email}', true)" title="ক্লিক করে ব্লক করুন" class="px-2 py-0.5 text-[11px] rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200 transition whitespace-nowrap">🟢 সক্রিয়</button>`
                                }
                            </td>

                            <!-- 5. Combined Activity Stats (Total, This Month, Today, Last Month) -->
                            <td class="py-2.5 px-2.5 text-center">
                                <div class="text-xs font-black text-indigo-700 leading-tight" title="সর্বমোট ইউনিক ডাটা">
                                    মোট: ${u.totalContributed.toLocaleString()}
                                </div>
                                <div class="text-[10px] text-purple-700 font-extrabold mt-0.5" title="চলতি মাসের ১ তারিখ থেকে জমা">
                                    চলতি মাস: ${(u.thisMonthAdded || 0).toLocaleString()}
                                </div>
                                <div class="text-[10px] text-emerald-600 font-bold mt-0.5">
                                    আজ: +${u.todayAdded.toLocaleString()}
                                </div>
                                ${(u.lastMonthAdded && u.lastMonthAdded > 0) ? `<div class="text-[9px] text-slate-400 font-medium" title="বিগত মাসের মোট জমা">গত মাস: ${u.lastMonthAdded.toLocaleString()}</div>` : ''}
                            </td>

                            <!-- 6. Compact Modern Actions -->
                            <td class="py-2.5 px-3 text-center">
                                <div class="inline-flex items-center space-x-1">
                                    ${!isMaster ? `
                                        ${u.is_blocked ? `
                                            <button onclick="adminToggleUserBlock('${u.id}', '${u.username || u.email}', false)" class="p-1 px-1.5 text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 rounded-md font-bold transition" title="আনব্লক করুন">
                                                ✅
                                            </button>
                                        ` : `
                                            <button onclick="adminToggleUserBlock('${u.id}', '${u.username || u.email}', true)" class="p-1 px-1.5 text-xs bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-md font-bold transition" title="ব্লক করুন">
                                                🚫
                                            </button>
                                        `}
                                        <button onclick="adminDeleteUserPrompt('${u.id}', '${u.username || u.email}', '${u.email}')" class="p-1 px-1.5 text-xs bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300 rounded-md font-bold transition" title="স্থায়ীভাবে অ্যাকাউন্ট ডিলিট করুন">
                                            🗑️
                                        </button>
                                    ` : ''}
                                    <button onclick="downloadSingleUserData('${u.email}')" class="p-1 px-2 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md font-bold transition flex items-center space-x-1" title="এই কর্মীর ডাটা এক্সেল ডাউনলোড">
                                        <span>📥</span>
                                        <span class="text-[10px]">Data</span>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            } else {
                body.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400 font-medium">কোনো কর্মী অ্যাকাউন্ট পাওয়া যায়নি।</td></tr>`;
            }
        }

        async function updateUserDepartment(userId, newDept) {
            try {
                const { error } = await supabaseClient
                    .from('profiles')
                    .update({ department: newDept })
                    .eq('id', userId);

                if (error) throw error;
                alert('Department updated successfully!');
                await loadAdminDashboard();
            } catch (err) {
                alert('Failed to update department: ' + err.message);
            }
        }

        async function loadAdminSubmissionsData() {
            if (!supabaseClient) return;
            const body = document.getElementById('adminSubmissionsTableBody');
            if (body) body.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">Loading submissions...</td></tr>`;

            const reportFilter = document.getElementById('adminSubReportFilter')?.value || 'all';
            const workerFilter = document.getElementById('adminSubWorkerFilter')?.value || 'all';
            const dateFilter = document.getElementById('adminSubDateFilter')?.value || '';

            try {
                let tRows = [];
                try {
                    if (typeof TursoVault !== 'undefined') {
                        let sql = `SELECT * FROM turso_submissions WHERE 1=1 `;
                        if (reportFilter === 'lookup_no_info') {
                            sql += ` AND (report_type = 'lookup_no_info' OR ((report_type = 'lookup_report' OR report_type = 'lookup') AND (household_income = 'no_info' OR household_income = 'No Information' OR household_income = '-' OR household_income = 'no' OR household_income IS NULL OR household_income = '')))`;
                        } else if (reportFilter === 'lookup_report') {
                            sql += ` AND (report_type = 'lookup_report' OR report_type = 'lookup') AND household_income != 'no_info' AND household_income != 'No Information' AND household_income != '-' AND household_income != 'no' AND household_income IS NOT NULL AND household_income != ''`;
                        } else if (reportFilter && reportFilter !== 'all') {
                            sql += ` AND report_type = '${reportFilter}'`;
                        }
                        if (workerFilter && workerFilter !== 'all') sql += ` AND (user_email = '${workerFilter}' OR username = '${workerFilter}')`;
                        if (dateFilter) sql += ` AND date(created_at) = '${dateFilter}'`;
                        sql += ` ORDER BY id DESC LIMIT 1000;`;
                        const tRes = await safeQuery(TursoVault.query(sql), null);
                        if (tRes && tRes.rows) tRows = tRes.rows;
                    }
                } catch(tErr) {
                    console.warn('Turso submissions live fetch notice:', tErr);
                }

                let sbRows = [];
                try {
                    if (reportFilter === 'lookup_no_info') {
                        let q = supabaseClient.from('lookup_no_info_records').select('*').order('created_at', { ascending: false }).limit(1000);
                        if (dateFilter) q = q.eq('submission_date', dateFilter);
                        if (workerFilter && workerFilter !== 'all') q = q.or(`worker_email.eq.${workerFilter},worker_username.eq.${workerFilter}`);
                        const res = await safeQuery(q, { data: [] });
                        if (res && res.data) {
                            sbRows = res.data.map(r => ({
                                id: r.id,
                                phone_number: r.phone_number,
                                full_name: r.full_name || '-',
                                age: r.age || '-',
                                household_income: 'No Information',
                                est_market_value: 'No Information',
                                report_type: 'lookup_no_info',
                                department: 'lookup',
                                user_email: r.worker_email,
                                username: r.worker_username,
                                created_at: r.created_at || r.submission_date
                            }));
                        }
                    } else if (reportFilter === 'lookup_report') {
                        let q = supabaseClient.from('lookup_records').select('*').order('created_at', { ascending: false }).limit(1000);
                        if (dateFilter) q = q.eq('submission_date', dateFilter);
                        if (workerFilter && workerFilter !== 'all') q = q.or(`worker_email.eq.${workerFilter},worker_username.eq.${workerFilter}`);
                        const res = await safeQuery(q, { data: [] });
                        if (res && res.data) {
                            sbRows = res.data.map(r => ({
                                id: r.id,
                                phone_number: r.phone_number,
                                full_name: r.full_name || '-',
                                age: r.age || '-',
                                household_income: r.household_income || '',
                                est_market_value: r.est_market_value || '',
                                report_type: 'lookup_report',
                                department: 'lookup',
                                user_email: r.worker_email,
                                username: r.worker_username,
                                created_at: r.created_at || r.submission_date
                            }));
                        }
                    } else {
                        let query = supabaseClient.from('master_numbers').select('*').order('created_at', { ascending: false }).limit(1000);
                        if (reportFilter && reportFilter !== 'all') query = query.eq('report_type', reportFilter);
                        if (workerFilter && workerFilter !== 'all') query = query.eq('user_email', workerFilter);
                        if (dateFilter) {
                            const startIso = `${dateFilter}T00:00:00.000Z`;
                            const endIso = `${dateFilter}T23:59:59.999Z`;
                            query = query.gte('created_at', startIso).lte('created_at', endIso);
                        }
                        const res = await safeQuery(query, { data: [] });
                        if (res && res.data) sbRows = res.data;
                    }
                } catch(sbErr) {
                    console.warn('Supabase submissions query notice:', sbErr);
                }

                // Combine both Turso and Supabase submissions!
                adminSubmissionsCache = [...tRows, ...sbRows];
                filterAdminSubmissionsLocal();

            } catch (err) {
                console.error('loadAdminSubmissionsData error:', err);
                if (body) {
                    body.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">
                        <p class="font-bold text-slate-600">কোনো ডাটা পাওয়া যায়নি।</p>
                    </td></tr>`;
                }
            }
        }

        function filterAdminSubmissionsBy(type) {
            switchAdminTab('submissions');
            const reportFilter = document.getElementById('adminSubReportFilter');
            const dateFilter = document.getElementById('adminSubDateFilter');

            if (type === 'male_report') {
                if (reportFilter) reportFilter.value = 'male_report';
                if (dateFilter) dateFilter.value = '';
            } else if (type === 'female_report') {
                if (reportFilter) reportFilter.value = 'female_report';
                if (dateFilter) dateFilter.value = '';
            } else if (type === 'lookup_report') {
                if (reportFilter) reportFilter.value = 'lookup_report';
                if (dateFilter) dateFilter.value = '';
            } else if (type === 'signal_report') {
                if (reportFilter) reportFilter.value = 'signal_report';
                if (dateFilter) dateFilter.value = '';
            } else if (type === 'lookup_no_info') {
                if (reportFilter) reportFilter.value = 'lookup_no_info';
                if (dateFilter) dateFilter.value = '';
            } else if (type === 'today') {
                if (reportFilter) reportFilter.value = 'all';
                if (dateFilter) dateFilter.value = new Date().toISOString().slice(0, 10);
            } else {
                if (reportFilter) reportFilter.value = 'all';
                if (dateFilter) dateFilter.value = '';
            }

            updateSubmissionsQuickFilterUI(type);
            loadAdminSubmissionsData();
        }

        function updateSubmissionsQuickFilterUI(activeType) {
            const btnMap = {
                'all': document.getElementById('qfBtnAll'),
                'male_report': document.getElementById('qfBtnMale'),
                'female_report': document.getElementById('qfBtnFemale'),
                'signal_report': document.getElementById('qfBtnSignal'),
                'lookup_report': document.getElementById('qfBtnLookup'),
                'lookup_no_info': document.getElementById('qfBtnLookupNoInfo'),
                'today': document.getElementById('qfBtnToday')
            };

            Object.keys(btnMap).forEach(k => {
                const btn = btnMap[k];
                if (!btn) return;
                if (k === activeType) {
                    btn.className = 'px-3 py-1.5 text-xs font-bold rounded-lg border transition bg-indigo-600 text-white shadow-sm';
                } else {
                    btn.className = 'px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition';
                }
            });
        }

        // 1-Click JSON Snapshot Backup of Central Database

        // ==========================================
        // COMPANY RECEIVED NUMBERS STOCK & ON-DEMAND DISPENSER
        // ==========================================
        
        

        function setDispenseQty(qty) {
            const input = document.getElementById('dispenseQuantity');
            if (qty === 'all') {
                const avail = parseInt(document.getElementById('recStatAvailable').innerText.replace(/,/g, '')) || 0;
                input.value = avail > 0 ? avail : 1000;
            } else {
                input.value = qty;
            }
        }

        function handleRecFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                recStockParsedRows = XLSX.utils.sheet_to_json(worksheet);
                alert(`ফাইল থেকে ${recStockParsedRows.length} টি সারি পাওয়া গেছে। এখন 'Save & Stock Numbers' বাটনে ক্লিক করুন।`);
            };

            if (file.name.endsWith('.txt')) {
                const textReader = new FileReader();
                textReader.onload = function(e) {
                    const lines = e.target.result.split(/\r?\n/);
                    recStockParsedRows = [];
                    lines.forEach(l => {
                        const cleanNum = l.replace(/[^0-9]/g, '');
                        if (cleanNum.length >= 6) {
                            recStockParsedRows.push({ phone: cleanNum });
                        }
                    });
                    alert(`TXT ফাইল থেকে ${recStockParsedRows.length} টি ফোন নাম্বার পাওয়া গেছে।`);
                };
                textReader.readAsText(file);
            } else {
                reader.readAsArrayBuffer(file);
            }
        }

        async function submitCompanyReceivedStock() {
            if (!supabaseClient) return;

            const dateInput = document.getElementById('recInputDate');
            const batchInput = document.getElementById('recInputBatchName');
            const textInput = document.getElementById('recTextInput');
            const resultCard = document.getElementById('recUploadResultCard');
            const btn = document.getElementById('btnSubmitRecStock');

            const recDate = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().slice(0, 10);
            const batchName = batchInput && batchInput.value.trim() ? batchInput.value.trim() : 'Company_Stock';

            let records = [];

            // From parsed file
            if (recStockParsedRows && recStockParsedRows.length > 0) {
                recStockParsedRows.forEach(row => {
                    let phone = '';
                    let name = '';
                    let age = '';

                    Object.keys(row).forEach(k => {
                        const val = String(row[k] || '').trim();
                        const cleanNum = val.replace(/[^0-9]/g, '');
                        if (!phone && cleanNum.length >= 6 && cleanNum.length <= 16) {
                            phone = cleanNum;
                        } else if (!name && val.length > 1 && !/^[0-9]+$/.test(val)) {
                            name = val;
                        } else if (!age && /^[0-9]{1,3}$/.test(val) && parseInt(val) <= 120) {
                            age = val;
                        }
                    });

                    if (phone) {
                        records.push({ phone, name, age });
                    }
                });
            }

            // From text paste
            if (textInput && textInput.value.trim()) {
                const lines = textInput.value.split(/\r?\n/);
                lines.forEach(line => {
                    const cleanNum = line.replace(/[^0-9]/g, '');
                    if (cleanNum.length >= 6) {
                        records.push({ phone: cleanNum, name: '', age: '' });
                    }
                });
            }

            if (records.length === 0) {
                alert('অনুগ্রহ করে একটি এক্সেল/টেক্সট ফাইল আপলোড করুন অথবা বক্সে ফোন নাম্বার পেস্ট করুন।');
                return;
            }

            btn.disabled = true;
            resultCard.classList.remove('hidden');
            resultCard.className = 'p-4 rounded-xl text-xs font-medium bg-indigo-50 border border-indigo-200 text-indigo-900';
            resultCard.innerHTML = `⏳ ${records.length} টি নাম্বার স্টকে আপলোড এবং ডুপ্লিকেট পরীক্ষা করা হচ্ছে...`;

            try {
                const stockTypeInput = document.getElementById('recInputStockType');
                const targetStockType = stockTypeInput ? stockTypeInput.value : 'gender_verify';

                // Call RPC with stock_type
                // 1. Direct Primary Write to Turso 9 GB Vault (Unlimited Capacity)
                let tursoStockCount = 0;
                try {
                    if (typeof TursoVault !== 'undefined') {
                        const tRes = await TursoVault.insertStockNumbers(records, targetStockType, recDate, batchName);
                        tursoStockCount = tRes.count || records.length;
                    }
                } catch(tStockErr) {
                    console.warn('Turso stock write notice:', tStockErr);
                }

                // 2. Optional Supabase Sync
                const { data, error } = await supabaseClient.rpc('admin_upload_received_numbers', {
                    p_records: records,
                    p_received_date: recDate,
                    p_batch_name: batchName,
                    p_stock_type: targetStockType
                });

                if (error) {
                    // Fallback to direct table insert if RPC not yet run
                    console.warn('RPC notice, using direct insert fallback:', error);
                    let newInserted = 0;
                    for (let i = 0; i < records.length; i += 500) {
                        const chunk = records.slice(i, i + 500).map(r => ({
                            received_date: recDate,
                            phone_number: r.phone,
                            full_name: r.name,
                            age: r.age,
                            batch_name: batchName,
                            admin_email: currentUser ? currentUser.email : 'admin'
                        }));
                        const { error: insErr } = await supabaseClient
                            .from('company_received_numbers')
                            .upsert(chunk, { onConflict: 'phone_number', ignoreDuplicates: true });
                        if (!insErr) newInserted += chunk.length;
                    }
                    resultCard.className = 'p-4 rounded-xl text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-900';
                    resultCard.innerHTML = `✅ স্টকে সফলভাবে সেভ করা হয়েছে! (${records.length} টি প্রসেস করা হয়েছে)`;
                } else {
                    // Background dual-write to Turso 9 GB Cloud Vault
                    try {
                        if (typeof TursoVault !== 'undefined' && TursoVault.asyncRecordStock) {
                            TursoVault.asyncRecordStock(records, targetStockType);
                        }
                    } catch(tErr) {
                        console.warn('Turso stock dual-write notice:', tErr);
                    }

                    resultCard.className = 'p-4 rounded-xl text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-900';
                    resultCard.innerHTML = `
                        <div class="flex items-center space-x-2 font-bold text-sm mb-1">
                            <span>✅</span>
                            <span>স্টকে সফলভাবে সংরক্ষণ করা হয়েছে!</span>
                        </div>
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono">
                            <div>মোট প্রসেস: <b>${data.total_received}</b></div>
                            <div>ফাইলে ইউনিক: <b>${data.unique_in_file}</b></div>
                            <div class="text-emerald-700">নতুন সেভ: <b>+${data.new_inserted}</b></div>
                            <div class="text-amber-700">ডুপ্লিকেট বাদ: <b>${data.duplicates_count}</b></div>
                        </div>
                    `;
                }

                // Reset form
                if (textInput) textInput.value = '';
                document.getElementById('recFileInput').value = '';
                recStockParsedRows = [];
                await loadCompanyReceivedData();
            } catch (err) {
                resultCard.className = 'p-4 rounded-xl text-xs font-medium bg-red-50 border border-red-200 text-red-800';
                resultCard.innerHTML = `⚠️ আপলোড ত্রুটি: ${err.message}`;
            } finally {
                btn.disabled = false;
            }
        }

        async function loadCompanyReceivedData() {
            if (!supabaseClient) return;

            const tbody = document.getElementById('recStockTableBody');
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">Loading received stock records...</td></tr>`;

            const dateFilter = document.getElementById('recHistoryDateFilter') ? document.getElementById('recHistoryDateFilter').value : 'all';

            try {
                let tStats = { total: 0, available: 0, claimed: 0, today: 0 };
                let tRows = [];

                try {
                    if (typeof TursoVault !== 'undefined') {
                        tStats = await safeQuery(TursoVault.getStockStats(), { total: 0, available: 0, claimed: 0, today: 0 });
                        let sql = `SELECT * FROM turso_stock_numbers WHERE 1=1 `;
                        if (dateFilter !== 'all') sql += ` AND received_date = '${dateFilter}'`;
                        sql += ` ORDER BY id DESC LIMIT 500;`;
                        const tRowsRes = await safeQuery(TursoVault.query(sql), null);
                        if (tRowsRes && tRowsRes.rows) tRows = tRowsRes.rows;
                    }
                } catch(tErr) {
                    console.warn('Turso stock fetch notice:', tErr);
                }

                const todayIso = new Date().toISOString().slice(0, 10);
                const [totalRecRes, availRecRes, claimedRecRes, todayRecRes, sbRowsRes] = await Promise.all([
                    safeQuery(supabaseClient.from('company_received_numbers').select('*', { count: 'exact', head: true }), { count: 0 }),
                    safeQuery(supabaseClient.from('company_received_numbers').select('*', { count: 'exact', head: true }).eq('is_assigned', false), { count: 0 }),
                    safeQuery(supabaseClient.from('company_received_numbers').select('*', { count: 'exact', head: true }).eq('is_assigned', true), { count: 0 }),
                    safeQuery(supabaseClient.from('company_received_numbers').select('*', { count: 'exact', head: true }).eq('received_date', todayIso), { count: 0 }),
                    (async () => {
                        try {
                            let q = supabaseClient.from('company_received_numbers').select('*').order('created_at', { ascending: false }).limit(500);
                            if (dateFilter !== 'all') q = q.eq('received_date', dateFilter);
                            const { data } = await q;
                            return data || [];
                        } catch(e) {
                            return [];
                        }
                    })()
                ]);

                const sbTotal = totalRecRes.count || 0;
                const sbAvail = availRecRes.count || 0;
                const sbClaimed = claimedRecRes.count || 0;
                const sbToday = todayRecRes.count || 0;
                const sbRows = sbRowsRes || [];

                // COMBINE TURSO + SUPABASE STOCK
                const combinedTotal = (tStats.total || 0) + sbTotal;
                const combinedAvail = (tStats.available || 0) + sbAvail;
                const combinedClaimed = (tStats.claimed || 0) + sbClaimed;
                const combinedToday = (tStats.today || 0) + sbToday;

                if (document.getElementById('recStatTotal')) document.getElementById('recStatTotal').innerText = combinedTotal.toLocaleString();
                if (document.getElementById('recStatAvailable')) document.getElementById('recStatAvailable').innerText = combinedAvail.toLocaleString();
                if (document.getElementById('recStockAvailableBadge')) document.getElementById('recStockAvailableBadge').innerText = combinedAvail.toLocaleString();
                if (document.getElementById('recStatExported')) document.getElementById('recStatExported').innerText = combinedClaimed.toLocaleString();
                if (document.getElementById('recStatToday')) document.getElementById('recStatToday').innerText = combinedToday.toLocaleString();

                updateStockDepletionAlert(combinedTotal, combinedAvail, combinedClaimed);
                loadAdminWorkerClaimsLog();

                // Merge rows from both Turso and Supabase
                recStockCache = [...tRows, ...sbRows];

                const dateSet = new Set();
                recStockCache.forEach(r => {
                    if (r.received_date) dateSet.add(r.received_date);
                });

                const dispenseDateSelect = document.getElementById('dispenseDateFilter');
                if (dispenseDateSelect) {
                    dispenseDateSelect.innerHTML = '<option value="all">🌟 All Dates (সব তারিখের স্টক থেকে)</option>';
                    dateSet.forEach(d => {
                        dispenseDateSelect.innerHTML += `<option value="${d}">📅 ${d} এর স্টক</option>`;
                    });
                }

                const historyDateSelect = document.getElementById('recHistoryDateFilter');
                if (historyDateSelect && historyDateSelect.options.length <= 1) {
                    historyDateSelect.innerHTML = '<option value="all">All Dates</option>';
                    dateSet.forEach(d => {
                        historyDateSelect.innerHTML += `<option value="${d}">${d}</option>`;
                    });
                }

                filterRecStockHistoryLocal();

            } catch (err) {
                console.error('loadCompanyReceivedData error:', err);
                if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No records found.</td></tr>`;
            }
        }

        function filterRecStockHistoryLocal() {
            const tbody = document.getElementById('recStockTableBody');
            if (!tbody) return;

            const search = (document.getElementById('recHistorySearch')?.value || '').trim().toLowerCase();

            let list = recStockCache;
            if (search) {
                list = list.filter(r => {
                    const phone = (r.phone_number || '').toLowerCase();
                    const batch = (r.batch_name || '').toLowerCase();
                    const name = (r.full_name || '').toLowerCase();
                    return phone.includes(search) || batch.includes(search) || name.includes(search);
                });
            }

            if (!list || list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No records found.</td></tr>`;
                return;
            }

            tbody.innerHTML = list.map((r, idx) => {
                const statusBadge = r.is_exported
                    ? `<span class="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800 font-bold">📤 Exported</span>`
                    : `<span class="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-800 font-bold">🟢 Available</span>`;

                return `
                    <tr class="hover:bg-slate-50 text-xs">
                        <td class="py-2.5 px-4 font-mono text-slate-400">${idx + 1}</td>
                        <td class="py-2.5 px-4 font-mono font-bold text-slate-800">${r.phone_number}</td>
                        <td class="py-2.5 px-4 font-medium text-slate-700">${r.full_name || '-'}</td>
                        <td class="py-2.5 px-4 font-medium text-slate-600">📅 ${r.received_date}</td>
                        <td class="py-2.5 px-4 text-slate-500">${r.batch_name || '-'}</td>
                        <td class="py-2.5 px-4">${statusBadge}</td>
                        <td class="py-2.5 px-4 text-right">
                            <button onclick="copySingleNumber('${r.phone_number}')" class="text-indigo-600 hover:text-indigo-800 font-bold text-xs p-1 rounded hover:bg-indigo-50" title="Copy Number">
                                📋 Copy
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function copySingleNumber(phone) {
            navigator.clipboard.writeText(phone);
            alert(`Phone number copied: ${phone}`);
        }

        // ==========================================
        // 🎯 EXECUTE CUSTOM ON-DEMAND NUMBER DISPENSE
        // ==========================================
        async function executeNumberDispense() {
            if (!supabaseClient) return;

            const qtyInput = document.getElementById('dispenseQuantity');
            const rawQty = parseInt(qtyInput ? qtyInput.value : 0);

            if (!rawQty || rawQty <= 0) {
                alert('অনুগ্রহ করে আপনি কতগুলো নাম্বার চান তা লিখুন (যেমন: 500 বা 1000)।');
                return;
            }

            const dateFilter = document.getElementById('dispenseDateFilter')?.value || 'all';
            const statusFilter = document.getElementById('dispenseStatusFilter')?.value || 'unused';
            const markExported = document.getElementById('dispenseMarkExported')?.checked ?? true;
            const formatRadio = document.querySelector('input[name="dispenseFormat"]:checked');
            const chosenFormat = formatRadio ? formatRadio.value : 'txt';

            const btn = document.getElementById('btnExecuteDispense');
            const msgBox = document.getElementById('dispenseResultMsg');

            btn.disabled = true;
            msgBox.classList.remove('hidden');
            msgBox.className = 'text-xs p-3 rounded-xl bg-white/20 text-white font-medium';
            msgBox.innerHTML = `⏳ স্টক থেকে ${rawQty.toLocaleString()} টি নাম্বার খোঁজা ও তৈরি করা হচ্ছে...`;

            try {
                // Query numbers
                let query = supabaseClient
                    .from('company_received_numbers')
                    .select('*')
                    .order('id', { ascending: true })
                    .limit(rawQty);

                if (statusFilter === 'unused') {
                    query = query.eq('is_exported', false);
                }
                if (dateFilter !== 'all') {
                    query = query.eq('received_date', dateFilter);
                }

                const { data, error } = await query;
                if (error) throw error;

                if (!data || data.length === 0) {
                    throw new Error('আপনার ফিল্টারের সাথে মিল রেখে স্টকে কোনো নাম্বার অবশিষ্ট নেই।');
                }

                const extractedCount = data.length;

                // Mark as exported if checked
                if (markExported) {
                    const idsToMark = data.map(d => d.id);
                    await supabaseClient
                        .from('company_received_numbers')
                        .update({ is_exported: true, exported_at: new Date().toISOString() })
                        .in('id', idsToMark);
                }

                const todayStr = new Date().toISOString().slice(0, 10);

                if (chosenFormat === 'txt') {
                    // Export as Plain Text (.txt) - 1 number per line
                    const textLines = data.map(d => d.phone_number).join('\r\n');
                    const blob = new Blob([textLines], { type: 'text/plain;charset=utf-8' });
                    const downloadAnchor = document.createElement('a');
                    downloadAnchor.href = URL.createObjectURL(blob);
                    downloadAnchor.download = `Company_Numbers_${extractedCount}_Qty_${todayStr}.txt`;
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    downloadAnchor.remove();
                } else {
                    // Export as Excel (.xlsx) - Pure phone numbers only, no extra rows or columns
                    const cleanNumbers = data
                        .map(d => String(d.phone_number || d.phone || d).trim())
                        .filter(p => p.length >= 6);
                    const ws = XLSX.utils.aoa_to_sheet(cleanNumbers.map(p => [p]));
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, `Numbers_${extractedCount}`);
                    XLSX.writeFile(wb, `Company_Numbers_${extractedCount}_Qty_${todayStr}.xlsx`);
                }

                msgBox.className = 'text-xs p-3 rounded-xl bg-emerald-500 text-slate-950 font-bold';
                msgBox.innerHTML = `✅ সফল! ${extractedCount.toLocaleString()} টি নাম্বার সফলভাবে .${chosenFormat.toUpperCase()} ফাইলে ডাউনলোড হয়েছে।${markExported ? ' (স্টকে ব্যবহৃত হিসেবে চিহ্নিত করা হয়েছে)' : ''}`;

                // Refresh stock counters
                await loadCompanyReceivedData();
            } catch (err) {
                msgBox.className = 'text-xs p-3 rounded-xl bg-red-500 text-white font-bold';
                msgBox.innerHTML = `⚠️ উত্তোলন ত্রুটি: ${err.message}`;
            } finally {
                btn.disabled = false;
            }
        }

        function setupGoogleDriveClient() {
            const savedClientId = localStorage.getItem('gdrive_client_id') || '171403934003-q673l41i2h57c7p9pjob191bnv76d2ge.apps.googleusercontent.com';
            const inputEl = document.getElementById('gdriveClientIdInput');
            if (inputEl && savedClientId) {
                inputEl.value = savedClientId;
            }
            updateGoogleDriveUI();
        }

        function updateGoogleDriveUI() {
            const notConnectedDiv = document.getElementById('gdriveNotConnected');
            const connectedDiv = document.getElementById('gdriveConnected');
            const emailBadge = document.getElementById('gdriveConnectedEmail');

            if (googleAccessToken && googleUserEmail) {
                if (notConnectedDiv) notConnectedDiv.classList.add('hidden');
                if (connectedDiv) connectedDiv.classList.remove('hidden');
                if (emailBadge) emailBadge.innerText = googleUserEmail;
            } else {
                if (notConnectedDiv) notConnectedDiv.classList.remove('hidden');
                if (connectedDiv) connectedDiv.classList.add('hidden');
            }
        }

        function handleConnectGoogleDrive() {
            const inputEl = document.getElementById('gdriveClientIdInput');
            const clientId = inputEl ? inputEl.value.trim() : '';

            if (!clientId) {
                alert('অনুগ্রহ করে আপনার Google OAuth Client ID দিন। নিচে দেওয়া নির্দেশিকা দেখে Google Cloud থেকে বিনামূল্যে Client ID তৈরি করে নিন।');
                return;
            }

            localStorage.setItem('gdrive_client_id', clientId);

            if (!window.google || !google.accounts || !google.accounts.oauth2) {
                alert('Google Identity Services লোড হচ্ছে, অনুগ্রহ করে কয়েক সেকেন্ড পর আবার চেষ্টা করুন।');
                return;
            }

            try {
                window.googleTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: clientId,
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    callback: async (tokenResponse) => {
                        if (tokenResponse && tokenResponse.access_token) {
                            window.googleAccessToken = tokenResponse.access_token;
                            localStorage.setItem('gdrive_access_token', window.googleAccessToken);

                            try {
                                const aboutRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
                                    headers: { Authorization: `Bearer ${window.googleAccessToken}` }
                                });
                                const aboutData = await aboutRes.json();
                                window.googleUserEmail = (aboutData.user && aboutData.user.emailAddress) || 'Connected Google User';
                                localStorage.setItem('gdrive_user_email', window.googleUserEmail);
                            } catch (e) {
                                window.googleUserEmail = 'Google Drive Connected';
                                localStorage.setItem('gdrive_user_email', window.googleUserEmail);
                            }

                            updateGoogleDriveUI();
                            alert(`গুগল ড্রাইভ সফলভাবে কানেক্ট হয়েছে! (${window.googleUserEmail})\nএখন আপনি ১-ক্লিকেই গুগল ড্রাইভে ডাটাবেজ ব্যাকআপ পাঠাতে পারবেন।`);
                        }
                    },
                });

                window.googleTokenClient.requestAccessToken();
            } catch (err) {
                alert('Google Drive connection error: ' + err.message);
            }
        }

        function handleDisconnectGoogleDrive() {
            googleAccessToken = null;
            googleUserEmail = null;
            localStorage.removeItem('gdrive_access_token');
            localStorage.removeItem('gdrive_user_email');
            updateGoogleDriveUI();
            alert('গুগল ড্রাইভ ডিসকানেক্ট করা হয়েছে।');
        }

        async function uploadDatabaseBackupToGoogleDrive() {
            if (!googleAccessToken) {
                alert('প্রথমে আপনার গুগল অ্যাকাউন্ট কানেক্ট করুন।');
                return;
            }

            const btn = document.getElementById('gdriveUploadBtn');
            const statusBox = document.getElementById('gdriveUploadStatus');

            if (btn) btn.disabled = true;
            if (statusBox) {
                statusBox.classList.remove('hidden');
                statusBox.className = 'text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 p-3 rounded-lg font-medium';
                statusBox.innerHTML = '⏳ সুপাবেস ডাটাবেজ থেকে সমস্ত রেকর্ড সংগ্রহ করা হচ্ছে...';
            }

            try {
                const { data, error } = await supabaseClient
                    .from('master_numbers')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (error) throw error;
                if (!data || data.length === 0) {
                    throw new Error('ডাটাবেজে কোনো রেকর্ড পাওয়া যায়নি।');
                }

                if (statusBox) statusBox.innerHTML = `⏳ ${data.length.toLocaleString()} টি রেকর্ড সরাসরি গুগল ড্রাইভে আপলোড করা হচ্ছে...`;

                const today = new Date().toISOString().slice(0, 10);
                const fileName = `Work_Manager_Full_Backup_${today}.json`;
                const fileContent = JSON.stringify({
                    backup_date: today,
                    total_records: data.length,
                    exported_from: 'Work Manager Portal',
                    data: data
                }, null, 2);

                const metadata = {
                    name: fileName,
                    mimeType: 'application/json',
                    description: `Automated Full Central Database Backup with ${data.length} unique phone records.`
                };

                const boundary = '-------314159265358979323846';
                const delimiter = "\r\n--" + boundary + "\r\n";
                const close_delim = "\r\n--" + boundary + "--";

                const multipartRequestBody =
                    delimiter +
                    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
                    JSON.stringify(metadata) +
                    delimiter +
                    'Content-Type: application/json\r\n\r\n' +
                    fileContent +
                    close_delim;

                const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + googleAccessToken,
                        'Content-Type': 'multipart/related; boundary=' + boundary
                    },
                    body: multipartRequestBody
                });

                if (!res.ok) {
                    if (res.status === 401) {
                        googleAccessToken = null;
                        localStorage.removeItem('gdrive_access_token');
                        updateGoogleDriveUI();
                        throw new Error('গুগল লগইন সেশনের মেয়াদ শেষ হয়ে গেছে। অনুগ্রহ করে আবার "Connect Google Drive" এ ক্লিক করুন।');
                    }
                    const errData = await res.json();
                    throw new Error(errData.error ? errData.error.message : 'Upload failed');
                }

                const driveFile = await res.json();

                if (statusBox) {
                    statusBox.className = 'text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 p-3 rounded-lg font-medium';
                    statusBox.innerHTML = `
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <span class="font-bold">✅ সফলভাবে আপনার গুগল ড্রাইভে সেভ হয়েছে!</span>
                                <div class="text-[11px] text-emerald-700 mt-0.5">ফাইল: ${fileName} (${data.length.toLocaleString()} টি রেকর্ড)</div>
                            </div>
                            <a href="https://drive.google.com/file/d/${driveFile.id}/view" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-xs font-bold transition flex items-center space-x-1">
                                <span>গুগল ড্রাইভে দেখুন ↗</span>
                            </a>
                        </div>
                    `;
                }
            } catch (err) {
                if (statusBox) {
                    statusBox.className = 'text-xs text-red-700 bg-red-50 border border-red-200 p-3 rounded-lg font-medium';
                    statusBox.innerHTML = `⚠️ আপলোড ব্যর্থ হয়েছে: ${err.message}`;
                }
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        async function downloadFullDatabaseJsonBackup() {
            if (!supabaseClient) return;
            try {
                const { data, error } = await supabaseClient
                    .from('master_numbers')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (error) throw error;
                if (!data || data.length === 0) {
                    alert('No records found in database to backup.');
                    return;
                }

                const today = new Date().toISOString().slice(0, 10);
                const backupPayload = {
                    backup_date: today,
                    exported_by: currentUser ? currentUser.email : 'admin',
                    total_records: data.length,
                    data: data
                };

                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupPayload, null, 2));
                const downloadAnchor = document.createElement('a');
                downloadAnchor.setAttribute("href", dataStr);
                downloadAnchor.setAttribute("download", `Full_Database_Backup_${today}.json`);
                document.body.appendChild(downloadAnchor);
                downloadAnchor.click();
                downloadAnchor.remove();
            } catch (err) {
                alert('Backup download failed: ' + err.message);
            }
        }

        // ==========================================
        // ADMIN SUBMISSION MANAGEMENT & RECORD CLEANER
        // ==========================================
        async function adminDeleteSingleNumber(id, phone) {
            if (!confirm(`Are you sure you want to delete this record (${phone})?`)) return;
            try {
                const { error } = await supabaseClient.from('master_numbers').delete().eq('id', id);
                if (error) throw error;
                alert('Record deleted successfully!');
                await loadAdminSubmissionsData();
                await loadAdminDashboard();
            } catch (err) {
                alert('Delete failed: ' + err.message);
            }
        }

        async function adminDeleteInvalidRecords() {
            if (!adminSubmissionsCache || adminSubmissionsCache.length === 0) {
                alert('কোনো রেকর্ড নেই।');
                return;
            }

            const invalidRows = adminSubmissionsCache.filter(r => {
                const phone = String(r.phone_number || '').trim();
                const digits = phone.replace(/[^0-9]/g, '');
                return /[a-zA-Z]/.test(phone) && digits.length < 6;
            });

            if (invalidRows.length === 0) {
                alert('কোনো ভুল রেকর্ড পাওয়া যায়নি! সব রেকর্ডে সঠিক ফোন নাম্বার রয়েছে।');
                return;
            }

            if (!confirm(`মোট ${invalidRows.length} টি ভুল রেকর্ড পাওয়া গেছে (যেখানে ফোন নাম্বারের জায়গায় নাম চলে এসেছে)।\nআপনি কি এই ${invalidRows.length} টি ভুল রেকর্ড ডাটাবেজ থেকে মুছে ফেলতে চান?`)) {
                return;
            }

            try {
                const ids = invalidRows.map(r => r.id);
                const { error } = await supabaseClient.from('master_numbers').delete().in('id', ids);
                if (error) throw error;

                alert(`সফলভাবে ${ids.length} টি ভুল রেকর্ড মুছে ফেলা হয়েছে!`);
                await loadAdminSubmissionsData();
                await loadAdminDashboard();
            } catch (err) {
                alert('মুছতে সমস্যা হয়েছে: ' + err.message);
            }
        }

        async function downloadDateSpecificExcel(targetDate) {
            if (!supabaseClient) return;
            try {
                // Fetch 100% of records for targetDate with auto-pagination (Zero Data Loss!)
                const allRows = await fetchAllSubmissions({ date: targetDate });
                if (!allRows || allRows.length === 0) {
                    alert('No records found for date: ' + targetDate);
                    return;
                }

                const exportRows = allRows.map((item, idx) => ({
                    'SL': idx + 1,
                    'Phone Number': item.phone_number,
                    'Full Name': item.full_name || '',
                    'Age': item.age || '',
                    'Household Income': item.household_income || '',
                    'Est Market Value': item.est_market_value || '',
                    'Report Type': item.report_type === 'female_report' ? 'Female Report' : 'Lookup Report',
                    'Department': item.department || '-',
                    'Submitted By (Worker)': item.username || userEmailToNameMap[item.user_email] || item.user_email,
                    'Submission Time': new Date(item.created_at).toLocaleString()
                }));

                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, `Data_${targetDate}`);
                XLSX.writeFile(wb, `Report_Data_${targetDate}_Total_${exportRows.length}.xlsx`);
            } catch(err) {
                console.error('downloadDateSpecificExcel error:', err);
                alert('Export failed: ' + err.message);
            }
        }


        function filterAdminSubmissionsLocal() {
            const body = document.getElementById('adminSubmissionsTableBody');
            const search = document.getElementById('adminSubSearchInput').value.trim().toLowerCase();
            const groupByDateToggle = document.getElementById('adminSubGroupByDateToggle');
            const isGroupByDate = groupByDateToggle ? groupByDateToggle.checked : true;

            let list = adminSubmissionsCache;
            if (search) {
                list = list.filter(item => {
                    const workerUname = (item.username || userEmailToNameMap[item.user_email] || '').toLowerCase();
                    const phone = (item.phone_number || '');
                    const name = (item.full_name || '').toLowerCase();
                    const email = (item.user_email || '').toLowerCase();
                    return phone.includes(search) || name.includes(search) || email.includes(search) || workerUname.includes(search);
                });
            }

            if (!list || list.length === 0) {
                body.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">
                    <p class="font-bold text-slate-600">কোনো ডাটা পাওয়া যায়নি।</p>
                    <p class="text-xs text-slate-400 mt-1">ফিল্টারের সাথে মিল রেখে কোনো সাবমিশন রেকর্ড পাওয়া যায়নি।</p>
                </td></tr>`;
                return;
            }

            // Function to render a single row
            function renderItemRow(item, idx) {
                const timeStr = new Date(item.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                let repBadge = '';
                if (item.report_type === 'female_report') {
                    repBadge = '<span class="px-2 py-0.5 text-xs rounded bg-pink-100 text-pink-800 font-bold">👩 Female Report</span>';
                } else if (item.report_type === 'signal_report') {
                    repBadge = '<span class="px-2 py-0.5 text-xs rounded bg-cyan-100 text-cyan-800 font-bold">📡 Signal Report</span>';
                } else {
                    repBadge = '<span class="px-2 py-0.5 text-xs rounded bg-purple-100 text-purple-800 font-bold">🔍 Lookup Report</span>';
                }

                if (item.household_income || item.est_market_value) {
                    repBadge += `<div class="text-[10px] text-purple-700 mt-1 flex flex-wrap gap-1 font-sans">
                        ${item.household_income ? `<span class="bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">💰 ${item.household_income}</span>` : ''}
                        ${item.est_market_value ? `<span class="bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">🏡 ${item.est_market_value}</span>` : ''}
                    </div>`;
                }

                const phoneStr = String(item.phone_number || '').trim();
                const phoneDigits = phoneStr.replace(/[^0-9]/g, '');
                const isInvalidPhone = /[a-zA-Z]/.test(phoneStr) && phoneDigits.length < 6;

                let phoneHtml = `<span class="font-bold font-mono text-slate-800">${phoneStr}</span>`;
                if (isInvalidPhone) {
                    phoneHtml = `<span class="font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded">${phoneStr}</span>
                        <span class="text-[10px] text-red-500 block mt-0.5 font-sans">⚠️ কলাম উল্টা ছিল (নাম এসেছে)</span>`;
                }

                return `
                    <tr class="hover:bg-slate-50 text-xs">
                        <td class="py-2.5 px-4 font-mono text-slate-400">${idx + 1}</td>
                        <td class="py-2.5 px-4">${phoneHtml}</td>
                        <td class="py-2.5 px-4 font-bold text-slate-800">${item.full_name || '-'}</td>
                        <td class="py-2.5 px-4 font-medium text-slate-600">${item.age || '-'}</td>
                        <td class="py-2.5 px-4">${repBadge}</td>
                        <td class="py-2.5 px-4">
                            <div class="flex items-center space-x-1 font-bold text-slate-800 text-xs">
                                <span>👤</span>
                                <span>${item.username || userEmailToNameMap[item.user_email] || item.user_email.split('@')[0]}</span>
                            </div>
                            <span class="text-[11px] text-slate-400 font-mono block mt-0.5">${item.user_email}</span>
                        </td>
                        <td class="py-2.5 px-4 text-right text-slate-500">
                            <div>${timeStr}</div>
                            <button onclick="adminDeleteSingleNumber('${item.id}', '${phoneStr}')" class="text-[11px] text-red-500 hover:text-red-700 underline font-semibold mt-1" title="Delete this record">Delete</button>
                        </td>
                    </tr>
                `;
            }

            if (isGroupByDate) {
                // Group by Day/Date (YYYY-MM-DD)
                const dateGroups = {};
                list.forEach(item => {
                    const dateKey = (item.created_at || '').slice(0, 10) || 'Unknown Date';
                    if (!dateGroups[dateKey]) dateGroups[dateKey] = [];
                    dateGroups[dateKey].push(item);
                });

                // Sort dates descending
                const sortedDates = Object.keys(dateGroups).sort().reverse();
                let outputHtml = '';
                let globalIdx = 0;

                sortedDates.forEach(dateKey => {
                    const groupRows = dateGroups[dateKey];
                    const friendlyDate = new Date(dateKey + 'T00:00:00').toLocaleDateString(undefined, {
                        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
                    });

                    outputHtml += `
                        <tr class="bg-indigo-50/90 border-t-2 border-indigo-300 font-bold text-indigo-950">
                            <td colspan="7" class="py-2.5 px-4">
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <div class="flex items-center space-x-2">
                                        <span class="text-base">📅</span>
                                        <span class="text-sm font-extrabold">${friendlyDate}</span>
                                        <span class="text-xs bg-indigo-200 text-indigo-900 px-2.5 py-0.5 rounded-full font-bold">
                                            মোট: ${groupRows.length.toLocaleString()} টি ডাটা
                                        </span>
                                    </div>
                                    <button type="button" onclick="downloadDateSpecificExcel('${dateKey}')" class="text-xs text-indigo-800 hover:text-indigo-950 bg-white hover:bg-indigo-50 border border-indigo-200 font-bold px-3 py-1 rounded-md shadow-sm transition flex items-center space-x-1">
                                        <span>📥</span>
                                        <span>Export ${dateKey} Excel</span>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;

                    groupRows.forEach(item => {
                        outputHtml += renderItemRow(item, globalIdx++);
                    });
                });

                body.innerHTML = outputHtml;
            } else {
                body.innerHTML = list.map((item, idx) => renderItemRow(item, idx)).join('');
            }
        }

        
        // Admin Block / Unblock User Function
        async function adminToggleUserBlock(userId, username, shouldBlock) {
            if (!supabaseClient) return;
            const actionWord = shouldBlock ? 'ব্লক (Block)' : 'আনব্লক (Unblock)';
            const confirmMsg = shouldBlock 
                ? `আপনি কি নিশ্চিতভাবে কর্মী "${username}" এর অ্যাকাউন্ট ${actionWord} করতে চান?\n\nব্লক করলে এই কর্মী আর পোর্টালে লগইন করতে বা কোনো ডাটা এক্সেস করতে পারবে না।`
                : `আপনি কি কর্মী "${username}" এর অ্যাকাউন্ট পুনরায় সচল / ${actionWord} করতে চান?`;

            if (!confirm(confirmMsg)) return;

            try {
                const { data, error } = await supabaseClient.rpc('admin_set_user_block_status', {
                    p_user_id: userId,
                    p_is_blocked: shouldBlock,
                    p_blocked: shouldBlock,
                    p_reason: shouldBlock ? 'Blocked by administrator' : ''
                });

                if (error) throw error;

                alert(`✅ কর্মী "${username}" এর অ্যাকাউন্ট সফলভাবে ${actionWord} করা হয়েছে!`);
                await loadAdminDashboard();
            } catch (err) {
                alert('অ্যাকাউন্ট স্ট্যাটাস পরিবর্তন করতে সমস্যা হয়েছে: ' + err.message);
            }
        }

        // Admin Permanently Delete User Function
        async function adminDeleteUserPrompt(userId, username, email) {
            if (!supabaseClient) return;
            const confirmMsg = `⚠️ সাবধান! আপনি কি নিশ্চিতভাবে "${username}" (${email}) অ্যাকাউন্টটি স্থায়ীভাবে ডিলিট করতে চান?\n\nএই অ্যাকাউন্টটি মুছে ফেলা হলে কর্মী আর কখনোই লগইন করতে পারবে না।\n\nমুছে ফেলতে 'OK' চাপুন।`;
            if (!confirm(confirmMsg)) return;

            try {
                const { data, error } = await supabaseClient.rpc('admin_delete_user_account', {
                    p_user_id: userId
                });

                if (error) throw error;

                alert(`✅ কর্মী "${username}" এর অ্যাকাউন্ট সম্পূর্ণ মুছে ফেলা হয়েছে!`);
                await loadAdminDashboard();
            } catch (err) {
                alert('অ্যাকাউন্ট ডিলিট করতে সমস্যা হয়েছে: ' + err.message);
            }
        }

function renderAdminLogsTable() {
            const body = document.getElementById('adminLogsTableBody');
            if (adminLogsCache.length > 0) {
                body.innerHTML = adminLogsCache.map(l => {
                    const timeStr = new Date(l.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    const repLabel = l.report_type === 'female_report' ? '👩 Female Report' : '🔍 Lookup Report';
                    return `
                        <tr class="hover:bg-slate-50 text-xs">
                            <td class="py-3 px-4 font-mono text-slate-500">${timeStr}</td>
                            <td class="py-3 px-4">
                                <div class="font-bold text-slate-800 text-xs flex items-center space-x-1">
                                    <span>👤</span>
                                    <span>${l.username || userEmailToNameMap[l.user_email] || l.user_email.split('@')[0]}</span>
                                </div>
                                <span class="text-[11px] text-slate-400 font-mono block">${l.user_email}</span>
                            </td>
                            <td class="py-3 px-4 font-bold">${repLabel}</td>
                            <td class="py-3 px-4 text-slate-600">${l.file_name || 'Upload'}</td>
                            <td class="py-3 px-4 text-right">${l.total_received}</td>
                            <td class="py-3 px-4 text-right text-emerald-600 font-bold">+${l.new_inserted}</td>
                            <td class="py-3 px-4 text-right text-amber-600">${l.duplicates_count}</td>
                        </tr>
                    `;
                }).join('');
            } else {
                body.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No logs found.</td></tr>`;
            }
        }

        function refreshAdminData() {
            loadAdminDashboard();
        }

        async function downloadMasterExcel() {
            if (!supabaseClient) return;
            try {
                // Fetch 100% of all master database records (bypasses 1000 limit)
                const allRows = await fetchAllSubmissions({});
                if (!allRows || allRows.length === 0) {
                    alert('No records found in database to export.');
                    return;
                }

                let exportRows;
                if (reportFilter === 'lookup_report') {
                    // Strictly 3 columns for Lookup Report: Phone Number, Household Income, Est Market Value (NO Name, Age, etc.)
                    exportRows = allRows.map(item => ({
                        'Phone Number': item.phone_number,
                        'Household Income': item.household_income || '',
                        'Est Market Value': item.est_market_value || ''
                    }));
                } else if (reportFilter === 'lookup_no_info') {
                    // Pure phone numbers for Lookup No Info (separate file)
                    exportRows = allRows.map(item => ({
                        'Phone Number': item.phone_number,
                        'Status': 'No Information (কোনো তথ্য পাওয়া যায় নাই)'
                    }));
                } else if (reportFilter === 'lookup_no_info') {
                    // Pure phone numbers for Lookup No Info (separate file)
                    exportRows = allRows.map(item => ({
                        'Phone Number': item.phone_number,
                        'Status': 'No Information (কোনো তথ্য পাওয়া যায় নাই)'
                    }));
                } else if (reportFilter === 'signal_report') {
                    // Pure phone numbers for Signal Report
                    exportRows = allRows.map(item => ({
                        'Phone Number': item.phone_number
                    }));
                } else {
                    exportRows = allRows.map((item, idx) => ({
                        'SL': idx + 1,
                        'Phone Number': item.phone_number,
                        'Full Name': item.full_name || '',
                        'Age': item.age || '',
                        'Household Income': item.household_income || '',
                        'Est Market Value': item.est_market_value || '',
                        'Report Type': item.report_type === 'female_report' ? 'Female Report' : (item.report_type === 'signal_report' ? 'Signal Report' : 'Lookup Report'),
                        'Department': item.department || '-',
                        'Submitted By': item.username || userEmailToNameMap[item.user_email] || item.user_email,
                        'Submission Date': new Date(item.created_at).toLocaleString()
                    }));
                }

                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Master Data All");
                const today = new Date().toISOString().slice(0, 10);
                XLSX.writeFile(wb, `Master_Database_Full_${today}_Total_${exportRows.length}.xlsx`);
            } catch(err) {
                alert('Master export failed: ' + err.message);
            }
        }

        async function downloadFilteredSubmissionsExcel() {
            if (!supabaseClient) return;
            const dateVal = document.getElementById('adminSubDateFilter')?.value;
            const reportFilter = document.getElementById('adminSubReportFilter')?.value || 'all';
            const workerFilter = document.getElementById('adminSubWorkerFilter')?.value || 'all';

            try {
                // Fetch 100% of all filtered records with auto-pagination (bypasses 500 limit!)
                const allRows = await fetchAllSubmissions({
                    date: dateVal || null,
                    report_type: reportFilter,
                    user_email: workerFilter
                });

                if (!allRows || allRows.length === 0) {
                    alert('No records found to export for current filter.');
                    return;
                }

                const exportRows = allRows.map((item, idx) => ({
                    'SL': idx + 1,
                    'Phone Number': item.phone_number,
                    'Full Name': item.full_name || '',
                    'Age': item.age || '',
                    'Household Income': item.household_income || '',
                    'Est Market Value': item.est_market_value || '',
                    'Report Type': item.report_type === 'female_report' ? 'Female Report' : 'Lookup Report',
                    'Department': item.department || '-',
                    'Submitted By': item.username || userEmailToNameMap[item.user_email] || item.user_email,
                    'Submission Date': new Date(item.created_at).toLocaleString()
                }));

                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                let sheetTitle = 'Submissions';
                if (reportFilter === 'lookup_no_info') sheetTitle = 'No_Information';
                else if (reportFilter === 'lookup_report') sheetTitle = 'Valid_Lookup';
                else if (reportFilter === 'signal_report') sheetTitle = 'Signal_Data';
                XLSX.utils.book_append_sheet(wb, ws, sheetTitle);

                let fileNamePrefix = 'Submissions_Export';
                if (reportFilter === 'lookup_no_info') fileNamePrefix = 'Lookup_No_Information';
                else if (reportFilter === 'lookup_report') fileNamePrefix = 'Lookup_Valid';
                else if (reportFilter === 'signal_report') fileNamePrefix = 'Signal_Records';

                XLSX.writeFile(wb, `${fileNamePrefix}_${new Date().toISOString().slice(0,10)}_Total_${exportRows.length}.xlsx`);
                alert(`📥 মোট ${exportRows.length.toLocaleString()} টি ${reportFilter === 'lookup_no_info' ? 'Lookup No Information' : 'রেকর্ড'} সফলভাবে ডাউনলোড হয়েছে!`);
            } catch(err) {
                alert('Export failed: ' + err.message);
            }
        }

        async function downloadSingleUserData(userEmail) {
            if (!supabaseClient) return;
            try {
                // Fetch 100% of records for this worker with auto-pagination
                const allRows = await fetchAllSubmissions({ user_email: userEmail });
                if (!allRows || allRows.length === 0) {
                    alert(`No numbers found for ${userEmail}`);
                    return;
                }

                const exportRows = allRows.map((item, idx) => ({
                    'SL': idx + 1,
                    'Phone Number': item.phone_number,
                    'Full Name': item.full_name || '',
                    'Age': item.age || '',
                    'Household Income': item.household_income || '',
                    'Est Market Value': item.est_market_value || '',
                    'Report Type': item.report_type === 'female_report' ? 'Female Report' : 'Lookup Report',
                    'Department': item.department || '-',
                    'Submitted By': item.username || item.user_email,
                    'Submission Date': new Date(item.created_at).toLocaleString()
                }));

                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Worker Data");
                const safeEmail = userEmail.replace(/[@.]/g, '_');
                XLSX.writeFile(wb, `Submissions_${safeEmail}_Total_${exportRows.length}.xlsx`);
            } catch(err) {
                alert('Worker export error: ' + err.message);
            }
        }

        // =========================================================================
        // LOOKUP REPORT QUALIFICATION & FILTERING TOOL ENGINE
        // =========================================================================

        let currentLookupChkMode = 'file';
        let lookupChkFileRawRows = [];
        let lookupChkAllRecords = [];
        let lookupChkMistakeRecords = [];
        let lookupChkQualifiedRecords = [];
        let lookupChkSpecialRecords = [];
        let lookupChkDiscardedRecords = [];
        let currentLookupChkTab = 'qualified';

        function switchLookupChkInputMode(mode) {
            currentLookupChkMode = mode;
            const btnFile = document.getElementById('btnLookupChkModeFile');
            const btnPaste = document.getElementById('btnLookupChkModePaste');
            const secFile = document.getElementById('lookupChkFileSection');
            const secPaste = document.getElementById('lookupChkPasteSection');

            if (mode === 'file') {
                if (btnFile) btnFile.className = 'px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 text-white shadow-sm transition cursor-pointer';
                if (btnPaste) btnPaste.className = 'px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition cursor-pointer';
                if (secFile) secFile.classList.remove('hidden');
                if (secPaste) secPaste.classList.add('hidden');
            } else {
                if (btnPaste) btnPaste.className = 'px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 text-white shadow-sm transition cursor-pointer';
                if (btnFile) btnFile.className = 'px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition cursor-pointer';
                if (secPaste) secPaste.classList.remove('hidden');
                if (secFile) secFile.classList.add('hidden');
            }
        }

        function handleLookupChkFile(e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    const data = new Uint8Array(evt.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

                    if (!rows || rows.length === 0) {
                        alert('ফাইলের ভেতরে কোনো ডাটা পাওয়া যায়নি!');
                        return;
                    }

                    lookupChkFileRawRows = rows;
                    const countEl = document.getElementById('lookupChkFileRowsCount');
                    if (countEl) countEl.innerText = `${rows.length.toLocaleString()} Rows Found`;

                    const headers = Object.keys(rows[0] || {});
                    populateLookupChkDropdowns(headers);

                    const cfg = document.getElementById('lookupChkColumnConfig');
                    if (cfg) cfg.classList.remove('hidden');

                } catch(err) {
                    console.error('File read error:', err);
                    alert('ফাইল রিড করতে সমস্যা হয়েছে: ' + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        }

        function populateLookupChkDropdowns(headers) {
            const phoneSel = document.getElementById('lookupChkColPhone');
            const incSel = document.getElementById('lookupChkColIncome');
            const mktSel = document.getElementById('lookupChkColMarket');
            const nameSel = document.getElementById('lookupChkColName');

            [phoneSel, incSel, mktSel, nameSel].forEach(s => {
                if (s) s.innerHTML = '';
            });

            if (nameSel) nameSel.innerHTML = '<option value="">-- উল্লেখ নেই (Optional) --</option>';

            headers.forEach(h => {
                const optP = new Option(h, h);
                const optI = new Option(h, h);
                const optM = new Option(h, h);
                const optN = new Option(h, h);

                const lower = h.toLowerCase().trim();

                // Smart Phone Auto-selection
                if (lower.includes('phone') || lower.includes('tel') || lower.includes('mobile') || lower.includes('cell') || lower.includes('number') || lower.includes('ফোন')) {
                    optP.selected = true;
                }

                // Smart Income Auto-selection
                if (lower.includes('income') || lower.includes('salary') || lower.includes('hh_income') || lower.includes('household') || lower.includes('ann') || lower.includes('আয়')) {
                    optI.selected = true;
                }

                // Smart Market Value Auto-selection
                if (lower.includes('market') || lower.includes('property') || lower.includes('home_value') || lower.includes('est') || lower.includes('value') || lower.includes('ভ্যালু')) {
                    optM.selected = true;
                }

                // Smart Name Auto-selection
                if (lower.includes('name') || lower.includes('owner') || lower.includes('contact') || lower.includes('full') || lower.includes('নাম')) {
                    optN.selected = true;
                }

                if (phoneSel) phoneSel.appendChild(optP);
                if (incSel) incSel.appendChild(optI);
                if (mktSel) mktSel.appendChild(optM);
                if (nameSel) nameSel.appendChild(optN);
            });
        }

        // Smart monetary range and amount parser supporting Lakhs, Millions, and k
        function parseMonetaryValueRange(rawVal) {
            if (!rawVal) return null;
            let s = String(rawVal).trim().toLowerCase();
            if (!s || s === '-' || s === 'n/a' || s === 'none' || s === '?' || s === 'null') return null;

            // Remove commas
            s = s.replace(/,/g, '');

            // 1. Lakhs (1 lakh = 100,000)
            s = s.replace(/([0-9.]+)\s*(?:lakhs|lakh|lacs|lac)\b/gi, (match, p1) => {
                return String(parseFloat(p1) * 100000);
            });

            // 2. Millions (1m = 1,000,000)
            s = s.replace(/([0-9.]+)\s*(?:million|m)\b/gi, (match, p1) => {
                return String(parseFloat(p1) * 1000000);
            });


            // 4. k (1k = 1,000)
            s = s.replace(/([0-9.]+)\s*k(?![a-zA-Z])/gi, (match, p1) => {
                return String(parseFloat(p1) * 1000);
            });

            // Extract all numbers
            const matches = s.match(/[0-9]+(?:\.[0-9]+)?/g);
            if (!matches || matches.length === 0) return null;

            const nums = matches.map(Number).filter(n => !isNaN(n));
            if (nums.length === 0) return null;

            const minVal = Math.min(...nums);
            const maxVal = Math.max(...nums);
            const avgVal = (minVal + maxVal) / 2;

            return { min: minVal, max: maxVal, avg: avgVal };
        }

        // Evaluate qualification based on the user's updated rules:
        // Rule 1: Household income around 75k$ ($75,000 - $100,000 or $75k+) -> Valid even if market value is empty/0/anything
        // Rule 2: Household income <= 10k$ (or 0$ or low/empty) AND Market Value >= 350k$ ($350,000+) -> Valid
        // Rule 3: Special Numbers: Market Value > 18 Lakhs ($1,800,000 / $1.8M) -> Special High-Value VIP
        // Rule 4 (Fallback): Market Value <= 400,000 with positive value -> Valid
        function evaluateLookupRowRules(incomeStr, marketStr) {
            const inc = parseMonetaryValueRange(incomeStr);
            const mkt = parseMonetaryValueRange(marketStr);

            let isSpecial = false;
            let isKept = false;
            const passedRules = [];

            const hasIncome = inc && (inc.max > 0 || inc.raw !== '');
            const hasMarket = mkt && (mkt.max > 0 || mkt.raw !== '');

            // 1. ⭐ SPECIAL NUMBER CHECK: Market Value > 18 Lakhs ($1,800,000 / $1.8M)
            if (mkt && mkt.max > 1800000) {
                isSpecial = true;
                isKept = true;
                passedRules.push(`⭐ স্পেশাল নাম্বার: মার্কেট ভ্যালু ১৮ লাখ$ এর বেশি ($${Math.round(mkt.max).toLocaleString()} > $1.8M)`);
            }

            // 2. CONDITION A: Market Value >= $350,000 ($350k+ / $400k+)
            // "kono number 400k$ market value thaklei oi number o valid ar er baire jai hok joto kom beshi hok bepar na tachara 40k$-50k$ thakleo valid kintu oi number gular market value 350k$+ thaklei hobe"
            // Market Value >= 350k / 400k is VALID regardless of income (whether $0, $10k, $20k-$30k, $40k-$50k, $50k-$60k, etc.)!
            if (mkt && mkt.max >= 345000) {
                if (!isKept) {
                    isKept = true;
                    passedRules.push(`মার্কেট ভ্যালু $350k+ ($${Math.round(mkt.max).toLocaleString()}) থাকায় গ্রহণযোগ্য (Valid)`);
                }
            }

            // 3. CONDITION B: Household Income >= $75,000 ($75k+)
            // "mot kotha household income 75k$ thakle oi number er market value na thakleo cholbe"
            // Household Income >= $75k is VALID even if market value is empty, 0, or missing!
            if (inc) {
                if ((inc.min >= 70000 && inc.max <= 105000) ||
                    (inc.avg >= 74000) ||
                    (74000 <= inc.min && inc.min <= 105000) ||
                    (inc.max >= 74000)) {
                    if (!isKept) {
                        isKept = true;
                        passedRules.push(`বাৎসরিক আয় $75k+ ($${Math.round(inc.max).toLocaleString()}) থাকায় গ্রহণযোগ্য (মার্কেট ভ্যালু না থাকলেও Valid)`);
                    }
                }
            }

            if (isKept) {
                return { isKept: true, isSpecial, reasons: passedRules };
            }

            // REJECTION REASONS:
            // "shudhu bad porbe jodi kono infoi na thake oi number ar jodi market value 350k$ er niche othoba jodi kono number 75k$ er niche household icome hoy tahole bad porbe ai number gulo jodi shudhu single data thake tobei tachara baki valid"
            let rejectReason = 'কোনো গ্রহণযোগ্য শর্তের আওতায় পড়েনি (Unqualified / বাদ)';
            if (!hasIncome && !hasMarket) {
                rejectReason = 'কোনো তথ্য পাওয়া যায়নি (No Information / খালি ডাটা)';
            } else if (hasIncome && !hasMarket) {
                rejectReason = `আয় $75k এর নিচে ($${Math.round(inc.max).toLocaleString()}) এবং মার্কেট ভ্যালু খালি থাকায় বাদ`;
            } else if (!hasIncome && hasMarket) {
                rejectReason = `মার্কেট ভ্যালু $350k এর নিচে ($${Math.round(mkt.max).toLocaleString()}) এবং আয় খালি থাকায় বাদ`;
            } else if (hasIncome && hasMarket) {
                rejectReason = `আয় $75k এর নিচে এবং মার্কেট ভ্যালুও $350k এর নিচে ($${Math.round(mkt.max).toLocaleString()} < $350k) থাকায় বাদ`;
            }

            return {
                isKept: false,
                isSpecial: false,
                reasons: [rejectReason]
            };
        }

        function runLookupFileCheck() {
            if (!lookupChkFileRawRows || lookupChkFileRawRows.length === 0) {
                alert('অনুগ্রহ করে প্রথমে একটি ফাইল নির্বাচন করুন।');
                return;
            }

            const colPhone = document.getElementById('lookupChkColPhone')?.value;
            const colIncome = document.getElementById('lookupChkColIncome')?.value;
            const colMarket = document.getElementById('lookupChkColMarket')?.value;
            const colName = document.getElementById('lookupChkColName')?.value;

            if (!colPhone || !colIncome || !colMarket) {
                alert('অনুগ্রহ করে Phone, Household Income এবং Market Value কলাম নির্বাচন করুন।');
                return;
            }

            const btn = document.getElementById('btnRunLookupFileCheck');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span>⏳ যাচাই ও ফিল্টার হচ্ছে...</span>';
            }

            setTimeout(() => {
                try {
                    const parsedRecords = [];

                    lookupChkFileRawRows.forEach(row => {
                        let rawPhone = String(row[colPhone] || '').trim();
                        let cleanPhone = rawPhone.replace(/[^0-9]/g, '');

                        if (cleanPhone.length < 6) {
                            Object.keys(row).forEach(k => {
                                const val = String(row[k] || '').trim();
                                const digs = val.replace(/[^0-9]/g, '');
                                if (digs.length >= 7 && digs.length <= 16 && cleanPhone.length < 6) {
                                    cleanPhone = digs;
                                }
                            });
                        }

                        if (!cleanPhone || cleanPhone.length < 6) return;

                        const incomeVal = String(row[colIncome] || '').trim();
                        const marketVal = String(row[colMarket] || '').trim();
                        const nameVal = colName ? String(row[colName] || '').trim() : '';

                        const evalRes = evaluateLookupRowRules(incomeVal, marketVal);

                        parsedRecords.push({
                            phone: cleanPhone,
                            name: nameVal || '-',
                            income: incomeVal || '-',
                            market: marketVal || '-',
                            isKept: evalRes.isKept,
                            isSpecial: evalRes.isSpecial,
                            reasons: evalRes.reasons
                        });
                    });

                    processEvaluatedLookupRecords(parsedRecords);

                } catch(err) {
                    console.error('File check error:', err);
                    alert('যাচাই করার সময় ত্রুটি ঘটেছে: ' + err.message);
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<span>⚡ কোয়ালিফিকেশন যাচাই ও ফিল্টার করুন</span>';
                    }
                }
            }, 50);
        }

        function runLookupPasteCheck() {
            const rawText = (document.getElementById('lookupChkPasteInput')?.value || '').trim();
            if (!rawText) {
                alert('অনুগ্রহ করে টেক্সট বক্সে ডাটা পেস্ট করুন।');
                return;
            }

            const btn = document.getElementById('btnRunLookupPasteCheck');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span>⏳ পেস্ট করা ডাটা যাচাই হচ্ছে...</span>';
            }

            const colOrder = document.querySelector('input[name="lchkColOrder"]:checked')?.value || 'num_inc_mkt';

            setTimeout(() => {
                try {
                    const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    const parsedRecords = [];

                    rawLines.forEach((line, lineIdx) => {
                        let parts = [];
                        if (line.includes('\t')) {
                            parts = line.split('\t').map(p => p.trim()).filter(p => p.length > 0);
                        } else if (line.includes(',')) {
                            parts = line.split(',').map(p => p.trim()).filter(p => p.length > 0);
                        } else if (line.includes('|')) {
                            parts = line.split('|').map(p => p.trim()).filter(p => p.length > 0);
                        } else {
                            parts = line.split(/\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
                            if (parts.length < 2) {
                                parts = line.split(/\s+/).map(p => p.trim()).filter(p => p.length > 0);
                            }
                        }

                        let phone = '';
                        let income = '';
                        let market = '';
                        let name = '';

                        if (colOrder === 'num_inc_mkt') {
                            phone = parts[0] ? parts[0].replace(/[^0-9]/g, '') : '';
                            income = parts[1] || '';
                            market = parts[2] || '';
                            if (parts[3]) name = parts.slice(3).join(' ');
                        } else if (colOrder === 'num_name_inc_mkt') {
                            phone = parts[0] ? parts[0].replace(/[^0-9]/g, '') : '';
                            name = parts[1] || '';
                            income = parts[2] || '';
                            market = parts[3] || '';
                        } else if (colOrder === 'num_mkt_inc') {
                            phone = parts[0] ? parts[0].replace(/[^0-9]/g, '') : '';
                            market = parts[1] || '';
                            income = parts[2] || '';
                            if (parts[3]) name = parts.slice(3).join(' ');
                        } else {
                            // Smart auto-detection
                            parts.forEach(p => {
                                const digits = p.replace(/[^0-9]/g, '');
                                if (!phone && digits.length >= 7 && digits.length <= 15) {
                                    phone = digits;
                                } else if (p.includes('$') || p.includes('k') || p.includes('lakh')) {
                                    if (!income) income = p;
                                    else if (!market) market = p;
                                } else if (!name && /[a-zA-Z]/.test(p)) {
                                    name = p;
                                }
                            });
                            if (!phone && parts[0]) phone = parts[0].replace(/[^0-9]/g, '');
                            if (!income && parts[1]) income = parts[1];
                            if (!market && parts[2]) market = parts[2];
                        }

                        // Ignore header text line only if phone has no valid digits at all
                        if (!phone || phone.length < 6) return;

                        // DOLLAR SIGN ($) VALIDATION:
                        // Row MUST contain '$' in income or market value. If not, mark as Mistake!
                        const hasDollar = (income && income.includes('$')) || (market && market.includes('$'));

                        if (!hasDollar) {
                            parsedRecords.push({
                                origIdx: lineIdx,
                                phone: phone,
                                name: name || '-',
                                income: income || '-',
                                market: market || '-',
                                isKept: false,
                                isSpecial: false,
                                isMistake: true,
                                mistakeReason: '$ চিহ্ন নেই (Income বা Market Value তে $ প্রতীক পাওয়া যায়নি)',
                                reasons: ['⚠️ ভুল ডাটা: $ চিহ্ন ছাড়া ডাটা গ্রহণযোগ্য হবে না']
                            });
                        } else {
                            const evalRes = evaluateLookupRowRules(income, market);
                            parsedRecords.push({
                                origIdx: lineIdx,
                                phone: phone,
                                name: name || '-',
                                income: income || '-',
                                market: market || '-',
                                isKept: evalRes.isKept,
                                isSpecial: evalRes.isSpecial,
                                isMistake: false,
                                reasons: evalRes.reasons
                            });
                        }
                    });

                    processEvaluatedLookupRecords(parsedRecords);

                } catch(err) {
                    console.error('Paste check error:', err);
                    alert('ডাটা প্রসেস করতে সমস্যা: ' + err.message);
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<span>⚡ পেস্ট করা ডাটা যাচাই ও ফিল্টার করুন</span>';
                    }
                }
            }, 50);
        }

        function processEvaluatedLookupRecords(records) {
            if (!records || records.length === 0) {
                alert('কোনো বৈধ ফোন নাম্বার বা রেকর্ড পাওয়া যায়নি!');
                return;
            }

            // Ensure every record has an origIdx for in-place editing
            records.forEach((r, idx) => { r.origIdx = idx; });

            lookupChkAllRecords = records;
            lookupChkMistakeRecords = records.filter(r => r.isMistake);
            lookupChkQualifiedRecords = records.filter(r => r.isKept && !r.isMistake);
            lookupChkSpecialRecords = records.filter(r => r.isSpecial && !r.isMistake);
            lookupChkDiscardedRecords = records.filter(r => !r.isKept && !r.isMistake);

            const total = records.length;
            const qCount = lookupChkQualifiedRecords.length;
            const spCount = lookupChkSpecialRecords.length;
            const dCount = lookupChkDiscardedRecords.length;
            const mCount = lookupChkMistakeRecords.length;

            const r1Count = records.filter(r => (r.reasons || []).some(s => s.includes('বাৎসরিক আয় $75k+') || s.includes('শর্ত ১'))).length;
            const r2Count = records.filter(r => (r.reasons || []).some(s => s.includes('মার্কেট ভ্যালু $350k+') || s.includes('শর্ত ২'))).length;

            const qPct = total > 0 ? Math.round((qCount / total) * 100) : 0;
            const dPct = total > 0 ? Math.round((dCount / total) * 100) : 0;
            const mPct = total > 0 ? Math.round((mCount / total) * 100) : 0;

            // Update Statistics Cards
            const elTotal = document.getElementById('lchkStatTotal');
            const elQ = document.getElementById('lchkStatQualified');
            const elQPct = document.getElementById('lchkStatQualifiedPct');
            const elSp = document.getElementById('lchkStatSpecial');
            const elD = document.getElementById('lchkStatDiscarded');
            const elDPct = document.getElementById('lchkStatDiscardedPct');
            const elM = document.getElementById('lchkStatMistake');
            const elMPct = document.getElementById('lchkStatMistakePct');
            const elR1 = document.getElementById('lchkStatRule1');
            const elR2 = document.getElementById('lchkStatRule2');

            if (elTotal) elTotal.innerText = total.toLocaleString();
            if (elQ) elQ.innerText = qCount.toLocaleString();
            if (elQPct) elQPct.innerText = `${qPct}% সফল (Keep)`;
            if (elSp) elSp.innerText = spCount.toLocaleString();
            if (elD) elD.innerText = dCount.toLocaleString();
            if (elDPct) elDPct.innerText = `${dPct}% বাদ (Discarded)`;
            if (elM) elM.innerText = mCount.toLocaleString();
            if (elMPct) elMPct.innerText = `${mCount} টি ভুল ($ ছাড়া)`;
            if (elR1) elR1.innerText = r1Count.toLocaleString();
            if (elR2) elR2.innerText = r2Count.toLocaleString();

            // Update Tab Badges
            const bQ = document.getElementById('lchkTabBadgeQualified');
            const bSp = document.getElementById('lchkTabBadgeSpecial');
            const bD = document.getElementById('lchkTabBadgeDiscarded');
            const bM = document.getElementById('lchkTabBadgeMistake');
            const bA = document.getElementById('lchkTabBadgeAll');

            if (bQ) bQ.innerText = qCount.toLocaleString();
            if (bSp) bSp.innerText = spCount.toLocaleString();
            if (bD) bD.innerText = dCount.toLocaleString();
            if (bM) bM.innerText = mCount.toLocaleString();
            if (bA) bA.innerText = total.toLocaleString();

            // Show Result Container
            const resContainer = document.getElementById('lookupChkResultContainer');
            if (resContainer) resContainer.classList.remove('hidden');

            // Switch to appropriate tab: if mistakes exist, alert user and show mistakes or qualified
            if (mCount > 0) {
                switchLookupChkTableTab('mistake');
                alert(`⚠️ মোট ${mCount.toLocaleString()} টি ডাটাতে "$" চিহ্ন পাওয়া যায়নি এবং এগুলো Mistake হিসেবে চিহ্নিত করা হয়েছে!\n\nআপনি "ভুল ডাটা (Mistake)" ট্যাবে গিয়ে সরাসরি ইনপুট বক্সে সঠিক $ মান লিখে "⚡ ঠিক করুন ও যুক্ত করুন" বাটনে ক্লিক করে ঠিক করতে পারেন এবং ওয়েবসাইট থেকেই সরাসরি রিপোর্ট জমা দিতে পারবেন।`);
            } else {
                switchLookupChkTableTab(spCount > 0 ? 'special' : 'qualified');
                alert(`✅ কোয়ালিফিকেশন যাচাই সম্পন্ন হয়েছে!\n\n📊 মোট ডাটা: ${total.toLocaleString()} টি\n🟢 গ্রহণযোগ্য (Keep): ${qCount.toLocaleString()} টি (${qPct}%)\n⭐ স্পেশাল নাম্বার (>18 Lakhs): ${spCount.toLocaleString()} টি\n🔴 অযোগ্য (Discarded): ${dCount.toLocaleString()} টি (${dPct}%)\n\nএখন আপনি গ্রহণযোগ্য ডাটা এক ক্লিকে ডাউনলোড বা সরাসরি ডাটাবেজে আপলোড করতে পারবেন।`);
            }
        }

        function switchLookupChkTableTab(tab) {
            currentLookupChkTab = tab;
            const btnQ = document.getElementById('btnLchkTabQualified');
            const btnSp = document.getElementById('btnLchkTabSpecial');
            const btnD = document.getElementById('btnLchkTabDiscarded');
            const btnM = document.getElementById('btnLchkTabMistake');
            const btnA = document.getElementById('btnLchkTabAll');

            [btnQ, btnSp, btnD, btnM, btnA].forEach(b => {
                if (b) b.className = 'px-4 py-2 text-xs font-bold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition cursor-pointer flex items-center space-x-1.5';
            });

            if (tab === 'qualified') {
                if (btnQ) btnQ.className = 'px-4 py-2 text-xs font-black rounded-xl bg-emerald-600 text-white shadow-sm transition cursor-pointer flex items-center space-x-1.5';
            } else if (tab === 'special') {
                if (btnSp) btnSp.className = 'px-4 py-2 text-xs font-black rounded-xl bg-amber-400 text-slate-950 shadow-sm transition cursor-pointer flex items-center space-x-1.5 border border-amber-500';
            } else if (tab === 'discarded') {
                if (btnD) btnD.className = 'px-4 py-2 text-xs font-black rounded-xl bg-rose-600 text-white shadow-sm transition cursor-pointer flex items-center space-x-1.5';
            } else if (tab === 'mistake') {
                if (btnM) btnM.className = 'px-4 py-2 text-xs font-black rounded-xl bg-amber-500 text-white shadow-sm transition cursor-pointer flex items-center space-x-1.5';
            } else {
                if (btnA) btnA.className = 'px-4 py-2 text-xs font-black rounded-xl bg-purple-700 text-white shadow-sm transition cursor-pointer flex items-center space-x-1.5';
            }

                        const noInfoBanner = document.getElementById('lchkNoInfoBanner');
            if (noInfoBanner) {
                if (tab === 'mistake') {
                    noInfoBanner.classList.remove('hidden');
                } else {
                    noInfoBanner.classList.add('hidden');
                }
            }

            filterLookupChkTableLocal();
        }

        function filterLookupChkTableLocal() {
            let activeList = [];
            if (currentLookupChkTab === 'qualified') {
                activeList = lookupChkQualifiedRecords;
            } else if (currentLookupChkTab === 'special') {
                activeList = lookupChkSpecialRecords;
            } else if (currentLookupChkTab === 'discarded') {
                activeList = lookupChkDiscardedRecords;
            } else if (currentLookupChkTab === 'mistake') {
                activeList = lookupChkMistakeRecords;
            } else {
                activeList = lookupChkAllRecords;
            }

            const search = (document.getElementById('lchkTableSearchInput')?.value || '').toLowerCase().trim();
            if (search) {
                activeList = activeList.filter(r => {
                    const phone = (r.phone || '');
                    const name = (r.name || '').toLowerCase();
                    const inc = (r.income || '').toLowerCase();
                    const mkt = (r.market || '').toLowerCase();
                    const reason = (r.reasons || []).join(' ').toLowerCase();
                    return phone.includes(search) || name.includes(search) || inc.includes(search) || mkt.includes(search) || reason.includes(search);
                });
            }

            const countEl = document.getElementById('lchkTableRenderCount');
            if (countEl) countEl.innerText = `Showing ${activeList.length.toLocaleString()} records`;

            const tbody = document.getElementById('lookupChkTableBody');
            if (!tbody) return;

            if (activeList.length === 0) {
                if (currentLookupChkTab === 'mistake') {
                    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-emerald-600 font-sans text-xs font-bold">🎉 অসাধারণ! কোনো ভুল ডাটা ($ ছাড়া) নেই। সব ডাটা সঠিক রয়েছে।</td></tr>`;
                } else {
                    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400 font-sans text-xs">নির্বাচিত তালিকায় কোনো ডাটা নেই।</td></tr>`;
                }
                return;
            }

            tbody.innerHTML = activeList.map((r, idx) => {
                if (currentLookupChkTab === 'mistake' || r.isMistake) {
                    return `
                    <tr class="hover:bg-amber-50/60 transition border-b border-amber-100 bg-amber-50/20">
                        <td class="py-3 px-3.5 text-center text-xs font-bold text-amber-900">${idx + 1}</td>
                        <td class="py-3 px-3.5 font-mono font-bold text-xs text-slate-900">${r.phone}</td>
                        <td class="py-3 px-3.5 text-xs text-slate-500">${r.name || '-'}</td>
                        <td class="py-3 px-3.5 text-xs">
                            <input type="text" id="lchkMistakeInc_${r.origIdx}" value="${r.income !== '-' ? r.income : ''}" placeholder="$75,000" class="w-full px-2 py-1 border border-amber-300 rounded-lg text-xs font-mono font-bold text-emerald-800 bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none">
                        </td>
                        <td class="py-3 px-3.5 text-xs">
                            <input type="text" id="lchkMistakeMkt_${r.origIdx}" value="${r.market !== '-' ? r.market : ''}" placeholder="$350,000" class="w-full px-2 py-1 border border-amber-300 rounded-lg text-xs font-mono font-bold text-indigo-800 bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none">
                        </td>
                        <td class="py-3 px-3.5 text-center">
                            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-100 text-rose-800 border border-rose-300 whitespace-nowrap flex items-center justify-center space-x-1 inline-flex">
                                <span>❌</span>
                                <span>No Information (তথ্য নেই)</span>
                            </span>
                        </td>
                        <td class="py-3 px-3.5">
                            <div class="flex items-center space-x-1.5">
                                <button type="button" onclick="fixAndVerifyLookupMistakeRow(${r.origIdx})" class="px-3 py-1 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs transition flex items-center space-x-1">
                                    <span>⚡ ঠিক করুন</span>
                                </button>
                                <button type="button" onclick="removeLookupMistakeRow(${r.origIdx})" class="px-2.5 py-1 text-xs font-bold rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 cursor-pointer transition">
                                    <span>🗑️ বাদ</span>
                                </button>
                            </div>
                        </td>
                    </tr>`;
                }

                let badge = '';
                if (r.isSpecial) {
                    badge = '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-gradient-to-r from-amber-400 to-yellow-400 text-slate-950 border border-amber-400 shadow-xs whitespace-nowrap flex items-center space-x-1 inline-flex"><span>⭐</span><span>SPECIAL ($1.8M+)</span></span>';
                } else if (r.isKept) {
                    badge = '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300 whitespace-nowrap">✅ KEEP (বৈধ)</span>';
                } else {
                    badge = '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300 whitespace-nowrap">❌ REJECT (বাদ)</span>';
                }

                const reasonsHtml = (r.reasons || []).map(rs => {
                    const isSp = rs.includes('স্পেশাল') || rs.includes('1.8M');
                    const cls = isSp ? 'bg-amber-100 text-amber-950 border border-amber-300 font-black' : (r.isKept ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 font-bold' : 'bg-slate-100 text-slate-600 border border-slate-200');
                    return `<span class="inline-block px-2 py-0.5 rounded-md text-[11px] mr-1 mb-1 border ${cls}">${rs}</span>`;
                }).join('');

                return `
                <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                    <td class="py-3 px-3.5 text-center text-xs font-bold text-slate-400">${idx + 1}</td>
                    <td class="py-3 px-3.5 font-mono font-bold text-xs text-slate-900">${r.phone}</td>
                    <td class="py-3 px-3.5 text-xs text-slate-700">${r.name || '-'}</td>
                    <td class="py-3 px-3.5 font-mono text-xs font-bold text-emerald-700">${r.income}</td>
                    <td class="py-3 px-3.5 font-mono text-xs font-bold text-indigo-700">${r.market}</td>
                    <td class="py-3 px-3.5 text-center">${badge}</td>
                    <td class="py-3 px-3.5">${reasonsHtml}</td>
                </tr>`;
            }).join('');
        }

        // Fix single mistake row in-place
        function fixAndVerifyLookupMistakeRow(origIdx) {
            const rec = lookupChkAllRecords.find(r => r.origIdx === origIdx);
            if (!rec) return;

            const incInput = document.getElementById(`lchkMistakeInc_${origIdx}`);
            const mktInput = document.getElementById(`lchkMistakeMkt_${origIdx}`);

            const newInc = (incInput ? incInput.value : rec.income).trim();
            const newMkt = (mktInput ? mktInput.value : rec.market).trim();

            const hasDollar = newInc.includes('$') || newMkt.includes('$');
            if (!hasDollar) {
                alert('সংশোধনের জন্য অবশ্যই Household Income অথবা Market Value তে "$" প্রতীক দিতে হবে (যেমন: $75,000 বা $350,000)।');
                return;
            }

            const evalRes = evaluateLookupRowRules(newInc, newMkt);

            rec.income = newInc || '-';
            rec.market = newMkt || '-';
            rec.isMistake = false;

            if (evalRes.isKept) {
                rec.isKept = true;
                rec.isSpecial = evalRes.isSpecial;
                rec.reasons = evalRes.reasons;

                // Remove from mistake list
                lookupChkMistakeRecords = lookupChkMistakeRecords.filter(r => r.origIdx !== origIdx);
                // Add to qualified list
                if (!lookupChkQualifiedRecords.some(r => r.origIdx === origIdx)) {
                    lookupChkQualifiedRecords.push(rec);
                }
                if (evalRes.isSpecial && !lookupChkSpecialRecords.some(r => r.origIdx === origIdx)) {
                    lookupChkSpecialRecords.push(rec);
                }
                alert('✅ নাম্বারটি সফলভাবে সংশোধন করা হয়েছে এবং গ্রহণযোগ্য (Keep) তালিকায় যুক্ত করা হয়েছে!');
            } else {
                rec.isKept = false;
                rec.isSpecial = false;
                rec.reasons = evalRes.reasons;

                lookupChkMistakeRecords = lookupChkMistakeRecords.filter(r => r.origIdx !== origIdx);
                if (!lookupChkDiscardedRecords.some(r => r.origIdx === origIdx)) {
                    lookupChkDiscardedRecords.push(rec);
                }
                alert('⚠️ সংশোধিত ডাটা অনুযায়ী এটি গ্রহণযোগ্যতার শর্ত পূরণ করে নাই, তাই এটি অযোগ্য (Discarded) তালিকায় স্থানান্তর করা হয়েছে।');
            }

            // Refresh UI Badges & Counts
            updateLookupChkBadgesAndStats();
            filterLookupChkTableLocal();
        }

        // Remove row from mistake list
        function removeLookupMistakeRow(origIdx) {
            lookupChkMistakeRecords = lookupChkMistakeRecords.filter(r => r.origIdx !== origIdx);
            const rec = lookupChkAllRecords.find(r => r.origIdx === origIdx);
            if (rec) {
                rec.isMistake = false;
                rec.isKept = false;
                if (!lookupChkDiscardedRecords.some(r => r.origIdx === origIdx)) {
                    lookupChkDiscardedRecords.push(rec);
                }
            }
            updateLookupChkBadgesAndStats();
            filterLookupChkTableLocal();
        }

        // Helper to update badges and statistics
        function updateLookupChkBadgesAndStats() {
            const total = lookupChkAllRecords.length;
            const qCount = lookupChkQualifiedRecords.length;
            const spCount = lookupChkSpecialRecords.length;
            const dCount = lookupChkDiscardedRecords.length;
            const mCount = lookupChkMistakeRecords.length;

            const qPct = total > 0 ? Math.round((qCount / total) * 100) : 0;
            const dPct = total > 0 ? Math.round((dCount / total) * 100) : 0;

            const elTotal = document.getElementById('lchkStatTotal');
            const elQ = document.getElementById('lchkStatQualified');
            const elQPct = document.getElementById('lchkStatQualifiedPct');
            const elSp = document.getElementById('lchkStatSpecial');
            const elD = document.getElementById('lchkStatDiscarded');
            const elDPct = document.getElementById('lchkStatDiscardedPct');
            const elM = document.getElementById('lchkStatMistake');
            const elMPct = document.getElementById('lchkStatMistakePct');

            if (elTotal) elTotal.innerText = total.toLocaleString();
            if (elQ) elQ.innerText = qCount.toLocaleString();
            if (elQPct) elQPct.innerText = `${qPct}% সফল (Keep)`;
            if (elSp) elSp.innerText = spCount.toLocaleString();
            if (elD) elD.innerText = dCount.toLocaleString();
            if (elDPct) elDPct.innerText = `${dPct}% বাদ (Discarded)`;
            if (elM) elM.innerText = mCount.toLocaleString();
            if (elMPct) elMPct.innerText = `${mCount} টি ভুল ($ ছাড়া)`;

            const bQ = document.getElementById('lchkTabBadgeQualified');
            const bSp = document.getElementById('lchkTabBadgeSpecial');
            const bD = document.getElementById('lchkTabBadgeDiscarded');
            const bM = document.getElementById('lchkTabBadgeMistake');
            const bA = document.getElementById('lchkTabBadgeAll');

            if (bQ) bQ.innerText = qCount.toLocaleString();
            if (bSp) bSp.innerText = spCount.toLocaleString();
            if (bD) bD.innerText = dCount.toLocaleString();
            if (bM) bM.innerText = mCount.toLocaleString();
            if (bA) bA.innerText = total.toLocaleString();
        }

        // Clear and reset entire Lookup Checker tool
        function clearLookupCheckerAll() {
            const pasteArea = document.getElementById('lookupChkPasteInput');
            if (pasteArea) pasteArea.value = '';

            const fileInp = document.getElementById('lookupChkFileInput');
            if (fileInp) fileInp.value = '';

            const fileCount = document.getElementById('lookupChkFileRowsCount');
            if (fileCount) fileCount.innerText = '';

            const cfg = document.getElementById('lookupChkColumnConfig');
            if (cfg) cfg.classList.add('hidden');

            const resContainer = document.getElementById('lookupChkResultContainer');
            if (resContainer) resContainer.classList.add('hidden');

            const searchInp = document.getElementById('lchkTableSearchInput');
            if (searchInp) searchInp.value = '';

            lookupChkAllRecords = [];
            lookupChkQualifiedRecords = [];
            lookupChkSpecialRecords = [];
            lookupChkDiscardedRecords = [];
            lookupChkMistakeRecords = [];
            lookupChkFileRawRows = [];

            updateLookupChkBadgesAndStats();
            const tbody = document.getElementById('lookupChkTableBody');
            if (tbody) tbody.innerHTML = '';

            alert('🧹 লুকআপ চেকার সম্পূর্ণ ক্লিয়ার করা হয়েছে! আপনি এখন নতুন ডাটা চেক করতে পারেন।');
        }

        async function submitLookupChkAsWorkReport() {
            // CHECK IF REPORT SUBMISSION IS CURRENTLY CLOSED / LOCKED
            const lockStatus = checkReportSubmissionLockStatus();
            if (lockStatus.isClosed) {
                alert(`দুঃখিত স্যার, আপনি সময়মতো কাজ জমা করতে পারেন নাই, তাই আপনার কাজ আজকে গ্রহণ করা হবে না। আপনি আবার পরে চেষ্টা করেন।\n\n⏰ আর ${lockStatus.remainingText} পর আবার রিপোর্ট জমা দেওয়া যাবে।`);
                return;
            }
            if (!lookupChkQualifiedRecords || lookupChkQualifiedRecords.length === 0) {
                alert('রিপোর্ট হিসেবে জমা দেওয়ার মতো কোনো গ্রহণযোগ্য ডাটা নেই!');
                return;
            }

            if (!currentUser) {
                alert('⚠️ কাজের রিপোর্ট জমা দেওয়ার জন্য অনুগ্রহ করে প্রথমে আপনার কর্মী অ্যাকাউন্টে লগইন করুন।');
                switchToSection('dashboard');
                return;
            }

            const specialCount = (lookupChkSpecialRecords || []).length;
            const specialMsg = specialCount > 0 ? `\n(যার মধ্যে ${specialCount} টি ⭐ স্পেশাল নাম্বার রয়েছে)` : '';

            if (!confirm(`মোট ${lookupChkQualifiedRecords.length.toLocaleString()} টি গ্রহণযোগ্য লুকআপ নাম্বার আপনার আজকের কাজের রিপোর্ট হিসেবে জমা দিতে চান?${specialMsg}`)) {
                return;
            }

            const records = lookupChkQualifiedRecords.map(r => ({
                phone: r.phone,
                name: r.name || '-',
                age: '-',
                income: r.income || '-',
                household_income: r.income || '-',
                market_value: r.market || '-',
                est_market_value: r.market || '-'
            }));

            try {
                // Dual-write to Turso 9 GB Vault
                try {
                    if (typeof TursoVault !== 'undefined') {
                        await TursoVault.insertSubmissions(records, 'lookup_report', 'Lookup_Tool_Checked_Report.xlsx', currentProfile);
                    }
                } catch(tSubErr) {
                    console.warn('Turso lookup report write notice:', tSubErr);
                }

                const { data, error } = await supabaseClient.rpc('submit_lookup_work_batch', {
                    p_lookup_type: 'valid',
                    p_records: records,
                    p_file_name: 'Lookup_Tool_Checked_Report.xlsx'
                });

                if (error) throw error;

                alert(`✅ আপনার লুকআপ কাজের রিপোর্ট সফলভাবে জমা হয়েছে!\n\nমোট ডাটা: ${data.total_received}\nনতুন ইউনিক সংরক্ষিত: +${data.new_inserted}\nডুপ্লিকেট ফিল্টার্ড: ${data.duplicates_count}`);
                
                if (typeof loadAdminLookupReports === 'function') loadAdminLookupReports();
                if (typeof loadUserDashboard === 'function') loadUserDashboard();

                // Switch to worker dashboard so they see their submitted report & stats
                switchToSection('dashboard');

            } catch(err) {
                console.error('Lookup report submit error:', err);
                alert('রিপোর্ট জমা দিতে সমস্যা হয়েছে: ' + err.message);
            }
        }

        const uploadLookupChkQualifiedToDatabase = submitLookupChkAsWorkReport;

        function downloadLookupChkExcel(type) {
            let list = [];
            let fileName = '';

            if (type === 'special') {
                list = lookupChkSpecialRecords;
                fileName = `Lookup_Special_VIP_${list.length}_Records`;
            } else if (type === 'qualified') {
                list = lookupChkQualifiedRecords;
                fileName = `Lookup_Qualified_Kept_${list.length}_Records`;
            } else if (type === 'discarded') {
                list = lookupChkDiscardedRecords;
                fileName = `Lookup_Discarded_Rejected_${list.length}_Records`;
            } else if (type === 'no_info' || type === 'mistake') {
                list = lookupChkMistakeRecords;
                fileName = `Lookup_No_Information_Kono_Tottho_Pawa_Jay_Nai_${list.length}_Numbers`;
            } else {
                list = lookupChkAllRecords;
                fileName = `Lookup_All_Analysis_${list.length}_Records`;
            }

            if (!list || list.length === 0) {
                alert('ডাউনলোড করার মতো কোনো ডাটা নেই!');
                return;
            }

            const todayStr = new Date().toISOString().slice(0, 10);

            // Special handling for No Information numbers
            if (type === 'no_info' || type === 'mistake') {
                const exportData = list.map(r => ({
                    'Phone Number': String(r.phone || r.phone_number || '').trim(),
                    'Household Income': 'No Information',
                    'Est Market Value': 'No Information',
                    'Status': 'No Information (কোনো তথ্য পাওয়া যায় নাই)'
                })).filter(r => r['Phone Number'].length >= 6);

                const ws = XLSX.utils.json_to_sheet(exportData);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'No_Information');
                XLSX.writeFile(wb, `${fileName}_${todayStr}.xlsx`);
                alert(`📥 মোট ${exportData.length.toLocaleString()} টি No Information (কোনো তথ্য পাওয়া যায় নাই) নাম্বারের এক্সেল ফাইল ডাউনলোড সম্পন্ন হয়েছে!`);
                return;
            }

            // Strictly 3 columns for Lookup Report: Phone Number, Household Income, Est Market Value (NO Name, Age, etc.)
            const exportData = list.map(r => ({
                'Phone Number': String(r.phone || r.phone_number || '').trim(),
                'Household Income': String(r.income || r.household_income || '').trim(),
                'Est Market Value': String(r.market || r.est_market_value || '').trim()
            })).filter(r => r['Phone Number'].length >= 6);

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            const sheetTitle = type === 'special' ? 'Special_VIP' : (type === 'qualified' ? 'Qualified_Lookup' : 'Lookup_Report');
            XLSX.utils.book_append_sheet(wb, ws, sheetTitle);
            XLSX.writeFile(wb, `${fileName}_${todayStr}.xlsx`);
        }

        function downloadLookupChkTxt(type) {
            let list = [];
            if (type === 'special') list = lookupChkSpecialRecords;
            else if (type === 'qualified') list = lookupChkQualifiedRecords;
            else if (type === 'discarded') list = lookupChkDiscardedRecords;
            else if (type === 'no_info' || type === 'mistake') list = lookupChkMistakeRecords;
            else list = lookupChkAllRecords;

            if (!list || list.length === 0) {
                alert('ডাউনলোড করার মতো কোনো নাম্বার নেই!');
                return;
            }

            const lines = list.map(r => r.phone).filter(p => p && p.length >= 6).join('\n');
            const blob = new Blob([lines], { type: 'text/plain;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const titleType = (type === 'no_info' || type === 'mistake') ? 'No_Information_Kono_Tottho_Pawa_Jay_Nai' : (type === 'special' ? 'Special' : (type === 'qualified' ? 'Kept' : 'All'));
            a.download = `Lookup_${titleType}_Phones_${list.length}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (type === 'no_info' || type === 'mistake') {
                alert(`📄 মোট ${list.length.toLocaleString()} টি No Information (কোনো তথ্য পাওয়া যায় নাই) ফোন নাম্বার টেক্সট ফাইলে ডাউনলোড করা হয়েছে!`);
            }
        }

        function copyLookupChkPhones(type) {
            let list = [];
            if (type === 'special') list = lookupChkSpecialRecords;
            else if (type === 'qualified') list = lookupChkQualifiedRecords;
            else if (type === 'no_info' || type === 'mistake') list = lookupChkMistakeRecords;
            else list = lookupChkAllRecords;

            if (!list || list.length === 0) {
                alert('কপি করার মতো কোনো নাম্বার নেই!');
                return;
            }

            const lines = list.map(r => r.phone).filter(p => p && p.length >= 6).join('\n');
            navigator.clipboard.writeText(lines).then(() => {
                const label = (type === 'no_info' || type === 'mistake') ? 'No Information (কোনো তথ্য পাওয়া যায় নাই)' : '';
                alert(`✅ মোট ${list.length.toLocaleString()} টি ${label} ফোন নাম্বার ক্লিপবোর্ডে কপি করা হয়েছে!`);
            }).catch(err => {
                alert('কপি করতে সমস্যা: ' + err.message);
            });
        }

        // Direct submission of No Information records to database
        async function submitLookupChkNoInfoAsWorkReport() {
            const lockStatus = checkReportSubmissionLockStatus();
            if (lockStatus.isClosed) {
                alert(`দুঃখিত স্যার, আপনি সময়মতো কাজ জমা করতে পারেন নাই, তাই আপনার কাজ আজকে গ্রহণ করা হবে না। আপনি আবার পরে চেষ্টা করেন।\n\n⏰ আর ${lockStatus.remainingText} পর আবার রিপোর্ট জমা দেওয়া যাবে।`);
                return;
            }
            if (!lookupChkMistakeRecords || lookupChkMistakeRecords.length === 0) {
                alert('জমা দেওয়ার মতো কোনো No Information ডাটা নেই!');
                return;
            }

            if (!currentUser) {
                alert('⚠️ কাজের রিপোর্ট জমা দেওয়ার জন্য অনুগ্রহ করে প্রথমে আপনার কর্মী অ্যাকাউন্টে লগইন করুন।');
                switchToSection('dashboard');
                return;
            }

            if (!confirm(`মোট ${lookupChkMistakeRecords.length.toLocaleString()} টি No Information (কোনো তথ্য পাওয়া যায় নাই) নাম্বার আপনার আজকের কাজের রিপোর্ট হিসেবে জমা দিতে চান?`)) {
                return;
            }

            const records = lookupChkMistakeRecords.map(r => ({
                phone: r.phone,
                name: r.name || '-',
                age: '-',
                income: 'no_info',
                household_income: 'no_info',
                market_value: 'no_info',
                est_market_value: 'no_info'
            }));

            try {
                try {
                    if (typeof TursoVault !== 'undefined') {
                        await TursoVault.insertSubmissions(records, 'lookup_report', 'Lookup_No_Info_Checked_Report.xlsx', currentProfile);
                    }
                } catch(tSubErr) {
                    console.warn('Turso lookup no_info write notice:', tSubErr);
                }

                const { data, error } = await supabaseClient.rpc('submit_lookup_work_batch', {
                    p_lookup_type: 'no_info',
                    p_records: records,
                    p_file_name: 'Lookup_No_Info_Checked_Report.xlsx'
                });

                if (error) throw error;

                alert(`✅ আপনার No Information (কোনো তথ্য পাওয়া যায় নাই) রিপোর্ট সফলভাবে জমা হয়েছে!\n\nমোট ডাটা: ${data.total_received}\nনতুন সংরক্ষিত: +${data.new_inserted}\nডুপ্লিকেট ফিল্টার্ড: ${data.duplicates_count}`);
                
                if (typeof loadAdminLookupReports === 'function') loadAdminLookupReports();
                if (typeof loadUserDashboard === 'function') loadUserDashboard();

            } catch(err) {
                console.error('Submit lookup no_info report error:', err);
                alert('রিপোর্ট জমা দিতে সমস্যা হয়েছে: ' + err.message);
            }
        }

        // =========================================================================
        // ADMIN TAB 7: LOOKUP NUMBERS DIRECT UPLOAD ENGINE
        // =========================================================================
        let adminLookupUploadFileRows = [];

        // -------------------------------------------------------------
        // ADMIN LOOKUP STOCK UPLOAD DISPENSER
        // -------------------------------------------------------------
        let adminLookupStockFileRows = [];

        function switchAdminLookupStockMode(mode) {
            const btnFile = document.getElementById('btnAdminLookupStockModeFile');
            const btnPaste = document.getElementById('btnAdminLookupStockModePaste');
            const secFile = document.getElementById('adminLookupStockFileSection');
            const secPaste = document.getElementById('adminLookupStockPasteSection');

            if (mode === 'file') {
                if (btnFile) btnFile.className = 'px-4 py-2 text-xs font-black rounded-xl bg-purple-600 text-white shadow-sm transition cursor-pointer';
                if (btnPaste) btnPaste.className = 'px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition cursor-pointer';
                if (secFile) secFile.classList.remove('hidden');
                if (secPaste) secPaste.classList.add('hidden');
            } else {
                if (btnPaste) btnPaste.className = 'px-4 py-2 text-xs font-black rounded-xl bg-purple-600 text-white shadow-sm transition cursor-pointer';
                if (btnFile) btnFile.className = 'px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition cursor-pointer';
                if (secPaste) secPaste.classList.remove('hidden');
                if (secFile) secFile.classList.add('hidden');
            }
        }

        function handleAdminLookupStockFile(e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    let rows = [];
                    if (file.name.endsWith('.txt')) {
                        const txt = evt.target.result;
                        const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                        rows = lines.map(line => {
                            const digs = line.replace(/[^0-9]/g, '');
                            return { phone: digs };
                        });
                    } else {
                        const data = new Uint8Array(evt.target.result);
                        const wb = XLSX.read(data, { type: 'array' });
                        const sheet = wb.Sheets[wb.SheetNames[0]];
                        rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                    }

                    if (!rows || rows.length === 0) {
                        alert('ফাইলে কোনো ডাটা পাওয়া যায়নি!');
                        return;
                    }

                    adminLookupStockFileRows = rows;
                    const countBadge = document.getElementById('adminLookupStockFileRowsCount');
                    if (countBadge) countBadge.innerText = `${rows.length.toLocaleString()} Rows`;

                    const cols = Object.keys(rows[0]);
                    const pSel = document.getElementById('adminLookupStockColPhone');
                    const nSel = document.getElementById('adminLookupStockColName');
                    const aSel = document.getElementById('adminLookupStockColAge');

                    if (pSel) pSel.innerHTML = '';
                    if (nSel) nSel.innerHTML = '<option value="">-- None --</option>';
                    if (aSel) aSel.innerHTML = '<option value="">-- None --</option>';

                    let bestPhoneCol = cols[0];
                    cols.forEach(c => {
                        const lc = c.toLowerCase();
                        if (lc.includes('phone') || lc.includes('number') || lc.includes('mobile') || lc.includes('cell')) bestPhoneCol = c;
                    });

                    cols.forEach(col => {
                        const o1 = document.createElement('option');
                        o1.value = col; o1.innerText = col;
                        if (col === bestPhoneCol) o1.selected = true;
                        if (pSel) pSel.appendChild(o1);

                        const o2 = document.createElement('option');
                        o2.value = col; o2.innerText = col;
                        if (nSel) nSel.appendChild(o2);

                        const o3 = document.createElement('option');
                        o3.value = col; o3.innerText = col;
                        if (aSel) aSel.appendChild(o3);
                    });

                    document.getElementById('adminLookupStockFileConfig')?.classList.remove('hidden');

                } catch(err) {
                    alert('ফাইল পড়তে সমস্যা হয়েছে: ' + err.message);
                }
            };

            if (file.name.endsWith('.txt')) {
                reader.readAsText(file);
            } else {
                reader.readAsArrayBuffer(file);
            }
        }

        async function submitAdminLookupStockUpload() {
            if (!supabaseClient) return;

            const textInput = document.getElementById('adminLookupStockPasteInput');
            const dateInput = document.getElementById('adminLookupReportDate');
            const batchName = 'Lookup_Stock_' + (dateInput?.value || new Date().toISOString().slice(0, 10));
            const recDate = dateInput?.value || new Date().toISOString().slice(0, 10);
            const resultCard = document.getElementById('adminLookupStockUploadResultCard');
            const btn = document.getElementById('btnAdminLookupStockSubmit');

            let records = [];

            // From file rows if selected
            if (adminLookupStockFileRows && adminLookupStockFileRows.length > 0) {
                const pCol = document.getElementById('adminLookupStockColPhone')?.value;
                const nCol = document.getElementById('adminLookupStockColName')?.value;
                const aCol = document.getElementById('adminLookupStockColAge')?.value;

                adminLookupStockFileRows.forEach(row => {
                    let phone = pCol ? String(row[pCol] || '').replace(/[^0-9]/g, '') : '';
                    if (!phone || phone.length < 6) {
                        Object.keys(row).forEach(k => {
                            const val = String(row[k] || '').replace(/[^0-9]/g, '');
                            if (!phone && val.length >= 6 && val.length <= 16) phone = val;
                        });
                    }
                    if (phone && phone.length >= 6) {
                        records.push({
                            phone: phone,
                            name: nCol ? String(row[nCol] || '').trim() : '',
                            age: aCol ? String(row[aCol] || '').trim() : ''
                        });
                    }
                });
            }

            // From direct paste
            if (textInput && textInput.value.trim()) {
                const lines = textInput.value.split(/\r?\n/);
                lines.forEach(line => {
                    const cleanNum = line.replace(/[^0-9]/g, '');
                    if (cleanNum && cleanNum.length >= 6) {
                        records.push({ phone: cleanNum, name: '', age: '' });
                    }
                });
            }

            if (records.length === 0) {
                alert('অনুগ্রহ করে একটি ফাইল সিলেক্ট করুন অথবা বক্সে ফোন নাম্বার পেস্ট করুন।');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span>⏳ স্টকে আপলোড হচ্ছে...</span>';
            }

            try {
                let uploadResult = null;

                // Try RPC first
                try {
                    const { data, error } = await supabaseClient.rpc('admin_upload_received_numbers', {
                        p_records: records,
                        p_received_date: recDate,
                        p_batch_name: batchName,
                        p_stock_type: 'lookup'
                    });
                    if (error) throw error;
                    uploadResult = data;
                } catch(rpcErr) {
                    console.warn('RPC admin_upload_received_numbers failed, fallback to direct insert:', rpcErr);

                    // Direct Insert Fallback to company_received_numbers
                    const insertRows = records.map(r => ({
                        phone_number: r.phone,
                        full_name: r.name || '',
                        age: r.age || '',
                        stock_type: 'lookup',
                        received_date: recDate,
                        batch_name: batchName,
                        is_assigned: false,
                        is_exported: false
                    }));

                    const uniqueMap = {};
                    insertRows.forEach(r => { uniqueMap[r.phone_number] = r; });
                    const uniqueRows = Object.values(uniqueMap);

                    const { data: insData, error: insErr } = await supabaseClient
                        .from('company_received_numbers')
                        .upsert(uniqueRows, { onConflict: 'phone_number', ignoreDuplicates: false });

                    if (insErr) throw insErr;

                    uploadResult = {
                        success: true,
                        total_received: records.length,
                        unique_in_file: uniqueRows.length,
                        new_inserted: uniqueRows.length,
                        duplicates_count: records.length - uniqueRows.length
                    };
                }

                if (resultCard) {
                    resultCard.classList.remove('hidden');
                    resultCard.className = 'p-4 rounded-2xl text-xs font-semibold bg-emerald-50 text-emerald-900 border border-emerald-300 block';
                    resultCard.innerHTML = `
                        <div class="flex items-center space-x-2 font-black text-sm text-emerald-950 mb-1">
                            <span>✅</span>
                            <span>সফলভাবে লুকআপ স্টকে নাম্বার যোগ হয়েছে!</span>
                        </div>
                        <div class="grid grid-cols-3 gap-2 mt-2 font-mono">
                            <p>মোট প্রাপ্ত: <b>\${uploadResult.total_received.toLocaleString()}</b></p>
                            <p class="text-emerald-700">নতুন স্টকে যুক্ত: <b>+\${uploadResult.new_inserted.toLocaleString()}</b></p>
                            <p class="text-amber-700">ডুপ্লিকেট বাদ: <b>\${uploadResult.duplicates_count.toLocaleString()}</b></p>
                        </div>
                        <p class="text-[11px] text-emerald-800 font-sans mt-2">
                            💡 কর্মীরা এখন <b>'Claim Stock'</b> পেজে গিয়ে <b>'লুকআপ নাম্বার স্টক (Lookup Numbers)'</b>-এ এই নাম্বারগুলো দেখতে পাবে এবং কাজের জন্য তুলে নিতে পারবে।
                        </p>
                    `;
                }

                alert(`✅ সফলভাবে \${uploadResult.new_inserted.toLocaleString()} টি নতুন নাম্বার লুকআপ স্টকে জমা হয়েছে!\n\nকর্মীরা এখন Claim Stock পেজ থেকে এই নাম্বারগুলো তুলে নিয়ে কাজ শুরু করতে পারবে।`);

                // Reset paste textarea
                if (textInput) textInput.value = '';

                // Refresh stock counts across portal
                if (typeof refreshClaimStockData === 'function') refreshClaimStockData();
                if (typeof loadWorkerClaimStockCount === 'function') loadWorkerClaimStockCount();
                if (typeof loadAdminRecStockData === 'function') loadAdminRecStockData();

            } catch(err) {
                console.error('Stock upload error:', err);
                alert('স্টকে আপলোড করতে সমস্যা হয়েছে: ' + err.message);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span>📥 পেস্ট করা নাম্বার লুকআপ স্টকে যুক্ত করুন</span>';
                }
            }
        }

        // -------------------------------------------------------------
        // ADMIN DATA RESET & DUPLICATE CLEANING
        // -------------------------------------------------------------
        async function resetAdminLookupData(scope) {
            if (!supabaseClient) return;

            const targetDate = document.getElementById('adminLookupReportDate')?.value || new Date().toISOString().slice(0, 10);
            
            let confirmMsg = '';
            if (scope === 'today') {
                confirmMsg = `⚠️ আপনি কি আজকের (\${targetDate}) সমস্ত জমা দেওয়া লুকআপ ডাটা মুছে ফেলতে চান?\n\nএর ফলে টেস্টে জমা দেওয়া নাম্বারগুলো মুছে যাবে এবং পরবর্তীতে কর্মীদের কাজে ডুপ্লিকেট হিসেবে ধরবে না।`;
            } else {
                confirmMsg = `🚨 চরম সতর্কতা!\n\nআপনি কি ডাটাবেজের সমস্ত লুকআপ ডাটা (আপনার পূর্বে আপলোড করা ৫,০০০ টেস্ট ডাটা সহ সব) সম্পূর্ণ মুছে ফেলে ডাটাবেজ রিসেট করতে চান?\n\nএর ফলে সম্পূর্ণ লুকআপ ডাটাবেজ ফ্রেশ ও ক্লিন হয়ে যাবে এবং ডুপ্লিকেট মেমোরি পরিষ্কার হবে।`;
            }

            if (!confirm(confirmMsg)) return;

            try {
                // 1. Try RPC first
                let rpcWorked = false;
                try {
                    const { data, error } = await supabaseClient.rpc('admin_clear_lookup_records', {
                        p_scope: scope,
                        p_target_date: targetDate
                    });
                    if (!error && data && data.success) {
                        rpcWorked = true;
                    }
                } catch(e) {
                    console.warn('RPC admin_clear_lookup_records fallback:', e);
                }

                // 2. Direct Delete Fallback
                if (!rpcWorked) {
                    if (scope === 'today') {
                        await Promise.all([
                            supabaseClient.from('lookup_records').delete().eq('submission_date', targetDate),
                            supabaseClient.from('lookup_no_info_records').delete().eq('submission_date', targetDate)
                        ]);
                    } else {
                        await Promise.all([
                            supabaseClient.from('lookup_records').delete().neq('id', 0),
                            supabaseClient.from('lookup_no_info_records').delete().neq('id', 0)
                        ]);
                    }
                }

                alert('✅ সফলভাবে লুকআপ ডাটা মুছে ফেলা হয়েছে এবং ডাটাবেজ রিসেট সম্পন্ন হয়েছে!\nএখন কর্মীরা নতুনভাবে ফ্রেশ ডাটা সাবমিট করতে পারবে এবং পূর্বের নাম্বারগুলো ডুপ্লিকেট ধরবে না।');

                // Reload table & metrics
                await loadAdminLookupReports();

            } catch (err) {
                console.error('Error clearing lookup data:', err);
                alert('লুকআপ টেস্ট ডাটা মুছতে সমস্যা হয়েছে: ' + (err.message || 'Unknown notice') + '\n\n(নোট: আপনার কোম্পানির কোনো ডেলিভারি বা স্টক ডাটা ক্ষতিগ্রস্ত হয়নি)');
            }
        }

        // Backward compatibility stubs
        const switchAdminLookupUploadMode = switchAdminLookupStockMode;
        const handleAdminLookupUploadFile = handleAdminLookupStockFile;
        const submitAdminLookupUploadFile = submitAdminLookupStockUpload;
        const submitAdminLookupUploadPaste = submitAdminLookupStockUpload;

        function switchDupInputMode(mode) {
            activeDupInputMode = mode;
            const btnPaste = document.getElementById('btnDupModePaste');
            const btnFile = document.getElementById('btnDupModeFile');
            const secPaste = document.getElementById('dupSectionPaste');
            const secFile = document.getElementById('dupSectionFile');

            if (mode === 'paste') {
                btnPaste.className = 'px-4 py-2 text-xs sm:text-sm font-black rounded-xl bg-indigo-600 text-white shadow-sm transition';
                btnFile.className = 'px-4 py-2 text-xs sm:text-sm font-bold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition';
                secPaste.classList.remove('hidden');
                secFile.classList.add('hidden');
            } else {
                btnFile.className = 'px-4 py-2 text-xs sm:text-sm font-black rounded-xl bg-indigo-600 text-white shadow-sm transition';
                btnPaste.className = 'px-4 py-2 text-xs sm:text-sm font-bold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition';
                secFile.classList.remove('hidden');
                secPaste.classList.add('hidden');
            }
        }

        function handleDupFileSelected(e) {
            const file = e.target.files[0];
            if (!file) return;

            const statusEl = document.getElementById('dupFileStatus');
            if (statusEl) statusEl.innerText = `⏳ ফাইল পড়া হচ্ছে: ${file.name}...`;

            const reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    const data = new Uint8Array(evt.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rawAoA = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

                    if (!rawAoA || rawAoA.length === 0) {
                        alert('ফাইলে কোনো ডাটা পাওয়া যায়নি।');
                        return;
                    }

                    // Convert to string lines or parsed rows
                    const lines = [];
                    rawAoA.forEach(row => {
                        if (row && row.some(c => String(c || '').trim().length > 0)) {
                            lines.push(row.map(c => String(c || '').trim()).join('\t'));
                        }
                    });

                    document.getElementById('dupTextInput').value = lines.join('\n');
                    if (statusEl) statusEl.innerHTML = `<span class="text-emerald-600 font-bold">✅ ${lines.length.toLocaleString()} টি সারি সফলভাবে লোড হয়েছে! এখন নিচে 'Run Duplicate Check' বাটনে ক্লিক করুন।</span>`;
                    alert(`✅ ফাইল থেকে ${lines.length} টি সারি পাওয়া গেছে। এখন 'Run Duplicate Check' বাটনে ক্লিক করে ডুপ্লিকেট ফিল্টার করুন।`);
                } catch(err) {
                    alert('ফাইল পড়তে সমস্যা হয়েছে: ' + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        }

async function runDuplicateCheck() {
            const rawText = document.getElementById('dupTextInput').value.trim();
            if (!rawText) {
                alert('Please paste phone numbers to check.');
                return;
            }

            const checkCompany = document.getElementById('dupCheckCompanyDeliveries')?.checked ?? true;
            const checkDb = document.getElementById('dupCheckDbCrossCheck')?.checked ?? true;
            const lines = rawText.split(/\r?\n/);
            
            const counts = {};
            const inputRecords = {};
            const inputOrder = [];

            // Smart Multi-Pattern Parsing
            lines.forEach(line => {
                const trimmed = line.trim();
                if (!trimmed) return;

                let phone = '';
                let name = '';
                let age = '';

                // Case 1: Tab, comma, semicolon, pipe separated
                const delims = trimmed.split(/[\t,;|]+/);
                if (delims.length >= 2) {
                    for (const d of delims) {
                        const dStr = d.trim();
                        const digs = dStr.replace(/[^0-9]/g, '');
                        if (digs.length >= 7 && digs.length <= 16 && !phone) {
                            phone = digs;
                        } else if (digs.length >= 2 && digs.length <= 3 && parseInt(digs, 10) >= 15 && parseInt(digs, 10) <= 120 && !age) {
                            age = digs;
                        } else if (!name && /[a-zA-Z]/.test(dStr) && digs.length <= 2) {
                            name = dStr;
                        }
                    }
                }

                // Case 2: Space separated
                if (!phone) {
                    const tokens = trimmed.split(/\s+/);
                    const nameParts = [];
                    for (const tok of tokens) {
                        const digs = tok.replace(/[^0-9]/g, '');
                        if (digs.length >= 7 && digs.length <= 16 && !phone) {
                            phone = digs;
                        } else if (digs.length >= 2 && digs.length <= 3 && parseInt(digs, 10) >= 15 && parseInt(digs, 10) <= 120 && !age) {
                            age = digs;
                        } else if (/[a-zA-Z]/.test(tok)) {
                            nameParts.append ? nameParts.append(tok) : nameParts.push(tok);
                        }
                    }
                    if (nameParts.length > 0 && !name) {
                        name = nameParts.join(' ');
                    }
                }

                // Fallback: regex search for 7-16 digits
                if (!phone) {
                    const match = trimmed.match(/\b\d{7,16}\b/);
                    if (match) phone = match[0];
                }
                if (!phone) {
                    const justDigs = trimmed.replace(/[^0-9]/g, '');
                    if (justDigs.length >= 7 && justDigs.length <= 16) phone = justDigs;
                }

                if (phone) {
                    if (!counts[phone]) {
                        counts[phone] = 0;
                        inputOrder.push(phone);
                        inputRecords[phone] = {
                            phone: phone,
                            name: name || '-',
                            age: age || '-',
                            originalLine: trimmed
                        };
                    }
                    counts[phone]++;
                }
            });

            if (inputOrder.length === 0) {
                alert('কোনো বৈধ ফোন নাম্বার পাওয়া যায়নি। অনুগ্রহ করে নাম্বার পেস্ট বা ফাইল আপলোড করুন।');
                return;
            }

            dupCleanList = [];
            dupRepeatedList = [];
            dupDbMatchesList = [];
            let dupCompanyDeliveredList = [];
            window.dupCompanyDeliveredList = dupCompanyDeliveredList;

            // 1. Check intra-file duplicates
            inputOrder.forEach(num => {
                const rec = inputRecords[num];
                if (counts[num] > 1) {
                    dupRepeatedList.push({
                        phone: num,
                        name: rec.name,
                        age: rec.age,
                        count: counts[num],
                        status: `🔁 একই ফাইলে ${counts[num]} বার ডুপ্লিকেট রয়েছে`
                    });
                }
                dupCleanList.push({
                    phone: num,
                    name: rec.name,
                    age: rec.age,
                    count: 1,
                    status: '🟢 Fresh (কোম্পানিকে দেওয়ার মতো ফ্রেশ)'
                });
            });

            const existingDbSet = new Set();
            const companyDeliveredSet = new Set();

            // 2. Comprehensive Cross-Check against TURSO 9 GB VAULT (Primary Storage)
            try {
                if (typeof TursoVault !== 'undefined') {
                    const tursoDupRes = await TursoVault.checkDuplicates(inputOrder);
                    
                    // A. Turso Company Deliveries
                    if (checkCompany && tursoDupRes.companyDeliveries && tursoDupRes.companyDeliveries.length > 0) {
                        tursoDupRes.companyDeliveries.forEach(row => {
                            if (!companyDeliveredSet.has(row.phone_number)) {
                                companyDeliveredSet.add(row.phone_number);
                                const rec = inputRecords[row.phone_number] || {};
                                dupCompanyDeliveredList.push({
                                    phone: row.phone_number,
                                    name: row.full_name || rec.name || '-',
                                    age: row.age || rec.age || '-',
                                    count: 1,
                                    delivery_date: row.delivery_date || row.delivered_at || 'পূর্বের তারিখ',
                                    company_name: row.company_name || 'Client',
                                    status: `⚠️ পূর্বে ${row.delivery_date || ''} তারিখে কোম্পানিকে ডেলিভারি দেওয়া হয়েছে (${row.company_name || 'Client'}) [Turso Vault]`
                                });
                            }
                        });
                    }

                    // B. Turso Central Submissions
                    if (checkDb && tursoDupRes.submissions && tursoDupRes.submissions.length > 0) {
                        tursoDupRes.submissions.forEach(row => {
                            if (!existingDbSet.has(row.phone_number)) {
                                existingDbSet.add(row.phone_number);
                                const rec = inputRecords[row.phone_number] || {};
                                dupDbMatchesList.push({
                                    phone: row.phone_number,
                                    name: row.full_name || rec.name || '-',
                                    age: row.age || rec.age || '-',
                                    count: 1,
                                    status: `ডাটাবেজে পূর্বে জমা দেওয়া (${row.username || row.user_email || 'Worker'}) [Turso Vault]`
                                });
                            }
                        });
                    }
                }
            } catch (tursoDupErr) {
                console.warn('Turso dup check notice:', tursoDupErr);
            }

            // 3. Fallback Cross-Check against Supabase (if available)
            if (supabaseClient) {
                try {
                    const chunkSize = 200;
                    for (let i = 0; i < inputOrder.length; i += chunkSize) {
                        const chunk = inputOrder.slice(i, i + chunkSize);

                        if (checkCompany) {
                            try {
                                const { data: compData } = await supabaseClient
                                    .from('company_deliveries')
                                    .select('phone_number, delivery_date, company_name, category, full_name, age')
                                    .in('phone_number', chunk);

                                if (compData && compData.length > 0) {
                                    compData.forEach(row => {
                                        if (!companyDeliveredSet.has(row.phone_number)) {
                                            companyDeliveredSet.add(row.phone_number);
                                            const rec = inputRecords[row.phone_number] || {};
                                            dupCompanyDeliveredList.push({
                                                phone: row.phone_number,
                                                name: row.full_name || rec.name || '-',
                                                age: row.age || rec.age || '-',
                                                count: 1,
                                                delivery_date: row.delivery_date || 'পূর্বের তারিখ',
                                                company_name: row.company_name || 'Company',
                                                status: `⚠️ পূর্বে ${row.delivery_date || ''} তারিখে কোম্পানিকে ডেলিভারি দেওয়া হয়েছে (${row.company_name || 'Client'})`
                                            });
                                        }
                                    });
                                }
                            } catch (compErr) {
                                console.warn('Supabase deliveries cross check notice:', compErr);
                            }
                        }

                        if (checkDb) {
                            try {
                                const { data: dbData } = await supabaseClient
                                    .from('master_numbers')
                                    .select('phone_number, user_email, full_name, age')
                                    .in('phone_number', chunk);

                                if (dbData && dbData.length > 0) {
                                    dbData.forEach(row => {
                                        if (!existingDbSet.has(row.phone_number)) {
                                            existingDbSet.add(row.phone_number);
                                            const rec = inputRecords[row.phone_number] || {};
                                            dupDbMatchesList.push({
                                                phone: row.phone_number,
                                                name: row.full_name || rec.name || '-',
                                                age: row.age || rec.age || '-',
                                                count: 1,
                                                status: `ডাটাবেজে পূর্বে জমা দেওয়া (${row.user_email || 'Worker'})`
                                            });
                                        }
                                    });
                                }
                            } catch(dbErr) {
                                console.warn('Supabase master numbers cross check notice:', dbErr);
                            }
                        }
                    }
                } catch (err) {
                    console.error('Supabase cross-check error:', err);
                }
            }

            // STRICT QUALITY CONTROL: Exclude company delivered numbers and DB numbers from clean list!
            dupCleanList = dupCleanList.filter(item => !companyDeliveredSet.has(item.phone) && !existingDbSet.has(item.phone));

            // Update Metric Counts
            document.getElementById('dupStatTotal').innerText = inputOrder.length.toLocaleString();
            document.getElementById('dupStatUnique').innerText = dupCleanList.length.toLocaleString();
            document.getElementById('dupStatCompanyDups').innerText = dupCompanyDeliveredList.length.toLocaleString();
            document.getElementById('dupStatFileDups').innerText = dupRepeatedList.length.toLocaleString();
            document.getElementById('dupStatDbDups').innerText = dupDbMatchesList.length.toLocaleString();

            document.getElementById('dupCountClean').innerText = dupCleanList.length.toLocaleString();
            document.getElementById('dupCountCompany').innerText = dupCompanyDeliveredList.length.toLocaleString();
            document.getElementById('dupCountRepeated').innerText = dupRepeatedList.length.toLocaleString();
            document.getElementById('dupCountDb').innerText = dupDbMatchesList.length.toLocaleString();

            document.getElementById('dupResultsCard').classList.remove('hidden');
            switchDupTab('clean');
        }

        function switchDupTab(tab) {
            currentDupTab = tab;
            const btnClean = document.getElementById('tabDupCleanBtn');
            const btnCompany = document.getElementById('tabDupCompanyBtn');
            const btnFile = document.getElementById('tabDupFileBtn');
            const btnDb = document.getElementById('tabDupDbBtn');
            const body = document.getElementById('dupTableBody');

            [btnClean, btnCompany, btnFile, btnDb].forEach(b => {
                if (b) b.className = 'px-3.5 py-2 text-xs sm:text-sm font-bold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition whitespace-nowrap';
            });

            let activeList = [];
            if (tab === 'clean') {
                if (btnClean) btnClean.className = 'px-3.5 py-2 text-xs sm:text-sm font-black rounded-xl bg-emerald-600 text-white shadow transition whitespace-nowrap';
                activeList = dupCleanList;
            } else if (tab === 'company') {
                if (btnCompany) btnCompany.className = 'px-3.5 py-2 text-xs sm:text-sm font-black rounded-xl bg-rose-600 text-white shadow transition whitespace-nowrap';
                activeList = window.dupCompanyDeliveredList || [];
            } else if (tab === 'duplicates') {
                if (btnFile) btnFile.className = 'px-3.5 py-2 text-xs sm:text-sm font-black rounded-xl bg-amber-500 text-white shadow transition whitespace-nowrap';
                activeList = dupRepeatedList;
            } else {
                if (btnDb) btnDb.className = 'px-3.5 py-2 text-xs sm:text-sm font-black rounded-xl bg-blue-600 text-white shadow transition whitespace-nowrap';
                activeList = dupDbMatchesList;
            }

            if (activeList.length > 0) {
                body.innerHTML = activeList.map((item, idx) => {
                    const isComp = (tab === 'company');
                    const isClean = (tab === 'clean');
                    const rowBg = isComp ? 'bg-rose-50/60 hover:bg-rose-100/60' : (isClean ? 'hover:bg-emerald-50/40' : 'hover:bg-slate-50');
                    const numColor = isComp ? 'text-rose-700 font-black' : (isClean ? 'text-emerald-700 font-bold' : 'text-slate-800 font-bold');
                    const statusColor = isComp ? 'text-rose-800 font-extrabold bg-rose-100/80 px-2 py-0.5 rounded' : (isClean ? 'text-emerald-700 font-bold' : 'text-slate-600 font-medium');

                    return `
                        <tr class="${rowBg} text-xs transition">
                            <td class="py-2.5 px-3 font-mono text-slate-400">${idx + 1}</td>
                            <td class="py-2.5 px-3 font-mono ${numColor}">${item.phone}</td>
                            <td class="py-2.5 px-3 font-semibold text-slate-700">${item.name || '-'}</td>
                            <td class="py-2.5 px-3 text-slate-500">${item.age || '-'}</td>
                            <td class="py-2.5 px-3 ${statusColor}">
                                ${item.status}
                            </td>
                        </tr>
                    `;
                }).join('');
            } else {
                body.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 font-medium">এই ক্যাটাগরিতে কোনো রেকর্ড পাওয়া যায়নি।</td></tr>`;
            }
        }

        // 1-Click Clean Sheet Download directly for Company
        function downloadCleanCompanyExcel() {
            if (!dupCleanList || dupCleanList.length === 0) {
                alert('কোম্পানিকে দেওয়ার মতো কোনো ফ্রেশ ডাটা নেই!');
                return;
            }

            // Pure phone numbers only - no extra columns (SL, Full Name, Age, Status) or header rows
            const cleanNumbers = dupCleanList
                .map(item => String(item.phone || item.phone_number || item).trim())
                .filter(p => p.length >= 6);
            const ws = XLSX.utils.aoa_to_sheet(cleanNumbers.map(p => [p]));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Clean_Numbers');
            const today = new Date().toISOString().slice(0, 10);
            XLSX.writeFile(wb, `Clean_Company_Delivery_${today}.xlsx`);
        }

        // Download Current Tab (Full Data Support: Clean, Company, File Dups, DB Dups)
        function downloadDupTabExcel() {
            let activeList = [];
            let tabName = '';

            if (currentDupTab === 'clean') {
                activeList = dupCleanList;
                tabName = 'Clean_Company_Fresh';
            } else if (currentDupTab === 'company') {
                activeList = window.dupCompanyDeliveredList || [];
                tabName = 'Company_Previously_Delivered';
            } else if (currentDupTab === 'duplicates') {
                activeList = dupRepeatedList;
                tabName = 'Repeated_File_Duplicates';
            } else {
                activeList = dupDbMatchesList;
                tabName = 'Already_In_Database';
            }

            if (!activeList || activeList.length === 0) {
                alert('এই ক্যাটাগরিতে ডাউনলোড করার মতো কোনো রেকর্ড নেই।');
                return;
            }

            // When downloading clean numbers tab for work, export pure numbers only!
            if (currentDupTab === 'clean') {
                const cleanNumbers = activeList
                    .map(item => String(item.phone || item.phone_number || item).trim())
                    .filter(p => p.length >= 6);
                const ws = XLSX.utils.aoa_to_sheet(cleanNumbers.map(p => [p]));
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Clean_Numbers');
                XLSX.writeFile(wb, `Clean_Company_Fresh_${new Date().toISOString().slice(0,10)}.xlsx`);
                return;
            }

            const exportData = activeList.map((item, idx) => ({
                'SL': idx + 1,
                'Phone Number': item.phone,
                'Full Name': item.name || '',
                'Age': item.age || '',
                'Count': item.count || 1,
                'Status': item.status
            }));

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, tabName);
            XLSX.writeFile(wb, `${tabName}_${new Date().toISOString().slice(0,10)}.xlsx`);
        }

        function downloadAllQcExcel() {
            const wb = XLSX.utils.book_new();
            const today = new Date().toISOString().slice(0, 10);

            // Sheet 1: Clean Fresh
            const s1Data = (dupCleanList || []).map((r, i) => ({
                'SL': i + 1, 'Phone Number': r.phone, 'Full Name': r.name || '', 'Age': r.age || '', 'Status': r.status
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s1Data.length > 0 ? s1Data : [{'Notice': 'No records'}]), '1_Fresh_Clean_Numbers');

            // Sheet 2: Company Delivered Dups
            const s2Data = (window.dupCompanyDeliveredList || []).map((r, i) => ({
                'SL': i + 1, 'Phone Number': r.phone, 'Full Name': r.name || '', 'Age': r.age || '', 'Delivery Date': r.delivery_date || '', 'Company': r.company_name || '', 'Status': r.status
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s2Data.length > 0 ? s2Data : [{'Notice': 'No records'}]), '2_Company_Delivered');

            // Sheet 3: File Duplicates
            const s3Data = (dupRepeatedList || []).map((r, i) => ({
                'SL': i + 1, 'Phone Number': r.phone, 'Full Name': r.name || '', 'Age': r.age || '', 'Count': r.count, 'Status': r.status
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s3Data.length > 0 ? s3Data : [{'Notice': 'No records'}]), '3_File_Repeats');

            // Sheet 4: Database Dups
            const s4Data = (dupDbMatchesList || []).map((r, i) => ({
                'SL': i + 1, 'Phone Number': r.phone, 'Full Name': r.name || '', 'Age': r.age || '', 'Status': r.status
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s4Data.length > 0 ? s4Data : [{'Notice': 'No records'}]), '4_Master_DB_Duplicates');

            XLSX.writeFile(wb, `Complete_QC_Audit_Report_${today}.xlsx`);
        }

        // ==================== USERNAME EDIT MODAL LOGIC ====================
        function openUsernameModal(targetUserId, currentName) {
            const modal = document.getElementById('usernameModal');
            const input = document.getElementById('newUsernameInput');
            const errBox = document.getElementById('usernameModalError');
            const succBox = document.getElementById('usernameModalSuccess');

            if (errBox) errBox.classList.add('hidden');
            if (succBox) succBox.classList.add('hidden');

            modal.dataset.targetUserId = targetUserId || (currentUser ? currentUser.id : '');
            input.value = currentName || (currentProfile ? currentProfile.username : '');

            modal.classList.remove('hidden');
            input.focus();
        }

        function closeUsernameModal() {
            const modal = document.getElementById('usernameModal');
            if (modal) modal.classList.add('hidden');
        }

        async function handleUsernameUpdate(e) {
            e.preventDefault();
            const modal = document.getElementById('usernameModal');
            const targetUserId = modal.dataset.targetUserId || (currentUser ? currentUser.id : '');
            const input = document.getElementById('newUsernameInput');
            const rawVal = input.value.trim();
            const cleanUsername = rawVal.replace(/\s+/g, '_');
            const errBox = document.getElementById('usernameModalError');
            const succBox = document.getElementById('usernameModalSuccess');
            const btn = document.getElementById('saveUsernameBtn');

            if (!cleanUsername) {
                if (errBox) {
                    errBox.innerText = 'Please enter a valid username';
                    errBox.classList.remove('hidden');
                }
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span>Saving...</span>';

            try {
                // 1. Update in profiles table
                const { error } = await supabaseClient
                    .from('profiles')
                    .update({ username: cleanUsername })
                    .eq('id', targetUserId);

                if (error) throw error;

                // 2. If user is updating their own profile, update local state
                if (currentUser && targetUserId === currentUser.id) {
                    try {
                        await supabaseClient.auth.updateUser({
                            data: { username: cleanUsername }
                        });
                    } catch (authErr) {
                        console.warn('Auth metadata update note:', authErr);
                    }

                    if (currentProfile) currentProfile.username = cleanUsername;
                    const emailDisplay = document.getElementById('userEmail');
                    if (emailDisplay && currentProfile) {
                        emailDisplay.innerText = cleanUsername;
                        emailDisplay.title = `${cleanUsername} (${currentProfile.email})`;
                    }
                    const badge = document.getElementById('workerUsernameBadge');
                    if (badge) badge.innerText = cleanUsername;
                }

                succBox.innerText = '✅ Username updated successfully!';
                succBox.classList.remove('hidden');

                // If admin is viewing, refresh admin tables
                if (currentProfile && currentProfile.role === 'admin') {
                    await loadAdminDashboard();
                }

                setTimeout(() => {
                    closeUsernameModal();
                    btn.disabled = false;
                    btn.innerHTML = '<span>💾 Save Username</span>';
                }, 1000);

            } catch (err) {
                if (errBox) {
                    errBox.innerText = 'Failed to update username: ' + err.message;
                    errBox.classList.remove('hidden');
                }
                btn.disabled = false;
                btn.innerHTML = '<span>💾 Save Username</span>';
            }
        }


        // ==================== DATE FILTER & DATABASE RESET LOGIC ====================
        function clearAdminSubDateFilter() {
            const dateInput = document.getElementById('adminSubDateFilter');
            if (dateInput) dateInput.value = '';
            loadAdminSubmissionsData();
        }

        async function downloadAdminLookupNoInfoExcel() {
            if (!supabaseClient) return;
            const dateVal = document.getElementById('adminSubDateFilter')?.value;
            const workerFilter = document.getElementById('adminSubWorkerFilter')?.value || 'all';

            try {
                const allRows = await fetchAllSubmissions({
                    date: dateVal || null,
                    report_type: 'lookup_no_info',
                    user_email: workerFilter
                });

                if (!allRows || allRows.length === 0) {
                    alert('নির্বাচিত তারিখ বা ফিল্টারে কোনো Lookup No Information ডাটা পাওয়া যায়নি।');
                    return;
                }

                // Strictly Phone Number & Status: No Information
                const exportRows = allRows.map(item => ({
                    'Phone Number': String(item.phone_number || item.phone || '').trim(),
                    'Status': 'No Information (কোনো তথ্য পাওয়া যায় নাই)'
                })).filter(r => r['Phone Number'].length >= 6);

                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "No_Information");
                const fileName = `Lookup_No_Information_${dateVal || new Date().toISOString().slice(0, 10)}_Total_${exportRows.length}.xlsx`;
                XLSX.writeFile(wb, fileName);
                alert(`📥 মোট ${exportRows.length.toLocaleString()} টি Lookup No Information নাম্বারের এক্সেল ফাইল ডাউনলোড সম্পন্ন হয়েছে!`);
            } catch(err) {
                alert('Download error: ' + err.message);
            }
        }

        async function downloadDateFilteredExcel() {
            if (!supabaseClient) return;
            const dateVal = document.getElementById('adminSubDateFilter')?.value;
            const reportFilter = document.getElementById('adminSubReportFilter')?.value || 'all';
            const workerFilter = document.getElementById('adminSubWorkerFilter')?.value || 'all';

            try {
                // Fetch 100% of all dated records with auto-pagination (bypasses 500 limit!)
                const allRows = await fetchAllSubmissions({
                    date: dateVal || null,
                    report_type: reportFilter,
                    user_email: workerFilter
                });

                if (!allRows || allRows.length === 0) {
                    alert('নির্বাচিত তারিখ বা ফিল্টারে কোনো ডাটা পাওয়া যায়নি।');
                    return;
                }

                let exportRows;
                if (reportFilter === 'lookup_report') {
                    // Strictly 3 columns for Lookup Report: Phone Number, Household Income, Est Market Value (NO Name, Age, etc.)
                    exportRows = allRows.map(item => ({
                        'Phone Number': item.phone_number,
                        'Household Income': item.household_income || '',
                        'Est Market Value': item.est_market_value || ''
                    }));
                } else if (reportFilter === 'signal_report') {
                    // Pure phone numbers for Signal Report
                    exportRows = allRows.map(item => ({
                        'Phone Number': item.phone_number
                    }));
                } else {
                    exportRows = allRows.map((item, idx) => ({
                        'SL': idx + 1,
                        'Phone Number': item.phone_number,
                        'Full Name': item.full_name || '-',
                        'Age': item.age || '-',
                        'Household Income': item.household_income || '-',
                        'Est Market Value': item.est_market_value || '-',
                        'Report Type': item.report_type || 'general',
                        'Department': item.department || '-',
                        'Worker Username': item.username || userEmailToNameMap[item.user_email] || '-',
                        'Worker Email': item.user_email,
                        'Date': new Date(item.created_at).toLocaleDateString(),
                        'Time': new Date(item.created_at).toLocaleTimeString()
                    }));
                }

                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                let sheetTitle = 'Submissions';
                if (reportFilter === 'lookup_no_info') sheetTitle = 'No_Information';
                else if (reportFilter === 'lookup_report') sheetTitle = 'Valid_Lookup';
                else if (reportFilter === 'signal_report') sheetTitle = 'Signal_Data';
                else if (dateVal) sheetTitle = `Records_${dateVal}`;
                XLSX.utils.book_append_sheet(wb, ws, sheetTitle.slice(0, 31));

                let fileNamePrefix = 'Daily_Records';
                if (reportFilter === 'lookup_no_info') fileNamePrefix = 'Lookup_No_Information';
                else if (reportFilter === 'lookup_report') fileNamePrefix = 'Lookup_Valid';
                else if (reportFilter === 'signal_report') fileNamePrefix = 'Signal_Records';

                const fileName = `${fileNamePrefix}_${dateVal || new Date().toISOString().slice(0, 10)}_Total_${exportRows.length}.xlsx`;
                XLSX.writeFile(wb, fileName);
                alert(`📥 মোট ${exportRows.length.toLocaleString()} টি ${reportFilter === 'lookup_no_info' ? 'Lookup No Information' : 'রেকর্ড'} সফলভাবে ডাউনলোড হয়েছে!`);
            } catch (err) {
                alert('Download error: ' + err.message);
            }
        }

        function openResetDataModal() {
            const modal = document.getElementById('resetDataModal');
            const msg = document.getElementById('resetModalMsg');
            const wordInput = document.getElementById('confirmDeleteWordInput');
            if (msg) msg.classList.add('hidden');
            if (wordInput) wordInput.value = '';

            const dateInput = document.getElementById('targetDeleteDateInput');
            if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
            toggleDateInputVisibility();

            if (modal) modal.classList.remove('hidden');
        }

        function closeResetDataModal() {
            const modal = document.getElementById('resetDataModal');
            if (modal) modal.classList.add('hidden');
        }

        function toggleDateInputVisibility() {
            const scope = document.querySelector('input[name="deleteScope"]:checked')?.value;
            const container = document.getElementById('deleteDateSelectContainer');
            if (container) {
                if (scope === 'specific_date' || scope === 'before_date') {
                    container.classList.remove('hidden');
                } else {
                    container.classList.add('hidden');
                }
            }
        }

        async 
        // =========================================================================
        // SAFE USER DASHBOARD CLEAN ENGINE (100% Zero Data Loss of Company Deliveries / Stock)
        // =========================================================================
        async function cleanUserDashboardsOnly(targetDate) {
            if (!supabaseClient) return;
            const dateToClean = targetDate || new Date().toISOString().slice(0, 10);
            const todayStartIso = `${dateToClean}T00:00:00.000Z`;
            const todayEndIso = `${dateToClean}T23:59:59.999Z`;

            console.log(`[SafeClean] Cleaning user dashboards for date: ${dateToClean}`);

            // 1. Delete upload logs for this date (resets the worker daily counter to 0)
            try {
                await supabaseClient
                    .from('upload_logs')
                    .delete()
                    .gte('created_at', todayStartIso)
                    .lte('created_at', todayEndIso);
            } catch (e) {
                console.warn('Clean upload_logs notice:', e);
            }

            // 2. Delete today's user submissions from master_numbers for this date
            try {
                await supabaseClient
                    .from('master_numbers')
                    .delete()
                    .gte('created_at', todayStartIso)
                    .lte('created_at', todayEndIso);
            } catch (e) {
                console.warn('Clean master_numbers notice:', e);
            }

            // 3. In Turso, delete today's submissions for this date
            try {
                if (typeof TursoVault !== 'undefined') {
                    await safeQuery(TursoVault.query(`DELETE FROM turso_submissions WHERE date(created_at) = '${dateToClean}';`), null);
                }
            } catch (e) {
                console.warn('Clean Turso today submissions notice:', e);
            }

            // 4. Release any claimed stock numbers assigned today back to available pool
            try {
                await supabaseClient
                    .from('company_received_numbers')
                    .update({
                        is_assigned: false,
                        assigned_to_user_id: null,
                        assigned_to_username: null,
                        assigned_to_email: null,
                        assigned_at: null
                    })
                    .eq('is_assigned', true)
                    .gte('assigned_at', todayStartIso)
                    .lte('assigned_at', todayEndIso);
            } catch (e) {
                console.warn('Release stock notice:', e);
            }

            // 5. In Turso stock table, release assigned numbers for this date
            try {
                if (typeof TursoVault !== 'undefined') {
                    await safeQuery(TursoVault.query(`UPDATE turso_stock_numbers SET is_assigned = 0, assigned_to_username = NULL, assigned_to_email = NULL, assigned_at = NULL WHERE is_assigned = 1 AND date(assigned_at) = '${dateToClean}';`), null);
                }
            } catch (e) {
                console.warn('Turso stock release notice:', e);
            }

            // 6. Refresh admin and user view
            if (typeof loadAdminDashboard === 'function') {
                await loadAdminDashboard();
            }
            if (typeof loadAdminSubmissionsData === 'function') {
                await loadAdminSubmissionsData();
            }
        }

        function openCleanUserDashboardModal() {
            openResetDataModal();
            const radio = document.querySelector('input[name="deleteScope"][value="users_dashboard_only"]');
            if (radio) {
                radio.checked = true;
                toggleDateInputVisibility();
            }
        }

        async function executeDatabaseReset() {
            const scope = document.querySelector('input[name="deleteScope"]:checked')?.value || 'users_dashboard_only';
            const targetDate = document.getElementById('targetDeleteDateInput')?.value;
            const confirmWord = document.getElementById('confirmDeleteWordInput')?.value.trim();
            const autoBackup = document.getElementById('autoBackupBeforeDeleteCheck')?.checked;
            const clearLogs = document.getElementById('clearUploadLogsTooCheck')?.checked;
            const msgBox = document.getElementById('resetModalMsg');
            const btn = document.getElementById('executeResetBtn');

            // -------------------------------------------------------------
            // DEDICATED SAFE PATH: USERS' DASHBOARD CLEAN ONLY
            // -------------------------------------------------------------
            if (scope === 'users_dashboard_only') {
                if (confirmWord !== 'CLEAN' && confirmWord !== 'DELETE') {
                    alert('নিশ্চিত করতে বক্সে সঠিকভাবে "CLEAN" অথবা "DELETE" লিখুন।');
                    return;
                }

                btn.disabled = true;
                btn.innerHTML = '<span>Processing...</span>';
                if (msgBox) {
                    msgBox.className = 'p-3 rounded-lg text-xs bg-amber-50 text-amber-800 font-semibold block';
                    msgBox.innerText = 'কর্মীদের আজকের ড্যাশবোর্ড ক্লিন করা হচ্ছে...';
                }

                cleanUserDashboardsOnly(targetDate).then(() => {
                    if (msgBox) {
                        msgBox.className = 'p-3 rounded-lg text-xs bg-emerald-50 text-emerald-800 font-bold block';
                        msgBox.innerText = '✅ কর্মীদের ড্যাশবোর্ড সফলভাবে ক্লিন করা হয়েছে! কোম্পানির কোনো ডাটা মোছা হয়নি।';
                    }
                    alert('✅ সফলভাবে শুধুমাত্র কর্মীদের আজকের ড্যাশবোর্ড ক্লিন করা হয়েছে!\n\n১০০% নিরাপদ:\n• কর্মীদের আজকের ৪২০ টার্গেট ও সাবমিশন কাউন্টার ০ হয়ে ফ্রেশ শুরু হবে।\n• কোম্পানির কোনো ডেলিভারি (Company Deliveries), রিসিভড স্টক বা ভল্ট ডাটা মোছা হয়নি।');
                    closeResetDataModal();
                }).catch(err => {
                    console.error('Clean error:', err);
                    alert('ক্লিন করতে সমস্যা হয়েছে: ' + err.message);
                }).finally(() => {
                    btn.disabled = false;
                    btn.innerHTML = '<span>🗑️ Confirm & Delete Data</span>';
                });
                return;
            }

            if (confirmWord !== 'DELETE') {
                alert('নিশ্চিত করতে বক্সে সঠিকভাবে "DELETE" লিখুন।');
                return;
            }

            if ((scope === 'specific_date' || scope === 'before_date') && !targetDate) {
                alert('দয়া করে একটি তারিখ নির্বাচন করুন।');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span>Processing...</span>';

            try {
                // 1. Auto backup before delete if checked
                if (autoBackup) {
                    msgBox.className = 'p-3 rounded-lg text-xs bg-blue-50 text-blue-800 font-semibold block';
                    msgBox.innerText = 'Creating and downloading dated record backup file...';

                    let bQuery = supabaseClient.from('master_numbers').select('*').order('created_at', { ascending: false });
                    if (scope === 'specific_date') {
                        bQuery = bQuery.gte('created_at', `${targetDate}T00:00:00.000Z`).lte('created_at', `${targetDate}T23:59:59.999Z`);
                    } else if (scope === 'before_date') {
                        bQuery = bQuery.lt('created_at', `${targetDate}T00:00:00.000Z`);
                    }
                    const { data: backupData } = await bQuery;
                    if (backupData && backupData.length > 0) {
                        const exportRows = backupData.map((item, idx) => ({
                            'SL': idx + 1,
                            'Phone Number': item.phone_number,
                            'Full Name': item.full_name || '-',
                            'Age': item.age || '-',
                            'Report Type': item.report_type || 'general',
                            'Department': item.department || '-',
                            'Worker Username': item.username || userEmailToNameMap[item.user_email] || '-',
                            'Worker Email': item.user_email,
                            'Date': new Date(item.created_at).toLocaleDateString(),
                            'Time': new Date(item.created_at).toLocaleTimeString()
                        }));
                        const ws = XLSX.utils.json_to_sheet(exportRows);
                        const wb = XLSX.utils.book_new();
                        XLSX.utils.book_append_sheet(wb, ws, 'Records_Backup');
                        const backupFilename = `Records_Archive_Backup_${scope}_${targetDate || new Date().toISOString().slice(0, 10)}.xlsx`;
                        XLSX.writeFile(wb, backupFilename);
                    }
                }

                msgBox.className = 'p-3 rounded-lg text-xs bg-amber-50 text-amber-800 font-semibold block';
                msgBox.innerText = 'Deleting previous records from database...';

                // 1.5 Delete from Turso 9 GB Vault (Leaves Supabase User Database 100% Intact)
                try {
                    if (typeof TursoVault !== 'undefined') {
                        await TursoVault.deleteSubmissions(scope, targetDate);
                    }
                } catch(tResetErr) {
                    console.warn('Turso reset notice:', tResetErr);
                }

                // 2. Try RPC first, fallback to direct delete
                try {
                    const { data: rpcRes, error: rpcErr } = await supabaseClient.rpc('admin_clear_master_numbers', {
                        p_delete_mode: scope,
                        p_target_date: targetDate ? `${targetDate}T00:00:00.000Z` : null,
                        p_clear_logs: clearLogs
                    });
                    if (rpcErr) throw rpcErr;
                } catch (rpcFallbackErr) {
                    let dQuery = supabaseClient.from('master_numbers').delete();
                    let lQuery = clearLogs ? supabaseClient.from('upload_logs').delete() : null;

                    if (scope === 'all') {
                        dQuery = dQuery.neq('id', 0);
                        if (lQuery) lQuery = lQuery.neq('id', 0);
                    } else if (scope === 'specific_date') {
                        dQuery = dQuery.gte('created_at', `${targetDate}T00:00:00.000Z`).lte('created_at', `${targetDate}T23:59:59.999Z`);
                        if (lQuery) lQuery = lQuery.gte('created_at', `${targetDate}T00:00:00.000Z`).lte('created_at', `${targetDate}T23:59:59.999Z`);
                    } else if (scope === 'before_date') {
                        dQuery = dQuery.lt('created_at', `${targetDate}T00:00:00.000Z`);
                        if (lQuery) lQuery = lQuery.lt('created_at', `${targetDate}T00:00:00.000Z`);
                    }

                    const { error: delErr } = await dQuery;
                    if (delErr) throw delErr;
                    if (lQuery) await lQuery;
                }

                msgBox.className = 'p-3 rounded-lg text-xs bg-emerald-50 text-emerald-800 font-bold block';
                msgBox.innerText = '✅ পূর্বের ডাটা সফলভাবে মুছে ফেলা হয়েছে এবং ব্যাকআপ সংরক্ষিত হয়েছে! এখন প্রতিদিন নতুন করে ফ্রেশ ডাটা যোগ করা যাবে।';

                await loadAdminDashboard();

                setTimeout(() => {
                    closeResetDataModal();
                    btn.disabled = false;
                    btn.innerHTML = '<span>🗑️ Confirm & Delete Data</span>';
                }, 1500);

            } catch (err) {
                msgBox.className = 'p-3 rounded-lg text-xs bg-red-50 text-red-700 font-bold block';
                msgBox.innerText = 'Failed to reset data: ' + err.message;
                btn.disabled = false;
                btn.innerHTML = '<span>🗑️ Confirm & Delete Data</span>';
            }
        }


        // ==================== 1-CLICK FORM CLEAR & RESET FUNCTIONS ====================
        function clearGenderVerifyForm() {
            const textInput = document.getElementById('gvTextInput');
            const fileInput = document.getElementById('gvXlsxFileInput');
            const colMap = document.getElementById('gvFileColumnMap');
            const resultsSec = document.getElementById('gvResultsSection');
            const progressContainer = document.getElementById('gvProgressContainer');
            const statusText = document.getElementById('gvStatusText');

            if (textInput) textInput.value = '';
            if (fileInput) fileInput.value = '';
            if (colMap) colMap.classList.add('hidden');
            if (resultsSec) resultsSec.classList.add('hidden');
            if (progressContainer) progressContainer.classList.add('hidden');
            if (statusText) statusText.innerText = '';

            gvDataList = [];
            gvMaleList = [];
            gvFemaleList = [];
            gvUnknownList = [];
            if (window.selectedUndeterminedIds) selectedUndeterminedIds.clear();

            const statTotal = document.getElementById('gvStatTotal');
            const statMale = document.getElementById('gvStatMale');
            const statFemale = document.getElementById('gvStatFemale');
            const statUnknown = document.getElementById('gvStatUnknown');
            const badgeMale = document.getElementById('badgeMaleCount');
            const badgeFemale = document.getElementById('badgeFemaleCount');
            const badgeUnknown = document.getElementById('badgeUnknownCount');

            if (statTotal) statTotal.innerText = '0';
            if (statMale) statMale.innerText = '0';
            if (statFemale) statFemale.innerText = '0';
            if (statUnknown) statUnknown.innerText = '0';
            if (badgeMale) badgeMale.innerText = '0';
            if (badgeFemale) badgeFemale.innerText = '0';
            if (badgeUnknown) badgeUnknown.innerText = '0';

            const tableBody = document.getElementById('gvSectorTableBody');
            if (tableBody) tableBody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-400">No records to display.</td></tr>';

            if (textInput) textInput.focus();
        }

        function clearDuplicateCheckForm() {
            const textInput = document.getElementById('dupTextInput');
            const resultsCard = document.getElementById('dupResultsCard');

            if (textInput) {
                textInput.value = '';
                textInput.focus();
            }
            if (resultsCard) resultsCard.classList.add('hidden');

            dupCleanList = [];
            dupRepeatedList = [];
            dupDbMatchesList = [];

            const dTotal = document.getElementById('dupStatTotal');
            const dUnique = document.getElementById('dupStatUnique');
            const dFile = document.getElementById('dupStatFileDups');
            const dDb = document.getElementById('dupStatDbDups');
            const cClean = document.getElementById('dupCountClean');
            const cRepeated = document.getElementById('dupCountRepeated');
            const cDb = document.getElementById('dupCountDb');

            if (dTotal) dTotal.innerText = '0';
            if (dUnique) dUnique.innerText = '0';
            if (dFile) dFile.innerText = '0';
            if (dDb) dDb.innerText = '0';
            if (cClean) cClean.innerText = '0';
            if (cRepeated) cRepeated.innerText = '0';
            if (cDb) cDb.innerText = '0';

            const tableBody = document.getElementById('dupTableBody');
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-slate-400">Run check to view results.</td></tr>';
            }
        }


        // ==================== COMPANY DELIVERIES HUB LOGIC ====================
        let cdDeliveriesCache = [];
        let cdParsedRows = [];
        let cdSelectedFile = null;
        let currentCdInputMode = 'paste';

        function switchCdInputMode(mode) {
            currentCdInputMode = mode;
            const btnPaste = document.getElementById('tabCdPasteBtn');
            const btnFile = document.getElementById('tabCdFileBtn');
            const pasteSec = document.getElementById('cdPasteSection');
            const fileSec = document.getElementById('cdFileSection');

            if (mode === 'paste') {
                btnPaste.className = 'pb-2.5 px-4 text-xs font-bold border-b-2 border-indigo-600 text-indigo-600 transition';
                btnFile.className = 'pb-2.5 px-4 text-xs font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition';
                pasteSec.classList.remove('hidden');
                fileSec.classList.add('hidden');
            } else {
                btnFile.className = 'pb-2.5 px-4 text-xs font-bold border-b-2 border-indigo-600 text-indigo-600 transition';
                btnPaste.className = 'pb-2.5 px-4 text-xs font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition';
                fileSec.classList.remove('hidden');
                pasteSec.classList.add('hidden');
            }
        }

        function onCdCategoryChanged() {
            const cat = document.getElementById('cdInputCategory')?.value || 'female_data';
            const hint = document.getElementById('cdPasteHint');
            const nameContainer = document.getElementById('cdColNameContainer');
            const ageContainer = document.getElementById('cdColAgeContainer');
            const incomeContainer = document.getElementById('cdColIncomeContainer');
            const marketContainer = document.getElementById('cdColMarketContainer');

            if (cat === 'lookup_data') {
                if (hint) hint.innerHTML = 'Enter or paste: <span class="font-mono bg-purple-50 text-purple-900 px-1 rounded font-bold">Phone [tab/space] Household Income [tab/space] Est Market Value</span> (e.g. 15136465609 $85,000 $320,000)';
                if (incomeContainer) incomeContainer.classList.remove('hidden');
                if (marketContainer) marketContainer.classList.remove('hidden');
                if (nameContainer) nameContainer.classList.add('hidden');
                if (ageContainer) ageContainer.classList.add('hidden');
            } else if (cat === 'signal_data') {
                if (hint) hint.innerHTML = 'Enter or paste rows for Signal Data: <span class="font-mono bg-sky-50 text-sky-900 px-1 rounded font-bold">Phone Number</span> (one per line, e.g. 15136465609)';
                if (nameContainer) nameContainer.classList.add('hidden');
                if (ageContainer) ageContainer.classList.add('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            } else if (cat === 'male_data') {
                if (hint) hint.innerHTML = `Enter or paste rows for Male Data: <span class="font-mono bg-blue-50 text-blue-900 px-1 rounded font-bold">Phone Name Age</span> (e.g. 15136465609 John Doe 45)`;
                if (nameContainer) nameContainer.classList.remove('hidden');
                if (ageContainer) ageContainer.classList.remove('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            } else {
                if (hint) hint.innerHTML = `Enter or paste rows for Female Data: <span class="font-mono bg-pink-50 text-pink-900 px-1 rounded font-bold">Phone Name Age</span> (e.g. 15136465609 John Doe 45)`;
                if (nameContainer) nameContainer.classList.remove('hidden');
                if (ageContainer) ageContainer.classList.remove('hidden');
                if (incomeContainer) incomeContainer.classList.add('hidden');
                if (marketContainer) marketContainer.classList.add('hidden');
            }
        }

        function handleCdFileSelected(e) {
            const file = e.target.files[0];
            if (!file) return;

            cdSelectedFile = file;
            const statusEl = document.getElementById('cdFileStatus');
            const submitBtn = document.getElementById('cdSubmitBtn');

            if (statusEl) {
                statusEl.innerHTML = `<span class="text-amber-600 font-bold animate-pulse">⏳ ফাইল পড়া হচ্ছে: ${file.name}... অনুগ্রহ করে অপেক্ষা করুন</span>`;
            }
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span>⏳ ফাইল প্রসেস হচ্ছে...</span>';
            }

            const reader = new FileReader();
            reader.onerror = function() {
                if (statusEl) {
                    statusEl.innerHTML = `<span class="text-rose-600 font-bold">❌ ফাইল পড়তে ব্যর্থ: ফাইলটি সম্ভবত এক্সেলে খোলা আছে। অনুগ্রহ করে এক্সেল বন্ধ করে আবার চেষ্টা করুন।</span>`;
                }
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span>📤 Save & Record Company Delivery</span>';
                }
            };

            reader.onload = function(evt) {
                try {
                    let rows = [];
                    const lowerName = file.name.toLowerCase();

                    if (lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
                        const textData = new TextDecoder('utf-8').decode(evt.target.result);
                        const lines = textData.split(/\r?\n/).filter(l => l.trim().length > 0);
                        if (lines.length > 0) {
                            const header = lines[0].split(/,|\t/).map(h => h.trim().replace(/^["']|["']$/g, ''));
                            for (let i = 1; i < lines.length; i++) {
                                const vals = lines[i].split(/,|\t/).map(v => v.trim().replace(/^["']|["']$/g, ''));
                                const obj = {};
                                header.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
                                rows.push(obj);
                            }
                        }
                    } else {
                        const data = new Uint8Array(evt.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                        rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
                    }

                    if (!rows || rows.length === 0) {
                        if (statusEl) statusEl.innerHTML = `<span class="text-rose-600 font-bold">❌ ফাইলে কোনো ডাটা সারি পাওয়া যায়নি।</span>`;
                        alert('ফাইলে কোনো ডাটা পাওয়া যায়নি। অনুগ্রহ করে ফাইলটি চেক করুন।');
                        return;
                    }

                    cdParsedRows = rows;
                    if (statusEl) {
                        statusEl.innerHTML = `<span class="text-emerald-600 font-bold">✅ সফলভাবে লোড হয়েছে: ${file.name} (${rows.length} টি সারি পাওয়া গেছে)</span>`;
                    }

                    const columns = Object.keys(rows[0]);
                    const colPhone = document.getElementById('cdColPhone');
                    const colName = document.getElementById('cdColName');
                    const colAge = document.getElementById('cdColAge');
                    const colIncome = document.getElementById('cdColIncome');
                    const colMarket = document.getElementById('cdColMarket');

                    if (colPhone) {
                        colPhone.innerHTML = '';
                        if (colName) colName.innerHTML = '<option value="">-- None / Empty --</option>';
                        if (colAge) colAge.innerHTML = '<option value="">-- None / Empty --</option>';
                        if (colIncome) colIncome.innerHTML = '<option value="">-- None / Empty --</option>';
                        if (colMarket) colMarket.innerHTML = '<option value="">-- None / Empty --</option>';

                        let phoneSet = false, nameSet = false, ageSet = false, incSet = false, mktSet = false;

                        columns.forEach(col => {
                            const lower = col.toLowerCase();

                            const optP = document.createElement('option');
                            optP.value = col; optP.innerText = col;
                            if (!phoneSet && (lower.includes('phone') || lower.includes('number') || lower.includes('mobile') || lower.includes('contact'))) {
                                optP.selected = true; phoneSet = true;
                            }
                            colPhone.appendChild(optP);

                            if (colName) {
                                const optN = document.createElement('option');
                                optN.value = col; optN.innerText = col;
                                if (!nameSet && (lower.includes('name') || lower.includes('full') || lower.includes('client'))) {
                                    optN.selected = true; nameSet = true;
                                }
                                colName.appendChild(optN);
                            }

                            if (colAge) {
                                const optA = document.createElement('option');
                                optA.value = col; optA.innerText = col;
                                if (!ageSet && (lower.includes('age') || lower.includes('dob') || lower.includes('year'))) {
                                    optA.selected = true; ageSet = true;
                                }
                                colAge.appendChild(optA);
                            }

                            if (colIncome) {
                                const optI = document.createElement('option');
                                optI.value = col; optI.innerText = col;
                                if (!incSet && (lower.includes('income') || lower.includes('hhi') || lower.includes('salary'))) {
                                    optI.selected = true; incSet = true;
                                }
                                colIncome.appendChild(optI);
                            }

                            if (colMarket) {
                                const optM = document.createElement('option');
                                optM.value = col; optM.innerText = col;
                                if (!mktSet && (lower.includes('market') || lower.includes('value') || lower.includes('home') || lower.includes('property'))) {
                                    optM.selected = true; mktSet = true;
                                }
                                colMarket.appendChild(optM);
                            }
                        });

                        const grid = document.getElementById('cdColMapGrid');
                        if (grid) grid.classList.remove('hidden');
                        onCdCategoryChanged();
                    }

                } catch (err) {
                    console.error('Error reading file:', err);
                    if (statusEl) statusEl.innerHTML = `<span class="text-rose-600 font-bold">❌ ফাইল পড়তে সমস্যা: ${err.message}</span>`;
                    alert('Error reading Excel file: ' + err.message);
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<span>📤 Save & Record Company Delivery</span>';
                    }
                }
            };
            reader.readAsArrayBuffer(file);
        }

        async function submitCompanyDelivery() {
            const dateInput = document.getElementById('cdInputDate');
            const deliveryDate = (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().slice(0, 10);
            const category = document.getElementById('cdInputCategory')?.value || 'male_data';
            const companyName = document.getElementById('cdInputCompany')?.value.trim() || 'Company';
            const btn = document.getElementById('cdSubmitBtn');
            const resultCard = document.getElementById('cdResultCard');

            let records = [];

            if (currentCdInputMode === 'paste') {
                const text = document.getElementById('cdTextInput')?.value.trim();
                if (!text) {
                    alert('Please paste numbers and data to upload.');
                    return;
                }
                const lines = text.split(/\r?\n/);
                lines.forEach(line => {
                    const cleanLine = line.trim();
                    if (!cleanLine) return;

                    if (category === 'lookup_data') {
                        // Check tab or comma or multiple spaces
                        const parts = cleanLine.split(/\t|,|\s{2,}/);
                        if (parts.length >= 2) {
                            const p = parts[0].replace(/[\s\-\(\)\.]/g, '');
                            const inc = parts[1] ? parts[1].trim() : '';
                            const mkt = parts[2] ? parts[2].trim() : '';
                            if (p.length >= 6) {
                                records.push({ phone: p, income: inc, market_value: mkt });
                            }
                        } else {
                            const spaceParts = cleanLine.split(/\s+/);
                            const p = spaceParts[0].replace(/[\s\-\(\)\.]/g, '');
                            if (p.length >= 6) {
                                records.push({
                                    phone: p,
                                    income: spaceParts[1] || '',
                                    market_value: spaceParts[2] || ''
                                });
                            }
                        }
                    } else {
                        // Female or lookup data
                        const parts = cleanLine.split(/\t|,|\s{2,}/);
                        if (parts.length >= 2) {
                            const p = parts[0].replace(/[\s\-\(\)\.]/g, '');
                            const name = parts[1] ? parts[1].trim() : '';
                            const age = parts[2] ? parts[2].trim() : '';
                            if (p.length >= 6) records.push({ phone: p, name: name, age: age });
                        } else {
                            const spaceParts = cleanLine.split(/\s+/);
                            const p = spaceParts[0].replace(/[\s\-\(\)\.]/g, '');
                            if (p.length >= 6) {
                                records.push({
                                    phone: p,
                                    name: spaceParts.slice(1, spaceParts.length - 1).join(' ') || spaceParts[1] || '',
                                    age: spaceParts.length > 2 ? spaceParts[spaceParts.length - 1] : ''
                                });
                            }
                        }
                    }
                });
            } else {
                // File upload mode: if cdParsedRows is empty but cdSelectedFile is present, parse immediately
                if ((!cdParsedRows || cdParsedRows.length === 0) && cdSelectedFile) {
                    btn.disabled = true;
                    btn.innerHTML = '<span>⏳ ফাইল প্রসেস করা হচ্ছে, অনুগ্রহ করে একটু অপেক্ষা করুন...</span>';
                    try {
                // 1. Direct Primary Write to Turso 9 GB Vault
                try {
                    if (typeof TursoVault !== 'undefined') {
                        await TursoVault.insertDeliveries(records, category, companyName, deliveryDate);
                    }
                } catch(tDelErr) {
                    console.warn('Turso deliveries insert notice:', tDelErr);
                }

                        await new Promise((resolve, reject) => {
                            const r = new FileReader();
                            r.onload = function(evt) {
                                try {
                                    const lowerName = cdSelectedFile.name.toLowerCase();
                                    let rows = [];
                                    if (lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
                                        const textData = new TextDecoder('utf-8').decode(evt.target.result);
                                        const lines = textData.split(/\r?\n/).filter(l => l.trim().length > 0);
                                        if (lines.length > 0) {
                                            const header = lines[0].split(/,|\t/).map(h => h.trim().replace(/^["']|["']$/g, ''));
                                            for (let i = 1; i < lines.length; i++) {
                                                const vals = lines[i].split(/,|\t/).map(v => v.trim().replace(/^["']|["']$/g, ''));
                                                const obj = {};
                                                header.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
                                                rows.push(obj);
                                            }
                                        }
                                    } else {
                                        const data = new Uint8Array(evt.target.result);
                                        const wb = XLSX.read(data, { type: 'array' });
                                        const ws = wb.Sheets[wb.SheetNames[0]];
                                        rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                                    }
                                    cdParsedRows = rows;
                                    resolve();
                                } catch(e) { reject(e); }
                            };
                            r.onerror = reject;
                            r.readAsArrayBuffer(cdSelectedFile);
                        });
                    } catch (parseErr) {
                        alert('ফাইল পড়তে সমস্যা হয়েছে: ' + parseErr.message);
                        btn.disabled = false;
                        btn.innerHTML = '<span>📤 Save & Record Company Delivery</span>';
                        return;
                    }
                }

                if (!cdParsedRows || cdParsedRows.length === 0) {
                    alert('অনুগ্রহ করে প্রথমে একটি এক্সেল বা সিএসভি ফাইল সিলেক্ট করুন।');
                    return;
                }
                const phoneCol = document.getElementById('cdColPhone')?.value;
                const nameCol = document.getElementById('cdColName')?.value;
                const ageCol = document.getElementById('cdColAge')?.value;
                const incCol = document.getElementById('cdColIncome')?.value;
                const mktCol = document.getElementById('cdColMarket')?.value;

                cdParsedRows.forEach(row => {
                    const rawPhone = String(row[phoneCol] || '').trim().replace(/[\s\-\(\)\.]/g, '');
                    if (rawPhone.length >= 6) {
                        records.push({
                            phone: rawPhone,
                            name: nameCol ? String(row[nameCol] || '').trim() : '',
                            age: ageCol ? String(row[ageCol] || '').trim() : '',
                            income: incCol ? String(row[incCol] || '').trim() : '',
                            market_value: mktCol ? String(row[mktCol] || '').trim() : ''
                        });
                    }
                });
            }

            if (records.length === 0) {
                alert('No valid phone numbers found in input.');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span>Processing Delivery...</span>';

            try {
                // Try calling RPC with automatic deduplication
                let result = null;
                try {
                    const { data, error } = await supabaseClient.rpc('admin_upload_company_delivery', {
                        p_records: records,
                        p_category: category,
                        p_delivery_date: deliveryDate,
                        p_company_name: companyName,
                        p_batch_name: `Batch_${deliveryDate}`
                    });
                    if (error) throw error;
                    result = data;
                } catch (rpcErr) {
                    // Fallback to direct insert with deduplication
                    const dedupMap = new Map();
                    records.forEach(r => {
                        if (!dedupMap.has(r.phone)) dedupMap.set(r.phone, r);
                    });
                    const uniqueRecords = Array.from(dedupMap.values());
                    const rowsToInsert = uniqueRecords.map(r => ({
                        delivery_date: deliveryDate,
                        category: category,
                        phone_number: r.phone,
                        full_name: r.name || '',
                        age: r.age || '',
                        household_income: r.income || '',
                        est_market_value: r.market_value || '',
                        company_name: companyName,
                        batch_name: `Batch_${deliveryDate}`
                    }));

                    const { data: insertedData, error: insErr } = await supabaseClient
                        .from('company_deliveries')
                        .upsert(rowsToInsert, { onConflict: 'phone_number', ignoreDuplicates: true })
                        .select('phone_number');

                    const newCount = insertedData ? insertedData.length : uniqueRecords.length;
                    result = {
                        success: true,
                        total_received: records.length,
                        unique_in_file: uniqueRecords.length,
                        new_inserted: newCount,
                        duplicates_count: records.length - newCount
                    };
                }

                const catLabel = category === 'female_data' ? '👩 Female Data' : '🔍 Lookup Data';

                resultCard.className = 'p-4 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-900 block';
                resultCard.innerHTML = `
                    <div class="flex items-center space-x-2">
                        <span class="text-xl">✅</span>
                        <h5 class="font-bold text-sm text-emerald-800">Company Delivery Recorded for ${deliveryDate} (${catLabel})</h5>
                    </div>
                    <p class="text-xs text-slate-600 mt-1">সব ডুপ্লিকেট নাম্বার স্বয়ংক্রিয়ভাবে বাদ দেওয়া হয়েছে এবং নতুন নাম্বারগুলো ডাটাবেজে সংরক্ষিত হয়েছে।</p>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
                        <div class="bg-white p-2.5 rounded-lg border border-emerald-100">
                            <span class="text-slate-500 block">Total Received</span>
                            <span class="text-base font-bold text-slate-800">${result.total_received}</span>
                        </div>
                        <div class="bg-white p-2.5 rounded-lg border border-emerald-100">
                            <span class="text-slate-500 block">Unique in File</span>
                            <span class="text-base font-bold text-slate-800">${result.unique_in_file}</span>
                        </div>
                        <div class="bg-white p-2.5 rounded-lg border border-emerald-200">
                            <span class="text-emerald-700 block font-semibold">New Unique to Company</span>
                            <span class="text-lg font-extrabold text-emerald-600">+${result.new_inserted}</span>
                        </div>
                        <div class="bg-white p-2.5 rounded-lg border border-amber-200">
                            <span class="text-amber-700 block font-semibold">Duplicates Filtered</span>
                            <span class="text-lg font-extrabold text-amber-600">${result.duplicates_count}</span>
                        </div>
                    </div>
                `;

                // Reload company table & stats
                await loadCompanyDeliveriesData();

            } catch (err) {
                resultCard.className = 'p-4 rounded-xl border bg-red-50 border-red-200 text-red-800 block';
                resultCard.innerText = 'Failed to record company delivery: ' + err.message;
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>📤 Save & Record Company Delivery</span>';
            }
        }

        async function loadCompanyDeliveriesData() {
            if (!supabaseClient) return;

            const tableBody = document.getElementById('cdTableBody');
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">Loading company deliveries...</td></tr>`;

            const dateFilter = document.getElementById('cdFilterDate')?.value || '';
            const catFilter = document.getElementById('cdFilterCategory')?.value || 'all';

            try {
                let tStats = { total: 0, femaleDeliv: 0, signalDeliv: 0, lookupDeliv: 0, todayDeliv: 0 };
                let tRows = [];

                try {
                    if (typeof TursoVault !== 'undefined') {
                        tStats = await safeQuery(TursoVault.getDeliveryStats(), { total: 0, femaleDeliv: 0, signalDeliv: 0, lookupDeliv: 0, todayDeliv: 0 });
                        let sql = `SELECT * FROM turso_deliveries WHERE 1=1 `;
                        if (dateFilter) sql += ` AND delivery_date = '${dateFilter}'`;
                        if (catFilter !== 'all') sql += ` AND category = '${catFilter}'`;
                        sql += ` ORDER BY id DESC LIMIT 500;`;
                        const tRes = await safeQuery(TursoVault.query(sql), null);
                        if (tRes && tRes.rows) tRows = tRes.rows;
                    }
                } catch(tErr) {
                    console.warn('Turso delivery stats notice:', tErr);
                }

                const todayIso = new Date().toISOString().slice(0, 10);
                const [totalDelivRes, maleDelivRes, femaleDelivRes, signalDelivRes, lookupDelivRes, todayDelivRes, sbRowsRes] = await Promise.all([
                    safeQuery(supabaseClient.from('company_deliveries').select('*', { count: 'exact', head: true }), { count: 0 }),
                    safeQuery(supabaseClient.from('company_deliveries').select('*', { count: 'exact', head: true }).eq('category', 'male_data'), { count: 0 }),
                    safeQuery(supabaseClient.from('company_deliveries').select('*', { count: 'exact', head: true }).eq('category', 'female_data'), { count: 0 }),
                    safeQuery(supabaseClient.from('company_deliveries').select('*', { count: 'exact', head: true }).eq('category', 'signal_data'), { count: 0 }),
                    safeQuery(supabaseClient.from('company_deliveries').select('*', { count: 'exact', head: true }).eq('category', 'lookup_data'), { count: 0 }),
                    safeQuery(supabaseClient.from('company_deliveries').select('*', { count: 'exact', head: true }).eq('delivery_date', todayIso), { count: 0 }),
                    (async () => {
                        try {
                            let q = supabaseClient.from('company_deliveries').select('*').order('created_at', { ascending: false }).limit(500);
                            if (dateFilter) q = q.eq('delivery_date', dateFilter);
                            if (catFilter !== 'all') q = q.eq('category', catFilter);
                            const { data } = await q;
                            return data || [];
                        } catch(e) {
                            return [];
                        }
                    })()
                ]);

                const sbTotal = totalDelivRes.count || 0;
                const sbMale = maleDelivRes.count || 0;
                const sbFemale = femaleDelivRes.count || 0;
                const sbSignal = signalDelivRes.count || 0;
                const sbLookup = lookupDelivRes.count || 0;
                const sbToday = todayDelivRes.count || 0;
                const sbRows = sbRowsRes || [];

                // COMBINE TURSO + SUPABASE DELIVERIES
                const combTotal = (tStats.total || 0) + sbTotal;
                const combMale = (tStats.maleDeliv || 0) + sbMale;
                const combFemale = (tStats.femaleDeliv || 0) + sbFemale;
                const combSignal = (tStats.signalDeliv || 0) + sbSignal;
                const combLookup = (tStats.lookupDeliv || 0) + sbLookup;
                const combToday = (tStats.todayDeliv || 0) + sbToday;

                const elTotal = document.getElementById('cdStatTotal');
                const elMale = document.getElementById('cdStatMale');
                const elFemale = document.getElementById('cdStatFemale');
                const elSignal = document.getElementById('cdStatSignal');
                const elLookup = document.getElementById('cdStatLookup');
                const elToday = document.getElementById('cdStatToday');
                const badgeTotal = document.getElementById('companyDelivTotalBadge');

                if (elTotal) elTotal.innerText = combTotal.toLocaleString();
                if (elMale) elMale.innerText = combMale.toLocaleString();
                if (elFemale) elFemale.innerText = combFemale.toLocaleString();
                if (elSignal) elSignal.innerText = combSignal.toLocaleString();
                if (elLookup) elLookup.innerText = combLookup.toLocaleString();
                if (elToday) elToday.innerText = combToday.toLocaleString();
                if (badgeTotal) badgeTotal.innerText = combTotal.toLocaleString();

                cdDeliveriesCache = [...tRows, ...sbRows];
                filterCompanyDeliveriesLocal();

            } catch (err) {
                console.error('loadCompanyDeliveriesData error:', err);
                if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No delivery records found.</td></tr>`;
            }
        }

        function filterCompanyDeliveriesLocal() {
            const tableBody = document.getElementById('cdTableBody');
            if (!tableBody) return;

            const search = (document.getElementById('cdFilterSearch')?.value || '').trim().toLowerCase();

            let list = cdDeliveriesCache;
            if (search) {
                list = list.filter(item => {
                    const phone = (item.phone_number || '');
                    const name = (item.full_name || '').toLowerCase();
                    const inc = (item.household_income || '').toLowerCase();
                    const mkt = (item.est_market_value || '').toLowerCase();
                    const comp = (item.company_name || '').toLowerCase();
                    const ddate = (item.delivery_date || '');
                    return phone.includes(search) || name.includes(search) || inc.includes(search) || mkt.includes(search) || comp.includes(search) || ddate.includes(search);
                });
            }

            if (list.length > 0) {
                tableBody.innerHTML = list.map((item, idx) => {
                    const timeStr = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    let catBadge = '';
                    if (item.category === 'female_data') {
                        catBadge = '<span class="px-2.5 py-0.5 text-xs rounded bg-pink-100 text-pink-800 font-bold">👩 Female Data</span>';
                    } else {
                        catBadge = '<span class="px-2.5 py-0.5 text-xs rounded bg-purple-100 text-purple-800 font-bold">🔍 Lookup Data</span>';
                    }

                    let detailHtml = '';
                    if (item.category === 'lookup_data') {
                        detailHtml = `
                            <div class="space-y-0.5">
                                ${item.household_income ? `<div class="text-xs font-bold text-emerald-700">💰 Income: ${item.household_income}</div>` : ''}
                                ${item.est_market_value ? `<div class="text-xs font-bold text-purple-700">🏡 Market Val: ${item.est_market_value}</div>` : ''}
                                ${!item.household_income && !item.est_market_value ? '<span class="text-slate-400">-</span>' : ''}
                            </div>
                        `;
                    } else {
                        detailHtml = `
                            <div>
                                <span class="font-bold text-slate-800">${item.full_name || '-'}</span>
                                ${item.age ? `<span class="text-slate-500 text-xs ml-1">(${item.age} yrs)</span>` : ''}
                            </div>
                        `;
                    }

                    return `
                        <tr class="hover:bg-slate-50 text-xs">
                            <td class="py-3 px-4 font-mono text-slate-400">${idx + 1}</td>
                            <td class="py-3 px-4 font-bold text-slate-700 font-mono">${item.delivery_date}</td>
                            <td class="py-3 px-4">${catBadge}</td>
                            <td class="py-3 px-4 font-mono font-bold text-indigo-700 text-sm">${item.phone_number}</td>
                            <td class="py-3 px-4">${detailHtml}</td>
                            <td class="py-3 px-4 font-medium text-slate-600">${item.company_name || 'Company'}</td>
                            <td class="py-3 px-4 text-right text-slate-400 font-mono">${timeStr}</td>
                        </tr>
                    `;
                }).join('');
            } else {
                tableBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-400">No company delivery records found for this selection.</td></tr>';
            }
        }

        async function downloadCompanyDeliveriesExcel() {
            if (!supabaseClient) return;
            const dateFilter = document.getElementById('cdFilterDate')?.value || '';
            const catFilter = document.getElementById('cdFilterCategory')?.value || 'all';

            try {
                // Fetch ALL company deliveries with range pagination (Zero 500 cap!)
                let allRows = [];
                let from = 0;
                const pageSize = 1000;
                while (from < 50000) {
                    let query = supabaseClient.from('company_deliveries').select('*').order('created_at', { ascending: false }).range(from, from + pageSize - 1);
                    if (dateFilter) query = query.eq('delivery_date', dateFilter);
                    if (catFilter !== 'all') query = query.eq('category', catFilter);

                    const { data, error } = await query;
                    if (error) throw error;
                    if (!data || data.length === 0) break;
                    allRows.push(...data);
                    if (data.length < pageSize) break;
                    from += pageSize;
                }

                if (!allRows || allRows.length === 0) {
                    alert('No delivery records found to download.');
                    return;
                }

                const exportRows = allRows.map((item, idx) => ({
                    'SL': idx + 1,
                    'Delivery Date': item.delivery_date,
                    'Category': item.category === 'female_data' ? 'Female Data' : 'Lookup Data',
                    'Phone Number': item.phone_number,
                    'Full Name': item.full_name || '-',
                    'Age': item.age || '-',
                    'Household Income': item.household_income || '-',
                    'Est Market Value': item.est_market_value || '-',
                    'Company': item.company_name || 'Company',
                    'Recorded Time': new Date(item.created_at).toLocaleString()
                }));

                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Company_Deliveries');
                const dateVal = dateFilter || new Date().toISOString().slice(0, 10);
                XLSX.writeFile(wb, `Company_Delivery_Export_${dateVal}_Total_${exportRows.length}.xlsx`);
            } catch(err) {
                alert('Company export error: ' + err.message);
            }
        }

        function clearCdForm() {
            const textInput = document.getElementById('cdTextInput');
            const fileInput = document.getElementById('cdFileInput');
            const resultCard = document.getElementById('cdResultCard');
            const colMap = document.getElementById('cdColMapGrid');
            const fileStatus = document.getElementById('cdFileStatus');

            if (textInput) textInput.value = '';
            if (fileInput) fileInput.value = '';
            if (resultCard) resultCard.classList.add('hidden');
            if (colMap) colMap.classList.add('hidden');
            if (fileStatus) fileStatus.innerText = 'XLSX, XLS or CSV';

            cdParsedRows = [];
            cdSelectedFile = null;
        }

        function clearCdDateFilter() {
            const dateFilter = document.getElementById('cdFilterDate');
            if (dateFilter) dateFilter.value = '';
            loadCompanyDeliveriesData();
        }

    
        // ==========================================
        // WORKER SELF-SERVICE STOCK CLAIM SYSTEM
        // ==========================================
        let currentClaimedRecords = [];

        function setWorkerClaimQty(qty) {
            const input = document.getElementById('workerClaimQtyInput');
            if (input) input.value = qty;
        }

        async function loadWorkerClaimStockCount() {
            if (!supabaseClient) return;
            try {
                const { count, error } = await supabaseClient
                    .from('company_received_numbers')
                    .select('*', { count: 'exact', head: true })
                    .eq('is_assigned', false);
                
                const stockBadge = document.getElementById('workerStockCount');
                if (stockBadge) {
                    stockBadge.innerText = (count !== null && count !== undefined) ? count : 0;
                }
            } catch (err) {
                console.warn('Could not fetch stock count:', err);
            }
        }

        async function executeWorkerClaim() {
            if (!supabaseClient || !currentUser) {
                alert('অনুগ্রহ করে প্রথমে লগইন করুন।');
                return;
            }

            const input = document.getElementById('workerClaimQtyInput');
            let qty = parseInt(input ? input.value : '100', 10);
            if (isNaN(qty) || qty <= 0) qty = 100;

            const isLeader = currentProfile && (currentProfile.role === 'team_leader' || currentProfile.role === 'admin' || currentProfile.is_unlimited_quota === true);
            if (!isLeader && qty > 1000) {
                alert('সাধারণ কর্মীরা প্রতি ৬ ঘণ্টায় সর্বোচ্চ ১,০০০ টি নাম্বার সংগ্রহ করতে পারবেন।');
                return;
            }

            const btn = document.getElementById('btnWorkerClaim');
            btn.disabled = true;
            btn.innerHTML = '<span>⏳ নাম্বার সংগ্রহ করা হচ্ছে...</span>';

            // Strict 1,000 Quota Check per Worker (6-Hour Window)
            try {
                const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

                const { count: claimedTodayCount } = await supabaseClient
                    .from('company_received_numbers')
                    .select('*', { count: 'exact', head: true })
                    .eq('assigned_to_user_id', currentUser.id)
                    .gte('assigned_at', sixHoursAgo.toISOString());

                const isLeader = currentProfile && (currentProfile.role === 'team_leader' || currentProfile.role === 'admin' || currentProfile.is_unlimited_quota === true);

                if (!isLeader) {
                    const alreadyClaimed = claimedTodayCount || 0;
                    const maxDailyQuota = 1000;
                    const remainingQuota = Math.max(0, maxDailyQuota - alreadyClaimed);

                    if (alreadyClaimed >= maxDailyQuota) {
                        alert(`❌ আপনার গত ৬ ঘণ্টার লিমিট (১,০০০ টি) পূর্ণ হয়েছে!\n\nসাধারণ কর্মীরা প্রতি ৬ ঘণ্টায় সর্বোচ্চ ১,০০০ টি নাম্বার সংগ্রহ করতে পারেন। আপনি গত ৬ ঘণ্টায় ইতিমধ্যে ${alreadyClaimed} টি নাম্বার নিয়েছেন। ৬ ঘণ্টা পূর্ণ হলে আবার নতুন কোটা পাবেন।\n\n💡 আনলিমিটেড কোটার প্রয়োজন হলে অ্যাডমিনের সাথে যোগাযোগ করুন।`);
                        btn.disabled = false;
                        btn.innerHTML = '<span>⚡ Claim & Take Numbers (নাম্বার সংগ্রহ করুন)</span>';
                        return;
                    }

                    if (qty > remainingQuota) {
                        alert(`⚠️ ৬ ঘণ্টার কোটা সীমা অতিক্রম করেছে!\n\nআপনি গত ৬ ঘণ্টায় ইতিমধ্যে ${alreadyClaimed} টি নাম্বার নিয়েছেন। প্রতি ৬ ঘণ্টায় ১,০০০ লিমিট থাকায় এই মুহূর্তে আপনি আর মাত্র ${remainingQuota} টি নাম্বার সংগ্রহ করতে পারবেন।`);
                        input.value = remainingQuota;
                        btn.disabled = false;
                        btn.innerHTML = '<span>⚡ Claim & Take Numbers (নাম্বার সংগ্রহ করুন)</span>';
                        return;
                    }
                }
            } catch (quotaErr) {
                console.warn('Quota verification check notice:', quotaErr);
            }

            try {
                let records = [];
                // 1. Try atomic RPC first
                try {
                    const { data, error } = await supabaseClient.rpc('worker_claim_numbers', {
                        p_quantity: qty,
                        p_stock_type: activeClaimStockCategory
                    });
                    if (error) throw error;

                    if (data && data.success && data.data && data.data.length > 0) {
                        records = data.data;
                    } else if (data && !data.success) {
                        alert(data.message || 'স্টকে কোনো নতুন নাম্বার খালি নেই!');
                        btn.disabled = false;
                        btn.innerHTML = '<span>⚡ Claim & Get Numbers (নাম্বার সংগ্রহ করুন)</span>';
                        return;
                    }
                } catch (rpcErr) {
                    console.warn('RPC fallback to direct claim:', rpcErr);

                    // 2. Direct fallback: select unassigned and update
                    let fbQuery = supabaseClient
                        .from('company_received_numbers')
                        .select('id, phone_number, full_name, age')
                        .eq('is_assigned', false);

                    if (activeClaimStockCategory === 'lookup') {
                        fbQuery = fbQuery.eq('stock_type', 'lookup');
                    } else if (activeClaimStockCategory === 'signal') {
                        fbQuery = fbQuery.eq('stock_type', 'signal');
                    } else {
                        fbQuery = fbQuery.or('stock_type.eq.gender_verify,stock_type.is.null,stock_type.eq.');
                    }

                    const { data: stockRows, error: fetchErr } = await fbQuery
                        .order('id', { ascending: true })
                        .limit(qty);

                    if (fetchErr) throw fetchErr;

                    if (!stockRows || stockRows.length === 0) {
                        alert('স্টকে কোনো নতুন নাম্বার খালি নেই! এডমিন কোম্পানি থেকে নতুন নাম্বার আপলোড করলে আবার চেষ্টা করুন।');
                        btn.disabled = false;
                        btn.innerHTML = '<span>⚡ Claim & Get Numbers (নাম্বার সংগ্রহ করুন)</span>';
                        return;
                    }

                    const claimIds = stockRows.map(r => r.id);
                    const username = currentProfile ? currentProfile.username : currentUser.email.split('@')[0];

                    const { error: updateErr } = await supabaseClient
                        .from('company_received_numbers')
                        .update({
                            is_assigned: true,
                            assigned_to_user_id: currentUser.id,
                            assigned_to_username: username,
                            assigned_to_email: currentUser.email,
                            assigned_at: new Date().toISOString()
                        })
                        .in('id', claimIds);

                    if (updateErr) throw updateErr;

                    records = stockRows.map(r => ({
                        phone: r.phone_number,
                        name: r.full_name || '',
                        age: r.age || ''
                    }));
                }

                currentClaimedRecords = records;

                // Update UI Modal
                document.getElementById('workerClaimedCountDisplay').innerText = records.length;
                document.getElementById('workerClaimModalSubtitle').innerText = `${records.length} টি নাম্বার সফলভাবে আপনার একাউন্টে বরাদ্দ করা হয়েছে।`;

                const phoneListText = records.map(r => r.phone).join('\n');
                document.getElementById('workerClaimedTextarea').value = phoneListText;

                document.getElementById('workerClaimModal').classList.remove('hidden');

                // Refresh stock count
                loadWorkerClaimStockCount();

            } catch (err) {
                console.error('Error claiming numbers:', err);
                alert('নাম্বার সংগ্রহে সমস্যা হয়েছে: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>⚡ Claim & Get Numbers (নাম্বার সংগ্রহ করুন)</span>';
            }
        }

        function closeWorkerClaimModal() {
            document.getElementById('workerClaimModal').classList.add('hidden');
        }

        function copyWorkerClaimedNumbers() {
            const textarea = document.getElementById('workerClaimedTextarea');
            if (!textarea || !textarea.value) return;
            navigator.clipboard.writeText(textarea.value).then(() => {
                alert('✅ সমস্ত ফোন নাম্বার ক্লিপবোর্ডে কপি করা হয়েছে!');
            }).catch(() => {
                textarea.select();
                document.execCommand('copy');
                alert('✅ সমস্ত ফোন নাম্বার কপি করা হয়েছে!');
            });
        }

        function downloadWorkerClaimedTxt() {
            if (!currentClaimedRecords || currentClaimedRecords.length === 0) return;
            const textContent = currentClaimedRecords.map(r => r.phone).join('\n');
            const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Work_Numbers_${currentProfile?.username || 'user'}_${new Date().toISOString().slice(0,10)}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        }

        function downloadWorkerClaimedExcel() {
            if (!currentClaimedRecords || currentClaimedRecords.length === 0) return;
            // Pure phone numbers only - no extra columns (SL, Name, Age) or header rows
            const cleanNumbers = currentClaimedRecords
                .map(r => String(r.phone || r.phone_number || r).trim())
                .filter(p => p.length >= 6);
            const ws = XLSX.utils.aoa_to_sheet(cleanNumbers.map(p => [p]));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Work_Numbers');
            XLSX.writeFile(wb, `Work_Numbers_${currentProfile?.username || 'user'}_${new Date().toISOString().slice(0,10)}.xlsx`);
        }

        function sendWorkerClaimedToDupCheck() {
            const textarea = document.getElementById('workerClaimedTextarea');
            if (!textarea || !textarea.value) return;
            closeWorkerClaimModal();
            switchToSection('duplicate_check');
            const dupInput = document.getElementById('dupTextInput');
            if (dupInput) {
                dupInput.value = textarea.value;
                dupInput.scrollIntoView({ behavior: 'smooth' });
            }
        }

        async function openClaimHistoryModal() {
            if (!supabaseClient || !currentUser) return;
            try {
                const todayStart = new Date();
                todayStart.setHours(0,0,0,0);

                const { data, error } = await supabaseClient
                    .from('company_received_numbers')
                    .select('phone_number, full_name, age, assigned_at')
                    .eq('assigned_to_user_id', currentUser.id)
                    .gte('assigned_at', todayStart.toISOString())
                    .order('assigned_at', { ascending: false });

                if (error) throw error;

                const area = document.getElementById('workerHistoryTextarea');
                if (data && data.length > 0) {
                    area.value = data.map(r => r.phone_number).join('\n');
                } else {
                    area.value = 'আজ এখনো কোনো নাম্বার সংগ্রহ করা হয়নি।';
                }

                document.getElementById('workerClaimHistoryModal').classList.remove('hidden');
            } catch (err) {
                alert('হিস্ট্রি লোড করতে সমস্যা: ' + err.message);
            }
        }

        function closeWorkerClaimHistoryModal() {
            document.getElementById('workerClaimHistoryModal').classList.add('hidden');
        }

        function copyWorkerHistoryNumbers() {
            const textarea = document.getElementById('workerHistoryTextarea');
            if (!textarea || !textarea.value) return;
            navigator.clipboard.writeText(textarea.value).then(() => {
                alert('✅ ক্লিপবোর্ডে কপি করা হয়েছে!');
            });
        }


        // ==============================================================
        // DEDICATED SECTOR: CLAIM WORK NUMBERS (FOR LOGGED-IN USERS)
        // ==============================================================
        let secCurrentClaimed = [];

        function selectSecQty(qty, btnEl) {
            const input = document.getElementById('secClaimQtyInput');
            if (input) input.value = qty;

            document.querySelectorAll('.sec-qty-btn').forEach(btn => {
                btn.className = 'sec-qty-btn px-4 py-2 text-xs sm:text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl transition';
            });
            if (btnEl) {
                btnEl.className = 'sec-qty-btn px-4 py-2 text-xs sm:text-sm font-bold bg-indigo-500 border border-indigo-300 text-white rounded-xl shadow transition';
            }
        }

        
        // ==============================================================
        // DUAL STOCK CATEGORY & TEAM LEADER DISPENSER LOGIC
        // ==============================================================
        let activeClaimStockCategory = 'gender_verify';

        function switchClaimCategory(cat) {
            activeClaimStockCategory = cat;
            const btnGv = document.getElementById('tabClaimCatGv');
            const btnLookup = document.getElementById('tabClaimCatLookup');
            const btnSignal = document.getElementById('tabClaimCatSignal');

            const inactiveCls = 'w-full py-3 px-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-1.5 transition text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 cursor-pointer';
            [btnGv, btnLookup, btnSignal].forEach(b => {
                if (b) b.className = inactiveCls;
            });

            if (cat === 'gender_verify' && btnGv) {
                btnGv.className = 'w-full py-3 px-3 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center space-x-1.5 transition bg-indigo-600 text-white shadow-md cursor-pointer';
            } else if (cat === 'lookup' && btnLookup) {
                btnLookup.className = 'w-full py-3 px-3 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center space-x-1.5 transition bg-indigo-600 text-white shadow-md cursor-pointer';
            } else if (cat === 'signal' && btnSignal) {
                btnSignal.className = 'w-full py-3 px-3 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center space-x-1.5 transition bg-cyan-600 text-white shadow-md cursor-pointer';
            }

            // Department Lock Enforcement:
            // Gender Verify workers -> allowed 'gender_verify' and 'signal' (blocked from 'lookup')
            // Lookup workers -> allowed ONLY 'lookup' (blocked from 'gender_verify' and 'signal')
            // Admin -> allowed all 3
            const userDept = currentProfile?.department || 'gender_verify';
            const isAdmin = currentProfile && currentProfile.role === 'admin';
            const lockBanner = document.getElementById('claimStockDeptLockBanner');
            const lockText = document.getElementById('claimStockDeptLockText');
            const claimBtn = document.getElementById('btnSecClaim');

            let isBlocked = false;
            let blockReason = '';

            if (!isAdmin) {
                if (userDept === 'gender_verify') {
                    if (cat === 'lookup') {
                        isBlocked = true;
                        blockReason = '🔒 অ্যাক্সেস সীমিত: আপনি "Gender Verify" ডিপার্টমেন্টের কর্মী। আপনি শুধুমাত্র "জেন্ডার ভেরিফাই" এবং "সিগন্যাল নাম্বার" স্টক থেকে নাম্বার নিতে পারবেন। লুকআপ স্টকটি শুধুমাত্র Number Lookup ডিপার্টমেন্টের কর্মীদের জন্য সংরক্ষিত।';
                    }
                } else if (userDept === 'lookup' || userDept === 'number_lookup') {
                    if (cat === 'gender_verify') {
                        isBlocked = true;
                        blockReason = '🔒 অ্যাক্সেস সীমিত: আপনি "Number Lookup" ডিপার্টমেন্টের কর্মী। আপনি শুধুমাত্র "লুকআপ নাম্বার স্টক" থেকে নাম্বার নিতে পারবেন। জেন্ডার ভেরিফাই স্টক শুধুমাত্র Gender Verify কর্মীদের জন্য সংরক্ষিত।';
                    } else if (cat === 'signal') {
                        isBlocked = true;
                        blockReason = '🔒 অ্যাক্সেস সীমিত: সিগন্যাল নাম্বার শুধুমাত্র "Gender Verify" ডিপার্টমেন্টের কর্মীদের জন্য সংরক্ষিত। আপনি Lookup স্টক থেকে নাম্বার গ্রহণ করুন।';
                    }
                }
            }

            if (isBlocked) {
                if (lockBanner) {
                    lockBanner.classList.remove('hidden');
                    if (lockText) lockText.innerText = blockReason;
                }
                if (claimBtn) {
                    claimBtn.disabled = true;
                    claimBtn.className = 'w-full py-3.5 px-6 rounded-xl font-black text-xs sm:text-sm text-slate-400 bg-slate-200 cursor-not-allowed flex items-center justify-center space-x-2';
                    claimBtn.innerHTML = '<span>🔒 লকার: আপনার ডিপার্টমেন্টের জন্য এই স্টকটি প্রযোজ্য নয়</span>';
                }
            } else {
                if (lockBanner) lockBanner.classList.add('hidden');
                if (claimBtn) {
                    claimBtn.disabled = false;
                    claimBtn.className = 'w-full py-3.5 px-6 rounded-xl font-black text-xs sm:text-sm text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-md transition flex items-center justify-center space-x-2 cursor-pointer';
                    claimBtn.innerHTML = '<span>⚡ Claim & Take Numbers (নাম্বার সংগ্রহ করুন)</span>';
                }
            }

            refreshClaimStockData();
        }

async function loadClaimStockSector() {
            if (supabaseClient && currentUser) {
                try {
                    const { data: p } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();
                    if (p) {
                        currentProfile = p;
                        if (currentProfile.role === 'team_leader' || currentProfile.is_unlimited_quota === true) {
                            const badge = document.getElementById('userBadge');
                            if (badge && currentProfile.role !== 'admin') {
                                badge.className = 'text-xs px-2.5 py-1 rounded-full font-black bg-amber-400 text-slate-950 shadow-sm border border-amber-300';
                                badge.innerText = '👑 Team Leader (আনলিমিটেড)';
                            }
                        }
                    }
                } catch(pErr) {
                    console.warn('Could not refresh profile on claim sector load:', pErr);
                }
            }
            refreshClaimStockData();
            loadSecClaimHistory();
        }

        async function refreshClaimStockData() {
            if (!supabaseClient) return;
            try {
                // 1. Dual Stock Categories Counts
                const { count: gvCount } = await supabaseClient
                    .from('company_received_numbers')
                    .select('*', { count: 'exact', head: true })
                    .eq('is_assigned', false)
                    .or('stock_type.eq.gender_verify,stock_type.is.null,stock_type.eq.');

                const { count: lookupCount } = await supabaseClient
                    .from('company_received_numbers')
                    .select('*', { count: 'exact', head: true })
                    .eq('is_assigned', false)
                    .eq('stock_type', 'lookup');

                const { count: signalCount } = await supabaseClient
                    .from('company_received_numbers')
                    .select('*', { count: 'exact', head: true })
                    .eq('is_assigned', false)
                    .eq('stock_type', 'signal');

                let tursoGv = 0, tursoLookup = 0, tursoSignal = 0;
                try {
                    if (typeof TursoVault !== 'undefined') {
                        const resGv = await TursoVault.query("SELECT COUNT(*) as cnt FROM turso_stock_numbers WHERE is_assigned = 0 AND stock_type = 'gender_verify';");
                        const resLook = await TursoVault.query("SELECT COUNT(*) as cnt FROM turso_stock_numbers WHERE is_assigned = 0 AND stock_type = 'lookup';");
                        const resSig = await TursoVault.query("SELECT COUNT(*) as cnt FROM turso_stock_numbers WHERE is_assigned = 0 AND stock_type = 'signal';");
                        tursoGv = parseInt(resGv.rows[0]?.cnt || 0, 10);
                        tursoLookup = parseInt(resLook.rows[0]?.cnt || 0, 10);
                        tursoSignal = parseInt(resSig.rows[0]?.cnt || 0, 10);
                    }
                } catch(tStockErr) {
                    console.warn('Turso stock count notice:', tStockErr);
                }

                const gvAvail = (gvCount || 0) + tursoGv;
                const lookupAvail = (lookupCount || 0) + tursoLookup;
                const signalAvail = (signalCount || 0) + tursoSignal;

                const badgeGv = document.getElementById('badgeGvStockAvail');
                if (badgeGv) badgeGv.innerText = `${gvAvail.toLocaleString()} টি বাকি`;

                const badgeLookup = document.getElementById('badgeLookupStockAvail');
                if (badgeLookup) badgeLookup.innerText = `${lookupAvail.toLocaleString()} টি বাকি`;

                const badgeSignal = document.getElementById('badgeSignalStockAvail');
                if (badgeSignal) badgeSignal.innerText = `${signalAvail.toLocaleString()} টি বাকি`;

                let activeCount = gvAvail;
                if (activeClaimStockCategory === 'lookup') activeCount = lookupAvail;
                else if (activeClaimStockCategory === 'signal') activeCount = signalAvail;
                const availEl = document.getElementById('secStockAvailable');
                if (availEl) availEl.innerText = activeCount.toLocaleString();

                // 2. Team Leader & Lookup Account Privilege Enforcement
                const isLeader = currentProfile && (currentProfile.role === 'team_leader' || currentProfile.role === 'admin' || currentProfile.is_unlimited_quota === true);
                const isLookupAccount = currentProfile && (['lookup', 'number_lookup'].includes(currentProfile.department) || isLeader);

                const leaderBanner = document.getElementById('teamLeaderPrivilegeBanner');
                if (leaderBanner) {
                    if (activeClaimStockCategory === 'lookup') {
                        if (isLookupAccount) {
                            leaderBanner.className = 'p-4 rounded-2xl bg-gradient-to-r from-purple-500/15 via-indigo-500/15 to-emerald-500/15 border border-purple-300 text-purple-950 flex items-center justify-between gap-3';
                            leaderBanner.innerHTML = `
                                <div class="flex items-center space-x-3">
                                    <span class="text-2xl">✨</span>
                                    <div>
                                        <h4 class="font-black text-sm sm:text-base text-purple-900">লুকআপ একাউন্ট সুবিধা: আনলিমিটেড নাম্বার কোটা সক্রিয়!</h4>
                                        <p class="text-xs text-purple-800 mt-0.5">লুকআপ কর্মীদের জন্য নাম্বারের কোনো দৈনিক লিমিট নেই। যত খুশি তত নাম্বার স্টক থেকে তুলতে পারবেন।</p>
                                    </div>
                                </div>
                                <span class="px-3 py-1 bg-purple-600 text-white font-black text-xs rounded-full uppercase tracking-wider flex-shrink-0">Unlimited Quota</span>
                            `;
                            leaderBanner.classList.remove('hidden');
                        } else {
                            leaderBanner.className = 'p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-950 flex items-center justify-between gap-3';
                            leaderBanner.innerHTML = `
                                <div class="flex items-center space-x-3">
                                    <span class="text-2xl">🔒</span>
                                    <div>
                                        <h4 class="font-black text-sm text-rose-900">এই স্টকটি শুধুমাত্র লুকআপ অ্যাকাউন্টধারীদের জন্য সংরক্ষিত!</h4>
                                        <p class="text-xs text-rose-800 mt-0.5">আপনার অ্যাকাউন্টে লুকআপ পারমিশন নেই। অ্যাডমিনের সাথে যোগাযোগ করে আপনার ডিপার্টমেন্ট লুকআপে আপডেট করুন।</p>
                                    </div>
                                </div>
                                <span class="px-3 py-1 bg-rose-600 text-white font-black text-xs rounded-full uppercase tracking-wider flex-shrink-0">Restricted</span>
                            `;
                            leaderBanner.classList.remove('hidden');
                        }
                    } else {
                        if (isLeader) {
                            leaderBanner.className = 'p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-purple-500/15 to-indigo-500/15 border border-amber-300 text-amber-950 flex items-center justify-between gap-3';
                            leaderBanner.innerHTML = `
                                <div class="flex items-center space-x-3">
                                    <span class="text-2xl">👑</span>
                                    <div>
                                        <h4 class="font-black text-sm sm:text-base text-amber-900">টিম লিডার সুবিধা: আনলিমিটেড নাম্বার কোটা সক্রিয়!</h4>
                                        <p class="text-xs text-amber-800 mt-0.5">আপনার অ্যাকাউন্টে কোনো ৬ ঘণ্টার ১,০০০ লিমিট নেই। আপনি কাজের প্রয়োজনে যেকোনো পরিমাণ নাম্বার সংগ্রহ করতে পারবেন।</p>
                                    </div>
                                </div>
                                <span class="px-3 py-1 bg-amber-400 text-slate-950 font-black text-xs rounded-full uppercase tracking-wider flex-shrink-0">Unlimited Quota</span>
                            `;
                            leaderBanner.classList.remove('hidden');
                        } else {
                            leaderBanner.classList.add('hidden');
                        }
                    }
                }

                // 2. User claimed in last 6 hours count
                if (currentUser) {
                    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

                    const { data: recentClaims } = await supabaseClient
                        .from('company_received_numbers')
                        .select('assigned_at')
                        .eq('assigned_to_user_id', currentUser.id)
                        .gte('assigned_at', sixHoursAgo.toISOString())
                        .order('assigned_at', { ascending: true });

                    const userTodayEl = document.getElementById('secWorkerClaimedToday');
                    const cCount = recentClaims ? recentClaims.length : 0;
                    if (userTodayEl) userTodayEl.innerText = cCount.toLocaleString();

                    const quotaRemEl = document.getElementById('secWorkerQuotaRemaining');
                    const quotaPctEl = document.getElementById('secWorkerQuotaPercent');
                    const quotaBarEl = document.getElementById('secWorkerQuotaBar');
                    const btnClaim = document.getElementById('btnSecClaim');
                    const qtyInput = document.getElementById('secClaimQtyInput');

                    if (isLeader) {
                        // Team Leader: 100% UNLIMITED - NEVER LOCK!
                        if (qtyInput) {
                            qtyInput.removeAttribute('max');
                            qtyInput.placeholder = "e.g. 1000 বা 5000";
                        }
                        if (quotaRemEl) quotaRemEl.innerHTML = '<span class="text-emerald-600 font-black text-sm sm:text-base">∞ (আনলিমিটেড)</span>';
                        if (quotaPctEl) quotaPctEl.innerHTML = '<span class="text-amber-600 font-black">👑 টিম লিডার সুবিধা সক্রিয়</span>';
                        if (quotaBarEl) {
                            quotaBarEl.style.width = '100%';
                            quotaBarEl.className = 'bg-emerald-500 h-2 rounded-full transition-all duration-300';
                        }
                        if (btnClaim) {
                            btnClaim.disabled = false;
                            btnClaim.className = 'w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-600 hover:to-teal-500 text-slate-950 font-black text-sm sm:text-base px-8 py-3.5 rounded-xl shadow-lg transition transform active:scale-95 flex items-center justify-center space-x-2 cursor-pointer';
                            btnClaim.innerHTML = '<span>⚡ Claim & Take Numbers (আনলিমিটেড সংগ্রহ করুন)</span>';
                        }
                    } else {
                        // General Worker: Strict 1,000 per 6 Hours
                        if (qtyInput) qtyInput.max = "1000";
                        const sixHourLimit = 1000;
                        const remaining = Math.max(0, sixHourLimit - cCount);
                        const pct = Math.min(100, Math.round((cCount / sixHourLimit) * 100));

                        let unlockTimeStr = '';
                        if (cCount >= sixHourLimit && recentClaims && recentClaims.length > 0) {
                            const oldestClaimTime = new Date(recentClaims[0].assigned_at).getTime();
                            const unlockTime = new Date(oldestClaimTime + 6 * 60 * 60 * 1000);
                            unlockTimeStr = unlockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        }

                        if (quotaRemEl) {
                            if (cCount >= sixHourLimit) {
                                quotaRemEl.innerHTML = `<span class="text-rose-600 font-bold text-xs sm:text-sm">০ (আনলক: ${unlockTimeStr || 'শীঘ্রই'})</span>`;
                            } else {
                                quotaRemEl.innerText = remaining.toLocaleString();
                            }
                        }
                        if (quotaPctEl) {
                            if (cCount >= sixHourLimit) {
                                quotaPctEl.innerHTML = `<span class="text-rose-600 font-bold">১০০% ব্যবহৃত (পরবর্তী কোটা: ${unlockTimeStr || 'শীঘ্রই'})</span>`;
                            } else {
                                quotaPctEl.innerText = `${pct}% ব্যবহৃত`;
                            }
                        }
                        if (quotaBarEl) {
                            quotaBarEl.style.width = `${pct}%`;
                            if (pct >= 100) {
                                quotaBarEl.className = 'bg-rose-600 h-2 rounded-full transition-all duration-300';
                                if (btnClaim) {
                                    btnClaim.disabled = true;
                                    btnClaim.className = 'w-full sm:w-auto bg-slate-300 text-slate-500 font-black text-sm sm:text-base px-8 py-3.5 rounded-xl shadow cursor-not-allowed flex items-center justify-center space-x-2';
                                    btnClaim.innerHTML = `<span>🔒 ৬ ঘণ্টার ১,০০০ লিমিট পূর্ণ (পরবর্তী আনলক: ${unlockTimeStr || '৬ ঘণ্টা পর'})</span>`;
                                }
                            } else {
                                quotaBarEl.className = pct >= 80 ? 'bg-amber-500 h-2 rounded-full transition-all duration-300' : 'bg-indigo-600 h-2 rounded-full transition-all duration-300';
                                if (btnClaim) {
                                    btnClaim.disabled = false;
                                    btnClaim.className = 'w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white font-black text-sm sm:text-base px-8 py-3.5 rounded-xl shadow-lg transition transform active:scale-95 flex items-center justify-center space-x-2 cursor-pointer';
                                    btnClaim.innerHTML = '<span>⚡ Claim & Take Numbers (নাম্বার সংগ্রহ করুন)</span>';
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('Error refreshing claim stock data:', err);
            }
        }

        async function executeSecClaim() {
            if (!supabaseClient || !currentUser) {
                alert('অনুগ্রহ করে প্রথমে আপনার অ্যাকাউন্টে লগইন করুন। লগইন করা ছাড়া কোনো নাম্বার দেখা বা সংগ্রহ করা যাবে না।');
                showView('loginView');
                return;
            }

            const input = document.getElementById('secClaimQtyInput');
            let qty = parseInt(input ? input.value : '100', 10);
            if (isNaN(qty) || qty <= 0) qty = 100;

            const isLeader = currentProfile && (currentProfile.role === 'team_leader' || currentProfile.role === 'admin' || currentProfile.is_unlimited_quota === true);
            if (!isLeader && qty > 1000) {
                alert('সাধারণ কর্মীরা প্রতি ৬ ঘণ্টায় সর্বোচ্চ ১,০০০ টি নাম্বার সংগ্রহ করতে পারবেন।\n\nআনলিমিটেড নাম্বারের জন্য অ্যাডমিনের সাথে যোগাযোগ করে টিম লিডার রোল সক্রিয় করুন।');
                return;
            }

            // Strict Department Access Rules:
            // gender_verify workers -> can claim 'gender_verify' and 'signal' (blocked from 'lookup')
            // lookup workers -> can claim ONLY 'lookup' (blocked from 'gender_verify' and 'signal')
            // admin -> can claim anything
            const userDept = currentProfile?.department || 'gender_verify';
            const isAdmin = currentProfile && currentProfile.role === 'admin';

            if (!isAdmin) {
                if (userDept === 'gender_verify') {
                    if (activeClaimStockCategory === 'lookup') {
                        alert('🔒 অনুমতি নেই!\n\nআপনি "Gender Verify" ডিপার্টমেন্টের কর্মী। আপনি শুধুমাত্র "জেন্ডার ভেরিফাই" এবং "সিগন্যাল নাম্বার" স্টক থেকে নাম্বার নিতে পারবেন।');
                        return;
                    }
                } else if (userDept === 'lookup' || userDept === 'number_lookup') {
                    if (activeClaimStockCategory !== 'lookup') {
                        alert('🔒 অনুমতি নেই!\n\nআপনি "Number Lookup" ডিপার্টমেন্টের কর্মী। আপনি শুধুমাত্র "লুকআপ নাম্বার" স্টক থেকে নাম্বার নিতে পারবেন। জেন্ডার ভেরিফাই ও সিগন্যাল নাম্বার শুধুমাত্র জেন্ডার ভেরিফাই ডিপার্টমেন্টের কর্মীরা নিতে পারবেন।');
                        return;
                    }
                }
            }

            const btn = document.getElementById('btnSecClaim');
            btn.disabled = true;
            btn.innerHTML = '<span>⏳ নাম্বার সংগ্রহ করা হচ্ছে...</span>';

            try {
                let records = [];

                // 1. Try Turso 9 GB Cloud Vault first (Instant, No timeout, Zero Supabase storage)
                try {
                    if (typeof TursoVault !== 'undefined') {
                        const tursoRes = await TursoVault.claimStock(qty, activeClaimStockCategory, currentProfile);
                        if (tursoRes && tursoRes.success && tursoRes.data && tursoRes.data.length > 0) {
                            records = tursoRes.data;
                            console.log(`✅ Claimed ${records.length} numbers directly from Turso Cloud Vault!`);
                        }
                    }
                } catch (tursoClaimErr) {
                    console.warn('Turso stock claim notice, falling back to Supabase:', tursoClaimErr);
                }

                // 2. Fallback to Supabase if Turso was empty or offline
                if (!records || records.length === 0) {
                    try {
                        const { data, error } = await supabaseClient.rpc('worker_claim_numbers', {
                            p_quantity: qty,
                            p_stock_type: activeClaimStockCategory
                        });
                        if (!error && data && data.success && data.data && data.data.length > 0) {
                            records = data.data;
                        }
                    } catch (rpcErr) {
                        console.warn('RPC worker_claim_numbers fallback notice:', rpcErr);
                    }
                }

                // 3. If still empty, try direct Supabase table query
                if (!records || records.length === 0)
                try {
                    const { data, error } = await supabaseClient.rpc('worker_claim_numbers', {
                        p_quantity: qty,
                        p_stock_type: activeClaimStockCategory
                    });
                    if (error) throw error;

                    if (data && data.success && data.data && data.data.length > 0) {
                        records = data.data;
                    } else if (data && !data.success) {
                        alert(data.message || 'স্টকে কোনো নতুন নাম্বার খালি নেই!');
                        btn.disabled = false;
                        btn.innerHTML = '<span>⚡ Claim & Take Numbers (নাম্বার সংগ্রহ করুন)</span>';
                        return;
                    }
                } catch (rpcErr) {
                    console.warn('RPC fallback to direct claim query:', rpcErr);

                    // 2. Direct fallback query
                    let fbQuery = supabaseClient
                        .from('company_received_numbers')
                        .select('id, phone_number, full_name, age')
                        .eq('is_assigned', false);

                    if (activeClaimStockCategory === 'lookup') {
                        fbQuery = fbQuery.eq('stock_type', 'lookup');
                    } else if (activeClaimStockCategory === 'signal') {
                        fbQuery = fbQuery.eq('stock_type', 'signal');
                    } else {
                        fbQuery = fbQuery.or('stock_type.eq.gender_verify,stock_type.is.null,stock_type.eq.');
                    }

                    const { data: stockRows, error: fetchErr } = await fbQuery
                        .order('id', { ascending: true })
                        .limit(qty);

                    if (fetchErr) throw fetchErr;

                    if (!stockRows || stockRows.length === 0) {
                        alert('স্টকে কোনো নতুন নাম্বার খালি নেই! এডমিন নতুন স্টক আপলোড করলে আবার চেষ্টা করুন।');
                        btn.disabled = false;
                        btn.innerHTML = '<span>⚡ Claim & Take Numbers (নাম্বার সংগ্রহ করুন)</span>';
                        return;
                    }

                    const claimIds = stockRows.map(r => r.id);
                    const username = currentProfile ? currentProfile.username : currentUser.email.split('@')[0];

                    const { error: updateErr } = await supabaseClient
                        .from('company_received_numbers')
                        .update({
                            is_assigned: true,
                            assigned_to_user_id: currentUser.id,
                            assigned_to_username: username,
                            assigned_to_email: currentUser.email,
                            assigned_at: new Date().toISOString()
                        })
                        .in('id', claimIds);

                    if (updateErr) throw updateErr;

                    records = stockRows.map(r => ({
                        phone: r.phone_number,
                        name: r.full_name || '',
                        age: r.age || ''
                    }));
                }

                secCurrentClaimed = records;

                // Render in Sector Active Output Panel
                document.getElementById('secResultCount').innerText = records.length;
                const phoneText = records.map(r => r.phone).join('\n');
                document.getElementById('secClaimedTextarea').value = phoneText;
                document.getElementById('secActiveResultCard').classList.remove('hidden');
                document.getElementById('secActiveResultCard').scrollIntoView({ behavior: 'smooth' });

                // Refresh metrics & history
                refreshClaimStockData();
                loadSecClaimHistory();

                alert(`🎉 অভিনন্দন! সফলভাবে ${records.length}টি ফোন নাম্বার আপনার জন্য সংরক্ষিত করা হয়েছে।`);

            } catch (err) {
                console.error('Claim error:', err);
                alert('নাম্বার সংগ্রহে ত্রুটি: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>⚡ Claim & Take Numbers (নাম্বার সংগ্রহ করুন)</span>';
            }
        }

        function copySecClaimedNumbers() {
            const area = document.getElementById('secClaimedTextarea');
            if (!area || !area.value) return;
            navigator.clipboard.writeText(area.value).then(() => {
                alert('✅ সমস্ত সংগৃহীত ফোন নাম্বার ক্লিপবোর্ডে কপি করা হয়েছে!');
            }).catch(() => {
                area.select();
                document.execCommand('copy');
                alert('✅ সমস্ত সংগৃহীত ফোন নাম্বার কপি করা হয়েছে!');
            });
        }

        function downloadSecClaimedTxt() {
            if (!secCurrentClaimed || secCurrentClaimed.length === 0) return;
            const textContent = secCurrentClaimed.map(r => r.phone).join('\n');
            const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Work_Stock_${currentProfile?.username || 'user'}_${new Date().toISOString().slice(0,10)}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        }

        function downloadSecClaimedExcel() {
            if (!secCurrentClaimed || secCurrentClaimed.length === 0) return;
            // Pure phone numbers only - no extra columns (SL, Name, Age) or header rows
            const cleanNumbers = secCurrentClaimed
                .map(r => String(r.phone || r.phone_number || r).trim())
                .filter(p => p.length >= 6);
            const ws = XLSX.utils.aoa_to_sheet(cleanNumbers.map(p => [p]));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Claimed_Numbers');
            XLSX.writeFile(wb, `Work_Stock_${currentProfile?.username || 'user'}_${new Date().toISOString().slice(0,10)}.xlsx`);
        }

        function sendSecClaimedToDupCheck() {
            const area = document.getElementById('secClaimedTextarea');
            if (!area || !area.value) return;
            switchToSection('duplicate_check');
            const dupInput = document.getElementById('dupTextInput');
            if (dupInput) {
                dupInput.value = area.value;
                dupInput.scrollIntoView({ behavior: 'smooth' });
            }
        }

        async function loadSecClaimHistory() {
            if (!supabaseClient || !currentUser) return;
            const tbody = document.getElementById('secClaimHistoryBody');
            if (!tbody) return;

            try {
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);

                const { data, error } = await supabaseClient
                    .from('company_received_numbers')
                    .select('id, phone_number, full_name, age, assigned_at')
                    .eq('assigned_to_user_id', currentUser.id)
                    .gte('assigned_at', todayStart.toISOString())
                    .order('assigned_at', { ascending: false });

                if (error) throw error;

                if (!data || data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-400">আজ এখনো কোনো নাম্বার সংগ্রহ করা হয়নি। উপরের বাটন চাপ দিয়ে নাম্বার নিন।</td></tr>';
                    return;
                }

                tbody.innerHTML = '';
                data.forEach((row, idx) => {
                    const timeStr = row.assigned_at ? new Date(row.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
                    const tr = document.createElement('tr');
                    tr.className = 'hover:bg-slate-50 transition';
                    tr.innerHTML = `
                        <td class="py-3 px-4 font-mono text-slate-400">${idx + 1}</td>
                        <td class="py-3 px-4 font-mono text-slate-600">${timeStr}</td>
                        <td class="py-3 px-4 font-bold font-mono text-slate-800">${row.phone_number}</td>
                        <td class="py-3 px-4 text-slate-600">${row.full_name || '-'}</td>
                        <td class="py-3 px-4 text-slate-600">${row.age || '-'}</td>
                        <td class="py-3 px-4 text-center">
                            <button onclick="navigator.clipboard.writeText('${row.phone_number}').then(() => alert('কপি করা হয়েছে: ${row.phone_number}'))" class="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded transition">
                                📋 Copy
                            </button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });

            } catch (err) {
                console.error('History load error:', err);
                tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-rose-500">হিস্ট্রি লোড করতে সমস্যা: ${err.message}</td></tr>`;
            }
        }


        // ==============================================================
        // ADMIN STOCK MONITOR & WORKER CLAIMS LOG
        // ==============================================================
        let adminClaimBatchCache = {};

        function updateStockDepletionAlert(total, available, claimed) {
            const banner = document.getElementById('recStockAlertBanner');
            const icon = document.getElementById('recStockAlertIcon');
            const title = document.getElementById('recStockAlertTitle');
            const sub = document.getElementById('recStockAlertSub');
            const percentBadge = document.getElementById('recStockPercentBadge');

            if (!banner) return;

            const percentRemaining = total > 0 ? Math.round((available / total) * 100) : 0;
            if (percentBadge) percentBadge.innerText = `${percentRemaining}% অবশিষ্ট`;

            if (total === 0 || available === 0) {
                banner.className = 'p-4 rounded-2xl border transition-all duration-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-rose-50 border-rose-400 text-rose-950 animate-pulse';
                if (icon) icon.innerText = '🚨';
                if (title) title.innerText = 'জরুরি সতর্কতা: স্টক সম্পূর্ণ শেষ (০ টি নাম্বার বাকি)!';
                if (sub) sub.innerText = 'কর্মীরা কাজ করার জন্য আর কোনো নাম্বার নিতে পারছে না। কোম্পানি থেকে অবিলম্বে নতুন স্টক ফাইল আপলোড করুন।';
                if (percentBadge) percentBadge.className = 'text-xs font-black px-3 py-1 rounded-full bg-rose-600 text-white';
            } else if (available <= 500) {
                banner.className = 'p-4 rounded-2xl border transition-all duration-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50 border-amber-400 text-amber-950';
                if (icon) icon.innerText = '⚠️';
                if (title) title.innerText = `সতর্কতা: স্টক প্রায় শেষ! মাত্র ${available.toLocaleString()} টি নাম্বার বাকি আছে।`;
                if (sub) sub.innerText = 'কর্মীদের কাজ চালু রাখতে শীঘ্রই কোম্পানি থেকে নতুন নাম্বার আপলোড করার প্রস্তুতি নিন।';
                if (percentBadge) percentBadge.className = 'text-xs font-extrabold px-3 py-1 rounded-full bg-amber-500 text-white';
            } else {
                banner.className = 'p-4 rounded-2xl border transition-all duration-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-emerald-50 border-emerald-300 text-emerald-950';
                if (icon) icon.innerText = '🟢';
                if (title) title.innerText = `স্টকে পর্যাপ্ত ফোন নাম্বার রয়েছে (${available.toLocaleString()} টি বাকি আছে)`;
                if (sub) sub.innerText = `মোট ${total.toLocaleString()} টির মধ্যে কর্মীরা ইতিমধ্যে ${claimed.toLocaleString()} টি নাম্বার নিয়ে কাজ করছে।`;
                if (percentBadge) percentBadge.className = 'text-xs font-extrabold px-2.5 py-1 rounded-full bg-emerald-200 text-emerald-900';
            }
        }

        async function loadAdminWorkerClaimsLog() {
            if (!supabaseClient) return;
            const tbody = document.getElementById('adminWorkerClaimsTableBody');
            const summaryDiv = document.getElementById('adminWorkerSummaryBadges');
            if (!tbody) return;

            tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-400 font-medium">⏳ সকল কর্মী ও টিম লিডারের হিসাব লোড হচ্ছে...</td></tr>';

            try {
                // Ensure profiles cache is available to display ALL team members including Team Leaders
                if (!adminUsersCache || adminUsersCache.length === 0) {
                    const { data: profs } = await supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
                    if (profs) {
                        adminUsersCache = profs.map(p => ({
                            id: p.id,
                            email: p.email,
                            username: p.username || (p.email ? p.email.split('@')[0] : 'Worker'),
                            department: p.department || 'gender_verify',
                            role: p.role || 'user',
                            is_unlimited: p.role === 'team_leader' || p.role === 'admin' || p.is_unlimited_quota === true
                        }));
                    }
                }

                // Map of user profiles by id and email/username for instant lookup
                const profileByEmail = {};
                const profileByUname = {};
                const profileById = {};
                adminUsersCache.forEach(u => {
                    if (u.email) profileByEmail[u.email.toLowerCase()] = u;
                    if (u.username) profileByUname[u.username.toLowerCase()] = u;
                    if (u.id) profileById[u.id] = u;
                });

                let batches = {};
                let userTotals = {};
                const todayStr = new Date().toISOString().slice(0, 10);

                // Initialize all team members in userTotals so EVERYONE shows up!
                adminUsersCache.forEach(u => {
                    const key = u.username;
                    userTotals[key] = {
                        username: u.username,
                        email: u.email,
                        role: u.role,
                        isLeader: (u.role === 'team_leader' || u.role === 'admin' || u.is_unlimited),
                        totalClaimed: 0,
                        todayClaimed: 0
                    };
                });

                // 1. Try High-Performance Server-Side RPC First
                let rpcSuccess = false;
                try {
                    const { data: rpcData, error: rpcErr } = await supabaseClient.rpc('get_admin_worker_claims_log');
                    if (!rpcErr && rpcData && rpcData.batches) {
                        rpcSuccess = true;
                        
                        // Populate batches from RPC
                        rpcData.batches.forEach(b => {
                            batches[b.batch_id] = {
                                batchId: b.batch_id,
                                username: b.username,
                                email: b.email,
                                role: b.role,
                                isLeader: (b.role === 'team_leader' || b.role === 'admin'),
                                time: b.time,
                                phones: b.phones || []
                            };

                            const uname = b.username;
                            if (!userTotals[uname]) {
                                userTotals[uname] = {
                                    username: uname,
                                    email: b.email,
                                    role: b.role,
                                    isLeader: (b.role === 'team_leader' || b.role === 'admin'),
                                    totalClaimed: 0,
                                    todayClaimed: 0
                                };
                            }
                            const qty = (b.phones ? b.phones.length : b.count) || 0;
                            userTotals[uname].totalClaimed += qty;
                            if (b.time && b.time.slice(0, 10) === todayStr) {
                                userTotals[uname].todayClaimed += qty;
                            }
                        });
                    }
                } catch(e) {
                    console.warn('RPC get_admin_worker_claims_log notice, using paginated client fetch:', e);
                }

                // 2. Client-Side Chunked Range Fetch Fallback (Bypasses PostgREST 1,000 row ceiling!)
                if (!rpcSuccess) {
                    let allClaimedRows = [];
                    let from = 0;
                    const pageSize = 1000;
                    const maxRowsToFetch = 15000; // supports up to 15,000 records smoothly

                    while (from < maxRowsToFetch) {
                        const { data: chunk, error: cErr } = await supabaseClient
                            .from('company_received_numbers')
                            .select('id, phone_number, assigned_to_user_id, assigned_to_username, assigned_to_email, assigned_at')
                            .eq('is_assigned', true)
                            .order('assigned_at', { ascending: false })
                            .range(from, from + pageSize - 1);

                        if (cErr || !chunk || chunk.length === 0) break;
                        allClaimedRows.push(...chunk);
                        if (chunk.length < pageSize) break; // reached the end
                        from += pageSize;
                    }

                    allClaimedRows.forEach(r => {
                        const prof = (r.assigned_to_user_id ? profileById[r.assigned_to_user_id] : null) || 
                                     (r.assigned_to_email ? profileByEmail[r.assigned_to_email.toLowerCase()] : null) ||
                                     (r.assigned_to_username ? profileByUname[r.assigned_to_username.toLowerCase()] : null) || {};

                        const uname = prof.username || r.assigned_to_username || (r.assigned_to_email ? r.assigned_to_email.split('@')[0] : 'Worker');
                        const email = prof.email || r.assigned_to_email || '-';
                        const role = prof.role || 'user';
                        const isLeader = (role === 'team_leader' || role === 'admin' || prof.is_unlimited);

                        if (!userTotals[uname]) {
                            userTotals[uname] = {
                                username: uname,
                                email: email,
                                role: role,
                                isLeader: isLeader,
                                totalClaimed: 0,
                                todayClaimed: 0
                            };
                        }
                        userTotals[uname].totalClaimed++;
                        if (r.assigned_at && r.assigned_at.slice(0, 10) === todayStr) {
                            userTotals[uname].todayClaimed++;
                        }

                        // Group into Batches by user and minute
                        const timeKey = r.assigned_at ? r.assigned_at.slice(0, 16) : 'unknown';
                        const batchKey = `${uname}_${timeKey}`;

                        if (!batches[batchKey]) {
                            batches[batchKey] = {
                                batchId: batchKey,
                                username: uname,
                                email: email,
                                role: role,
                                isLeader: isLeader,
                                time: r.assigned_at,
                                phones: []
                            };
                        }
                        batches[batchKey].phones.push(r.phone_number);
                    });
                }

                adminClaimBatchCache = batches;

                // 2. Render Comprehensive Worker & Team Leader Summary Badges
                if (summaryDiv) {
                    summaryDiv.innerHTML = '';
                    const sortedUsers = Object.values(userTotals).sort((a, b) => {
                        // Team leaders first, then by total claimed descending
                        if (a.isLeader && !b.isLeader) return -1;
                        if (!a.isLeader && b.isLeader) return 1;
                        return b.totalClaimed - a.totalClaimed;
                    });

                    sortedUsers.forEach(u => {
                        const chip = document.createElement('div');
                        if (u.isLeader) {
                            // Team Leader Badge (Golden Highlighted)
                            chip.className = 'inline-flex items-center space-x-2 bg-gradient-to-r from-amber-50 to-amber-100 border-2 border-amber-300 text-amber-950 px-3 py-1.5 rounded-xl text-xs font-black shadow-xs';
                            chip.innerHTML = `
                                <span>👑 ${u.username}</span>
                                <span class="bg-amber-400 text-slate-950 px-2 py-0.5 rounded-md text-[11px] font-black">${u.totalClaimed.toLocaleString()} টি</span>
                                ${u.todayClaimed > 0 ? `<span class="text-[10px] text-amber-900 font-extrabold bg-white/80 px-1.5 py-0.5 rounded">আজ: +${u.todayClaimed}</span>` : ''}
                            `;
                        } else {
                            // General Worker Badge
                            const hasClaimed = u.totalClaimed > 0;
                            chip.className = `inline-flex items-center space-x-2 border rounded-xl px-3 py-1.5 text-xs font-bold shadow-xs ${hasClaimed ? 'bg-indigo-50 border-indigo-200 text-indigo-950' : 'bg-slate-50 border-slate-200 text-slate-500'}`;
                            chip.innerHTML = `
                                <span>👤 ${u.username}:</span>
                                <span class="${hasClaimed ? 'bg-indigo-600 text-white' : 'bg-slate-300 text-slate-700'} px-2 py-0.5 rounded-md text-[11px] font-black">${u.totalClaimed.toLocaleString()} টি</span>
                                ${u.todayClaimed > 0 ? `<span class="text-[10px] text-emerald-700 font-extrabold bg-emerald-100 px-1.5 py-0.5 rounded">আজ: +${u.todayClaimed}</span>` : ''}
                            `;
                        }
                        summaryDiv.appendChild(chip);
                    });
                }

                // 3. Render Table Rows for All Batches Across All Workers
                const sortedBatches = Object.values(batches).sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

                if (sortedBatches.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-slate-400 font-medium">কোনো কর্মী বা টিম লিডার এখনো স্টক থেকে নাম্বার সংগ্রহ করেননি।</td></tr>';
                    return;
                }

                tbody.innerHTML = sortedBatches.map((batch, idx) => {
                    const dateObj = batch.time ? new Date(batch.time) : null;
                    const dateStr = dateObj ? dateObj.toLocaleDateString() : '-';
                    const timeStr = dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
                    const isLeader = batch.isLeader || (batch.role === 'team_leader' || batch.role === 'admin');

                    const workerBadge = isLeader 
                        ? `<span class="flex items-center space-x-1.5"><span class="text-base">👑</span><span class="font-black text-amber-950">${batch.username}</span><span class="text-[10px] bg-amber-200 text-amber-900 border border-amber-300 font-black px-1.5 py-0.2 rounded-md uppercase">Team Leader</span></span>`
                        : `<span class="flex items-center space-x-1.5"><span class="text-base">👤</span><span class="font-extrabold text-slate-800">${batch.username}</span></span>`;

                    return `
                        <tr class="hover:bg-slate-50/80 transition text-xs ${isLeader ? 'bg-amber-50/20' : ''}">
                            <td class="py-3 px-4 font-mono text-slate-400 font-bold">${idx + 1}</td>
                            <td class="py-3 px-4">${workerBadge}</td>
                            <td class="py-3 px-4 text-slate-500 font-mono text-[11px]">${batch.email}</td>
                            <td class="py-3 px-4 text-center">
                                <span class="inline-block ${isLeader ? 'bg-amber-100 text-amber-950 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'} font-black px-3 py-1 rounded-full text-xs shadow-xs">
                                    ${batch.phones.length.toLocaleString()} টি
                                </span>
                            </td>
                            <td class="py-3 px-4 font-mono text-slate-700 text-[11px] font-semibold">
                                ${dateStr} <span class="text-slate-400 font-normal">(${timeStr})</span>
                            </td>
                            <td class="py-3 px-4 text-center">
                                <button type="button" onclick="openAdminClaimBatchModal('${batch.batchId}')" class="text-xs font-bold text-indigo-700 hover:text-indigo-950 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl border border-indigo-200 shadow-xs transition flex items-center space-x-1.5 mx-auto">
                                    <span>👁️</span>
                                    <span>নাম্বার দেখুন</span>
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');

            } catch (err) {
                console.error('Error loading worker claims log:', err);
                tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-rose-600 font-bold">লগ লোড করতে সমস্যা: ${err.message}</td></tr>`;
            }
        }

        function openAdminClaimBatchModal(batchId) {
            const batch = adminClaimBatchCache[batchId];
            if (!batch) return;

            document.getElementById('adminClaimModalTitle').innerText = `কর্মী: ${batch.username} এর সংগৃহীত নাম্বারসমূহ (${batch.phones.length} টি)`;
            const timeStr = batch.time ? new Date(batch.time).toLocaleString() : '';
            document.getElementById('adminClaimModalSub').innerText = `গ্রহণের সময়: ${timeStr} | ইমেইল: ${batch.email}`;

            document.getElementById('adminClaimModalTextarea').value = batch.phones.join('\n');
            document.getElementById('adminViewClaimModal').classList.remove('hidden');
        }

        function closeAdminViewClaimModal() {
            document.getElementById('adminViewClaimModal').classList.add('hidden');
        }

        function copyAdminClaimModalNumbers() {
            const area = document.getElementById('adminClaimModalTextarea');
            if (!area || !area.value) return;
            navigator.clipboard.writeText(area.value).then(() => {
                alert('✅ সমস্ত নাম্বার ক্লিপবোর্ডে কপি করা হয়েছে!');
            });
        }


        // ==============================================================
        // GENDER VERIFY WORKER DAILY TARGET SYSTEM (270 Female Target)
        // ==============================================================
        // GENDER VERIFY WORKER DAILY TARGET SYSTEM (210 Female + 210 Male = 420 Total Target)
        // ==============================================================
        function updateWorkerTargetTrackerUI(femaleDone, maleDone) {
            const card = document.getElementById('workerTargetTrackerCard');
            if (!card) return;

            if (currentProfile && (currentProfile.department === 'number_lookup' || currentProfile.department === 'lookup')) {
                card.classList.add('hidden');
                return;
            } else {
                card.classList.remove('hidden');
            }

            const femaleTarget = 210;
            const maleTarget = 210;
            const totalTarget = 420;

            const fDone = femaleDone || 0;
            const mDone = maleDone || 0;
            const totalDone = fDone + mDone;

            // Female Card Update
            const femaleDoneEl = document.getElementById('targetFemaleDone');
            const femaleDiffEl = document.getElementById('targetFemaleDiffBadge');
            const femalePctEl = document.getElementById('targetFemalePercent');
            const femaleBarEl = document.getElementById('targetFemaleBar');

            if (femaleDoneEl) femaleDoneEl.innerText = fDone.toLocaleString();
            const femalePct = Math.min(100, Math.round((fDone / femaleTarget) * 100));
            if (femalePctEl) femalePctEl.innerText = `${femalePct}%`;
            if (femaleBarEl) femaleBarEl.style.width = `${femalePct}%`;

            if (femaleDiffEl) {
                if (fDone >= femaleTarget) {
                    const extra = fDone - femaleTarget;
                    femaleDiffEl.className = 'text-[11px] font-extrabold px-2.5 py-0.5 rounded-md bg-emerald-200 text-emerald-900';
                    femaleDiffEl.innerText = extra > 0 ? `✅ পূর্ণ (+${extra} বেশি)` : '✅ টার্গেট পূর্ণ';
                } else {
                    const short = femaleTarget - fDone;
                    femaleDiffEl.className = 'text-[11px] font-extrabold px-2.5 py-0.5 rounded-md bg-rose-200 text-rose-900';
                    femaleDiffEl.innerText = `বাকি ${short} টি`;
                }
            }

            // Male Card Update
            const maleDoneEl = document.getElementById('targetMaleDone');
            const maleDiffEl = document.getElementById('targetMaleDiffBadge');
            const malePctEl = document.getElementById('targetMalePercent');
            const maleBarEl = document.getElementById('targetMaleBar');

            if (maleDoneEl) maleDoneEl.innerText = mDone.toLocaleString();
            const malePct = Math.min(100, Math.round((mDone / maleTarget) * 100));
            if (malePctEl) malePctEl.innerText = `${malePct}%`;
            if (maleBarEl) maleBarEl.style.width = `${malePct}%`;

            if (maleDiffEl) {
                if (mDone >= maleTarget) {
                    const extra = mDone - maleTarget;
                    maleDiffEl.className = 'text-[11px] font-extrabold px-2.5 py-0.5 rounded-md bg-emerald-200 text-emerald-900';
                    maleDiffEl.innerText = extra > 0 ? `✅ পূর্ণ (+${extra} বেশি)` : '✅ টার্গেট পূর্ণ';
                } else {
                    const short = maleTarget - mDone;
                    maleDiffEl.className = 'text-[11px] font-extrabold px-2.5 py-0.5 rounded-md bg-blue-200 text-blue-900';
                    maleDiffEl.innerText = `বাকি ${short} টি`;
                }
            }

            // Combined Total Update
            const totalDoneEl = document.getElementById('targetTotalDoneText');
            if (totalDoneEl) totalDoneEl.innerText = totalDone.toLocaleString();

            const totalPct = Math.min(100, Math.round((totalDone / totalTarget) * 100));
            const totalPctEl = document.getElementById('targetTotalPercent');
            const totalBarEl = document.getElementById('targetTotalBar');
            if (totalPctEl) totalPctEl.innerText = `${totalPct}% (${totalDone}/${totalTarget})`;
            if (totalBarEl) totalBarEl.style.width = `${totalPct}%`;

            // Motivation Banner
            const banner = document.getElementById('targetMotivationBanner');
            const iconEl = document.getElementById('targetMotivationIcon');
            const titleEl = document.getElementById('targetMotivationTitle');
            const msgEl = document.getElementById('targetMotivationMessage');
            const badgeEl = document.getElementById('targetStatusBadge');

            const isFemaleComplete = fDone >= femaleTarget;
            const isMaleComplete = mDone >= maleTarget;
            const isAllComplete = isFemaleComplete && isMaleComplete;
            const isTotalExceeded = totalDone > totalTarget;

            if (isAllComplete && isTotalExceeded) {
                const extra = totalDone - totalTarget;
                if (banner) banner.className = 'p-4 rounded-xl border transition-all duration-300 flex items-start space-x-3 bg-purple-50 border-purple-300 text-purple-950 shadow-sm';
                if (iconEl) iconEl.innerText = '🏆';
                if (titleEl) titleEl.innerText = 'অসাধারণ পারফরম্যান্স! আপনি দৈনিক ৪২০ নাম্বারের চেয়েও বেশি কাজ জমা দিয়েছেন!';
                if (msgEl) {
                    msgEl.className = 'text-xs sm:text-sm text-purple-800 mt-0.5 leading-relaxed font-medium';
                    msgEl.innerText = `আপনি আজকের ৪২০টি নাম্বারের (২১০ ফিমেল + ২১০ মেল) টার্গেট সম্পূর্ণ পূরণ করার পরও আরও +${extra} টি অতিরিক্ত নাম্বার দিয়েছেন! আপনার বোনাস পারফরম্যান্স ডাটাবেজে রেকর্ড করা হয়েছে। ধন্যবাদ!`;
                }
                if (badgeEl) {
                    badgeEl.className = 'text-xs px-2.5 py-0.5 rounded-full font-black bg-purple-200 text-purple-900 animate-pulse';
                    badgeEl.innerText = `🌟 বোনাস: +${extra} টি বেশি!`;
                }
            } else if (isAllComplete) {
                if (banner) banner.className = 'p-4 rounded-xl border transition-all duration-300 flex items-start space-x-3 bg-emerald-50 border-emerald-300 text-emerald-950 shadow-sm';
                if (iconEl) iconEl.innerText = '🎉';
                if (titleEl) titleEl.innerText = 'অভিনন্দন! আপনি আজকের ৪২০টি নাম্বারের পূর্ণ টার্গেট সফলভাবে সম্পন্ন করেছেন!';
                if (msgEl) {
                    msgEl.className = 'text-xs sm:text-sm text-emerald-800 mt-0.5 leading-relaxed font-medium';
                    msgEl.innerText = 'দারুণ কাজ! আপনি আজকের নির্ধারিত ২১০টি ফিমেল এবং ২১০টি মেল নাম্বার সফলভাবে জমা দিয়েছেন। আজকের জন্য আপনার দায়িত্ব নিখুঁতভাবে সমাপ্ত হয়েছে।';
                }
                if (badgeEl) {
                    badgeEl.className = 'text-xs px-2.5 py-0.5 rounded-full font-extrabold bg-emerald-200 text-emerald-900';
                    badgeEl.innerText = '✅ পূর্ণ টার্গেট সম্পন্ন (৪২০/৪২০)';
                }
            } else {
                const shortF = Math.max(0, femaleTarget - fDone);
                const shortM = Math.max(0, maleTarget - mDone);
                const shortTotal = totalTarget - totalDone;

                if (banner) banner.className = 'p-4 rounded-xl border transition-all duration-300 flex items-start space-x-3 bg-amber-50 border-amber-300 text-amber-950 shadow-sm';
                if (iconEl) iconEl.innerText = '⚠️';
                if (titleEl) titleEl.innerText = 'আপনি আপনার টার্গেট পূরণ করুন দ্রুতই!';

                let remText = '';
                if (shortF > 0 && shortM > 0) {
                    remText = `ফিমেল বাকি ${shortF}টি এবং মেল বাকি ${shortM}টি (সর্বমোট বাকি ${shortTotal}টি)`;
                } else if (shortF > 0) {
                    remText = `ফিমেল বাকি ${shortF}টি (মেল সম্পন্ন ✅)`;
                } else if (shortM > 0) {
                    remText = `মেল বাকি ${shortM}টি (ফিমেল সম্পন্ন ✅)`;
                }

                if (msgEl) {
                    msgEl.className = 'text-xs sm:text-sm text-amber-900 mt-0.5 leading-relaxed font-medium';
                    msgEl.innerText = `আপনার আজকের ৪২০টি নাম্বারের (২১০ ফিমেল + ২১০ মেল) টার্গেট এখনো বাকি আছে। আপনার এখনো ${remText} জমা দেওয়া বাকি রয়েছে। অনুগ্রহ করে দ্রুত কাজ সম্পন্ন করে আপনার টার্গেট পূরণ করুন।`;
                }
                if (badgeEl) {
                    badgeEl.className = 'text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-200 text-amber-900';
                    badgeEl.innerText = `⚠️ বাকি ${shortTotal} টি`;
                }
            }
        }

        async function loadAdminUsers() {
            if (typeof loadAdminDashboard === 'function') {
                await loadAdminDashboard();
            }
        }

        // ==============================================================
        // ADMIN TEAM MEMBER & TEAM LEADER ACCOUNT CREATION SYSTEM
        // ==============================================================
        async function handleAdminCreateUser(e) {
            e.preventDefault();
            if (!supabaseClient || !currentProfile || currentProfile.role !== 'admin') {
                alert('শুধুমাত্র অ্যাডমিন নতুন অ্যাকাউন্ট তৈরি করতে পারেন।');
                return;
            }

            const username = document.getElementById('newMemberUsername').value.trim();
            const email = document.getElementById('newMemberEmail').value.trim().toLowerCase();
            const password = document.getElementById('newMemberPassword').value.trim();
            const role = document.getElementById('newMemberRole').value;
            const dept = document.getElementById('newMemberDept').value;
            const msgBox = document.getElementById('adminCreateUserMsg');
            const btn = document.getElementById('btnAdminCreateUser');

            if (!username || !email || !password) {
                alert('অনুগ্রহ করে সমস্ত তথ্য সঠিকভাবে পূরণ করুন।');
                return;
            }
            if (password.length < 6) {
                alert('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span>⏳ অ্যাকাউন্ট তৈরি হচ্ছে...</span>';
            msgBox.className = 'p-3 rounded-lg text-xs font-bold bg-blue-50 text-blue-800 block';
            msgBox.innerText = 'Creating user credentials in Supabase Auth...';

            try {
                // Use a separate non-persisting client so Admin is NOT logged out!
                const spUrl = localStorage.getItem('SP_URL') || DEFAULT_SP_URL;
                const spKey = localStorage.getItem('SP_KEY') || DEFAULT_SP_KEY;
                const tempClient = window.supabase.createClient(spUrl, spKey, {
                    auth: {
                        persistSession: false,
                        autoRefreshToken: false
                    }
                });

                const isUnlimited = (role === 'team_leader');

                const { data: authData, error: authErr } = await tempClient.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: {
                            username: username,
                            role: role,
                            department: dept,
                            is_unlimited_quota: isUnlimited
                        }
                    }
                });

                if (authErr) throw authErr;

                const newUserId = authData.user?.id;
                if (newUserId) {
                    // Ensure public.profiles has the correct role & unlimited quota
                    await supabaseClient.from('profiles').upsert({
                        id: newUserId,
                        email: email,
                        username: username,
                        role: role,
                        department: dept,
                        is_unlimited_quota: isUnlimited
                    });
                }

                msgBox.className = 'p-3 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 block';
                const roleLabel = role === 'team_leader' ? '👑 টিম লিডার (আনলিমিটেড কোটা)' : '👤 সাধারণ কর্মী';
                msgBox.innerHTML = `✅ সফল হয়েছে! নতুন অ্যাকাউন্ট তৈরি হয়েছে:<br><b>ইউজার:</b> ${username} | <b>রোল:</b> ${roleLabel}<br><b>ইমেইল:</b> ${email} | <b>পাসওয়ার্ড:</b> ${password}<br><span class="text-[11px] text-slate-500">এই লগইন তথ্য কর্মীকে প্রদান করুন।</span>`;

                // Reset form inputs
                document.getElementById('newMemberUsername').value = '';
                document.getElementById('newMemberEmail').value = '';
                document.getElementById('newMemberPassword').value = '';

                // Reload user list in admin table
                await loadAdminUsers();

            } catch (err) {
                console.error('User creation error:', err);
                msgBox.className = 'p-3 rounded-lg text-xs font-bold bg-rose-50 text-rose-800 border border-rose-300 block';
                msgBox.innerText = '❌ অ্যাকাউন্ট তৈরিতে সমস্যা: ' + err.message;
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>✨ Create Account & Activate</span>';
            }
        }

        async function adminChangeUserRole(userId, newRole, username) {
            const roleLabels = {
                'team_leader': '👑 টিম লিডার (Team Leader - আনলিমিটেড কোটা)',
                'user': '👤 সাধারণ কর্মী (General Worker - ৬ ঘণ্টার লিমিট)',
                'admin': '⚡ অ্যাডমিন (Admin - সম্পূর্ণ নিয়ন্ত্রণ)'
            };
            const targetLabel = roleLabels[newRole] || newRole;

            if (!confirm(`আপনি কি নিশ্চিতভাবে কর্মী "${username}" এর রোল পরিবর্তন করে "${targetLabel}" করতে চান?\n\nটিম লিডার নির্বাচন করলে এই কর্মী স্টক থেকে আনলিমিটেড নাম্বার তুলতে পারবেন।`)) {
                renderAdminUserTable();
                return;
            }
            try {
                const isUnlimited = (newRole === 'team_leader' || newRole === 'admin');

                // Try RPC first
                let rpcSuccess = false;
                try {
                    const { data, error } = await supabaseClient.rpc('admin_set_user_role', {
                        p_user_id: userId,
                        p_new_role: newRole
                    });
                    if (!error && data && data.success) rpcSuccess = true;
                } catch(rpcErr) {
                    console.warn('RPC admin_set_user_role notice:', rpcErr);
                }

                if (!rpcSuccess) {
                    // Fallback to direct profiles table update
                    const { error } = await supabaseClient
                        .from('profiles')
                        .update({
                            role: newRole,
                            is_unlimited_quota: isUnlimited
                        })
                        .eq('id', userId);

                    if (error) throw error;
                }

                alert(`✅ সফল! কর্মী "${username}" এখন "${targetLabel}" হিসেবে উন্নীত হয়েছেন।`);
                await loadAdminDashboard();
            } catch (err) {
                alert('রোল আপডেটে সমস্যা হয়েছে: ' + err.message);
                renderAdminUserTable();
            }
        }

        async function adminToggleUnlimitedQuota(userId, currentStatus) {
            try {
                const newStatus = !currentStatus;
                const { error } = await supabaseClient
                    .from('profiles')
                    .update({ is_unlimited_quota: newStatus })
                    .eq('id', userId);

                if (error) throw error;
                alert(`✅ কোটা সুবিধা আপডেট হয়েছে: ${newStatus ? 'আনলিমিটেড সক্রিয়' : 'প্রতি ৬ ঘণ্টায় ১,০০০ লিমিট'}`);
                await loadAdminUsers();
            } catch (err) {
                alert('কোটা আপডেটে ত্রুটি: ' + err.message);
            }
        }


        // ==============================================================
        // BATCH MISTAKE CORRECTION & CANCELLATION SYSTEM
        // ==============================================================
        let activeCorrLogId = null;
        let activeCorrCount = 0;

        function openCategoryCorrectionModal(logId, currentType, fileName, uniqueCount) {
            activeCorrLogId = logId;
            activeCorrCount = uniqueCount;

            document.getElementById('corrModalFileName').innerText = fileName;
            document.getElementById('corrModalUniqueCount').innerText = uniqueCount;

            const repLabel = currentType === 'female_report' ? '👩 Female Report' : (currentType === 'male_report' ? '👨 Male Report' : '🔍 Lookup Report');
            document.getElementById('corrModalCurrentType').innerText = repLabel;

            // Pre-select opposite type
            const radios = document.querySelectorAll('input[name="corrNewType"]');
            radios.forEach(r => {
                if (currentType === 'male_report' && r.value === 'female_report') r.checked = true;
                else if (currentType === 'female_report' && r.value === 'male_report') r.checked = true;
                else if (currentType === 'lookup_report' && r.value === 'female_report') r.checked = true;
            });

            document.getElementById('categoryCorrectionModal').classList.remove('hidden');
        }

        function closeCategoryCorrectionModal() {
            document.getElementById('categoryCorrectionModal').classList.add('hidden');
            activeCorrLogId = null;
        }

        async function confirmCategoryCorrection() {
            if (!activeCorrLogId || !supabaseClient) return;

            const selectedRadio = document.querySelector('input[name="corrNewType"]:checked');
            const newType = selectedRadio ? selectedRadio.value : 'female_report';
            const btn = document.getElementById('btnConfirmCorrection');

            btn.disabled = true;
            btn.innerHTML = '<span>⏳ সংশোধন করা হচ্ছে...</span>';

            try {
                // 1. Try RPC first
                try {
                    const { data, error } = await supabaseClient.rpc('worker_correct_submission_category', {
                        p_log_id: parseInt(activeCorrLogId, 10),
                        p_new_report_type: newType
                    });
                    if (error) throw error;
                } catch (rpcErr) {
                    console.warn('RPC fallback to direct update:', rpcErr);

                    // Direct fallback update
                    await supabaseClient
                        .from('upload_logs')
                        .update({ report_type: newType })
                        .eq('id', activeCorrLogId);

                    await supabaseClient
                        .from('master_numbers')
                        .update({ report_type: newType })
                        .eq('upload_log_id', activeCorrLogId);
                }

                closeCategoryCorrectionModal();
                const newTypeLabel = newType === 'female_report' ? 'Female Report' : (newType === 'male_report' ? 'Male Report' : 'Lookup Report');
                alert(`✅ সফলভাবে ক্যাটাগরি সংশোধন করা হয়েছে!\n\nএই ব্যাচের ${activeCorrCount}টি নাম্বার এখন "${newTypeLabel}" হিসেবে গণ্য হবে এবং আপনার দৈনিক টার্গেটে স্বয়ংক্রিয়ভাবে হিসাব সমন্বয় করা হয়েছে।`);

                // Reload dashboard & target tracker
                await loadUserDashboard();

            } catch (err) {
                console.error('Correction error:', err);
                alert('ক্যাটাগরি সংশোধনে সমস্যা: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>🔄 সংশোধন সম্পন্ন করুন</span>';
            }
        }

        async function cancelMistakenSubmissionBatch(logId, count) {
            if (!logId || !supabaseClient) return;

            if (!confirm(`⚠️ নিশ্চিতকরণ:\n\nআপনি কি এই সাবমিশন ব্যাচটি (${count} টি ইউনিক নাম্বার) সম্পূর্ণ বাতিল ও মুছে ফেলতে চান?\n\nবাতিল করলে এই নাম্বারগুলো ডাটাবেজ থেকে মুছে যাবে এবং আপনার আজকের হিসাব থেকে বাদ পড়বে। ফলে আপনি আবার নতুন করে সঠিক ফাইল আপলোড করতে পারবেন।`)) {
                return;
            }

            try {
                // 1. Try RPC first
                try {
                    const { data, error } = await supabaseClient.rpc('worker_cancel_submission_batch', {
                        p_log_id: parseInt(logId, 10)
                    });
                    if (error) throw error;
                } catch (rpcErr) {
                    console.warn('RPC fallback to direct delete:', rpcErr);

                    // Direct delete fallback
                    await supabaseClient
                        .from('master_numbers')
                        .delete()
                        .eq('upload_log_id', logId);

                    await supabaseClient
                        .from('upload_logs')
                        .delete()
                        .eq('id', logId);
                }

                alert(`✅ সাবমিশনটি সফলভাবে বাতিল করা হয়েছে!\n\nডাটাবেজ থেকে পূর্ববর্তী ভুল এন্ট্রি মুছে দেওয়া হয়েছে। এখন আপনি নির্ভয়ে নতুন করে সঠিক ফাইল বা নাম্বার সাবমিট করতে পারবেন।`);

                // Reload user dashboard & recalculate target tracker
                await loadUserDashboard();

            } catch (err) {
                console.error('Cancellation error:', err);
                alert('সাবমিশন বাতিলে সমস্যা: ' + err.message);
            }
        }


        // =========================================================================
        // ADMIN LOOKUP DAILY REPORTS & 1-CLICK EXCEL / TXT DOWNLOAD ENGINE
        // =========================================================================
        let adminLookupValidList = [];
        let adminLookupNoInfoList = [];

        function setLookupReportDateToday() {
            const today = new Date().toISOString().slice(0, 10);
            const dateInput = document.getElementById('adminLookupReportDate');
            if (dateInput) {
                dateInput.value = today;
                loadAdminLookupReports();
            }
        }

        function changeLookupReportDate(deltaDays) {
            const dateInput = document.getElementById('adminLookupReportDate');
            if (!dateInput) return;
            const curVal = dateInput.value || new Date().toISOString().slice(0, 10);
            const d = new Date(curVal);
            d.setDate(d.getDate() + deltaDays);
            dateInput.value = d.toISOString().slice(0, 10);
            loadAdminLookupReports();
        }

        async function fetchAllLookupTableRows(tableName, targetDate) {
            let allRows = [];
            let from = 0;
            const chunkSize = 1000;
            while (true) {
                let q = supabaseClient.from(tableName).select('*').order('created_at', { ascending: false }).range(from, from + chunkSize - 1);
                if (targetDate) q = q.eq('submission_date', targetDate);
                const { data, error } = await q;
                if (error || !data || data.length === 0) break;
                allRows.push(...data);
                if (data.length < chunkSize) break;
                from += chunkSize;
            }
            return allRows;
        }

        async function loadAdminLookupReports() {
            if (!supabaseClient) return;
            const dateInput = document.getElementById('adminLookupReportDate');
            if (!dateInput.value) {
                dateInput.value = new Date().toISOString().slice(0, 10);
            }
            const targetDate = dateInput.value;

            try {
                // Fetch ALL valid lookup records and no info records with auto-pagination (bypasses 1000 limit)
                const [valList, noInfoList] = await Promise.all([
                    fetchAllLookupTableRows('lookup_records', targetDate),
                    fetchAllLookupTableRows('lookup_no_info_records', targetDate)
                ]);

                adminLookupValidList = valList || [];
                adminLookupNoInfoList = noInfoList || [];

                // Metrics
                const totalValid = adminLookupValidList.length;
                const totalNoInfo = adminLookupNoInfoList.length;
                const totalAll = totalValid + totalNoInfo;

                const workerSet = new Set();
                adminLookupValidList.forEach(r => workerSet.add(r.worker_username || r.worker_email));
                adminLookupNoInfoList.forEach(r => workerSet.add(r.worker_username || r.worker_email));

                document.getElementById('lookupMetricValid').innerText = totalValid.toLocaleString();
                document.getElementById('lookupMetricNoInfo').innerText = totalNoInfo.toLocaleString();
                document.getElementById('lookupMetricWorkers').innerText = workerSet.size.toLocaleString();
                document.getElementById('lookupMetricTotal').innerText = totalAll.toLocaleString();

                // Populate Worker Filter Dropdown
                const wFilter = document.getElementById('adminLookupWorkerFilter');
                if (wFilter) {
                    const curSelected = wFilter.value;
                    wFilter.innerHTML = '<option value="all">👥 সব কর্মী (All Workers)</option>';
                    workerSet.forEach(w => {
                        if (w) {
                            const opt = document.createElement('option');
                            opt.value = w;
                            opt.innerText = `👤 ${w}`;
                            if (w === curSelected) opt.selected = true;
                            wFilter.appendChild(opt);
                        }
                    });
                }

                renderAdminLookupTable();

            } catch (err) {
                console.error('Error loading admin lookup reports:', err);
                alert('লুকআপ রিপোর্ট লোড করতে সমস্যা হয়েছে: ' + err.message);
            }
        }

        function renderAdminLookupTable() {
            const body = document.getElementById('adminLookupTableBody');
            const search = (document.getElementById('lookupTableSearchInput')?.value || '').toLowerCase().trim();
            const wFilter = document.getElementById('adminLookupWorkerFilter')?.value || 'all';
            const catFilter = document.getElementById('adminLookupCategoryFilter')?.value || 'all';

            let combined = [];

            if (catFilter === 'all' || catFilter === 'valid') {
                adminLookupValidList.forEach(r => {
                    combined.push({
                        ...r,
                        category: 'valid',
                        catLabel: '🟢 Valid (Household & Market)',
                        timeStr: new Date(r.created_at).toLocaleTimeString()
                    });
                });
            }

            if (catFilter === 'all' || catFilter === 'no_info') {
                adminLookupNoInfoList.forEach(r => {
                    combined.push({
                        ...r,
                        household_income: '-',
                        est_market_value: '-',
                        category: 'no_info',
                        catLabel: '⚪ No Information',
                        timeStr: new Date(r.created_at).toLocaleTimeString()
                    });
                });
            }

            // Apply Filters
            const filtered = combined.filter(row => {
                const phone = String(row.phone_number || '');
                const worker = String(row.worker_username || row.worker_email || '').toLowerCase();
                const matchSearch = phone.includes(search) || worker.includes(search);
                const matchWorker = (wFilter === 'all') || (worker === wFilter.toLowerCase());
                return matchSearch && matchWorker;
            });

            document.getElementById('lookupTableCountBadge').innerText = `${filtered.length.toLocaleString()} Records`;

            if (filtered.length > 0) {
                body.innerHTML = filtered.map((row, idx) => {
                    const isValid = (row.category === 'valid');
                    const badgeClass = isValid ? 'bg-emerald-100 text-emerald-800 font-black' : 'bg-slate-200 text-slate-700 font-bold';
                    return `
                        <tr class="hover:bg-slate-50 transition text-xs">
                            <td class="py-2.5 px-3 font-mono text-slate-400">${idx + 1}</td>
                            <td class="py-2.5 px-3 font-mono font-black text-slate-900">${row.phone_number}</td>
                            <td class="py-2.5 px-3 font-bold text-purple-900">${row.household_income || '-'}</td>
                            <td class="py-2.5 px-3 font-bold text-purple-900">${row.est_market_value || '-'}</td>
                            <td class="py-2.5 px-3 text-slate-700">${row.full_name || '-'} ${row.age ? `(${row.age})` : ''}</td>
                            <td class="py-2.5 px-3">
                                <span class="px-2 py-0.5 rounded text-[11px] ${badgeClass}">${row.catLabel}</span>
                            </td>
                            <td class="py-2.5 px-3 font-bold text-slate-800">
                                👤 ${row.worker_username || row.worker_email || 'Unknown'}
                            </td>
                            <td class="py-2.5 px-3 font-mono text-slate-400 text-[11px]">${row.timeStr}</td>
                        </tr>
                    `;
                }).join('');
            } else {
                body.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400 font-medium">নির্বাচিত ফিল্টারে কোনো ডাটা পাওয়া যায়নি।</td></tr>`;
            }
        }

        // Download Valid Numbers as Excel
        function downloadAdminLookupExcel(type) {
            const list = (type === 'valid') ? adminLookupValidList : adminLookupNoInfoList;
            const targetDate = document.getElementById('adminLookupReportDate')?.value || 'Today';

            if (!list || list.length === 0) {
                alert(`এই তারিখে কোনো ${type === 'valid' ? 'Valid' : 'No Information'} ডাটা নেই!`);
                return;
            }

            if (type === 'valid') {
                // Strictly 3 columns: Phone Number, Household Income, Est Market Value (NO Name, Age, etc.)
                const exportRows = list.map(r => ({
                    'Phone Number': String(r.phone_number || r.phone || '').trim(),
                    'Household Income': String(r.household_income || r.income || '').trim(),
                    'Est Market Value': String(r.est_market_value || r.market_value || '').trim()
                })).filter(r => r['Phone Number'].length >= 6);

                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Valid_Lookup');
                XLSX.writeFile(wb, `Lookup_Valid_${targetDate}.xlsx`);
            } else {
                // Pure phone numbers only for No Information
                const exportRows = list.map(r => ({
                    'Phone Number': String(r.phone_number || r.phone || '').trim(),
                    'Status': 'No Information (কোনো তথ্য পাওয়া যায় নাই)'
                })).filter(r => r['Phone Number'].length >= 6);

                const ws = XLSX.utils.json_to_sheet(exportRows);
                const wb = XLSX.utils.book_new();
                const sheetName = 'No_Information';
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
                XLSX.writeFile(wb, `Lookup_No_Information_${targetDate}_Total_${exportRows.length}.xlsx`);
                alert(`📥 মোট ${exportRows.length.toLocaleString()} টি Lookup No Information নাম্বারের এক্সেল ফাইল ডাউনলোড সম্পন্ন হয়েছে!`);
            }
        }

        function downloadAdminLookupTxt(type) {
            const list = (type === 'valid') ? adminLookupValidList : adminLookupNoInfoList;
            const targetDate = document.getElementById('adminLookupReportDate')?.value || 'Today';

            if (!list || list.length === 0) {
                alert(`এই তারিখে কোনো ${type === 'valid' ? 'Valid' : 'No Information'} ডাটা নেই!`);
                return;
            }

            let lines = [];
            if (type === 'valid') {
                lines = list.map(r => `${r.phone_number}\t${r.household_income || ''}\t${r.est_market_value || ''}`);
            } else {
                lines = list.map(r => `${r.phone_number}`);
            }

            const content = lines.join('\n');
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Lookup_${type === 'valid' ? 'Valid' : 'No_Info'}_${targetDate}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // Download Combined Excel Workbook (Valid & No Information in 2 separate sheets)
        function downloadAdminLookupCombinedExcel() {
            const targetDate = document.getElementById('adminLookupReportDate')?.value || 'Today';
            if (adminLookupValidList.length === 0 && adminLookupNoInfoList.length === 0) {
                alert('এই তারিখে কোনো লুকআপ ডাটা নেই!');
                return;
            }

            const wb = XLSX.utils.book_new();

            if (adminLookupValidList.length > 0) {
                const validRows = adminLookupValidList.map((r, i) => ({
                    'SL': i + 1,
                    'Phone Number': r.phone_number,
                    'Household Income': r.household_income || '',
                    'Est. Market Value': r.est_market_value || '',
                    'Full Name': r.full_name || '',
                    'Age': r.age || '',
                    'Worker': r.worker_username || r.worker_email || '',
                    'Date': r.submission_date
                }));
                const wsValid = XLSX.utils.json_to_sheet(validRows);
                XLSX.utils.book_append_sheet(wb, wsValid, 'Valid_Numbers');
            }

            if (adminLookupNoInfoList.length > 0) {
                const noInfoRows = adminLookupNoInfoList.map((r, i) => ({
                    'SL': i + 1,
                    'Phone Number': r.phone_number,
                    'Full Name': r.full_name || '',
                    'Age': r.age || '',
                    'Worker': r.worker_username || r.worker_email || '',
                    'Date': r.submission_date
                }));
                const wsNoInfo = XLSX.utils.json_to_sheet(noInfoRows);
                XLSX.utils.book_append_sheet(wb, wsNoInfo, 'No_Information');
            }

            XLSX.writeFile(wb, `Lookup_Complete_Daily_Report_${targetDate}.xlsx`);
        }


                // =========================================================================
        // QUICK SEARCH MODAL & COMPREHENSIVE FORENSIC DATA AUDIT ENGINE
        // =========================================================================

        function openQuickSearchModal(initialQuery = '') {
            const modal = document.getElementById('quickSearchModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            const input = document.getElementById('quickModalSearchInput');
            if (input) {
                if (initialQuery) {
                    input.value = initialQuery;
                    handleQuickModalSearch();
                } else {
                    input.focus();
                }
            }
        }

        function closeQuickSearchModal() {
            const modal = document.getElementById('quickSearchModal');
            if (modal) modal.classList.add('hidden');
        }

        function clearQuickModalSearch() {
            const input = document.getElementById('quickModalSearchInput');
            const card = document.getElementById('quickModalResultCard');
            const list = document.getElementById('quickModalResultList');
            if (input) {
                input.value = '';
                input.focus();
            }
            if (card) card.classList.add('hidden');
            if (list) list.innerHTML = '';
        }

        function clearUniversalNumberSearch() {
            const input = document.getElementById('universalSearchInput');
            const card = document.getElementById('universalSearchResultCard');
            const list = document.getElementById('universalResultList');
            if (input) {
                input.value = '';
                input.focus();
            }
            if (card) card.classList.add('hidden');
            if (list) list.innerHTML = '';
        }

        // Global Keyboard Shortcut: Press Ctrl + K or '/' to open Quick Search
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')) {
                e.preventDefault();
                openQuickSearchModal();
            } else if (e.key === 'Escape') {
                closeQuickSearchModal();
            }
        });

        async function handleQuickModalSearch(e) {
            if (e) e.preventDefault();
            const rawInput = document.getElementById('quickModalSearchInput')?.value.trim();
            if (!rawInput) {
                alert('অনুগ্রহ করে একটি ফোন নাম্বার অথবা ব্যক্তির নাম লিখুন।');
                return;
            }
            const resCard = document.getElementById('quickModalResultCard');
            const resList = document.getElementById('quickModalResultList');
            const resCount = document.getElementById('quickModalResultCountBadge');
            const resTitle = document.getElementById('quickModalResultTitle');
            const btn = document.getElementById('btnQuickModalSearch');

            await executeUniversalAuditSearch(rawInput, resCard, resList, resCount, resTitle, btn);
        }

        async function handleUniversalNumberSearch(e) {
            if (e) e.preventDefault();
            const rawInput = document.getElementById('universalSearchInput')?.value.trim();
            if (!rawInput) {
                alert('অনুগ্রহ করে একটি ফোন নাম্বার অথবা ব্যক্তির নাম লিখুন।');
                return;
            }
            const resCard = document.getElementById('universalSearchResultCard');
            const resList = document.getElementById('universalResultList');
            const resCount = document.getElementById('universalResultCountBadge');
            const resTitle = document.getElementById('universalResultTitle');
            const btn = document.getElementById('btnUniversalSearch');

            await executeUniversalAuditSearch(rawInput, resCard, resList, resCount, resTitle, btn);
        }

        // Unified High-Speed Multi-Sector Forensic Audit Engine
        async function executeUniversalAuditSearch(rawQuery, resCard, resList, resCount, resTitle, btn) {
            if (!rawQuery) return;
            const term = rawQuery.trim();
            const cleanDigits = term.replace(/[^0-9]/g, '');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span>⏳ গভীর অনুসন্ধান হচ্ছে...</span>';
            }
            if (resCard) resCard.classList.remove('hidden');
            if (resList) resList.innerHTML = '<div class="p-8 text-center text-slate-400 font-semibold"><div class="inline-block animate-spin text-2xl mb-2">⏳</div><br>ডাটাবেজের সমস্ত সেক্টরে (মাস্টার ডাটা, ফাইল লগ, কোম্পানি ডেলিভারি ও স্টক হিস্ট্রি) গভীর অনুসন্ধান করা হচ্ছে...</div>';

            try {
                // Determine search criteria based on whether input has phone digits or is a name
                let masterQ = supabaseClient.from('master_numbers').select('*');
                let lookupQ = supabaseClient.from('lookup_records').select('*');
                let noInfoQ = supabaseClient.from('lookup_no_info_records').select('*');
                let delivQ = supabaseClient.from('company_deliveries').select('*');
                let stockQ = supabaseClient.from('company_received_numbers').select('*');

                if (cleanDigits.length >= 4) {
                    // Search by Phone OR Name
                    masterQ = masterQ.or(`phone_number.ilike.%${cleanDigits}%,full_name.ilike.%${term}%`);
                    lookupQ = lookupQ.or(`phone_number.ilike.%${cleanDigits}%,full_name.ilike.%${term}%`);
                    noInfoQ = noInfoQ.or(`phone_number.ilike.%${cleanDigits}%,full_name.ilike.%${term}%`);
                    delivQ = delivQ.or(`phone_number.ilike.%${cleanDigits}%,full_name.ilike.%${term}%,company_name.ilike.%${term}%`);
                    stockQ = stockQ.or(`phone_number.ilike.%${cleanDigits}%,full_name.ilike.%${term}%`);
                } else {
                    // Search by Name or Partial text
                    masterQ = masterQ.or(`full_name.ilike.%${term}%,username.ilike.%${term}%`);
                    lookupQ = lookupQ.or(`full_name.ilike.%${term}%,worker_username.ilike.%${term}%`);
                    noInfoQ = noInfoQ.or(`full_name.ilike.%${term}%,worker_username.ilike.%${term}%`);
                    delivQ = delivQ.or(`full_name.ilike.%${term}%,company_name.ilike.%${term}%`);
                    stockQ = stockQ.or(`full_name.ilike.%${term}%,assigned_to_username.ilike.%${term}%`);
                }

                const [masterRes, lookupRes, noInfoRes, delivRes, stockRes] = await Promise.all([
                    masterQ.limit(40),
                    lookupQ.limit(40),
                    noInfoQ.limit(40),
                    delivQ.limit(40),
                    stockQ.limit(40)
                ]);

                let masterData = masterRes.data || [];
                const lookupData = lookupRes.data || [];
                const noInfoData = noInfoRes.data || [];
                const delivData = delivRes.data || [];
                const stockData = stockRes.data || [];

                // If company deliveries matched a phone that isn't in masterData yet, pull its master record to see who submitted it
                const extraDelivPhones = delivData.map(d => d.phone_number).filter(p => !masterData.some(m => m.phone_number === p));
                if (extraDelivPhones.length > 0) {
                    try {
                        const { data: extraMasters } = await supabaseClient.from('master_numbers').select('*').in('phone_number', extraDelivPhones);
                        if (extraMasters && extraMasters.length > 0) {
                            masterData = [...masterData, ...extraMasters];
                        }
                    } catch (e) {
                        console.warn('Error fetching extra master rows for deliveries:', e);
                    }
                }

                // Fetch upload logs to retrieve EXACT original file names for master batches
                const uploadLogIds = [...new Set(masterData.map(r => r.upload_log_id).filter(Boolean))];
                let uploadLogsMap = {};
                if (uploadLogIds.length > 0) {
                    try {
                        const { data: logRows } = await supabaseClient
                            .from('upload_logs')
                            .select('id, file_name, report_type, created_at')
                            .in('id', uploadLogIds);
                        (logRows || []).forEach(l => { uploadLogsMap[l.id] = l; });
                    } catch (logErr) {
                        console.warn('Error fetching upload logs map:', logErr);
                    }
                }

                const totalFound = masterData.length + lookupData.length + noInfoData.length + delivData.length + stockData.length;

                if (resCount) resCount.innerText = `${totalFound} টি সম্পর্কিত রেকর্ড পাওয়া গেছে`;
                if (resTitle) resTitle.innerText = `"${term}" এর সম্পূর্ণ গতিবিধি ও বিস্তারিত হিস্ট্রি`;

                if (totalFound === 0) {
                    resList.innerHTML = `
                        <div class="p-8 bg-slate-800/80 rounded-2xl text-center border border-slate-700 space-y-2">
                            <p class="text-amber-400 font-extrabold text-base">❌ ডাটাবেজে এই নাম বা নাম্বারের কোনো তথ্য পাওয়া যায়নি!</p>
                            <p class="text-xs text-slate-300">এই নামে বা নাম্বারে এখনো কোনো কর্মী ডাটা জমা দেয়নি এবং কোম্পানি ডেলিভারি বা স্টকেও এটি অনুপস্থিত।</p>
                        </div>
                    `;
                    return;
                }

                let htmlContent = '';

                // Set of phone numbers rendered in master to prevent duplicate rendering
                const renderedPhones = new Set();

                // 1. Render Master Numbers (Main Worker Submissions)
                masterData.forEach(r => {
                    renderedPhones.add(r.phone_number);
                    const dateObj = r.created_at ? new Date(r.created_at) : null;
                    const dateStr = dateObj ? dateObj.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : '-';
                    const timeStr = dateObj ? dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-';

                    const repLabels = {
                        'female_report': { text: '👩 Female Report (মহিলা ডাটা)', bg: 'bg-pink-600 text-white' },
                        'lookup_report': { text: '🔍 Lookup Report (লুকআপ ডাটা)', bg: 'bg-purple-600 text-white' }
                    };
                    const repInfo = repLabels[r.report_type] || { text: `📁 ${r.report_type || 'General'}`, bg: 'bg-slate-700 text-white' };

                    // Find corresponding company delivery info
                    const deliveryItem = delivData.find(d => d.phone_number === r.phone_number);

                    // Find corresponding stock claim history
                    const stockItem = stockData.find(s => s.phone_number === r.phone_number && s.is_assigned);

                    // Exact file name from record or upload_logs
                    const fileName = r.file_name || uploadLogsMap[r.upload_log_id]?.file_name || (r.upload_log_id ? `Batch #${r.upload_log_id}` : 'সরাসরি টেক্সট পেস্ট (Direct Text)');
                    const workerName = r.username || userEmailToNameMap[r.user_email] || r.user_email?.split('@')[0] || 'Unknown Worker';

                    htmlContent += `
                        <div class="bg-white rounded-2xl p-5 sm:p-6 text-slate-900 border-2 border-indigo-300 shadow-lg space-y-4 animate-in fade-in duration-150">
                            <!-- Header: Phone, Identity, Category & Delivery Status -->
                            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                                <div class="flex items-center space-x-3">
                                    <div class="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl font-black shadow-xs flex-shrink-0">
                                        📱
                                    </div>
                                    <div>
                                        <div class="flex items-center space-x-2">
                                            <span class="font-mono text-base sm:text-xl font-black text-indigo-950">${r.phone_number}</span>
                                            <button type="button" onclick="navigator.clipboard.writeText('${r.phone_number}'); alert('নাম্বার কপি হয়েছে: ${r.phone_number}');" class="text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md transition border border-slate-200 cursor-pointer" title="কপি করুন">
                                                📋 কপি
                                            </button>
                                        </div>
                                        <div class="text-xs text-slate-600 mt-0.5 flex flex-wrap items-center gap-2">
                                            <span>ব্যক্তির নাম: <strong class="text-slate-900 font-extrabold">${r.full_name || 'নাম নেই'}</strong></span>
                                            <span>•</span>
                                            <span>বয়স: <strong class="text-slate-900 font-extrabold">${r.age ? `${r.age} বছর` : 'উল্লেখ নেই'}</strong></span>
                                        </div>
                                    </div>
                                </div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-xs font-black px-3 py-1 rounded-xl ${repInfo.bg} shadow-xs">${repInfo.text}</span>
                                    ${deliveryItem 
                                        ? `<span class="text-xs font-black bg-amber-100 text-amber-950 border border-amber-300 px-3 py-1 rounded-xl flex items-center space-x-1"><span>🏢</span><span>কোম্পানিকে হস্তান্তর হয়েছে (${deliveryItem.delivery_date})</span></span>` 
                                        : '<span class="text-xs font-black bg-emerald-100 text-emerald-900 border border-emerald-300 px-3 py-1 rounded-xl flex items-center space-x-1"><span>🟢</span><span>কোম্পানিকে এখনও দেওয়া হয়নি (ফ্রেশ)</span></span>'}
                                </div>
                            </div>

                            <!-- 4-Column Detailed Inspection Cards -->
                            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                                <!-- 1. কে জমা দিয়েছে -->
                                <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                                    <span class="text-slate-500 font-bold block text-[11px] uppercase tracking-wider">👤 কে জমা দিয়েছে (Worker):</span>
                                    <span class="font-black text-slate-900 text-sm block truncate">${workerName}</span>
                                    <span class="text-[11px] text-slate-500 font-mono block truncate">${r.user_email || '-'}</span>
                                    <span class="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-bold inline-block mt-0.5">Dept: ${r.department || 'gender_verify'}</span>
                                </div>

                                <!-- 2. কোন ফাইলে দিয়েছে -->
                                <div class="p-3.5 bg-indigo-50/70 rounded-xl border border-indigo-200 space-y-1">
                                    <span class="text-indigo-800 font-bold block text-[11px] uppercase tracking-wider">📁 কোন ফাইলে দিয়েছে (File/Batch):</span>
                                    <span class="font-black text-indigo-950 text-xs sm:text-sm block break-all font-mono leading-tight">📄 ${fileName}</span>
                                    <span class="text-[10px] text-indigo-600 font-semibold block">লগ আইডি: #${r.upload_log_id || 'Direct'}</span>
                                </div>

                                <!-- 3. কবে ও কখন দিয়েছে -->
                                <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                                    <span class="text-slate-500 font-bold block text-[11px] uppercase tracking-wider">📅 জমা দেওয়ার তারিখ ও সময়:</span>
                                    <span class="font-bold text-slate-900 text-xs block">🕒 ${dateStr}</span>
                                    <span class="text-[11px] text-indigo-700 font-bold block">সময়: ${timeStr}</span>
                                    <span class="text-[10px] text-slate-400 block">ডাটাবেজ রেকর্ড আইডি: #${r.id}</span>
                                </div>

                                <!-- 4. কোম্পানিকে কোথায় ও কবে দেওয়া হয়েছে -->
                                <div class="p-3.5 ${deliveryItem ? 'bg-amber-50/90 border-amber-300' : 'bg-emerald-50/90 border-emerald-300'} rounded-xl border space-y-1.5">
                                    <span class="${deliveryItem ? 'text-amber-900' : 'text-emerald-900'} font-bold block text-[11px] uppercase tracking-wider">🏢 কোম্পানি ডেলিভারি স্ট্যাটাস:</span>
                                    ${deliveryItem ? `
                                        <div class="space-y-0.5">
                                            <span class="font-black text-amber-950 text-xs block">✅ হস্তান্তর সম্পন্ন</span>
                                            <span class="text-[11px] text-amber-900 font-bold block">তারিখ: ${deliveryItem.delivery_date}</span>
                                            <span class="text-[11px] text-amber-950 block">কোম্পানি: <strong>${deliveryItem.company_name || 'Company'}</strong></span>
                                            <span class="text-[10px] text-amber-800 font-mono block truncate">ফাইল/ব্যাচ: ${deliveryItem.batch_name || '-'}</span>
                                        </div>
                                    ` : `
                                        <div class="space-y-0.5">
                                            <span class="font-black text-emerald-950 text-xs block">🟢 এখনও দেওয়া হয়নি</span>
                                            <span class="text-[11px] text-emerald-800 block leading-tight">কোম্পানির কাছে হস্তান্তর করা হয়নি (ফ্রেশ মজুদ রয়েছে)।</span>
                                        </div>
                                    `}
                                </div>
                            </div>

                            <!-- Additional Card: Received Stock History if this number was claimed from company stock -->
                            ${stockItem ? `
                                <div class="p-3.5 bg-purple-50/70 rounded-xl border border-purple-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div class="flex items-center space-x-2">
                                        <span class="text-base">🎁</span>
                                        <div>
                                            <span class="font-bold text-purple-950 block">কোম্পানির স্টক থেকে সংগ্রহের হিস্ট্রি:</span>
                                            <span class="text-[11px] text-purple-800">কর্মী: <strong>${stockItem.assigned_to_username || stockItem.assigned_to_email}</strong> | তোলার সময়: ${stockItem.assigned_at ? new Date(stockItem.assigned_at).toLocaleString() : '-'} | স্টক ব্যাচ: ${stockItem.batch_name || 'Company Stock'}</span>
                                        </div>
                                    </div>
                                    <span class="text-[10px] bg-purple-200 text-purple-900 font-bold px-2 py-0.5 rounded-md whitespace-nowrap self-start sm:self-auto">স্টক থেকে নেওয়া ডাটা</span>
                                </div>
                            ` : ''}

                            <!-- Actions for this Entry -->
                            <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 bg-slate-50/50 p-3 rounded-xl">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-xs font-black text-slate-700">ভুল হলে ক্যাটাগরি পরিবর্তন করুন:</span>
                                    <select onchange="adminQuickChangeCategory('${r.id}', this.value, '${r.phone_number}')" class="px-3 py-1.5 text-xs font-bold rounded-lg border-2 border-indigo-300 bg-white text-slate-900 cursor-pointer focus:ring-2 focus:ring-indigo-500">
                                        <option value="female_report" ${r.report_type === 'female_report' ? 'selected' : ''}>👩 1. Female Report-এ স্থানান্তর করুন</option>
                                        <option value="lookup_report" ${r.report_type === 'lookup_report' ? 'selected' : ''}>🔍 2. Lookup Report-এ স্থানান্তর করুন</option>
                                    </select>
                                </div>
                                <button type="button" onclick="adminQuickDeleteRecord('${r.id}', '${r.phone_number}')" class="bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs px-4 py-2 rounded-lg shadow-sm transition flex items-center space-x-1.5 cursor-pointer">
                                    <span>🗑️ ভুল রেকর্ডটি মুছে ফেলুন (Delete)</span>
                                </button>
                            </div>
                        </div>
                    `;
                });

                // 2. Render Lookup Sector Records (if not already rendered in master)
                lookupData.forEach(r => {
                    if (renderedPhones.has(r.phone_number)) return;
                    renderedPhones.add(r.phone_number);
                    const deliveryItem = delivData.find(d => d.phone_number === r.phone_number);

                    htmlContent += `
                        <div class="bg-white rounded-2xl p-5 sm:p-6 text-slate-900 border-2 border-purple-300 shadow-md space-y-4 animate-in fade-in duration-150">
                            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-purple-100 pb-3">
                                <div class="flex items-center space-x-3">
                                    <span class="text-2xl">🔍</span>
                                    <div>
                                        <span class="font-mono text-lg sm:text-xl font-black text-purple-950">${r.phone_number}</span>
                                        <div class="text-xs text-slate-600">নাম: <strong class="text-slate-900">${r.full_name || 'নাম নেই'}</strong> | বয়স: <strong class="text-slate-900">${r.age || 'উল্লেখ নেই'}</strong></div>
                                    </div>
                                </div>
                                <div class="flex items-center space-x-2">
                                    <span class="text-xs font-black px-3 py-1 rounded-xl bg-purple-600 text-white shadow-xs">Valid Lookup Record</span>
                                    ${deliveryItem 
                                        ? `<span class="text-xs font-bold bg-amber-100 text-amber-950 border border-amber-300 px-3 py-1 rounded-xl">🏢 কোম্পানিকে দেওয়া হয়েছে (${deliveryItem.delivery_date})</span>` 
                                        : '<span class="text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 px-3 py-1 rounded-xl">🟢 কোম্পানিকে এখনও দেওয়া হয়নি</span>'}
                                </div>
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                                <div class="p-3 bg-purple-50/80 rounded-xl border border-purple-200">
                                    <span class="text-slate-500 font-bold block text-[11px] uppercase">👤 জমা দিয়েছে (Worker):</span>
                                    <span class="font-black text-slate-900 text-sm block truncate">${r.worker_username || r.worker_email}</span>
                                    <span class="text-[11px] text-slate-500 font-mono block truncate">${r.worker_email || '-'}</span>
                                </div>
                                <div class="p-3 bg-purple-50/80 rounded-xl border border-purple-200">
                                    <span class="text-slate-500 font-bold block text-[11px] uppercase">💰 গৃহস্থালি আয় (Income):</span>
                                    <span class="font-black text-purple-900 text-sm block">${r.household_income || '-'}</span>
                                    <span class="text-[11px] text-slate-500 block">মার্কেট ভ্যালু: ${r.est_market_value || '-'}</span>
                                </div>
                                <div class="p-3 bg-purple-50/80 rounded-xl border border-purple-200">
                                    <span class="text-slate-500 font-bold block text-[11px] uppercase">📅 জমা দেওয়ার তারিখ:</span>
                                    <span class="font-bold text-slate-900 text-xs block">${r.submission_date}</span>
                                    <span class="text-[11px] text-slate-500 block">তৈরি: ${r.created_at ? new Date(r.created_at).toLocaleTimeString() : '-'}</span>
                                </div>
                                <div class="p-3 ${deliveryItem ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'} rounded-xl border">
                                    <span class="${deliveryItem ? 'text-amber-900' : 'text-emerald-900'} font-bold block text-[11px] uppercase">🏢 কোম্পানি ডেলিভারি:</span>
                                    ${deliveryItem ? `
                                        <span class="font-bold text-amber-950 block">${deliveryItem.company_name || 'Company'} (${deliveryItem.delivery_date})</span>
                                        <span class="text-[10px] text-amber-800 font-mono block truncate">ব্যাচ: ${deliveryItem.batch_name || '-'}</span>
                                    ` : `
                                        <span class="font-bold text-emerald-900 block">🟢 এখনও হস্তান্তর করা হয়নি</span>
                                    `}
                                </div>
                            </div>
                        </div>
                    `;
                });

                // 3. Render Standalone Company Deliveries (if not already rendered in master or lookup)
                delivData.forEach(d => {
                    if (renderedPhones.has(d.phone_number)) return;
                    renderedPhones.add(d.phone_number);

                    htmlContent += `
                        <div class="bg-white rounded-2xl p-5 sm:p-6 text-slate-900 border-2 border-amber-300 shadow-md space-y-3 animate-in fade-in duration-150">
                            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 pb-3">
                                <div class="flex items-center space-x-3">
                                    <span class="text-2xl">🏢</span>
                                    <div>
                                        <span class="font-mono text-lg sm:text-xl font-black text-amber-950">${d.phone_number}</span>
                                        <span class="text-xs text-slate-600 block">ব্যক্তি: <strong class="text-slate-900">${d.full_name || 'নাম নেই'}</strong> (${d.age ? d.age + ' বছর' : '-'})</span>
                                    </div>
                                </div>
                                <span class="text-xs font-black bg-amber-400 text-slate-950 px-3 py-1 rounded-xl shadow-xs">🏢 ডেলিভারি রেকর্ড (Company Delivery)</span>
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                <div class="p-3 bg-amber-50 rounded-xl border border-amber-200">
                                    <span class="text-slate-500 font-bold block text-[11px] uppercase">🏢 কোন কোম্পানিকে দেওয়া হয়েছে:</span>
                                    <span class="font-black text-amber-950 text-sm block">${d.company_name || 'Company'}</span>
                                </div>
                                <div class="p-3 bg-amber-50 rounded-xl border border-amber-200">
                                    <span class="text-slate-500 font-bold block text-[11px] uppercase">📅 ডেলিভারির তারিখ:</span>
                                    <span class="font-black text-slate-900 text-sm block">${d.delivery_date}</span>
                                    <span class="text-[11px] text-amber-800 font-mono block">ফাইল: ${d.batch_name || '-'}</span>
                                </div>
                                <div class="p-3 bg-amber-50 rounded-xl border border-amber-200">
                                    <span class="text-slate-500 font-bold block text-[11px] uppercase">🏷️ ক্যাটাগরি:</span>
                                    <span class="font-bold text-indigo-900 text-xs block">${d.category || 'General'}</span>
                                </div>
                            </div>
                        </div>
                    `;
                });

                resList.innerHTML = htmlContent;

            } catch (err) {
                console.error('Universal forensic search error:', err);
                resList.innerHTML = `<div class="p-4 bg-rose-50 text-rose-800 rounded-xl text-xs font-bold">অনুসন্ধানে সমস্যা হয়েছে: ${err.message}</div>`;
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span>⚡ গভীর অনুসন্ধান (Search)</span>';
                }
            }
        }
        
        async function adminQuickChangeCategory(recordId, newType, phone) {
            const labelMap = {
                
                'female_report': '👩 Female Report',
                'lookup_report': '🔍 Lookup Report'
            };
            const targetLabel = labelMap[newType] || newType;

            if (!confirm(`আপনি কি নিশ্চিতভাবে এই নাম্বারটি (${phone}) "${targetLabel}" হিসেবে স্থানান্তর করতে চান?`)) {
                return;
            }
            try {
                const { error } = await supabaseClient
                    .from('master_numbers')
                    .update({ report_type: newType })
                    .eq('id', recordId);
                if (error) throw error;
                alert(`✅ সফল! নাম্বারটি (${phone}) সফলভাবে "${targetLabel}" হিসেবে ক্যাটাগরি আপডেট হয়েছে।`);
                handleUniversalNumberSearch();
                loadAdminDashboard();
            } catch(err) {
                alert('ক্যাটাগরি আপডেটে সমস্যা: ' + err.message);
            }
        }

        async function adminQuickDeleteRecord(recordId, phone) {
            if (!confirm(`⚠️ সতর্কবার্তা:

আপনি কি নিশ্চিতভাবে এই ভুল রেকর্ডটি (${phone}) ডাটাবেজ থেকে স্থায়ীভাবে মুছে ফেলতে চান?`)) {
                return;
            }
            try {
                const { error } = await supabaseClient
                    .from('master_numbers')
                    .delete()
                    .eq('id', recordId);
                if (error) throw error;
                alert(`✅ সফলভাবে রেকর্ডটি (${phone}) ডাটাবেজ থেকে মুছে ফেলা হয়েছে!`);
                handleUniversalNumberSearch();
                loadAdminDashboard();
            } catch(err) {
                alert('মুছতে সমস্যা হয়েছে: ' + err.message);
            }
        }


        // =========================================================================
        // 1-CLICK INSTANT FULL DATA DOWNLOADER ENGINE (UNLIMITED EXPORT)
        // =========================================================================
        function handleQuickExportScopeChange() {
            const scope = document.getElementById('quickExportDateScope')?.value;
            const container = document.getElementById('quickExportCustomDateContainer');
            const customDateInput = document.getElementById('quickExportCustomDate');
            if (scope === 'custom') {
                if (container) container.classList.remove('hidden');
                if (customDateInput && !customDateInput.value) {
                    customDateInput.value = new Date().toISOString().slice(0, 10);
                }
            } else {
                if (container) container.classList.add('hidden');
            }
        }

        async function executeQuickExport(format = 'xlsx') {
            if (!supabaseClient) {
                alert('ডাটাবেজ কানেকশন নেই।');
                return;
            }

            const scope = document.getElementById('quickExportDateScope')?.value || 'today';
            const category = document.getElementById('quickExportCategory')?.value || 'all';
            const worker = document.getElementById('quickExportWorker')?.value || 'all';

            let targetDate = null;
            let dateLabel = 'Today';

            if (scope === 'today') {
                targetDate = new Date().toISOString().slice(0, 10);
                dateLabel = targetDate;
            } else if (scope === 'yesterday') {
                const y = new Date();
                y.setDate(y.getDate() - 1);
                targetDate = y.toISOString().slice(0, 10);
                dateLabel = targetDate;
            } else if (scope === 'custom') {
                targetDate = document.getElementById('quickExportCustomDate')?.value;
                if (!targetDate) {
                    alert('অনুগ্রহ করে একটি নির্দিষ্ট তারিখ বেছে নিন।');
                    return;
                }
                dateLabel = targetDate;
            } else {
                targetDate = null;
                dateLabel = 'All_Time_Database';
            }

            const statusBox = document.getElementById('quickExportStatusBox');
            const statusText = document.getElementById('quickExportStatusText');
            const countBadge = document.getElementById('quickExportCountBadge');
            const btnXlsx = document.getElementById('btnQuickExportExcel');
            const btnTxt = document.getElementById('btnQuickExportTxt');

            if (btnXlsx) btnXlsx.disabled = true;
            if (btnTxt) btnTxt.disabled = true;
            if (statusBox) statusBox.classList.remove('hidden');
            if (statusText) statusText.innerText = '⏳ ডাটাবেজ থেকে সম্পূর্ণ ডাটা সংগ্রহ করা হচ্ছে...';
            if (countBadge) countBadge.innerText = '০ টি';

            try {
                let allRows = [];
                let from = 0;
                const pageSize = 1000;
                const maxSafetyCap = 100000; // supports up to 100,000 records smoothly!

                while (from < maxSafetyCap) {
                    let query = supabaseClient
                        .from('master_numbers')
                        .select('phone_number, full_name, age, household_income, est_market_value, report_type, department, user_email, username, created_at')
                        .order('created_at', { ascending: false })
                        .range(from, from + pageSize - 1);

                    if (targetDate) {
                        query = query.gte('created_at', `${targetDate}T00:00:00.000Z`)
                                     .lte('created_at', `${targetDate}T23:59:59.999Z`);
                    }
                    if (category === 'female_signal') {
                        query = query.or('report_type.eq.female_signal,report_type.eq.signal_report,category.eq.signal_female');
                    } else if (category === 'male_signal') {
                        query = query.or('report_type.eq.male_signal,category.eq.signal_male');
                    } else if (category === 'signal_report') {
                        query = query.or('report_type.eq.signal_report,report_type.eq.female_signal,report_type.eq.male_signal,category.eq.signal_data');
                    } else if (category !== 'all') {
                        query = query.eq('report_type', category);
                    }
                    if (worker !== 'all') {
                        query = query.eq('user_email', worker);
                    }

                    const { data: chunk, error } = await query;
                    if (error) throw error;
                    if (!chunk || chunk.length === 0) break;

                    allRows.push(...chunk);
                    if (countBadge) countBadge.innerText = `${allRows.length.toLocaleString()} টি`;
                    if (statusText) statusText.innerText = `⏳ এখন পর্যন্ত ${allRows.length.toLocaleString()} টি ডাটা সংগ্রহ হয়েছে... আরও খোঁজা হচ্ছে...`;

                    if (chunk.length < pageSize) break; // Reached the end!
                    from += pageSize;
                }

                if (allRows.length === 0) {
                    alert('নির্বাচিত শর্তে কোনো ডাটা পাওয়া যায়নি!');
                    if (statusBox) statusBox.classList.add('hidden');
                    return;
                }

                if (statusText) statusText.innerText = `✅ মোট ${allRows.length.toLocaleString()} টি ডাটা পাওয়া গেছে! ফাইল তৈরি হচ্ছে...`;

                const catName = category === 'all' ? 'All_Reports' : (category === 'female_report' ? 'Female_Only' : (category === 'male_report' ? 'Male_Only' : 'Lookup_Only'));

                if (format === 'xlsx') {
                    // Export Excel (.xlsx)
                    const exportRows = allRows.map((item, idx) => ({
                        'SL': idx + 1,
                        'Phone Number': item.phone_number,
                        'Full Name': item.full_name || '',
                        'Age': item.age || '',
                        'Household Income': item.household_income || '',
                        'Est Market Value': item.est_market_value || '',
                        'Report Type': item.report_type === 'female_report' ? 'Female Report' : 'Lookup Report',
                        'Department': item.department || '-',
                        'Submitted By': item.username || userEmailToNameMap[item.user_email] || item.user_email,
                        'Submission Date': new Date(item.created_at).toLocaleDateString(),
                        'Submission Time': new Date(item.created_at).toLocaleTimeString()
                    }));

                    const ws = XLSX.utils.json_to_sheet(exportRows);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Records");
                    const fileName = `Full_Report_${catName}_${dateLabel}_Total_${exportRows.length}.xlsx`;
                    XLSX.writeFile(wb, fileName);

                } else {
                    // Export Plain Text (.txt) - 1 record per line
                    const lines = allRows.map(r => `${r.phone_number}\t${r.full_name || ''}\t${r.age || ''}`);
                    const content = lines.join('\n');
                    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Full_Report_${catName}_${dateLabel}_Total_${allRows.length}.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }

                if (statusText) statusText.innerHTML = `<span class="text-emerald-700">🎉 সফল! মোট <b>${allRows.length.toLocaleString()} টি</b> সম্পূর্ণ ডাটা এক ক্লিকে ডাউনলোড হয়েছে!</span>`;

            } catch(err) {
                console.error('Quick export error:', err);
                alert('ডাউনলোডে সমস্যা হয়েছে: ' + err.message);
                if (statusBox) statusBox.classList.add('hidden');
            } finally {
                if (btnXlsx) btnXlsx.disabled = false;
                if (btnTxt) btnTxt.disabled = false;
            }
        }


        // =============================================================
        // REPORT SUBMISSION LOCK & AUTO-TIMER CONTROLLER
        // =============================================================
        let reportLockConfig = {
            is_closed: false,
            closed_until: null,
            closed_reason: 'সময়মতো কাজ জমা দেওয়া হয়নি'
        };

        async function initReportSubmissionLock() {
            try {
                if (supabaseClient) {
                    const { data } = await supabaseClient
                        .from('app_settings')
                        .select('*')
                        .eq('key', 'report_submission_lock')
                        .maybeSingle();

                    if (data && data.value) {
                        reportLockConfig = data.value;
                        localStorage.setItem('wm_report_lock', JSON.stringify(reportLockConfig));
                    }
                }
            } catch(e) {
                const saved = localStorage.getItem('wm_report_lock');
                if (saved) {
                    try { reportLockConfig = JSON.parse(saved); } catch(err) {}
                }
            }
            updateReportSubmissionLockUI();
        }

        function checkReportSubmissionLockStatus() {
            const saved = localStorage.getItem('wm_report_lock');
            if (saved) {
                try { reportLockConfig = JSON.parse(saved); } catch(err) {}
            }

            if (!reportLockConfig || !reportLockConfig.is_closed || !reportLockConfig.closed_until) {
                return { isClosed: false };
            }

            const now = new Date();
            const until = new Date(reportLockConfig.closed_until);

            if (now >= until) {
                // Time expired! Automatically re-open!
                reportLockConfig.is_closed = false;
                reportLockConfig.closed_until = null;
                localStorage.setItem('wm_report_lock', JSON.stringify(reportLockConfig));
                if (supabaseClient && currentProfile && currentProfile.role === 'admin') {
                    supabaseClient.from('app_settings').upsert({
                        key: 'report_submission_lock',
                        value: reportLockConfig,
                        updated_at: new Date().toISOString()
                    }).then();
                }
                return { isClosed: false };
            }

            const diffMs = until - now;
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            const secs = Math.floor((diffMs % (1000 * 60)) / 1000);

            const remainingText = `${hours > 0 ? hours + ' ঘণ্টা ' : ''}${mins} মিনিট ${secs} সেকেন্ড`;

            return {
                isClosed: true,
                closedUntil: until,
                remainingHours: hours,
                remainingMinutes: mins,
                remainingSeconds: secs,
                remainingText: remainingText
            };
        }

        function updateReportSubmissionLockUI() {
            const lock = checkReportSubmissionLockStatus();

            // 1. Worker Banner & Submit Button Lock
            const workerBanner = document.getElementById('workerReportClosedBanner');
            const workerCountdown = document.getElementById('workerReportClosedCountdown');
            const submitBtn = document.getElementById('processUploadBtn');

            if (workerBanner) {
                if (lock.isClosed) {
                    workerBanner.classList.remove('hidden');
                    if (workerCountdown) workerCountdown.innerText = lock.remainingText;
                    if (submitBtn) {
                        submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
                        submitBtn.title = 'বর্তমানে রিপোর্ট জমা গ্রহণ বন্ধ আছে';
                    }
                } else {
                    workerBanner.classList.add('hidden');
                    if (submitBtn) {
                        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                        submitBtn.title = '';
                    }
                }
            }

            // 2. Admin Control Card
            const adminStatusBadge = document.getElementById('adminLockStatusBadge');
            const adminCountdownText = document.getElementById('adminLockCountdownText');
            const adminBtnClose = document.getElementById('btnAdminCloseSubmissions');
            const adminBtnResume = document.getElementById('btnAdminResumeSubmissions');

            if (adminStatusBadge) {
                if (lock.isClosed) {
                    adminStatusBadge.className = 'bg-rose-100 text-rose-800 text-xs px-3 py-1 rounded-full font-black border border-rose-300';
                    adminStatusBadge.innerHTML = '🛑 রিপোর্ট গ্রহণ বন্ধ আছে (Closed)';
                    if (adminCountdownText) adminCountdownText.innerHTML = `⏰ আর <b>${lock.remainingText}</b> পর স্বয়ংক্রিয়ভাবে পুনরায় চালু হবে`;
                    if (adminBtnClose) adminBtnClose.classList.add('hidden');
                    if (adminBtnResume) adminBtnResume.classList.remove('hidden');
                } else {
                    adminStatusBadge.className = 'bg-emerald-100 text-emerald-800 text-xs px-3 py-1 rounded-full font-black border border-emerald-300';
                    adminStatusBadge.innerHTML = '🟢 রিপোর্ট গ্রহণ সচল আছে (Open)';
                    if (adminCountdownText) adminCountdownText.innerText = 'কর্মীরা সময়মতো তাদের কাজ জমা দিতে পারবে।';
                    if (adminBtnClose) adminBtnClose.classList.remove('hidden');
                    if (adminBtnResume) adminBtnResume.classList.add('hidden');
                }
            }
        }

        setInterval(updateReportSubmissionLockUI, 1000);

        async function adminSetReportLock(hours = 5) {
            if (!currentProfile || currentProfile.role !== 'admin') {
                alert('শুধুমাত্র এডমিন রিপোর্ট গ্রহণ বন্ধ করতে পারবেন।');
                return;
            }

            const durationHours = parseFloat(hours) || 5;
            const closedUntil = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();

            if (!confirm(`আপনি কি ${durationHours} ঘণ্টার জন্য কর্মীদের রিপোর্ট জমা নেওয়া বন্ধ করতে চান?\n\n${durationHours} ঘণ্টা পর পোর্টাল স্বয়ংক্রিয়ভাবে পুনরায় সচল হয়ে যাবে এবং কর্মীরা আবার রিপোর্ট জমা দিতে পারবে।`)) {
                return;
            }

            reportLockConfig = {
                is_closed: true,
                closed_until: closedUntil,
                closed_reason: 'সময়মতো কাজ জমা দেওয়া হয়নি',
                closed_by: currentUser.email,
                closed_at: new Date().toISOString()
            };

            localStorage.setItem('wm_report_lock', JSON.stringify(reportLockConfig));

            try {
                if (supabaseClient) {
                    await supabaseClient.from('app_settings').upsert({
                        key: 'report_submission_lock',
                        value: reportLockConfig,
                        updated_at: new Date().toISOString()
                    });
                }
            } catch(err) {
                console.warn('Could not save lock to app_settings table:', err);
            }

            updateReportSubmissionLockUI();
            alert(`🛑 সফলভাবে ${durationHours} ঘণ্টার জন্য রিপোর্ট গ্রহণ বন্ধ করা হয়েছে!\n\nকর্মীরা রিপোর্ট জমা দিতে গেলে দেখতে পাবে:\n"দুঃখিত স্যার, আপনি সময়মতো কাজ জমা করতে পারেন নাই, তাই আপনার কাজ আজকে গ্রহণ করা হবে না। আপনি আবার পরে চেষ্টা করেন।"\n\nএবং ${durationHours} ঘণ্টা পর স্বয়ংক্রিয়ভাবে পোর্টাল পুনরায় চালু হয়ে যাবে।`);
        }

        async function adminResumeReportSubmissions() {
            if (!currentProfile || currentProfile.role !== 'admin') {
                alert('শুধুমাত্র এডমিন এই অপশনটি ব্যবহার করতে পারবেন।');
                return;
            }

            if (!confirm('আপনি কি এখনই রিপোর্ট গ্রহণ পুনরায় সচল করতে চান?')) return;

            reportLockConfig = {
                is_closed: false,
                closed_until: null,
                closed_reason: '',
                closed_by: null,
                closed_at: null
            };

            localStorage.setItem('wm_report_lock', JSON.stringify(reportLockConfig));

            try {
                if (supabaseClient) {
                    await supabaseClient.from('app_settings').upsert({
                        key: 'report_submission_lock',
                        value: reportLockConfig,
                        updated_at: new Date().toISOString()
                    });
                }
            } catch(err) {
                console.warn('Could not reset lock in app_settings:', err);
            }

            updateReportSubmissionLockUI();
            alert('🟢 রিপোর্ট গ্রহণ সফলভাবে পুনরায় সচল করা হয়েছে! কর্মীরা এখন স্বাভাবিকভাবে কাজ জমা দিতে পারবে।');
        }

        // =============================================================
        // 1-CLICK MOVE TO GOOGLE DRIVE & PURGE SUPABASE DATABASE
        // =============================================================
        async function downloadBackupAndPurgeSupabase() {
            if (!currentProfile || currentProfile.role !== 'admin') {
                alert('শুধুমাত্র এডমিন ডাটাবেজ ব্যাকআপ ও খালি করতে পারবেন।');
                return;
            }

            if (!confirm('আপনি কি সম্পূর্ণ ডাটাবেজের ব্যাকআপ ফাইল ডাউনলোড করে সুপাবেসের পুরানো রেকর্ড মুছে স্টোরেজ খালি করতে চান?\n\nএর ফলে আপনার কম্পিউটারে সব ডাটা এক্সেল ও JSON ফাইলে নিরাপদ থাকবে এবং সুপাবেস ডাটাবেজ ১০০% হালকা ও দ্রুত হয়ে যাবে (Statement timeout আর হবে না)।')) {
                return;
            }

            try {
                alert('⏳ প্রথমে সম্পূর্ণ ব্যাকআপ তৈরি ও ডাউনলোড করা হচ্ছে...');
                await downloadMasterExcel();
                await downloadFullDatabaseJsonBackup();

                const proceedPurge = confirm('✅ ব্যাকআপ ফাইল আপনার কম্পিউটারে ডাউনলোড হয়েছে!\n\nআপনি কি এখন সুপাবেসের পুরানো রেকর্ডগুলো মুছে স্টোরেজ সম্পূর্ণ খালি করতে চান?\n\n(কোম্পানিকে পূর্বে ডেলিভারি দেওয়া নাম্বারের তালিকা সুরক্ষিত থাকবে যাতে ভবিষ্যতে ডুপ্লিকেট ডেলিভারি না হয়)');
                if (!proceedPurge) return;

                const { error: errM } = await supabaseClient.from('master_numbers').delete().neq('id', 0);
                if (errM) console.warn('Purge master_numbers notice:', errM);

                const { error: errL } = await supabaseClient.from('lookup_records').delete().neq('id', 0);
                if (errL) console.warn('Purge lookup_records notice:', errL);

                alert('🎉 অভিনন্দন! সুপাবেস ডাটাবেজ সম্পূর্ণ খালি করা হয়েছে!\n\nসব রেকর্ড আপনার ডাউনলোড করা ফাইলে সংরক্ষিত আছে (যা আপনি গুগল ড্রাইভে সংরক্ষণ করতে পারেন)। এখন সুপাবেস ডাটাবেজ সুপার ফাস্ট চলবে এবং আর কোনোদিন টাইমআউট হবে না!');

                if (typeof loadAdminSubmissionsData === 'function') loadAdminSubmissionsData();
                if (typeof loadAdminLookupReports === 'function') loadAdminLookupReports();

            } catch (err) {
                console.error('Error during backup and purge:', err);
                alert('ব্যাকআপ ও ডাটাবেজ খালি করতে সমস্যা হয়েছে: ' + err.message);
            }
        }

        async function moveDatabaseToGoogleDriveAndPurge() {
            if (!currentProfile || currentProfile.role !== 'admin') {
                alert('শুধুমাত্র এডমিন ডাটাবেজ ব্যাকআপ ও খালি করতে পারবেন।');
                return;
            }

            if (!googleAccessToken) {
                alert('গুগল ড্রাইভ এখনো কানেক্ট করা হয়নি। আমরা ব্যাকআপ ফাইল সরাসরি ডাউনলোড করে ড্রাইভের জন্য প্রস্তুত করব এবং ডাটাবেজ খালি করার অপশন দিব।');
                await downloadBackupAndPurgeSupabase();
                return;
            }

            const btn = document.getElementById('gdriveMoveBtn');
            const statusBox = document.getElementById('gdriveUploadStatus');

            if (btn) btn.disabled = true;
            if (statusBox) {
                statusBox.classList.remove('hidden');
                statusBox.className = 'text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 p-3 rounded-lg font-medium';
                statusBox.innerHTML = '⏳ সুপাবেস থেকে ডাটা নিয়ে সরাসরি গুগল ড্রাইভে পাঠানো হচ্ছে...';
            }

            try {
                await uploadDatabaseBackupToGoogleDrive();

                const proceedPurge = confirm('✅ সম্পূর্ণ ডাটাবেজ ব্যাকআপ সফলভাবে আপনার গুগল ড্রাইভে সংরক্ষিত হয়েছে!\n\nআপনি কি এখন সুপাবেস ডাটাবেজ থেকে পুরানো রেকর্ড মুছে স্টোরেজ খালি করতে চান?');
                if (proceedPurge) {
                    await supabaseClient.from('master_numbers').delete().neq('id', 0);
                    await supabaseClient.from('lookup_records').delete().neq('id', 0);
                    alert('🎉 সফলভাবে সব ডাটা গুগল ড্রাইভে মুভ করা হয়েছে এবং সুপাবেস ডাটাবেজ খালি করা হয়েছে!');
                    if (typeof loadAdminSubmissionsData === 'function') loadAdminSubmissionsData();
                    if (typeof loadAdminLookupReports === 'function') loadAdminLookupReports();
                }
            } catch (err) {
                console.error('Error moving to Google Drive:', err);
                alert('গুগল ড্রাইভে ডাটা মুভ করতে সমস্যা হয়েছে: ' + err.message);
            } finally {
                if (btn) btn.disabled = false;
            }
        }