"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, CalendarDays, ChevronDown, Database, History, Loader2, MessageSquare, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { api } from "@/lib/portal/api";
import { cn } from "@/lib/utils";
import { AccountAccess } from "./account-access";
import { RunResult } from "./run-result";
import { hasOutstandingRun, isWorking, prependHistory, type ChatAccounts, type ChatConversation, type ChatDetail, type ChatRun } from "./types";

const STARTERS = [
  { title: "Lead report", prompt: "How many new contacts were created this month? Show the date range, account timezone, sources and underlying records. Explain any pagination limits." },
  { title: "Pipeline review", prompt: "Review my sales pipelines and opportunities. What is open, won or lost, and where might follow-up be needed? Use current API evidence." },
  { title: "Account investigation", prompt: "What can you inspect about the workflows, forms and funnels in this account? Show what the API exposes and what still needs manual verification." },
  { title: "Explore capabilities", prompt: "Discover which GHL operations this connection can use. Summarize the read, create, update and delete capabilities, and explain any permission limits." },
];

function loadWorkspace() {
  return Promise.all([
    api.get<ChatAccounts>("ghl-chat/accounts/"),
    api.get<{ conversations: ChatConversation[] }>("ghl-chat/conversations/"),
  ]);
}

export function ChatWorkspace() {
  const toast = useToast();
  const [data, setData] = useState<ChatAccounts>({ accounts: [], manager: false });
  const [history, setHistory] = useState<ChatConversation[]>([]);
  const [accountId, setAccountId] = useState("");
  const [conversation, setConversation] = useState<ChatDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pollRetry, setPollRetry] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const prependScroll = useRef<{ id: string; height: number; top: number } | null>(null);
  const fetchingOlder = useRef(false);
  const loadVersion = useRef(0);
  const sending = useRef(false);
  const retryEnvelope = useRef<{ conversationId: string; question: string; key: string } | null>(null);
  const account = data.accounts.find((item) => String(item.id) === accountId);
  const activeRun = conversation?.runs.find((run) => isWorking(run.status));
  const pollingId = activeRun?.id;
  const pollingStatus = activeRun?.status;
  const outstanding = hasOutstandingRun(conversation?.runs ?? []);

  const refreshAccounts = useCallback(async (selectId?: number) => {
    const result = await api.get<ChatAccounts>("ghl-chat/accounts/");
    loadVersion.current++;
    setConversation(null);
    setDraft("");
    setPollError("");
    setOpening(false);
    retryEnvelope.current = null;
    setData(result);
    setAccountId((previous) => selectId ? String(selectId) : result.accounts.some((item) => String(item.id) === previous) ? previous : result.accounts.length === 1 ? String(result.accounts[0].id) : "");
  }, []);

  const initialize = useCallback(async () => {
    try {
      const [accounts, conversations] = await loadWorkspace();
      setData(accounts);
      setAccountId((previous) => previous || (accounts.accounts.length === 1 ? String(accounts.accounts[0].id) : ""));
      setHistory(conversations.conversations);
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load the chat workspace."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadWorkspace().then(([accounts, conversations]) => {
      if (!mounted) return;
      setData(accounts);
      setAccountId(accounts.accounts.length === 1 ? String(accounts.accounts[0].id) : "");
      setHistory(conversations.conversations);
    }).catch((err) => {
      if (mounted) setError(err instanceof Error ? err.message : "Could not load the chat workspace.");
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const updateRun = useCallback((run: ChatRun) => {
    setConversation((current) => current ? { ...current, runs: current.runs.map((item) => item.id === run.id ? run : item) } : current);
  }, []);

  useEffect(() => {
    if (!pollingId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (document.visibilityState === "hidden") { timer = setTimeout(poll, 5000); return; }
      try {
        const run = await api.get<ChatRun>(`ghl-chat/runs/${pollingId}/`);
        if (cancelled) return;
        updateRun(run);
        setPollError("");
        if (isWorking(run.status)) timer = setTimeout(poll, 3000);
      } catch (err) {
        if (!cancelled) setPollError(err instanceof Error ? err.message : "Could not check the request status.");
      }
    }
    timer = setTimeout(poll, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pollingId, pollingStatus, pollRetry, updateRun]);

  useLayoutEffect(() => {
    const position = prependScroll.current;
    if (position && position.id === conversation?.id && transcript.current) {
      transcript.current.scrollTop = position.top + transcript.current.scrollHeight - position.height;
      prependScroll.current = null;
      return;
    }
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [conversation?.id, conversation?.runs.length, conversation?.page, activeRun?.status]);

  function newChat(nextAccount = accountId) {
    loadVersion.current++;
    setAccountId(nextAccount);
    setConversation(null);
    setDraft("");
    setPollError("");
    setOpening(false);
    setShowHistory(false);
    setHistoryError("");
    prependScroll.current = null;
    retryEnvelope.current = null;
    composer.current?.focus();
  }

  async function openConversation(item: ChatConversation) {
    if (sending.current) return;
    const version = ++loadVersion.current;
    setAccountId(String(item.account_id));
    setOpening(true);
    setConversation(null);
    setPollError("");
    setDraft("");
    setShowHistory(false);
    setHistoryError("");
    prependScroll.current = null;
    retryEnvelope.current = null;
    try {
      const detail = await api.get<ChatDetail>(`ghl-chat/conversations/${item.id}/`);
      if (version === loadVersion.current) setConversation(detail);
    } catch (err) { if (version === loadVersion.current) setPollError(err instanceof Error ? err.message : "Could not open this conversation."); }
    finally { if (version === loadVersion.current) setOpening(false); }
  }

  async function loadOlder() {
    if (!conversation?.has_more || fetchingOlder.current) return;
    const targetId = conversation.id;
    const version = loadVersion.current;
    fetchingOlder.current = true;
    setLoadingOlder(true);
    setHistoryError("");
    try {
      const older = await api.get<ChatDetail>(`ghl-chat/conversations/${targetId}/?page=${(conversation.page ?? 1) + 1}`);
      if (version !== loadVersion.current) return;
      if (transcript.current) prependScroll.current = { id: targetId, height: transcript.current.scrollHeight, top: transcript.current.scrollTop };
      setConversation((current) => current?.id === targetId ? prependHistory(current, older) : current);
    } catch (err) {
      if (version === loadVersion.current) setHistoryError(err instanceof Error ? err.message : "Could not load earlier messages.");
    } finally { fetchingOlder.current = false; setLoadingOlder(false); }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!account || !question || sending.current || outstanding || opening) return;
    sending.current = true;
    setSubmitting(true);
    setPollError("");
    try {
      let target = conversation;
      if (!target) {
        const created = await api.post<ChatConversation>("ghl-chat/conversations/", { account_id: account.id, title: question.slice(0, 100) });
        target = { ...created, runs: [] };
        setConversation(target);
        setHistory((previous) => [created, ...previous.filter((item) => item.id !== created.id)]);
      }
      let request = retryEnvelope.current;
      if (!request || request.conversationId !== target.id || request.question !== question) {
        request = { conversationId: target.id, question, key: crypto.randomUUID() };
        retryEnvelope.current = request;
      }
      const run = await api.post<ChatRun>(`ghl-chat/conversations/${target.id}/messages/`, { question, request_key: request.key });
      const targetId = target.id;
      setConversation((current) => current?.id === targetId ? { ...current, runs: [...current.runs.filter((item) => item.id !== run.id), run] } : current);
      retryEnvelope.current = null;
      setDraft("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not send your question. Your draft has been kept."); }
    finally { sending.current = false; setSubmitting(false); }
  }

  function useDateRange() {
    if (!startDate || !endDate || startDate > endDate) { toast.error("Choose a valid start and end date."); return; }
    setDraft(`How many new contacts were created from ${startDate} through ${endDate}, inclusive, in this account's timezone? Give the total, a source breakdown and the underlying records for export. Distinguish contacts from opportunities and explain any incomplete results.`);
    composer.current?.focus();
  }

  const visibleHistory = history.filter((item) => (!accountId || String(item.account_id) === accountId) && item.title.toLowerCase().includes(search.toLowerCase()));

  return <div className="flex min-h-0 flex-1 flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">GHL Chat</h1><p className="mt-1 text-sm text-slate-500">Ask questions. Inspect live data. Review changes before they happen.</p></div><div className="flex items-center gap-2"><Button size="sm" variant="outline" className="lg:hidden" onClick={() => setShowHistory((shown) => !shown)}><History className="h-4 w-4" />History</Button>{data.manager && <AccountAccess data={data} account={account} onRefresh={refreshAccounts} />}</div></div>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span className="flex-1">{error}</span><Button size="sm" variant="outline" onClick={() => void initialize()}><RefreshCw className="h-3.5 w-3.5" />Retry</Button></div>}
    <div className="grid min-h-[660px] flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className={cn("flex-col border-b border-slate-200 bg-slate-50/70 lg:flex lg:border-b-0 lg:border-r", showHistory ? "flex" : "hidden")}>
        <div className="space-y-3 border-b border-slate-200 p-4"><label htmlFor="chat-account" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">GHL account</label><select id="chat-account" value={accountId} disabled={loading || submitting} onChange={(event) => newChat(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-pink-600/20"><option value="">Select an account</option>{data.accounts.map((item) => <option key={item.id} value={item.id}>{item.synthetic ? "[Demo] " : ""}{item.name}</option>)}</select><Button variant="outline" className="w-full bg-white" disabled={submitting || !account} onClick={() => newChat()}><Plus className="h-4 w-4" />New chat</Button></div>
        <div className="p-3"><label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2"><Search className="h-3.5 w-3.5 text-slate-400" /><input aria-label="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none" /></label></div>
        <nav aria-label="Conversation history" className="max-h-[50vh] flex-1 space-y-1 overflow-y-auto px-2 pb-4"><p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Your conversations</p>{visibleHistory.map((item) => <button key={item.id} disabled={submitting} onClick={() => void openConversation(item)} aria-current={conversation?.id === item.id ? "page" : undefined} className={cn("flex w-full items-start gap-2 rounded-lg px-3 py-3 text-left text-xs transition-colors hover:bg-slate-100", conversation?.id === item.id ? "bg-white font-semibold text-slate-950 shadow-sm ring-1 ring-slate-200" : "text-slate-600")}><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="line-clamp-2 break-words">{item.title}</span></button>)}{!loading && !visibleHistory.length && <p className="px-2 py-3 text-xs leading-5 text-slate-400">{search ? "No matching conversations." : "Your chats will appear here. History is private to you."}</p>}</nav>
        <p className="border-t border-slate-200 p-4 text-[11px] leading-5 text-slate-500">Account permissions apply to every query and export. Other staff cannot see your chat history.</p>
      </aside>
      <section className="flex min-w-0 flex-col">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3"><div className="flex min-w-0 items-center gap-2"><Database className="h-4 w-4 shrink-0 text-slate-400" /><span className="truncate text-sm font-semibold">{account?.name || "Choose a GHL account"}</span>{account && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", account.synthetic ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>{account.synthetic ? "Synthetic demo" : "Live account"}</span>}</div><div className="flex items-center gap-2 text-[11px] text-slate-500">{account && <><span>{account.timezone}</span><span>·</span><span>{account.can_execute ? "Changes need confirmation" : "Read only"}</span></>}<button className="rounded border border-slate-200 px-2 py-1 lg:hidden" onClick={() => setShowHistory((shown) => !shown)} aria-label="Choose account"><ChevronDown className="h-4 w-4" /></button></div></div>
        <div ref={transcript} className="max-h-[calc(100dvh-360px)] min-h-[340px] flex-1 overflow-y-auto px-5 py-7 sm:px-8">
          {loading || opening ? <div role="status" className="flex h-64 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 motion-safe:animate-spin" />{opening ? "Opening conversation…" : "Loading accounts…"}</div> : !data.accounts.length ? <div className="mx-auto max-w-md py-16 text-center"><h2 className="text-xl font-semibold">Connect an account to start</h2><p className="mt-3 text-sm leading-6 text-slate-500">{data.manager ? "Add a GHL token under Clients, then use Account access to enable chat for that account." : "Ask an administrator to grant you chat access to a connected GHL account."}</p>{data.manager && <Link href="/clients" className="mt-5 inline-block text-sm font-semibold text-pink-700 hover:underline">Go to Clients</Link>}</div> : conversation?.runs.length ? <div className="mx-auto max-w-3xl space-y-8">{conversation.has_more && <div className="text-center"><Button size="sm" variant="outline" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}</Button>{historyError && <p role="alert" className="mt-2 text-xs text-red-700">{historyError}</p>}</div>}{conversation.runs.map((run) => <RunResult key={run.id} run={run} account={account} onUpdate={updateRun} />)}</div> : <div className="mx-auto max-w-2xl py-7 sm:py-12"><p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Your account, in conversation</p><h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">What would you like to know?</h2><p className="mt-3 max-w-lg text-sm leading-6 text-slate-500">Query GHL, investigate implementation issues, or prepare a change. Answers include evidence and data limits. Export results to CSV or PDF.</p><div className="mt-7 grid gap-3 sm:grid-cols-2">{STARTERS.map((starter) => <button key={starter.title} disabled={!account || submitting} onClick={() => { setDraft(starter.prompt); composer.current?.focus(); }} className="rounded-xl border border-slate-200 p-4 text-left transition-colors hover:border-pink-200 hover:bg-pink-50/30 disabled:opacity-50"><p className="text-sm font-semibold">{starter.title}</p><p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-500">{starter.prompt}</p></button>)}</div></div>}
          {pollError && <div role="alert" className="mx-auto mt-4 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p>{pollError}</p>{activeRun && <Button size="sm" variant="outline" className="mt-2" onClick={() => { setPollError(""); setPollRetry((value) => value + 1); }}>Retry status check</Button>}</div>}
          <div ref={bottom} />
        </div>
        <div className="border-t border-slate-100 bg-white px-5 pb-4 pt-3 sm:px-8">
          <details className="mx-auto mb-3 max-w-3xl"><summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500"><CalendarDays className="h-3.5 w-3.5" />Build a date-range report</summary><div className="mt-3 flex flex-wrap items-end gap-3"><label className="text-xs text-slate-500">From<input aria-label="Report start date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 block h-9 rounded-md border border-slate-300 px-2 text-slate-800" /></label><label className="text-xs text-slate-500">Through<input aria-label="Report end date" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 block h-9 rounded-md border border-slate-300 px-2 text-slate-800" /></label><Button size="sm" variant="outline" disabled={!account || outstanding || submitting} onClick={useDateRange}>Use dates</Button><span className="text-[11px] text-slate-400">Inclusive dates · {account?.timezone || "account timezone"}</span></div></details>
          <form onSubmit={(event) => void send(event)} className="mx-auto max-w-3xl rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100">
            <textarea ref={composer} aria-label="Message GHL assistant" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={8000} rows={3} disabled={!account || submitting || outstanding || opening} placeholder={!account ? "Select an account to begin…" : outstanding ? "Wait for the current request or review its proposed action…" : `Ask about ${account.name}…`} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} className="block max-h-52 min-h-20 w-full resize-y border-0 bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-slate-400 disabled:text-slate-400" />
            <div className="flex items-center justify-between px-2 pb-1"><p className="text-[10px] text-slate-400">Enter to send · Shift + Enter for a new line</p><Button type="submit" size="sm" variant="primary" aria-label="Send message" disabled={!draft.trim() || !account || submitting || outstanding || opening}>{submitting ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <ArrowUp className="h-4 w-4" />}</Button></div>
          </form>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] leading-4 text-slate-400">Relevant GHL data is processed by your configured AI provider. Verify important decisions against the API evidence. No automatic changes or outbound messages.</p>
        </div>
      </section>
    </div>
  </div>;
}
