const fs = require('fs');
const path = require('path');
const http = require('http');

// ── Public build configuration ──────────────────────────────────────────────
// These values are safe for browser use. Never place a Supabase service-role key here.
const BUILD_CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  appName: process.env.APP_NAME || 'Daybook'
};

const DIST = path.join(__dirname, 'dist');

const sql = String.raw`-- Daybook / Second Brain database setup
-- Run this once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space text not null check (space in ('work', 'personal')),
  title text not null default '',
  content text not null default '',
  tags text[] not null default '{}',
  pinned boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid references public.entries(id) on delete set null,
  space text not null default 'personal' check (space in ('work', 'personal')),
  title text not null,
  notes text not null default '',
  due_at timestamptz not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists entries_user_updated_idx on public.entries(user_id, updated_at desc);
create index if not exists reminders_user_due_idx on public.reminders(user_id, due_at);
create index if not exists attachments_entry_idx on public.attachments(entry_id);

alter table public.entries enable row level security;
alter table public.reminders enable row level security;
alter table public.attachments enable row level security;

drop policy if exists "Users manage their own entries" on public.entries;
create policy "Users manage their own entries" on public.entries
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage their own reminders" on public.reminders;
create policy "Users manage their own reminders" on public.reminders
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage their own attachments" on public.attachments;
create policy "Users manage their own attachments" on public.attachments
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-images', 'journal-images', false, 6291456, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false;

drop policy if exists "Users read their own journal images" on storage.objects;
create policy "Users read their own journal images" on storage.objects for select
using (bucket_id = 'journal-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users upload their own journal images" on storage.objects;
create policy "Users upload their own journal images" on storage.objects for insert
with check (bucket_id = 'journal-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update their own journal images" on storage.objects;
create policy "Users update their own journal images" on storage.objects for update
using (bucket_id = 'journal-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete their own journal images" on storage.objects;
create policy "Users delete their own journal images" on storage.objects for delete
using (bucket_id = 'journal-images' and (storage.foldername(name))[1] = auth.uid()::text);
`;

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#f5f0e8" />
  <meta name="description" content="A calm second brain for notes, photos, voice capture, and reminders." />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  <title>Daybook</title>
  <style>
    :root {
      --paper:#f5f0e8; --surface:#fffdf8; --surface-2:#eee8de; --ink:#20211f; --muted:#77766f;
      --line:#ded8cd; --accent:#5e745c; --accent-deep:#3f553e; --accent-soft:#dfe8db;
      --work:#b86c43; --personal:#6f6a9d; --danger:#b64b4b; --shadow:0 16px 45px rgba(64,55,43,.10);
      --radius:18px; --font:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    [data-theme="dark"] {
      --paper:#171916; --surface:#20231f; --surface-2:#2a2e29; --ink:#f2f0e9; --muted:#aaa99f;
      --line:#383d36; --accent:#9bb096; --accent-deep:#c1d1bd; --accent-soft:#30402e;
      --work:#dc8b5e; --personal:#a9a2d5; --danger:#ed8585; --shadow:0 18px 50px rgba(0,0,0,.24);
    }
    *{box-sizing:border-box} html,body{height:100%} body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font);overflow:hidden}
    button,input,textarea{font:inherit;color:inherit} button{cursor:pointer} button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px}
    .hidden{display:none!important}.app{display:grid;grid-template-columns:240px 340px 1fr;height:100dvh;min-height:620px}
    .sidebar{border-right:1px solid var(--line);padding:28px 18px 20px;display:flex;flex-direction:column;background:color-mix(in srgb,var(--paper) 88%,var(--surface));position:relative;z-index:3}
    .brand{display:flex;align-items:center;gap:11px;padding:0 9px 24px;font-family:Georgia,serif;font-size:24px;letter-spacing:-.5px}
    .brand-mark{width:35px;height:35px;border-radius:12px;background:var(--accent);color:white;display:grid;place-items:center;box-shadow:0 8px 22px color-mix(in srgb,var(--accent) 25%,transparent)}
    .new-button{border:0;border-radius:13px;background:var(--ink);color:var(--paper);padding:13px 15px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:22px}
    .nav{display:grid;gap:5px}.nav-button{border:0;background:transparent;border-radius:12px;padding:12px 13px;text-align:left;display:flex;align-items:center;gap:11px;color:var(--muted);font-weight:650}
    .nav-button:hover{background:var(--surface-2);color:var(--ink)}.nav-button.active{background:var(--surface);color:var(--ink);box-shadow:0 4px 16px rgba(0,0,0,.05)}
    .nav-button .count{margin-left:auto;font-size:12px;background:var(--surface-2);border-radius:999px;padding:2px 8px;font-weight:700}
    .nav-dot{width:9px;height:9px;border-radius:50%;background:var(--work)}.nav-dot.personal{background:var(--personal)}.nav-dot.reminder{background:var(--accent)}
    .sidebar-foot{margin-top:auto;display:flex;align-items:center;gap:8px}.icon-button{border:1px solid var(--line);background:var(--surface);width:40px;height:40px;border-radius:12px;display:grid;place-items:center}.icon-button:hover{background:var(--surface-2)}
    .user-chip{flex:1;min-width:0;padding:8px 10px}.user-email{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .list-pane{border-right:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;min-width:0;position:relative;z-index:2}
    .list-header{padding:27px 22px 16px}.eyebrow{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-weight:800}.list-title-row{display:flex;align-items:center;justify-content:space-between;margin:5px 0 17px}.list-title{font:700 29px/1.1 Georgia,serif;margin:0}
    .search{position:relative}.search input{width:100%;border:1px solid var(--line);background:var(--paper);border-radius:12px;padding:11px 13px 11px 38px}.search svg{position:absolute;left:13px;top:12px;color:var(--muted)}
    .filters{display:flex;gap:7px;padding-top:11px;overflow:auto}.filter{white-space:nowrap;border:1px solid var(--line);background:transparent;border-radius:999px;padding:6px 10px;color:var(--muted);font-size:12px;font-weight:700}.filter.active{background:var(--accent-soft);border-color:transparent;color:var(--accent-deep)}
    .entry-list{overflow:auto;padding:0 12px 110px}.entry-card{width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;text-align:left;padding:17px 11px;display:block;position:relative}.entry-card:hover{background:color-mix(in srgb,var(--paper) 75%,transparent);border-radius:13px}.entry-card.active{background:var(--paper);border-radius:14px;border-bottom-color:transparent;box-shadow:inset 3px 0 var(--accent)}
    .card-meta{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}.card-title{font-weight:750;margin:7px 0 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.card-preview{color:var(--muted);font-size:13px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.pin{color:var(--work)}
    .empty{padding:50px 22px;text-align:center;color:var(--muted)}.empty-illustration{font-size:40px;margin-bottom:12px}.empty strong{display:block;color:var(--ink);margin-bottom:6px}
    .editor-pane{background:var(--surface);min-width:0;position:relative;overflow:auto}.editor{max-width:820px;margin:0 auto;padding:30px 58px 120px}.editor-top{display:flex;align-items:center;gap:9px;margin-bottom:35px}.crumb{font-size:12px;color:var(--muted);font-weight:750;text-transform:uppercase;letter-spacing:.1em}.save-state{margin-left:auto;font-size:12px;color:var(--muted)}
    .editor-title{width:100%;border:0;background:transparent;font:700 36px/1.2 Georgia,serif;padding:0;margin-bottom:17px}.editor-title::placeholder{color:color-mix(in srgb,var(--muted) 42%,transparent)}
    .editor-content{width:100%;min-height:330px;resize:none;border:0;background:transparent;font:400 17px/1.75 Georgia,serif;padding:0}.editor-content::placeholder{color:color-mix(in srgb,var(--muted) 55%,transparent)}
    .tool-row{position:sticky;bottom:22px;display:flex;align-items:center;gap:8px;padding:9px;background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);width:max-content;max-width:100%}
    .tool-button{border:0;background:transparent;border-radius:10px;padding:9px 11px;display:flex;align-items:center;gap:7px;font-weight:700;font-size:13px}.tool-button:hover{background:var(--surface-2)}.tool-button.recording{background:#f4dada;color:#9b3030;animation:pulse 1.4s infinite}.tool-spacer{width:1px;height:25px;background:var(--line)}
    @keyframes pulse{50%{box-shadow:0 0 0 6px rgba(182,75,75,.12)}}
    .details{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 22px}.tag{border:0;background:var(--accent-soft);color:var(--accent-deep);padding:5px 9px;border-radius:999px;font-size:12px;font-weight:700}.detail-chip{border:1px solid var(--line);background:transparent;padding:5px 9px;border-radius:999px;font-size:12px;color:var(--muted)}
    .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:10px 0 24px}.photo{aspect-ratio:4/3;border-radius:14px;overflow:hidden;position:relative;background:var(--surface-2)}.photo img{width:100%;height:100%;object-fit:cover}.photo button{position:absolute;right:6px;top:6px;border:0;border-radius:50%;width:28px;height:28px;background:rgba(20,20,20,.72);color:white}
    .reminder-view{max-width:760px;margin:0 auto;padding:29px 48px 120px}.reminder-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:25px}.reminder-title{font:700 32px Georgia,serif;margin:0}.reminder-groups{display:grid;gap:28px}.group-title{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:10px;font-weight:800}.reminder-item{display:flex;gap:12px;align-items:flex-start;border-bottom:1px solid var(--line);padding:14px 4px}.check{width:23px;height:23px;border:2px solid var(--accent);border-radius:50%;background:transparent;flex:0 0 auto;margin-top:1px}.check.done{background:var(--accent);color:white}.reminder-main{flex:1;min-width:0}.reminder-item.done .reminder-name{text-decoration:line-through;color:var(--muted)}.reminder-name{font-weight:750}.reminder-date{font-size:12px;color:var(--muted);margin-top:4px}.overdue{color:var(--danger)}
    .modal-backdrop{position:fixed;inset:0;background:rgba(15,17,14,.42);backdrop-filter:blur(4px);z-index:20;display:grid;place-items:center;padding:20px}.modal{width:min(500px,100%);max-height:90vh;overflow:auto;background:var(--surface);border-radius:20px;box-shadow:0 24px 80px rgba(0,0,0,.25);padding:25px}.modal h2{font:700 25px Georgia,serif;margin:0 0 20px}.field{display:grid;gap:7px;margin-bottom:15px}.field label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800}.field input,.field textarea,.field select{width:100%;border:1px solid var(--line);border-radius:11px;background:var(--paper);padding:11px 12px}.modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:21px}.button{border:1px solid var(--line);background:var(--surface);border-radius:11px;padding:10px 15px;font-weight:750}.button.primary{background:var(--ink);color:var(--paper);border-color:var(--ink)}.button.danger{color:var(--danger)}
    .auth-shell{min-height:100dvh;display:grid;grid-template-columns:1.2fr .8fr;background:var(--paper)}.auth-art{padding:60px;display:flex;flex-direction:column;justify-content:space-between;background:var(--accent);color:#fff;overflow:hidden;position:relative}.auth-art:after{content:'“';position:absolute;right:-30px;bottom:-190px;font:600 620px Georgia,serif;color:rgba(255,255,255,.07)}.auth-logo{font:700 27px Georgia,serif}.auth-copy{position:relative;z-index:1;max-width:600px}.auth-copy h1{font:700 clamp(45px,7vw,88px)/.95 Georgia,serif;letter-spacing:-.04em;margin:0 0 28px}.auth-copy p{font-size:18px;line-height:1.6;max-width:470px;color:rgba(255,255,255,.78)}.auth-card-wrap{display:grid;place-items:center;padding:35px}.auth-card{width:min(410px,100%);background:var(--surface);padding:31px;border-radius:22px;box-shadow:var(--shadow)}.auth-card h2{font:700 27px Georgia,serif;margin:0 0 8px}.auth-card>p{color:var(--muted);line-height:1.5;margin:0 0 23px}.auth-card .button{width:100%;margin-top:6px}.demo-note{font-size:12px;color:var(--muted);text-align:center;margin-top:14px;line-height:1.45}.config-badge{display:inline-block;background:var(--accent-soft);color:var(--accent-deep);border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;margin-bottom:12px}
    .toast-stack{position:fixed;right:20px;bottom:20px;z-index:50;display:grid;gap:9px}.toast{background:var(--ink);color:var(--paper);padding:12px 16px;border-radius:12px;box-shadow:var(--shadow);font-size:13px;animation:slideIn .2s ease}.toast.error{background:var(--danger);color:white}@keyframes slideIn{from{transform:translateY(8px);opacity:0}}
    .mobile-top,.bottom-nav,.mobile-back{display:none}.loading{position:fixed;inset:0;background:var(--paper);z-index:100;display:grid;place-items:center}.loader{width:38px;height:38px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    @media(max-width:960px){.app{grid-template-columns:210px 310px 1fr}.editor{padding-left:36px;padding-right:36px}.tool-button span{display:none}}
    @media(max-width:760px){body{overflow:hidden}.app{display:block;height:100dvh}.sidebar{display:none}.list-pane{height:100%;border:0;padding-top:max(0px,env(safe-area-inset-top))}.mobile-top{display:flex;align-items:center;padding:18px 18px 10px}.mobile-brand{font:700 23px Georgia,serif}.mobile-top .icon-button{margin-left:auto}.list-header{padding:10px 17px 12px}.list-title-row{margin-top:3px}.entry-list{padding:0 10px 100px}.bottom-nav{position:fixed;display:grid;grid-template-columns:repeat(3,1fr);left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));z-index:10;background:color-mix(in srgb,var(--surface) 94%,transparent);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:17px;padding:6px;backdrop-filter:blur(16px)}.bottom-nav button{border:0;background:transparent;padding:9px 4px;border-radius:11px;color:var(--muted);font-size:11px;font-weight:750}.bottom-nav button.active{background:var(--accent-soft);color:var(--accent-deep)}.mobile-new{position:fixed;right:18px;bottom:91px;z-index:9;width:55px;height:55px;border-radius:50%;border:0;background:var(--ink);color:var(--paper);font-size:25px;box-shadow:var(--shadow)}.editor-pane{position:fixed;inset:0;z-index:12;display:none}.editor-pane.mobile-open{display:block}.editor{padding:18px 20px 110px;min-height:100%}.editor-top{margin-bottom:25px}.mobile-back{display:grid}.editor-title{font-size:31px}.editor-content{font-size:17px;min-height:48vh}.tool-row{position:fixed;left:14px;right:14px;bottom:max(14px,env(safe-area-inset-bottom));width:auto;justify-content:space-around}.tool-button span{display:inline}.reminder-view{padding:25px 19px 110px}.reminder-head{align-items:flex-start}.auth-shell{display:block}.auth-art{min-height:38vh;padding:31px 25px}.auth-copy h1{font-size:46px}.auth-copy p{font-size:15px}.auth-card-wrap{padding:24px 17px}.auth-card{padding:25px}.list-pane.reminders-active .list-header,.list-pane.reminders-active .entry-list{display:none}.list-pane.reminders-active{background:var(--surface)}.list-pane.reminders-active #mobileReminderHost{display:block!important}}
    @media(max-width:400px){.tool-button{padding:9px}.tool-button span{display:none}.editor{padding-left:17px;padding-right:17px}}
  </style>
</head>
<body>
  <div id="loading" class="loading"><div class="loader" aria-label="Loading"></div></div>
  <div id="authRoot" class="hidden"></div>
  <div id="appRoot" class="hidden"></div>
  <div id="modalRoot"></div>
  <div id="toastRoot" class="toast-stack" aria-live="polite"></div>

  <script type="module">
    const CONFIG = __APP_CONFIG__;
    const hasCloudConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
    let supabase = null;
    let cloudAvailable = false;
    let startupWarning = '';
    async function importWithTimeout(url, timeoutMs = 5000) {
      let timeout;
      try {
        return await Promise.race([
          import(url),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Timed out')), timeoutMs); })
        ]);
      } finally { clearTimeout(timeout); }
    }
    if (hasCloudConfig) {
      try {
        let library;
        try { library = await importWithTimeout('https://esm.sh/@supabase/supabase-js@2'); }
        catch { library = await importWithTimeout('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'); }
        supabase = library.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
        cloudAvailable = true;
      } catch {
        startupWarning = 'Cloud sync could not start on this browser. Daybook opened in local mode instead.';
      }
    }
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const nowIso = () => new Date().toISOString();
    const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
    const icon = (name, size = 18) => {
      const paths = {
        plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
        sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
        mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>', image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
        bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>', more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        back:'<path d="m15 18-6-6 6-6"/>', pin:'<path d="M12 17v5M5 3h14l-3 7 3 4H5l3-4-3-7Z"/>', download:'<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/>', trash:'<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/>',
        logout:'<path d="M10 17l5-5-5-5m5 5H3m12-9h6v18h-6"/>', check:'<path d="m5 12 4 4L19 6"/>'
      };
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
    };

    const state = {
      session: null, entries: [], reminders: [], attachments: [], selectedId: null,
      tab: 'work', filter: 'all', search: '', saving: false, recognition: null,
      listening: false, localMode: !cloudAvailable, mobileEditorOpen: false
    };

    function toast(message, type = '') {
      const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = message;
      $('#toastRoot').append(el); setTimeout(() => el.remove(), 3200);
    }
    function setTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem('daybook-theme', theme); }
    setTheme(localStorage.getItem('daybook-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    function localRead(key, fallback = []) { try { return JSON.parse(localStorage.getItem('daybook-' + key)) || fallback; } catch { return fallback; } }
    function localWrite(key, value) { localStorage.setItem('daybook-' + key, JSON.stringify(value)); }
    function recoverDrafts() {
      const recovered = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('daybook-draft-')) continue;
        try {
          const draft = JSON.parse(localStorage.getItem(key));
          if (!draft?.id || draft.user_id !== (state.session?.user?.id || 'local-user')) continue;
          const existing = state.entries.find(entry => entry.id === draft.id);
          if (existing) Object.assign(existing, draft);
          else state.entries.unshift(draft);
          recovered.push(draft.id);
        } catch {}
      }
      if (recovered.length) setTimeout(() => toast('Recovered your unsaved draft'), 250);
    }

    const data = {
      async load() {
        if (state.localMode) {
          state.entries = localRead('entries'); state.reminders = localRead('reminders'); state.attachments = localRead('attachments'); recoverDrafts(); return;
        }
        const [entries, reminders, attachments] = await Promise.all([
          supabase.from('entries').select('*').order('updated_at', { ascending:false }).limit(500),
          supabase.from('reminders').select('*').order('due_at', { ascending:true }).limit(500),
          supabase.from('attachments').select('*').order('created_at', { ascending:true }).limit(500)
        ]);
        const error = entries.error || reminders.error || attachments.error;
        if (error) throw error;
        state.entries = entries.data; state.reminders = reminders.data; state.attachments = attachments.data;
        recoverDrafts();
        await hydrateAttachmentUrls();
      },
      async saveEntry(entry) {
        entry.updated_at = nowIso();
        if (state.localMode) { localWrite('entries', state.entries); return entry; }
        const payload = {...entry}; delete payload.localOnly;
        const {data: saved, error} = await supabase.from('entries').upsert(payload).select().single();
        if (error) throw error; Object.assign(entry, saved); return entry;
      },
      async deleteEntry(entry) {
        if (state.localMode) { state.entries = state.entries.filter(e => e.id !== entry.id); state.attachments = state.attachments.filter(a => a.entry_id !== entry.id); localWrite('entries', state.entries); localWrite('attachments', state.attachments); return; }
        const files = state.attachments.filter(a => a.entry_id === entry.id).map(a => a.storage_path);
        if (files.length) await supabase.storage.from('journal-images').remove(files);
        const {error} = await supabase.from('entries').delete().eq('id', entry.id); if (error) throw error;
        state.entries = state.entries.filter(e => e.id !== entry.id); state.attachments = state.attachments.filter(a => a.entry_id !== entry.id);
      },
      async saveReminder(reminder) {
        reminder.updated_at = nowIso();
        if (state.localMode) { const i=state.reminders.findIndex(r=>r.id===reminder.id); if(i<0) state.reminders.push(reminder); localWrite('reminders', state.reminders); return; }
        const {data: saved,error}=await supabase.from('reminders').upsert(reminder).select().single(); if(error) throw error;
        const i=state.reminders.findIndex(r=>r.id===saved.id); if(i<0) state.reminders.push(saved); else state.reminders[i]=saved;
      },
      async deleteReminder(id) {
        if(state.localMode){state.reminders=state.reminders.filter(r=>r.id!==id);localWrite('reminders',state.reminders);return;}
        const {error}=await supabase.from('reminders').delete().eq('id',id);if(error)throw error;state.reminders=state.reminders.filter(r=>r.id!==id);
      }
    };

    async function hydrateAttachmentUrls() {
      for (const item of state.attachments) {
        const {data: signed} = await supabase.storage.from('journal-images').createSignedUrl(item.storage_path, 3600);
        item.url = signed?.signedUrl || '';
      }
    }

    function defaultEntry(space = state.tab === 'personal' ? 'personal' : 'work') {
      return { id:uid(), user_id:state.session?.user?.id || 'local-user', space, title:'', content:'', tags:[], pinned:false, archived:false, created_at:nowIso(), updated_at:nowIso(), localOnly:true };
    }
    async function createEntry(space) {
      const entry=defaultEntry(space); state.entries.unshift(entry); state.selectedId=entry.id; state.tab=entry.space; state.mobileEditorOpen=true; render();
      setTimeout(()=>$('#entryContent')?.focus(),50); await queueSave(entry);
    }
    function selectedEntry(){return state.entries.find(e=>e.id===state.selectedId)}
    function visibleEntries(){
      const q=state.search.trim().toLowerCase();
      return state.entries.filter(e=>!e.archived&&e.space===state.tab).filter(e=>state.filter==='pinned'?e.pinned:true).filter(e=>!q||[e.title,e.content,...(e.tags||[])].join(' ').toLowerCase().includes(q)).sort((a,b)=>(b.pinned-a.pinned)||new Date(b.updated_at)-new Date(a.updated_at));
    }

    let saveTimer;
    function updateEntryField(field,value){const e=selectedEntry();if(!e)return;e[field]=value;e.updated_at=nowIso();state.saving=true;updateSaveState();clearTimeout(saveTimer);localStorage.setItem('daybook-draft-'+e.id,JSON.stringify(e));saveTimer=setTimeout(()=>queueSave(e),650);}
    async function queueSave(entry){
      state.saving=true;updateSaveState();
      try{await data.saveEntry(entry);localStorage.removeItem('daybook-draft-'+entry.id);state.saving=false;updateSaveState();renderEntryListOnly();}
      catch(error){state.saving=false;updateSaveState('Could not save');toast(error.message||'Could not save','error');}
    }
    function updateSaveState(forced){const el=$('#saveState');if(el)el.textContent=forced||(state.saving?'Saving…':'Saved');}

    function renderAuth(){
      $('#loading').classList.add('hidden'); $('#appRoot').classList.add('hidden'); const root=$('#authRoot');root.classList.remove('hidden');
      root.innerHTML='<main class="auth-shell"><section class="auth-art"><div class="auth-logo">◒ '+escapeHtml(CONFIG.appName)+'</div><div class="auth-copy"><h1>Your thoughts,<br>kept close.</h1><p>Capture ideas, memories, photos and the things you cannot afford to forget.</p></div><small>Private by design · Built for quiet focus</small></section><section class="auth-card-wrap"><form class="auth-card" id="authForm"><span class="config-badge">'+(cloudAvailable?'SECURE CLOUD SYNC':'LOCAL MODE')+'</span><h2>'+ (cloudAvailable?'Welcome back':'Open your Daybook') +'</h2><p>'+(cloudAvailable?'Enter your email and we will send you a secure sign-in link.':(startupWarning||'Supabase is not configured yet. Notes on this device will stay in this browser.'))+'</p>'+(cloudAvailable?'<div class="field"><label for="email">Email address</label><input id="email" type="email" required autocomplete="email" placeholder="you@example.com"></div>':'')+'<button class="button primary" type="submit">'+(cloudAvailable?'Send sign-in link':'Open local journal')+'</button><div class="demo-note">'+(cloudAvailable?'No password needed. Your journal is visible only to you.':(hasCloudConfig?'Check this browser’s connection or content-blocking settings to restore cloud sync.':'Add Supabase environment variables before deployment to enable accounts and cross-device sync.'))+'</div></form></section></main>';
      $('#authForm').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;if(!cloudAvailable){state.session={user:{id:'local-user',email:'Local journal'}};await startApp();return;}const email=$('#email').value.trim();const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin}});button.disabled=false;if(error)toast(error.message,'error');else{toast('Check your email for the sign-in link');button.textContent='Link sent';}};
    }

    function shellHtml(){return '<div class="app"><aside class="sidebar"><div class="brand"><span class="brand-mark">◒</span>'+escapeHtml(CONFIG.appName)+'</div><button class="new-button" data-action="new">'+icon('plus')+' New entry</button><nav class="nav">'+navButtons()+'</nav><div class="sidebar-foot"><div class="user-chip"><div class="user-email">'+escapeHtml(state.session?.user?.email||'Local journal')+'</div></div><button class="icon-button" data-action="theme" title="Toggle theme">'+icon('sun')+'</button><button class="icon-button" data-action="logout" title="Sign out">'+icon('logout')+'</button></div></aside><section class="list-pane '+(state.tab==='reminders'?'reminders-active':'')+'" id="listPane"><div class="mobile-top"><div class="mobile-brand">◒ '+escapeHtml(CONFIG.appName)+'</div><button class="icon-button" data-action="theme">'+icon('sun')+'</button></div><div class="list-header">'+listHeaderHtml()+'</div><div class="entry-list" id="entryList">'+entryListHtml()+'</div><div id="mobileReminderHost" class="hidden">'+(state.tab==='reminders'?remindersHtml():'')+'</div></section><main class="editor-pane '+(state.mobileEditorOpen?'mobile-open':'')+'" id="editorPane">'+mainPaneHtml()+'</main><button class="mobile-new" data-action="new" aria-label="New entry">+</button><nav class="bottom-nav">'+bottomNavHtml()+'</nav></div>'}
    function navButtons(){return [['work','Work','work'],['personal','Personal','personal'],['reminders','Reminders','reminder']].map(([key,label,dot])=>'<button class="nav-button '+(state.tab===key?'active':'')+'" data-tab="'+key+'"><span class="nav-dot '+dot+'"></span>'+label+'<span class="count">'+tabCount(key)+'</span></button>').join('')}
    function bottomNavHtml(){return [['work','Work'],['personal','Personal'],['reminders','Reminders']].map(([key,label])=>'<button class="'+(state.tab===key?'active':'')+'" data-tab="'+key+'">'+label+'</button>').join('')}
    function tabCount(key){if(key==='reminders')return state.reminders.filter(r=>!r.completed).length;return state.entries.filter(e=>e.space===key&&!e.archived).length}
    function listHeaderHtml(){if(state.tab==='reminders')return '';const title=state.tab==='work'?'Work':'Personal';return '<div class="eyebrow">Your second brain</div><div class="list-title-row"><h1 class="list-title">'+title+'</h1><button class="icon-button" data-action="new" aria-label="New entry">'+icon('plus')+'</button></div><div class="search">'+icon('search')+'<input id="searchInput" type="search" placeholder="Search '+title.toLowerCase()+' notes" value="'+escapeHtml(state.search)+'"></div><div class="filters"><button class="filter '+(state.filter==='all'?'active':'')+'" data-filter="all">All notes</button><button class="filter '+(state.filter==='pinned'?'active':'')+'" data-filter="pinned">Pinned</button></div>'}
    function entryListHtml(){const entries=visibleEntries();if(!entries.length)return '<div class="empty"><div class="empty-illustration">✦</div><strong>No notes here yet</strong><span>Capture the thought before it disappears.</span></div>';return entries.map(e=>'<button class="entry-card '+(e.id===state.selectedId?'active':'')+'" data-entry="'+e.id+'"><div class="card-meta">'+(e.pinned?'<span class="pin">'+icon('pin',12)+'</span>':'')+'<span>'+relativeDate(e.updated_at)+'</span>'+(state.reminders.some(r=>r.entry_id===e.id&&!r.completed)?'<span>· Reminder</span>':'')+'</div><div class="card-title">'+escapeHtml(e.title||firstLine(e.content)||'Untitled note')+'</div><div class="card-preview">'+escapeHtml(e.content||'Start writing…')+'</div></button>').join('')}
    function firstLine(text=''){return text.split(/\n/).find(Boolean)?.slice(0,55)||''}
    function relativeDate(value){const d=new Date(value),today=new Date();if(d.toDateString()===today.toDateString())return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});return d.toLocaleDateString([],{month:'short',day:'numeric'});}

    function mainPaneHtml(){if(state.tab==='reminders')return remindersHtml();const entry=selectedEntry();if(!entry||entry.space!==state.tab)return '<div class="empty" style="margin-top:28vh"><div class="empty-illustration">☼</div><strong>Select a note to begin</strong><span>Or create a new entry for this moment.</span></div>';return editorHtml(entry)}
    function editorHtml(e){const files=state.attachments.filter(a=>a.entry_id===e.id);const linked=state.reminders.find(r=>r.entry_id===e.id&&!r.completed);return '<article class="editor"><div class="editor-top"><button class="icon-button mobile-back" data-action="close-editor" aria-label="Back">'+icon('back')+'</button><span class="crumb">'+escapeHtml(e.space)+' note</span><span class="save-state" id="saveState">Saved</span><button class="icon-button" data-action="more" aria-label="More options">'+icon('more')+'</button></div><input class="editor-title" id="entryTitle" aria-label="Entry title" placeholder="Untitled" value="'+escapeHtml(e.title)+'"><div class="details">'+(e.tags||[]).map(t=>'<button class="tag" data-remove-tag="'+escapeHtml(t)+'">#'+escapeHtml(t)+' ×</button>').join('')+(linked?'<button class="detail-chip" data-action="open-reminder">'+icon('bell',12)+' '+escapeHtml(formatDue(linked.due_at))+'</button>':'')+'</div>'+(files.length?'<div class="gallery">'+files.map(a=>'<div class="photo"><img src="'+escapeHtml(a.url||'')+'" alt="'+escapeHtml(a.file_name)+'"><button data-delete-attachment="'+a.id+'" aria-label="Remove photo">×</button></div>').join('')+'</div>':'')+'<textarea class="editor-content" id="entryContent" aria-label="Journal entry" placeholder="Write what is on your mind…">'+escapeHtml(e.content)+'</textarea><div class="tool-row"><button class="tool-button '+(state.listening?'recording':'')+'" data-action="voice">'+icon('mic')+'<span>'+(state.listening?'Listening…':'Speak')+'</span></button><button class="tool-button" data-action="photo">'+icon('image')+'<span>Photo</span></button><input id="photoInput" class="hidden" type="file" accept="image/*" multiple><button class="tool-button" data-action="reminder">'+icon('bell')+'<span>Remind</span></button><span class="tool-spacer"></span><button class="tool-button" data-action="tag"># <span>Tag</span></button></div></article>'}

    function remindersHtml(){
      const active=state.reminders.filter(r=>!r.completed).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));const done=state.reminders.filter(r=>r.completed).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));const now=new Date(),end=new Date(now);end.setHours(23,59,59,999);
      const groups=[['Overdue',active.filter(r=>new Date(r.due_at)<now)],['Today',active.filter(r=>new Date(r.due_at)>=now&&new Date(r.due_at)<=end)],['Upcoming',active.filter(r=>new Date(r.due_at)>end)],['Completed',done]];
      return '<section class="reminder-view"><div class="reminder-head"><div><div class="eyebrow">Stay gently on track</div><h1 class="reminder-title">Reminders</h1></div><button class="button primary" data-action="reminder">'+icon('plus',15)+' Add</button></div><div class="reminder-groups">'+groups.filter(g=>g[1].length).map(([name,items])=>'<div><div class="group-title">'+name+'</div>'+items.map(reminderItemHtml).join('')+'</div>').join('')+(state.reminders.length?'':'<div class="empty"><div class="empty-illustration">◷</div><strong>Nothing to remember yet</strong><span>Add a reminder here or from any note.</span></div>')+'</div></section>';
    }
    function reminderItemHtml(r){const overdue=!r.completed&&new Date(r.due_at)<new Date();return '<div class="reminder-item '+(r.completed?'done':'')+'"><button class="check '+(r.completed?'done':'')+'" data-toggle-reminder="'+r.id+'" aria-label="'+(r.completed?'Mark incomplete':'Complete reminder')+'">'+(r.completed?icon('check',15):'')+'</button><button class="reminder-main" style="border:0;background:transparent;text-align:left;padding:0" data-edit-reminder="'+r.id+'"><div class="reminder-name">'+escapeHtml(r.title)+'</div><div class="reminder-date '+(overdue?'overdue':'')+'">'+escapeHtml(formatDue(r.due_at))+' · '+escapeHtml(r.space)+'</div></button><button class="icon-button" data-delete-reminder="'+r.id+'" aria-label="Delete reminder">'+icon('trash',15)+'</button></div>'}
    function formatDue(value){return new Date(value).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}

    function render(){const root=$('#appRoot');$('#loading').classList.add('hidden');$('#authRoot').classList.add('hidden');root.classList.remove('hidden');root.innerHTML=shellHtml();bindEvents();}
    function renderEntryListOnly(){const list=$('#entryList');if(list)list.innerHTML=entryListHtml();$$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));}
    function bindEvents(){
      $$('[data-action="new"]').forEach(b=>b.onclick=()=>createEntry(state.tab==='personal'?'personal':'work'));
      $$('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;state.search='';state.filter='all';state.mobileEditorOpen=false;if(state.tab!=='reminders'){const first=state.entries.find(e=>e.space===state.tab&&!e.archived);state.selectedId=first?.id||null;}render();});
      $$('[data-entry]').forEach(b=>b.onclick=()=>{state.selectedId=b.dataset.entry;state.mobileEditorOpen=true;render();});
      $$('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;render();});
      $('#searchInput')?.addEventListener('input',e=>{state.search=e.target.value;renderEntryListOnly()});
      $('#entryTitle')?.addEventListener('input',e=>updateEntryField('title',e.target.value));
      $('#entryContent')?.addEventListener('input',e=>{autoGrow(e.target);updateEntryField('content',e.target.value)});
      $('#entryContent')&&autoGrow($('#entryContent'));
      $$('[data-action="theme"]').forEach(b=>b.onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
      $$('[data-action="logout"]').forEach(b=>b.onclick=signOut);
      $$('[data-action="close-editor"]').forEach(b=>b.onclick=()=>{state.mobileEditorOpen=false;render()});
      $$('[data-action="voice"]').forEach(b=>b.onclick=toggleVoice);
      $$('[data-action="photo"]').forEach(b=>b.onclick=()=>$('#photoInput')?.click());
      $('#photoInput')?.addEventListener('change',e=>uploadPhotos(e.target.files));
      $$('[data-action="reminder"]').forEach(b=>b.onclick=()=>showReminderModal());
      $$('[data-action="open-reminder"]').forEach(b=>b.onclick=()=>showReminderModal(state.reminders.find(r=>r.entry_id===state.selectedId&&!r.completed)));
      $$('[data-action="tag"]').forEach(b=>b.onclick=showTagModal);
      $$('[data-action="more"]').forEach(b=>b.onclick=showMoreModal);
      $$('[data-remove-tag]').forEach(b=>b.onclick=()=>{const e=selectedEntry();e.tags=e.tags.filter(t=>t!==b.dataset.removeTag);queueSave(e);render()});
      $$('[data-toggle-reminder]').forEach(b=>b.onclick=async()=>{const r=state.reminders.find(x=>x.id===b.dataset.toggleReminder);r.completed=!r.completed;await data.saveReminder(r);render()});
      $$('[data-edit-reminder]').forEach(b=>b.onclick=()=>showReminderModal(state.reminders.find(r=>r.id===b.dataset.editReminder)));
      $$('[data-delete-reminder]').forEach(b=>b.onclick=()=>confirmDeleteReminder(b.dataset.deleteReminder));
      $$('[data-delete-attachment]').forEach(b=>b.onclick=()=>deleteAttachment(b.dataset.deleteAttachment));
    }
    function autoGrow(el){el.style.height='auto';el.style.height=Math.max(330,el.scrollHeight)+'px'}

    function showModal(content){$('#modalRoot').innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true">'+content+'</div></div>';$('#modalBackdrop').onclick=e=>{if(e.target===e.currentTarget)closeModal()}}
    function closeModal(){$('#modalRoot').innerHTML=''}
    function showTagModal(){showModal('<h2>Add a tag</h2><form id="tagForm"><div class="field"><label for="tagName">Tag</label><input id="tagName" maxlength="24" placeholder="project, idea, meeting…" autofocus></div><div class="modal-actions"><button class="button" type="button" data-close>Cancel</button><button class="button primary">Add tag</button></div></form>');$('[data-close]').onclick=closeModal;$('#tagName').focus();$('#tagForm').onsubmit=e=>{e.preventDefault();const tag=$('#tagName').value.trim().toLowerCase().replace(/^#/,'');const entry=selectedEntry();if(tag&&!entry.tags.includes(tag)){entry.tags.push(tag);queueSave(entry)}closeModal();render()}}
    function showMoreModal(){const e=selectedEntry();showModal('<h2>Note options</h2><div style="display:grid;gap:9px"><button class="button" data-option="pin">'+icon('pin',16)+' '+(e.pinned?'Unpin note':'Pin note')+'</button><button class="button" data-option="export">'+icon('download',16)+' Export as Markdown</button><button class="button danger" data-option="delete">'+icon('trash',16)+' Delete note</button></div><div class="modal-actions"><button class="button" data-close>Close</button></div>');$('[data-close]').onclick=closeModal;$('[data-option="pin"]').onclick=()=>{e.pinned=!e.pinned;queueSave(e);closeModal();render()};$('[data-option="export"]').onclick=()=>{exportEntry(e);closeModal()};$('[data-option="delete"]').onclick=()=>confirmDeleteEntry(e)}
    function showReminderModal(existing){const linkedEntry=selectedEntry();const r=existing||{id:uid(),user_id:state.session?.user?.id||'local-user',entry_id:state.tab==='reminders'?null:linkedEntry?.id||null,space:state.tab==='personal'?'personal':linkedEntry?.space||'work',title:linkedEntry?.title||firstLine(linkedEntry?.content)||'',notes:'',due_at:defaultDue(),completed:false,created_at:nowIso(),updated_at:nowIso()};showModal('<h2>'+(existing?'Edit reminder':'Add a reminder')+'</h2><form id="reminderForm"><div class="field"><label for="reminderTitle">What should I remember?</label><input id="reminderTitle" required maxlength="160" value="'+escapeHtml(r.title)+'" placeholder="Follow up, call, submit…"></div><div class="field"><label for="reminderDue">When</label><input id="reminderDue" required type="datetime-local" value="'+toLocalInput(r.due_at)+'"></div><div class="field"><label for="reminderSpace">Area</label><select id="reminderSpace"><option value="work" '+(r.space==='work'?'selected':'')+'>Work</option><option value="personal" '+(r.space==='personal'?'selected':'')+'>Personal</option></select></div><div class="modal-actions"><button class="button" type="button" data-close>Cancel</button><button class="button primary">Save reminder</button></div></form>');$('[data-close]').onclick=closeModal;$('#reminderTitle').focus();$('#reminderForm').onsubmit=async e=>{e.preventDefault();r.title=$('#reminderTitle').value.trim();r.due_at=new Date($('#reminderDue').value).toISOString();r.space=$('#reminderSpace').value;await data.saveReminder(r);closeModal();render();toast('Reminder saved')}}
    function defaultDue(){const d=new Date();d.setHours(d.getHours()+1,0,0,0);return d.toISOString()}
    function toLocalInput(iso){const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
    async function confirmDeleteEntry(e){if(!confirm('Delete this note and its photos? This cannot be undone.'))return;closeModal();try{await data.deleteEntry(e);state.selectedId=visibleEntries()[0]?.id||null;state.mobileEditorOpen=false;render();toast('Note deleted')}catch(error){toast(error.message,'error')}}
    async function confirmDeleteReminder(id){if(!confirm('Delete this reminder?'))return;try{await data.deleteReminder(id);render();toast('Reminder deleted')}catch(error){toast(error.message,'error')}}
    function exportEntry(e){const text='# '+(e.title||'Untitled')+'\n\n'+e.content+'\n\n'+(e.tags?.length?'Tags: '+e.tags.map(t=>'#'+t).join(' ')+'\n\n':'')+'Created: '+new Date(e.created_at).toLocaleString();const blob=new Blob([text],{type:'text/markdown'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(e.title||'journal-entry').replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.md';a.click();URL.revokeObjectURL(a.href)}

    function toggleVoice(){
      if(state.listening){state.recognition?.stop();return}
      const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition){toast('Voice transcription works best in Chrome or Edge','error');return}
      const recognition=new Recognition();recognition.continuous=true;recognition.interimResults=true;recognition.lang=navigator.language||'en-US';state.recognition=recognition;state.listening=true;render();
      let lastCommittedIndex=-1;const recentFinals=new Map();
      recognition.onresult=event=>{let interim='';for(let i=event.resultIndex;i<event.results.length;i++){const transcript=event.results[i][0].transcript.trim();if(event.results[i].isFinal){if(i<=lastCommittedIndex)continue;lastCommittedIndex=i;const fingerprint=transcript.toLowerCase().replace(/\s+/g,' ').trim(),seenAt=recentFinals.get(fingerprint)||0,currentTime=Date.now();if(fingerprint&&currentTime-seenAt<3500)continue;recentFinals.set(fingerprint,currentTime);for(const [key,time] of recentFinals){if(currentTime-time>10000)recentFinals.delete(key)}const command=fingerprint.replace(/[.!?]/g,'').trim();if(command==='stop'){recognition.stop();return}const committed=command==='period'?'.':(command==='comma'||command==='comme'?',':transcript);if(committed)insertAtCursor($('#entryContent'),committed);}else interim=transcript}const save=$('#saveState');if(save&&interim)save.textContent='Hearing: '+interim.slice(0,28)};
      recognition.onerror=e=>{if(e.error!=='aborted')toast('Microphone: '+e.error,'error')};recognition.onend=()=>{state.listening=false;state.recognition=null;render()};recognition.start();
    }
    function insertAtCursor(el,text){if(!el)return;const start=el.selectionStart,end=el.selectionEnd;const before=el.value.slice(0,start),after=el.value.slice(end);const join=before&&text&&![".",","].includes(text[0])&&!/\s$/.test(before)?' ':'';el.value=before+join+text+after;const pos=(before+join+text).length;el.setSelectionRange(pos,pos);updateEntryField('content',el.value);autoGrow(el)}

    async function compressImage(file){return new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{const max=1800,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{URL.revokeObjectURL(url);blob?resolve(blob):reject(new Error('Could not process image'))},'image/jpeg',.82)};img.onerror=()=>reject(new Error('Could not read image'));img.src=url})}
    async function uploadPhotos(files){const entry=selectedEntry();if(!entry||!files?.length)return;for(const file of Array.from(files).slice(0,6)){if(!file.type.startsWith('image/')){toast('Only image files are supported','error');continue}try{toast('Preparing '+file.name+'…');const blob=await compressImage(file);if(blob.size>6*1024*1024)throw new Error('Image is too large after compression');const attachment={id:uid(),user_id:state.session?.user?.id||'local-user',entry_id:entry.id,storage_path:'',file_name:file.name.replace(/\.[^.]+$/,'.jpg'),mime_type:'image/jpeg',size_bytes:blob.size,created_at:nowIso()};if(state.localMode){attachment.url=await blobToDataUrl(blob);attachment.storage_path='local/'+attachment.id;state.attachments.push(attachment);try{localWrite('attachments',state.attachments)}catch{state.attachments.pop();throw new Error('Browser storage is full. Connect Supabase for photo storage.')}}else{attachment.storage_path=state.session.user.id+'/'+entry.id+'/'+attachment.id+'.jpg';const upload=await supabase.storage.from('journal-images').upload(attachment.storage_path,blob,{contentType:'image/jpeg'});if(upload.error)throw upload.error;const inserted=await supabase.from('attachments').insert(attachment).select().single();if(inserted.error){await supabase.storage.from('journal-images').remove([attachment.storage_path]);throw inserted.error}Object.assign(attachment,inserted.data);const signed=await supabase.storage.from('journal-images').createSignedUrl(attachment.storage_path,3600);attachment.url=signed.data?.signedUrl||'';state.attachments.push(attachment)}render();toast('Photo added')}catch(error){toast(error.message||'Photo upload failed','error')}}}
    function blobToDataUrl(blob){return new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob)})}
    async function deleteAttachment(id){const a=state.attachments.find(x=>x.id===id);if(!a)return;if(!confirm('Remove this photo?'))return;try{if(state.localMode){state.attachments=state.attachments.filter(x=>x.id!==id);localWrite('attachments',state.attachments)}else{const del=await supabase.storage.from('journal-images').remove([a.storage_path]);if(del.error)throw del.error;const row=await supabase.from('attachments').delete().eq('id',id);if(row.error)throw row.error;state.attachments=state.attachments.filter(x=>x.id!==id)}render()}catch(error){toast(error.message,'error')}}

    async function signOut(){if(state.listening)state.recognition?.stop();if(cloudAvailable)await supabase.auth.signOut();state.session=null;state.entries=[];renderAuth()}
    function checkDueReminders(){const due=state.reminders.filter(r=>!r.completed&&new Date(r.due_at)<=new Date()&&!sessionStorage.getItem('notified-'+r.id));due.forEach(r=>{sessionStorage.setItem('notified-'+r.id,'1');toast('Reminder: '+r.title);if(Notification.permission==='granted')new Notification(CONFIG.appName,{body:r.title})})}
    async function startApp(){try{$('#loading').classList.remove('hidden');await data.load();const work=state.entries.find(e=>e.space==='work'&&!e.archived);state.selectedId=work?.id||null;render();checkDueReminders();setInterval(checkDueReminders,60000)}catch(error){$('#loading').classList.add('hidden');toast(error.message||'Could not load your journal','error');renderAuth()}}

    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#searchInput')?.focus()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();createEntry(state.tab==='personal'?'personal':'work')}if(e.key==='Escape'&&$('#modalRoot').innerHTML)closeModal()});
    window.addEventListener('online',()=>toast('Back online'));window.addEventListener('offline',()=>toast('Offline — drafts stay on this device'));
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});

    if(cloudAvailable){const {data:{session}}=await supabase.auth.getSession();state.session=session;supabase.auth.onAuthStateChange((_event,next)=>{if(next&&!state.session){state.session=next;startApp()}else state.session=next});if(session)await startApp();else renderAuth()}else renderAuth();
  </script>
</body>
</html>`;

const manifest = JSON.stringify({
  name: 'Daybook — Second Brain', short_name: 'Daybook', start_url: '/', display: 'standalone',
  background_color: '#f5f0e8', theme_color: '#5e745c',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
}, null, 2);

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="120" fill="#5e745c"/><circle cx="256" cy="256" r="154" fill="none" stroke="#fffdf8" stroke-width="28"/><path d="M256 102a154 154 0 0 0 0 308V102Z" fill="#fffdf8"/></svg>`;
const serviceWorker = `const CACHE='daybook-v2';self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/manifest.webmanifest','/icon.svg'])))});self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));self.addEventListener('fetch',e=>{if(e.request.method==='GET'&&new URL(e.request.url).origin===self.location.origin)e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))))});`;

function build() {
  fs.mkdirSync(DIST, { recursive: true });
  const output = html.replace('__APP_CONFIG__', JSON.stringify(BUILD_CONFIG).replace(/</g, '\\u003c'));
  fs.writeFileSync(path.join(DIST, 'index.html'), output);
  fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), manifest);
  fs.writeFileSync(path.join(DIST, 'icon.svg'), iconSvg);
  fs.writeFileSync(path.join(DIST, 'sw.js'), serviceWorker);
  fs.writeFileSync(path.join(DIST, 'supabase-setup.sql'), sql);
  console.log('Built Daybook into dist/');
}

function serve() {
  build();
  const port = Number(process.env.PORT || 3000);
  const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json', '.sql':'text/plain; charset=utf-8' };
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const requested = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
    let file = path.resolve(DIST, requested);
    if (!file.startsWith(path.resolve(DIST)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', path.basename(file) === 'index.html' ? 'no-cache' : 'public, max-age=3600');
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, () => console.log('Daybook is running at http://localhost:' + port));
}

const command = process.argv[2] || 'dev';
if (command === 'build') build();
else if (command === 'dev' || command === 'serve') serve();
else { console.error('Use: node index.js [dev|build|serve]'); process.exit(1); }
