# Work & Data Management Web Portal (100% Free)

## 📌 Features Included
1. **Multi-User Login**: Supports 30 distinct worker accounts and 1 Admin account with email and password.
2. **2 Dedicated Departments**:
   - `Number Lookup`
   - `Gender Verify`
3. **Daily XLSX File Upload**:
   - Drag-and-drop or select `.xlsx`, `.xls`, or `.csv` files.
   - Automatically detects phone number columns.
4. **Intelligent Deduplication**:
   - Cross-checks against the central database and filters duplicates in real-time.
   - Saves only clean, unique numbers.
5. **Real-Time Dashboards**:
   - **User Dashboard**: Today's valid unique numbers count, duplicates filtered count, and history.
   - **Admin Dashboard**: Live metrics, submission stats for all 30 users, and full audit logs.
6. **1-Click Master Excel Export (.xlsx)**:
   - Export all collected unique records or filter by department/date into an Excel spreadsheet.

---

## 🚀 Step 1: Create Free Database (Supabase)
1. Go to [https://supabase.com](https://supabase.com) and create a free account.
2. Click **New Project**, choose a project name (e.g. `work-manager`) and set a secure database password.
3. Once the project is created, click on **SQL Editor** on the left menu.
4. Click **New query**, paste the entire content of `schema.sql`, and click **Run**.
   - This sets up all tables, indexes, security policies (RLS), and deduplication logic.

---

## 👥 Step 2: Create Users and Departments
You can easily create your 30 worker accounts in Supabase:
1. In your Supabase dashboard, go to **Authentication** > **Users**.
2. Click **Add user** > **Create user**.
3. Enter the worker's Email and Password.
4. Set User Metadata (or let the trigger assign defaults):
   - To make an **Admin**:
     In **SQL Editor**, run:
     ```sql
     UPDATE public.profiles
     SET role = 'admin', department = 'admin'
     WHERE email = 'your-admin-email@company.com';
     ```
   - To assign a worker to **Gender Verify**:
     ```sql
     UPDATE public.profiles
     SET department = 'gender_verify'
     WHERE email = 'worker1@company.com';
     ```
   - (Default department is already `number_lookup`).

---

## 🌐 Step 3: Launch the Website (100% Free)
You have two easy ways to run this:

### Option A: Run Directly in Any Browser (No Server Needed)
Simply open `index.html` by double-clicking it on your computer.

### Option B: Free Hosting on GitHub Pages
1. Create a free repository on [GitHub](https://github.com).
2. Upload `index.html`.
3. Go to **Settings** > **Pages** > Select `main` branch > Click **Save**.
4. You will get a live web link (e.g. `https://yourusername.github.io/repo`) accessible by all 30 workers from anywhere!

---

## 🔑 Step 4: Connect Web App to Database
1. Open the website.
2. Click **⚙️ Settings** at the top right.
3. In Supabase, go to **Project Settings** > **API**.
4. Copy your **Project URL** and **anon public Key** and paste them into the Settings box.
5. Click **Save & Connect**.
