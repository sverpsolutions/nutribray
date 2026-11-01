// Telegram Business Assistant: connection, linked accounts (one-time codes), report / alert access, alert schedule, logs.
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { users_api, type user_row } from '../../api/users';
import Modal from '../../components/ui/Modal';
import { Badge, Table, Tabs, btnPri, btnSec, err, inp } from '../manufacturing/mfgShared';

type report = { key: string; title: string; group: string; financial: boolean };
type alert_type = { key: string; title: string; financial: boolean };
type status = {
  enabled: boolean; token_configured: boolean; bot_username: string | null; last_ok_at: string | null; last_error: string | null; last_error_at: string | null
  webhook: { url: string; pending: number; last_error: string | null; last_error_date: number | null } | null; webhook_expected: string | null; webhook_error?: string
  alerts: Record<string, string | number>; counts: { active_accounts: number; messages_24h: number; errors_24h: number; refused_24h: number }
  reports: report[]; alert_types: alert_type[]
};
type account = {
  id: number; user_name: string; username: string; role: string; chat_id: number; tg_username: string | null; tg_name: string | null; status: string
  allow_financial: boolean; blocked_reports: string[]; alerts: string[]; linked_at: string; last_seen_at: string | null; linked_by_name: string | null
};
const dt = (v?: string | null) => v ? new Date(v.endsWith('Z') || v.includes('+') ? v : v + 'Z').toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export default function TelegramAssistant() {
  const [tab, setTab] = useState('Connection');
  const [st, setSt] = useState<status | null>(null);
  const [accounts, setAccounts] = useState<account[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [sentAlerts, setSentAlerts] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [linkFor, setLinkFor] = useState<{ user_id: string; allow_financial: boolean; users: user_row[]; result?: any } | null>(null);
  const [edit, setEdit] = useState<account | null>(null);
  const [alerts, setAlerts] = useState<Record<string, string | number>>({});

  const load = () => {
    api.get<status>('/telegram/status').then(r => { setSt(r.data); setAlerts(r.data.alerts); }).catch(err);
    api.get<account[]>('/telegram/accounts').then(r => setAccounts(r.data)).catch(() => {});
  };
  useEffect(load, []);
  useEffect(() => {
    if (tab === 'Logs') api.get('/telegram/logs').then(r => setLogs(r.data)).catch(err);
    if (tab === 'Alerts') api.get('/telegram/alerts-sent').then(r => setSentAlerts(r.data)).catch(() => {});
  }, [tab]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { const r = await fn(); toast.success(ok); load(); return r; } catch (e) { err(e); } finally { setBusy(false); }
  };
  const openLink = async () => {
    const r = await users_api.list({ per_page: 200, status: true }).catch(() => null);
    setLinkFor({ user_id: '', allow_financial: false, users: r?.data.data || [] });
  };

  if (!st) return <div className="p-4 text-slate-500">Loading…</div>;
  const hookOk = st.webhook?.url && st.webhook.url === st.webhook_expected;

  return (
    <div className="p-4 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-slate-800"><i className="fab fa-telegram text-sky-500 mr-2" />Telegram Business Assistant</h1>
        <p className="text-sm text-slate-500">Read-only live reports on Telegram for linked users — same outlets, categories and permissions as in the software.</p>
      </div>
      <Tabs tabs={['Connection', 'Accounts', 'Alerts', 'Logs']} value={tab} onChange={setTab} />

      {tab === 'Connection' && (
        <div className="grid md:grid-cols-2 gap-4">
          <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 text-sm">
            <h3 className="font-semibold">Connection</h3>
            <Row k="Bot token">{st.token_configured ? <span className="text-green-700">Configured on the server (hidden)</span>
              : <span className="text-red-600">Not set — add TELEGRAM_BOT_TOKEN to the server .env and restart</span>}</Row>
            <Row k="Bot">{st.bot_username ? <a className="text-indigo-600" href={`https://t.me/${st.bot_username}`} target="_blank" rel="noreferrer">@{st.bot_username}</a> : '—'}</Row>
            <Row k="Webhook">{hookOk ? <span className="text-green-700">Active</span> : st.webhook?.url ? <span className="text-amber-700">Points elsewhere: {st.webhook.url}</span> : <span className="text-slate-500">Not registered</span>}
              {st.webhook?.pending ? <span className="text-amber-700"> · {st.webhook.pending} waiting</span> : null}</Row>
            {st.webhook?.last_error && <Row k="Telegram reports"><span className="text-red-600">{st.webhook.last_error}</span></Row>}
            {st.webhook_error && <Row k="Check"><span className="text-red-600">{st.webhook_error}</span></Row>}
            <Row k="Last success">{dt(st.last_ok_at)}</Row>
            {st.last_error && <Row k="Last error"><span className="text-red-600">{st.last_error} ({dt(st.last_error_at)})</span></Row>}
            <div className="flex flex-wrap gap-2 pt-2">
              <button className={btnSec} disabled={busy || !st.token_configured} onClick={() => run(() => api.post('/telegram/verify'), 'Bot connection verified')}>Verify connection</button>
              <button className={btnPri} disabled={busy || !st.token_configured} onClick={() => run(() => api.post('/telegram/webhook/register'), 'Webhook registered')}>Register webhook</button>
              {st.webhook?.url && <button className={btnSec} disabled={busy} onClick={() => confirm('Stop receiving Telegram messages?') && run(() => api.delete('/telegram/webhook'), 'Webhook removed')}>Remove webhook</button>}
            </div>
          </section>
          <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 text-sm">
            <h3 className="font-semibold">Integration</h3>
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={st.enabled} disabled={busy} onChange={e => run(() => api.put('/telegram/settings', { enabled: e.target.checked }), e.target.checked ? 'Assistant enabled' : 'Assistant disabled')} />
              Enabled (answer messages and send alerts)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Box k="Linked accounts" v={st.counts.active_accounts} />
              <Box k="Messages (24 h)" v={st.counts.messages_24h} />
              <Box k="Refused (24 h)" v={st.counts.refused_24h} />
              <Box k="Errors (24 h)" v={st.counts.errors_24h} />
            </div>
            <p className="text-xs text-slate-500">Set up: 1) create a bot with @BotFather, 2) put its token in the server .env as TELEGRAM_BOT_TOKEN, 3) Verify connection,
              4) Register webhook, 5) Enable, 6) Accounts → Link a user. Reports work only in private chats with linked accounts; financial reports need a per-account switch.</p>
          </section>
        </div>
      )}

      {tab === 'Accounts' && (
        <div className="space-y-3">
          <div className="flex justify-end"><button className={btnPri} onClick={openLink}><i className="fas fa-link mr-1" />Link a user</button></div>
          <Table rows={accounts} cols={[
            ['User', a => <><div className="font-semibold">{a.user_name}</div><div className="text-xs text-slate-500">{a.username} · {a.role}</div></>],
            ['Telegram', a => <>{a.tg_name || '—'}{a.tg_username && <span className="text-slate-500"> @{a.tg_username}</span>}</>],
            ['Status', a => <Badge s={a.status} />],
            ['Financial', a => a.allow_financial ? 'Allowed' : '—'],
            ['Blocked reports', a => a.blocked_reports.length || '—'],
            ['Alerts', a => a.alerts.length ? a.alerts.length : '—'],
            ['Last used', a => dt(a.last_seen_at)],
            ['', a => a.status === 'ACTIVE' && <div className="flex gap-1 justify-end">
              <button className={btnSec} onClick={() => setEdit(a)}>Access</button>
              <button className={btnSec} onClick={() => run(() => api.post(`/telegram/accounts/${a.id}/test`), 'Test message sent')}>Test</button>
              <button className={`${btnSec} !text-red-600`} onClick={() => confirm(`Revoke Telegram access of ${a.user_name}?`) && run(() => api.patch(`/telegram/accounts/${a.id}`, { status: 'REVOKED' }), 'Access revoked')}>Revoke</button>
            </div>, 'text-right'],
          ]} empty="No Telegram accounts linked yet." />
        </div>
      )}

      {tab === 'Alerts' && (
        <div className="space-y-4">
          <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 text-sm">
            <h3 className="font-semibold">Schedule (IST, HH:MM — several times separated by commas)</h3>
            <div className="grid md:grid-cols-2 gap-3">
              {st.alert_types.map(t => (
                <label key={t.key} className="block"><span className="text-xs text-slate-600">{t.title}{t.financial && ' 🔒'}</span>
                  <input className={inp} value={String(alerts[t.key] ?? '')} onChange={e => setAlerts(a => ({ ...a, [t.key]: e.target.value }))} /></label>
              ))}
              <label className="block"><span className="text-xs text-slate-600">Unusual discount: alert at % of gross sales</span>
                <input className={inp} type="number" min={0} max={100} value={alerts.discount_pct ?? ''} onChange={e => setAlerts(a => ({ ...a, discount_pct: e.target.value }))} /></label>
              <label className="block"><span className="text-xs text-slate-600">Unusual returns: alert at % of gross sales</span>
                <input className={inp} type="number" min={0} max={100} value={alerts.return_pct ?? ''} onChange={e => setAlerts(a => ({ ...a, return_pct: e.target.value }))} /></label>
            </div>
            <p className="text-xs text-slate-500">Recipients choose alerts under Accounts → Access. Each alert goes once per slot; it is sent only when there is something to report (daily summary and snapshots always).</p>
            <div className="flex justify-end"><button className={btnPri} disabled={busy} onClick={() => run(() => api.put('/telegram/settings', { enabled: st.enabled, alerts }), 'Alert schedule saved')}>Save schedule</button></div>
          </section>
          <h3 className="font-semibold text-sm">Delivery history</h3>
          <Table rows={sentAlerts} cols={[['Sent', r => dt(r.sent_at)], ['User', r => r.user_name], ['Alert', r => st.alert_types.find(t => t.key === r.alert)?.title || r.alert],
            ['Slot', r => r.period], ['Status', r => <Badge s={r.status} />], ['Error', r => <span className="text-red-600 text-xs">{r.error}</span>]]} />
        </div>
      )}

      {tab === 'Logs' && (
        <Table rows={logs} cols={[['Time', r => dt(r.at)], ['User', r => r.user_name || (r.chat_id ? `chat ${r.chat_id}` : '—')], ['Request', r => <span className="text-xs">{r.request}</span>],
          ['Report', r => r.report || '—'], ['Status', r => <Badge s={r.status} />], ['ms', r => r.ms ?? '—', 'text-right'], ['Error', r => <span className="text-red-600 text-xs">{r.error}</span>]]}
          empty="No messages yet." />
      )}

      <Modal open={!!linkFor} onClose={() => setLinkFor(null)} title="Link a Telegram account" width="max-w-lg">
        {linkFor && (linkFor.result ? (
          <div className="space-y-3 text-sm">
            <p>Give this to <b>{linkFor.users.find(u => String(u.id) === linkFor.user_id)?.name}</b>. It works once and expires in {linkFor.result.minutes} minutes.</p>
            {linkFor.result.link && <p><a className="text-indigo-600 break-all" href={linkFor.result.link} target="_blank" rel="noreferrer">{linkFor.result.link}</a></p>}
            <p>Or in the bot send: <code className="bg-slate-100 px-2 py-1 rounded select-all">/start {linkFor.result.code}</code></p>
            <div className="flex justify-end"><button className={btnSec} onClick={() => { setLinkFor(null); load(); }}>Done</button></div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <label className="block"><span className="text-xs text-slate-600">Software user (Telegram gets this user's outlets, categories and permissions)</span>
              <select className={inp} value={linkFor.user_id} onChange={e => setLinkFor(l => l && ({ ...l, user_id: e.target.value }))}>
                <option value="">Select…</option>
                {linkFor.users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.username} · {u.role}{u.outlet_name ? ` · ${u.outlet_name}` : ''})</option>)}
              </select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={linkFor.allow_financial} onChange={e => setLinkFor(l => l && ({ ...l, allow_financial: e.target.checked }))} />
              Allow financial reports (outstanding, cash, bank, expenses, GST, profit)</label>
            <div className="flex justify-end gap-2">
              <button className={btnSec} onClick={() => setLinkFor(null)}>Cancel</button>
              <button className={btnPri} disabled={!linkFor.user_id || busy} onClick={async () => {
                const r = await run(() => api.post('/telegram/link-code', { user_id: Number(linkFor.user_id), allow_financial: linkFor.allow_financial }), 'Link code created');
                if (r) setLinkFor(l => l && ({ ...l, result: r.data }));
              }}>Create one-time code</button>
            </div>
          </div>
        ))}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Telegram access • ${edit?.user_name ?? ''}`} width="max-w-3xl">
        {edit && (
          <div className="space-y-4 text-sm">
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={edit.allow_financial} onChange={e => setEdit({ ...edit, allow_financial: e.target.checked })} />
              Allow financial reports 🔒</label>
            <div>
              <div className="font-semibold mb-1">Reports (untick to block; outlet / category / role limits of the user always apply)</div>
              <div className="grid sm:grid-cols-3 gap-1 max-h-64 overflow-y-auto border border-slate-200 rounded p-2">
                {st.reports.map(r => (
                  <label key={r.key} className={`flex items-center gap-2 ${r.financial && !edit.allow_financial ? 'text-slate-400' : ''}`}>
                    <input type="checkbox" checked={!edit.blocked_reports.includes(r.key)}
                      onChange={e => setEdit({ ...edit, blocked_reports: e.target.checked ? edit.blocked_reports.filter(k => k !== r.key) : [...edit.blocked_reports, r.key] })} />
                    {r.title}{r.financial && ' 🔒'}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="font-semibold mb-1">Automatic alerts</div>
              <div className="grid sm:grid-cols-2 gap-1">
                {st.alert_types.map(t => (
                  <label key={t.key} className={`flex items-center gap-2 ${t.financial && !edit.allow_financial ? 'text-slate-400' : ''}`}>
                    <input type="checkbox" checked={edit.alerts.includes(t.key)}
                      onChange={e => setEdit({ ...edit, alerts: e.target.checked ? [...edit.alerts, t.key] : edit.alerts.filter(k => k !== t.key) })} />
                    {t.title}{t.financial && ' 🔒'}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className={btnSec} onClick={() => setEdit(null)}>Cancel</button>
              <button className={btnPri} disabled={busy} onClick={async () => {
                const r = await run(() => api.patch(`/telegram/accounts/${edit.id}`, { allow_financial: edit.allow_financial, blocked_reports: edit.blocked_reports, alerts: edit.alerts }), 'Access saved');
                if (r) setEdit(null);
              }}>Save</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const Row = ({ k, children }: { k: string; children: any }) => <div className="flex gap-3"><span className="w-32 shrink-0 text-slate-500">{k}</span><span>{children}</span></div>;
const Box = ({ k, v }: { k: string; v: number }) => <div className="border border-slate-200 rounded p-2"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div>;
