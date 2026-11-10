'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api, ApiError } from '@/lib/api';

interface Contact { email: string; name: string; sources: string[] }
interface SendResult { requestId: string; status: string; total: number; accepted: number; uncertain: boolean; message: string }
interface Draft { requestId: string; emails: string[]; subject: string; format: 'html' | 'text'; body: string }

export function AdminEmailComposer({ open, initialEmails, onClose }: { open: boolean; initialEmails: string[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'individual' | 'selected' | 'all'>('individual');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [format, setFormat] = useState<'html' | 'text'>('html');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [snapshot, setSnapshot] = useState<Draft | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // True only while a send's outcome is unknown (the connection dropped). That send must be
  // retried or checked, never replaced, so it survives closing and reopening the dialog.
  const uncertain = useRef(false);
  const finished = useRef(false);
  finished.current = result !== null;

  useEffect(() => {
    if (!open) return;
    // Keep the element: by cleanup time the ref may already point to null.
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    if (!uncertain.current) {
      // A finished, refused or unsent draft must not carry over: the recipients come from the button just clicked.
      if (finished.current) { setSubject(''); setBody(''); }
      setSnapshot(null); setSubmitted(false); setResult(null);
    }
    setSelected(initialEmails.map((email) => email.toLowerCase()));
    setMode(initialEmails.length > 1 ? 'selected' : 'individual');
    api<Contact[]>('/admin/emails/recipients', { auth: true, fallback: false })
      .then((list) => { if (!cancelled) setContacts(list); })
      .catch((err: Error) => { if (!cancelled) { setContacts([]); setError(err.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, initialEmails]);

  const addresses = mode === 'all' ? contacts.map((contact) => contact.email) : selected.filter((email) => contacts.some((contact) => contact.email === email));
  const visible = contacts.filter((contact) => `${contact.name} ${contact.email} ${contact.sources.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = (email: string) => setSelected((current) => mode === 'individual' ? [email] : current.includes(email) ? current.filter((item) => item !== email) : [...current, email]);

  const review = () => {
    if (!addresses.length || addresses.length > 1000) return setError('Choose between 1 and 1,000 contacts per send.');
    if (!subject.trim() || /[\r\n]/.test(subject)) return setError('Enter a subject on one line.');
    if (!body.trim() || new TextEncoder().encode(body).length > 100000) return setError('Enter a message up to 100 KB.');
    setError('');
    setSnapshot({ requestId: crypto.randomUUID(), emails: [...addresses].sort(), subject: subject.trim(), format, body });
  };

  const send = async () => {
    if (!snapshot || busy) return;
    setBusy(true); setSubmitted(true); setError('');
    try {
      setResult(await api<SendResult>('/admin/emails', { method: 'POST', auth: true, fallback: false, body: snapshot }));
      uncertain.current = false;
    } catch (err) {
      // The server's own refusals say whether anything was sent. Only a lost connection is uncertain.
      const unreachable = !(err instanceof ApiError) || err.status === 0;
      uncertain.current = unreachable;
      setError(unreachable
        ? `${(err as Error).message} If this request reached the server, messages may have been accepted. Check status or retry this same request; do not start another message.`
        : (err as Error).message);
    } finally { setBusy(false); }
  };

  const checkStatus = async () => {
    if (!snapshot || busy) return;
    setBusy(true); setError('');
    try { setResult(await api<SendResult>(`/admin/emails/${snapshot.requestId}`, { auth: true, fallback: false })); uncertain.current = false; }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const importHtml = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.html?$/i.test(file.name) || file.size > 100000) return setError('Choose an .html file up to 100 KB.');
    try { setBody(await file.text()); setFormat('html'); setError(''); }
    catch { setError('We could not read that file. Paste the HTML instead.'); }
  };

  if (!open) return null;
  return <dialog ref={dialog} className="email-dialog" aria-labelledby="email-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="email-heading"><div><h2 id="email-title">Email users</h2><p>Send an update to your contacts. Each address receives its own email.</p></div>
      <button type="button" className="btn btn-line" disabled={busy} onClick={onClose} aria-label="Close email composer">Close</button></div>
    {error && <p role="alert" className="email-error">{error}</p>}
    {snapshot ? <>
      <h3>{result ? 'Send status' : 'Review email'}</h3>
      <p><strong>{snapshot.subject}</strong> · {snapshot.format.toUpperCase()} · {snapshot.emails.length} {snapshot.emails.length === 1 ? 'recipient' : 'recipients'}</p>
      <details><summary>View all recipient addresses</summary><ul className="email-review-recipients">{snapshot.emails.map((email) => <li key={email}>{email}</li>)}</ul></details>
      {snapshot.format === 'html' ? <EmailPreview html={snapshot.body} /> : <pre className="email-text-preview">{snapshot.body}</pre>}
      {result && <p role="status">{result.message}</p>}
      <div className="email-actions">
        {!submitted && <button type="button" className="btn btn-line" onClick={() => setSnapshot(null)}>Edit message</button>}
        {!result && <button type="button" className="btn btn-dark" disabled={busy} onClick={send}>{busy ? 'Sending…' : submitted ? 'Retry same send safely' : `Send to ${snapshot.emails.length} ${snapshot.emails.length === 1 ? 'contact' : 'contacts'}`}</button>}
        {submitted && <button type="button" className="btn btn-line" disabled={busy} onClick={checkStatus}>Check send status</button>}
        {result && result.status !== 'sending' && <button type="button" className="btn btn-line" onClick={() => { setSnapshot(null); setSubmitted(false); setResult(null); setBody(''); setSubject(''); setError(''); }}>New message</button>}
      </div>
    </> : <>
      <fieldset className="email-modes"><legend>Recipients</legend>
        {(['individual', 'selected', 'all'] as const).map((item) => <label key={item}><input type="radio" name="email-audience" checked={mode === item} onChange={() => { setMode(item); if (item === 'individual') setSelected((current) => current.slice(0, 1)); }} />{item === 'individual' ? 'One person' : item === 'selected' ? 'Selected people' : `All contacts (${contacts.length})`}</label>)}
      </fieldset>
      <p className="email-note">Registered users, waitlist contacts, and event attendees. Duplicate addresses count once. Up to 1,000 contacts per send.</p>
      {loading ? <p role="status">Loading contacts…</p> : mode !== 'all' && <>
        <label className="email-field">Find a contact<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email or contact source" /></label>
        <div className="email-contacts">
          {mode === 'selected' && visible.length > 0 && <button type="button" className="btn btn-line btn-sm" onClick={() => setSelected((current) => [...new Set([...current, ...visible.map((contact) => contact.email)])])}>Select all shown</button>}
          {visible.map((contact) => <label key={contact.email} className="email-contact"><input type={mode === 'individual' ? 'radio' : 'checkbox'} name="email-contact" checked={selected.includes(contact.email)} onChange={() => toggle(contact.email)} /><span>{contact.name || contact.email}<small>{contact.name ? `${contact.email} · ` : ''}{contact.sources.join(', ')}</small></span></label>)}
          {!visible.length && <p>No contacts found.</p>}
        </div>
        <p className="email-note">{addresses.length} selected <button type="button" className="btn btn-line btn-sm" onClick={() => setSelected([])}>Clear selection</button></p>
      </>}
      <label className="email-field">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} /></label>
      <label className="email-field">Message format<select value={format} onChange={(event) => { setFormat(event.target.value as 'html' | 'text'); setPreview(false); }}><option value="html">HTML email</option><option value="text">Plain text</option></select></label>
      {format === 'html' && <label className="email-field">Import HTML file<input type="file" accept=".html,.htm,text/html" onChange={importHtml} /></label>}
      <label className="email-field">{format === 'html' ? 'HTML source' : 'Message'}<textarea rows={12} spellCheck={format !== 'html'} value={body} maxLength={100000} onChange={(event) => setBody(event.target.value)} placeholder={format === 'html' ? '<h1>Hello</h1><p>Your update…</p>' : 'Write your update…'} /></label>
      {format === 'html' && <><label><input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} /> Show HTML preview</label>{preview && <EmailPreview html={body} />}</>}
      <div className="email-actions"><button type="button" className="btn btn-dark" disabled={loading || !addresses.length} onClick={review}>Review email · {addresses.length} recipients</button></div>
    </>}
  </dialog>;
}

function EmailPreview({ html }: { html: string }) {
  // Raw admin HTML never becomes part of the admin DOM. Scripts, forms and network requests are blocked.
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
  return <div><p className="email-note">Preview blocks scripts and external images. Email apps may render HTML differently.</p><iframe title="HTML email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}">${html}`} className="email-preview" /></div>;
}
