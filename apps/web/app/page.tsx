"use client";
import { confirmMissingDocuments } from "./missing-document-review";
import { confirmDuplicateReview } from "./duplicate-review";
import { WorkspaceDashboard } from "./workspace-dashboard";
import { NotificationsView } from "./notifications-ui";
import { CreateCampaign } from "./create-campaign";
import { DeveloperIntroduction } from "./developer-introduction";
import { PanelLeftClose, PanelLeftOpen, CircleHelp, Moon, Sun, MoreHorizontal } from "lucide-react";
import { CampaignDirectory } from "./campaign-directory";
import { useEffect, useState, useRef, type FormEvent } from "react";
import {
  AuthPanel,
  AccountSettings,
  PolicyNotice,
  type Identity,
} from "./account-ui";
import {
  GraduationCap,
  LayoutDashboard,
  Users,
  Send,
  FileText,
  CalendarClock,
  Settings,
  ChevronRight,
  Plus,
  ArrowUpRight,
  Search,
  Bell,
  Sparkles,
  Upload,
  Pause,
  Play,
  Square,
  LogOut,
  ShieldCheck,
  Clock,
  Check,
  Mail,
  Menu,
  X,
  History,
} from "lucide-react";
import { SmartImport } from "./smart-import";
import { ImportWizard } from "./import-wizard";
import {
  SequenceSteps,
  SchedulerStatus,
  type SequenceStatus,
} from "./sequence-status";
import {
  ActivationPanel,
  Welcome,
  LearningCenter,
  PracticeCampaign,
  Help,
} from "./learning-ui";
import { ProductTour, startProductTour } from "./product-tour";
import { BookOpen, FlaskConical } from "lucide-react";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file";
import {
  spreadsheetDraft,
  normalizeSpreadsheetRow,
} from "../../../shared/spreadsheet";
import {
  MAX_SEQUENCE_DAYS,
  type FollowupStep,
} from "../../../shared/followup-sequence";
import { localDate, zonedISO } from "../lib/timezone";

// Production always uses the same-origin Vercel /api rewrite, including downloads.
// A development override can still target a local Worker directly.
const API =
  process.env.NODE_ENV === "production"
    ? ""
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(
        /\/$/,
        "",
      );
type Profile = {
  name: string;
  university: string;
  degree: string;
  gpa: string;
  interests: string;
  timezone: string;
  paused: number;
  stopped: number;
};
type Professor = {
  archived_at?: number | null;
  source_url?: string | null;
  verified_at?: number | null;
  id: string;
  name: string;
  email: string;
  university: string;
  interests: string;
};
type Doc = {
  content_type: string;
  expires_at?: number | null;
  retained_until?: number | null;
  id: string;
  name: string;
  size: number;
};
type Message = {
  id: string;
  professor_id: string;
  professor_name: string;
  professor_email: string;
  subject: string;
  body: string;
  mode: string;
  status: string;
  archived_at?: number | null;
  hidden_at?: number | null;
  followup_issue?: string | null;
  followup_draft?: string | null;
  approved?: number;
  live_ready?: number;
  campaign_import_id?: string | null;
  parent_id?: string | null;
  scheduled_at: string;
  timezone: string;
  followup_at: string | null;
  sent_at?: string | null;
  followup_proposal?: string | null;
  attachments: string[];
  error: string | null;
};
type Audit = { id: string; action: string; created_at: string; entity_id?: string };
type State = {
  sending_usage?: {sent:number;remaining:number;limit:number;next_available_at:number|null;pacing_available_at:number|null;mailboxes:{connection_id:string;address:string;sent:number;remaining:number;next_available_at:number|null}[]};
  reply_locations?: {message_id:string;location:string}[];
  campaigns?: {
    id: string;
    name: string;
    initial_count: number;
    followup_count: number;
    approved_at: number;
    cancelled: number;
  }[];
  followup_steps?: SequenceStatus[];
  scheduler?: {
    started_at: number;
    completed_at: number;
    failure: string | null;
  } | null;
  authorizations?: { message_id: string; campaign_id: string; kind: string }[];
  profile: Profile;
  professors: Professor[];
  documents: Doc[];
  messages: Message[];
  connections: {
    id: string;
    provider: "gmail" | "outlook";
    address: string;
    status: string;
    scopes: string;
  }[];
  capabilities: {
    workspace_limited: boolean;
    gmail: boolean;
    outlook: boolean;
    live_email: boolean;
    mock_delivery: boolean;
    live_owner: boolean;
    production_outreach: boolean;
    test_recipients: string[];
    activation: {
      delivered: boolean;
      reply_detected: boolean;
      can_activate: boolean;
    };
    ai: string;
  };
  notifications: { id: string; kind: string; message: string; read: number; entity_id?:string }[];
  automation: {
    message_id: string;
    days: number;
    subject: string;
    body: string;
    generated: number;
    due_at?: number | null;
    cancel_reason?: string | null;
    sent_at?: string | null;
    initial_status?: string;
    initial_provider_id?: string | null;
    followup_id?: string | null;
    child_status?: string | null;
    child_transport_state?: string | null;
    followup_provider_id?: string | null;
    suppression_reason?: string | null;
  }[];
  transports: {
    message_id: string;
    connection_id: string;
    state: string;
    provider_id: string | null;
    thread_id: string | null;
    attempts: number;
    next_at: number;
    sync_checked_at?: number;
    sync_error?: string | null;
  }[];
  mailbox_checks: {
    connection_id: string;
    checked_at: number;
    status: string;
    detail: string;
  }[];
  delivery_attempts: {
    id: string;
    message_id: string;
    attempt: number;
    started_at: number;
    outcome: string;
  }[];
  ai_usage: { requests: number; tokens: number };
  audit: Audit[];
  account: { email: string };
};
const nav = [
  ["Overview", LayoutDashboard, "Dashboard", "primary"],
  ["Outreach", Send, "Campaigns", "primary"],
  ["Professors", Users, "Professors", "primary"],
  ["Documents", FileText, "Documents", "primary"],
  ["Notifications", Bell, "Notifications", "primary"],
  ["Getting Started", BookOpen, "Getting started", "secondary"],
  ["Practice Campaign", FlaskConical, "Practice campaign", "secondary"],
  ["Settings", Settings, "Settings", "secondary"],
  ["Help", CircleHelp, "Help", "secondary"],
] as const;
const viewLabel = (view: string) => ({Overview:"Dashboard",Outreach:"Campaigns","Smart Import":"Create campaign","Getting Started":"Getting started","Practice Campaign":"Practice campaign","Follow-ups":"Sending and follow-ups","Academic profile":"Academic profile","Audit history":"Activity history"}[view] || view);
const proposalCount = (message: Message) =>
  message.followup_proposal
    ? JSON.parse(message.followup_proposal).steps?.length || 1
    : 0;
const initialProfile = {
  name: "",
  university: "",
  degree: "",
  gpa: "",
  interests: "",
  timezone: "Asia/Karachi",
  paused: 0,
  stopped: 0,
};
async function request(path: string, method = "GET", data?: unknown) {
  if(path==="/messages/approve" && method==="POST" && data && !(data as any).dry_run){
    const preview=await request(path,"POST",{...(data as any),dry_run:true});
    if(preview.missing_attachments?.length){
      if(!(await confirmMissingDocuments(preview.missing_attachments,(data as any).ids.length))) throw new Error("Choose documents below, then review and approve again. Your draft has been preserved.");
      data={...(data as any),without_attachments_acknowledged:true};
    }
    const review=preview.duplicate_review;
    if(review.history.length){
      if(!(await confirmDuplicateReview(review))) throw new Error("Change Recipients: remove or replace the highlighted duplicate recipients in the editable preview, then review again.");
      data={...(data as any),duplicate_acknowledgement:review.acknowledgement};
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(API + "/api" + path, {
      method,
      credentials: "include",
      signal: controller.signal,
      headers:
        data instanceof FormData
          ? {}
          : data
            ? { "Content-Type": "application/json" }
            : {},
      body:
        data instanceof FormData
          ? data
          : data
            ? JSON.stringify(data)
            : undefined,
    });
    const text = await res.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(
        `Request ${method} /api${path} returned HTTP ${res.status} without a JSON response. Please retry.`,
      );
    }
    if (!res.ok)
      throw new Error(result.error || `Request failed (HTTP ${res.status}).`);
    return result;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        "The request timed out after 60 seconds. Its save status is uncertain. Retry in this wizard to safely recover the same submission.",
      );
    if (error instanceof TypeError)
      throw new Error(
        `Could not reach ${method} /api${path}. Check your connection and retry. If this was a campaign save, retry in this wizard to recover the same submission without duplicates.`,
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function displayDate(value: string, tz: string) {
  return new Date(value).toLocaleString(undefined, {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  });
}
export default function Home() {
  const [state, setState] = useState<State | null>(null),
    [loading, setLoading] = useState(true),
    [view, setView] = useState("Overview"),
    [authMode, setAuthMode] = useState("login"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState<"professor" | "compose" | "verify" | null>(
      null,
    ),
    [review, setReview] = useState<Message | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const manualEntry=useRef(false);
  const [pendingManualEmail,setPendingManualEmail]=useState<string|null>(null),[pendingDraftId,setPendingDraftId]=useState<string|null>(null);
  useEffect(()=>{if(!pendingManualEmail||!state)return;const saved=state.professors.find(p=>p.email.toLowerCase()===pendingManualEmail);if(saved){setPendingManualEmail(null);compose(saved.id);}},[pendingManualEmail,state]);
  useEffect(()=>{if(pendingDraftId&&state?.messages.some(m=>m.id===pendingDraftId)){setCampaignFocus('draft:'+pendingDraftId);setCampaignTab('Professors');setView('Outreach');setPendingDraftId(null);}},[pendingDraftId,state]);
  const [campaignTab,setCampaignTab] = useState("Overview");
  const [createName,setCreateName] = useState("");
  const [collapsed,setCollapsed] = useState(false),[narrow,setNarrow] = useState(false);
  const [settingsSection,setSettingsSection] = useState("connections");
  const sidebarRef=useRef<HTMLElement>(null),navigationButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const media=window.matchMedia('(max-width:960px)');const update=()=>setNarrow(media.matches);update();media.addEventListener('change',update);try{setCollapsed(localStorage.getItem('professor-agent-sidebar')==='collapsed');}catch{}return()=>media.removeEventListener('change',update);},[]);
  useEffect(()=>{if(!mobile||!narrow)return;const previous=document.activeElement as HTMLElement;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';const element=sidebarRef.current;const items=()=>Array.from(element?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')||[]);items()[0]?.focus();const trap=(event:KeyboardEvent)=>{const list=items();if(event.key==='Escape'){event.preventDefault();setMobile(false);}if(event.key==='Tab'){if(event.shiftKey&&document.activeElement===list[0]){event.preventDefault();list.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===list.at(-1)){event.preventDefault();list[0]?.focus();}}};element?.addEventListener('keydown',trap);return()=>{document.body.style.overflow=overflow;element?.removeEventListener('keydown',trap);(navigationButton.current||previous)?.focus();};},[mobile,narrow]);
  const [campaignFocus,setCampaignFocus] = useState<string|null>(null);
  const [campaignName,setCampaignName] = useState("Professor outreach campaign");
  const [recordFilter, setRecordFilter] = useState("active");
  const [approvalAccount, setApprovalAccount] = useState("");
  const [authorizeImportedFollowups, setAuthorizeImportedFollowups] =
    useState(false);
  useEffect(() => {
    setAuthorizeImportedFollowups(false);
  }, [selected.join(","), review?.id, approvalAccount]);
  const [tone, setTone] = useState("professional"),
    [template, setTemplate] = useState("0"),
    [uploadProgress, setUploadProgress] = useState<number | null>(null),
    [documentPreview, setDocumentPreview] = useState<{
      name: string;
      text: string;
    } | null>(null);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [identity, setIdentity] = useState<Identity | null>(null),
    [googleReady, setGoogleReady] = useState(false),
    [theme, setTheme] = useState("light"),
    [policy, setPolicy] = useState(""),
    [link, setLink] = useState<{
      kind: "verify" | "reset";
      token: string;
    } | null>(null),
    [editingProfessor, setEditingProfessor] = useState(""),
    [statusFilter, setStatusFilter] = useState("all");
  useEffect(() => {
    const readLink = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      for (const kind of ["verify", "reset"] as const) {
        const token = fragment.get(kind);
        if (token) {
          setLink({ kind, token });
          history.replaceState(null, "", window.location.pathname);
        }
      }
      const campaignLink=new URLSearchParams(window.location.search).get("campaign") || fragment.get("campaign");if(campaignLink){setCampaignFocus(campaignLink);setCampaignTab("Overview");setView("Outreach");}
      if (["#terms", "#privacy"].includes(window.location.hash))
        setPolicy(window.location.hash.slice(1));
    };
    const parameters = new URLSearchParams(window.location.search);
    const activationError = parameters.get("activation_error");
    if (activationError) {
      setError(activationError.slice(0, 900));
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.hash,
      );
    }
    if (parameters.get("activation") === "verified") {
      setNotice(
        "Account verified and Gmail connected. Review your profile, documents and campaign before approving any outreach.",
      );
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.hash,
      );
    }
    readLink();
    window.addEventListener("hashchange", readLink);
    const stored =
      localStorage.getItem("workspace-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    setTheme(stored);
    document.documentElement.dataset.theme = stored;
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobile(false);
        manualEntry.current=false;
        setModal(null);
        setReview(null);
        setDocumentPreview(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    if (!modal && !review && !documentPreview) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const items = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) || [],
      );
    items()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = items(),
        first = list[0],
        last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog?.addEventListener("keydown", trap);
    return () => {
      dialog?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal, review, documentPreview]);
  const [professor, setProfessor] = useState({
    name: "",
    email: "",
    university: "",
    interests: "",
  });
  const [followupUnit, setFollowupUnit] = useState<
    "minutes" | "hours" | "days"
  >("days");
  const [draft, setDraft] = useState({
    sending_account_id: "",
    followup_enabled: false,
    followup_days: 7,
    followup_subject: "",
    followup_body: "",
    professor_id: "",
    subject: "",
    body: "",
    mode: "manual",
    authorized: false,
    followup_authorized: false,
    scheduled_at: localDate("Asia/Karachi"),
    timezone: "Asia/Karachi",
    attachments: [] as string[],
  });
  const [draftWarning, setDraftWarning] = useState("");
  const [smartPrepared, setSmartPrepared] = useState<any>(null);
  const [importRows, setImportRows] = useState<Record<string, string>[] | null>(
    null,
  );
  async function uploadPrivate(file: File) {
    if (file.size > 2 * 1024 * 1024)
      throw new Error("Document limit is 2 MiB.");
    setUploadProgress(0);
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", API + "/api/documents");
        xhr.withCredentials = true;
        xhr.timeout = 60000;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onerror = () =>
          reject(
            new Error(
              "Upload connection interrupted. Check Documents before retrying.",
            ),
          );
        xhr.ontimeout = () =>
          reject(
            new Error("Upload timed out. Check Documents before retrying."),
          );
        xhr.onload = () => {
          let result;
          try {
            result = JSON.parse(xhr.responseText);
          } catch {
            return reject(new Error("Upload returned an unreadable response."));
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(result.error || "Upload failed."));
        };
        const form = new FormData();
        form.set("file", file);
        xhr.send(form);
      });
    } finally {
      setUploadProgress(null);
    }
  }
  const [verificationTarget, setVerificationTarget] =
    useState<Professor | null>(null);
  async function refresh() {
    try {
      const me = await request("/auth/me");
      setIdentity(me.account);
      setGoogleReady(me.google_activation_ready === true);
      const data = await request("/state");
      setState(data);
      setProfile(data.profile);
    } catch (e) {
      if (e instanceof Error && e.message === "Unauthorized") {
        setState(null);
        setIdentity(null);
      } else throw e;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!state || state.capabilities.mock_delivery || busy) return;
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      request("/state")
        .then((data) => {
          setState(data);
          setReview((current) =>
            current
              ? data.messages.find((m: Message) => m.id === current.id) ||
                current
              : null,
          );
        })
        .catch((e) => {
          if (e.message === "Unauthorized") {
            setState(null);
            setIdentity(null);
          }
        });
    };
    const timer = window.setInterval(poll, 30000);
    window.addEventListener("focus", poll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [state?.account.email, state?.capabilities.mock_delivery, busy]);
  async function act(fn: () => Promise<void>, message = "Saved successfully") {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      if (message) setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  function compose(professorId = "") {
    if (state?.capabilities.workspace_limited) {
      setError("Verify your email before preparing outreach.");
      return;
    }
    setDraft({
      sending_account_id: "",
      followup_enabled: false,
      followup_days: 7,
      followup_subject: "",
      followup_body: "",
      professor_id: professorId || state?.professors[0]?.id || "",
      subject: "",
      body: "",
      mode: "manual",
      authorized: false,
      followup_authorized: false,
      scheduled_at: localDate(state?.profile.timezone || "Asia/Karachi"),
      timezone: state?.profile.timezone || "Asia/Karachi",
      attachments: [],
    });
    setModal("compose");
  }
  async function importFile(file: File) {
    if (file.size > 5 * 1024 * 1024) throw new Error("Import limit is 5 MB");
    let rows: Record<string, string>[];
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const sheet = await readXlsxFile(file);
      const headers = sheet[0]?.map((h) =>
        String(h ?? "")
          .trim()
          .toLowerCase(),
      );
      if (
        !headers?.length ||
        headers.some((h) => !h) ||
        new Set(headers).size !== headers.length
      )
        throw new Error(
          "Excel headers must be nonempty and unique. Use the downloadable template column names.",
        );
      rows = sheet
        .slice(1)
        .filter((r) => r.some(Boolean))
        .map((row, index) =>
          normalizeSpreadsheetRow(
            Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])),
            index,
          ),
        );
    } else {
      const parsed = Papa.parse<Record<string, string>>(await file.text(), {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => h.trim().toLowerCase(),
      });
      if (parsed.errors.length)
        throw new Error("Invalid CSV: " + parsed.errors[0].message);
      if (
        Object.keys(
          (parsed.meta as { renamedHeaders?: Record<string, string> })
            .renamedHeaders || {},
        ).length ||
        parsed.meta.fields?.some((header) => !header)
      )
        throw new Error(
          "CSV headers must be nonempty and unique. Use the downloadable template column names.",
        );
      rows = parsed.data;
    }
    if (!rows.length || rows.length > 500)
      throw new Error("Import between 1 and 500 professors");
    if (!state?.capabilities.workspace_limited) {
      if (
        rows.length > 25 &&
        rows.some((r) => r.subject || r.body || r.scheduled_at)
      )
        throw new Error(
          "Campaigns support up to 25 rows. Professor-only imports support 500.",
        );
      if (rows.length > 25) {
        await request(
          "/professors",
          "POST",
          rows.map((r) => ({
            name: r.name || "",
            email: r.email || "",
            university: r.university || "",
            interests: r.interests || "",
          })),
        );
        setNotice(
          "Professor records imported; duplicate active addresses skipped.",
        );
        return;
      }
      setSmartPrepared(null);
      setImportRows(rows);
      return;
    }
    const result = await request(
      "/professors",
      "POST",
      rows.map((r) => ({
        name: r.name || "",
        email: r.email || "",
        university: r.university || "",
        interests: r.interests || "",
      })),
    );
    setNotice(
      result.imported + " professors imported; duplicate emails skipped.",
    );
  }

  const visibleRecord = (r: {
    archived_at?: number | null;
    hidden_at?: number | null;
  }) =>
    recordFilter === "all" ||
    (recordFilter === "archived"
      ? !!r.archived_at && !r.hidden_at
      : !r.archived_at && !r.hidden_at);
  const messages = (state?.messages || []).filter(visibleRecord),
    professors = (state?.professors || []).filter(visibleRecord);
  const focusedIds = new Set((state?.authorizations || []).filter(a=>a.campaign_id===campaignFocus).map(a=>a.message_id));
  const scopedMessages = messages.filter(m=>!campaignFocus || (campaignFocus.startsWith("draft:") ? (m.campaign_import_id || m.id)===campaignFocus.slice(6) && !(state?.authorizations || []).some(a=>a.message_id===m.id) : campaignFocus==="drafts" ? !(state?.authorizations || []).some(a=>a.message_id===m.id) : focusedIds.has(m.id) || !!m.parent_id && focusedIds.has(m.parent_id)));
  const filtered = scopedMessages.filter(
    (m) =>
      (statusFilter === "all" || m.status === statusFilter) &&
      (m.professor_name + " " + m.subject + " " + m.status)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const followups = messages.filter(
    (m) =>
      m.followup_at &&
      m.status === "sent" &&
      !state?.automation.some((a) => a.message_id === m.id),
  );
  const counts = {
    sent: messages.filter(
      (m) =>
        ["sent", "replied"].includes(m.status) &&
        (state?.capabilities.mock_delivery !== false ||
          state.transports.some(
            (t) =>
              t.message_id === m.id && t.state === "confirmed" && t.provider_id,
          )),
    ).length,
    replied: messages.filter(
      (m) =>
        m.status === "replied" &&
        (state?.capabilities.mock_delivery !== false ||
          state.transports.some(
            (t) =>
              t.message_id === m.id && t.state === "confirmed" && t.provider_id,
          )),
    ).length,
    pending: messages.filter((m) => ["draft", "pending"].includes(m.status))
      .length,
    failed: messages.filter((m) => m.status === "failed").length,
  };
  const feedback = (
    <>
      {error && (
        <div role="alert" className="feedback error">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="feedback success">
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
  if (loading)
    return (
      <main className="auth">
        <GraduationCap size={44} />
        <div className="loading-skeleton" aria-hidden="true">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
        <p>Opening your workspace…</p>
      </main>
    );
  if (policy)
    return (
      <PolicyNotice
        kind={policy}
        onClose={() => {
          setPolicy("");
          history.replaceState(null, "", "/");
        }}
      />
    );
  if (link)
    return (
      <AuthPanel
        api={request}
        intent={link}
        onCancel={() => setLink(null)}
        onComplete={refresh}
      />
    );
  if (!state) return <AuthPanel api={request} onComplete={refresh} />;
  const limitedWorkspace = state.capabilities.workspace_limited;
  const realWorkflow = !state.capabilities.mock_delivery;
  const gmailAccount =
    approvalAccount ||
    state.connections.find(
      (c) => c.provider === "gmail" && c.status === "connected",
    )?.id ||
    "";
  const approvalOptions = () =>
    realWorkflow
      ? {
          name: campaignName,
          sending_account_id: gmailAccount,
          authorize_followups: authorizeImportedFollowups,
        }
      : {};
  const approvalControls = (items: Message[]) =>
    realWorkflow && (
      <fieldset>
        <legend>Approve exact Gmail delivery</legend>
        <label>Campaign Name<input aria-label="Campaign Name" required maxLength={160} value={campaignName} onChange={e=>setCampaignName(e.target.value)} /></label>
        {state.mailbox_checks
          ?.filter(
            (k) => k.connection_id === gmailAccount && k.status !== "ready",
          )
          .map((k) => (
            <p role="alert" key={k.connection_id}>
              {k.detail}
            </p>
          ))}
        <label>
          Gmail sending account
          <select
            value={gmailAccount}
            onChange={(e) => setApprovalAccount(e.target.value)}
          >
            <option value="">Choose connected Gmail</option>
            {state.connections
              .filter((c) => c.provider === "gmail" && c.status === "connected")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.address}
                </option>
              ))}
          </select>
        </label>
        <p className="helper">
          {state.capabilities.production_outreach
            ? "Professor outreach is enabled. Only the exact recipients you approve will be contacted."
            : "Controlled testing only: " +
              state.capabilities.test_recipients.join(", ")}
          . Approval schedules real delivery at or after the displayed time. Up
          to 25 messages per approval; attachments require individual review.
        </p>
        <div className="campaign-summary" role="status">
          <strong>
            Campaign approval: {items.length} initial emails +{" "}
            {authorizeImportedFollowups
              ? items.reduce(
                  (count, message) => count + proposalCount(message),
                  0,
                )
              : 0}{" "}
            conditional follow-ups ={" "}
            {items.length +
              (authorizeImportedFollowups
                ? items.reduce(
                    (count, message) => count + proposalCount(message),
                    0,
                  )
                : 0)}{" "}
            total authorized messages
          </strong>
          <p>
            {authorizeImportedFollowups
              ? "One approval authorizes both the initial emails and the exact automatic follow-ups below. No later preparation or approval is required."
              : "Initial emails only. Automatic follow-ups will not be authorized."}
          </p>
        </div>
        {items.some((m) => !m.followup_proposal) && (
          <p role="alert" className="helper">
            Missing follow-up content:{" "}
            {items
              .filter((m) => !m.followup_proposal)
              .map((m) => m.professor_email)
              .join(", ")}
            . These rows can receive initial-only approval; complete the missing
            subject, body and delay before campaign follow-up authorization.
          </p>
        )}
        {items.some((m) => m.followup_proposal) && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              disabled={items.some((m) => !m.followup_proposal)}
              checked={authorizeImportedFollowups}
              onChange={(e) => setAuthorizeImportedFollowups(e.target.checked)}
            />
            Approve initial emails and automatic follow-ups. I explicitly
            authorize every exact follow-up shown below for its recipient and
            delay, only if no reply is detected.
          </label>
        )}
        {items.map((m) => (
          <details key={m.id} open>
            <summary>
              {m.professor_email} - {m.subject}
            </summary>
            <pre className="email-preview">{m.body}</pre>
            <p>
              {displayDate(m.scheduled_at, m.timezone)} ({m.timezone})
            </p>
            {m.followup_issue && (
              <div className="feedback error">
                <strong>{m.followup_issue}</strong>
                {m.followup_draft && (
                  <pre className="email-preview">
                    {JSON.stringify(JSON.parse(m.followup_draft), null, 2)}
                  </pre>
                )}
              </div>
            )}
            {m.followup_proposal &&
              (() => {
                const f = JSON.parse(m.followup_proposal);
                if (f.steps)
                  return (f.steps as FollowupStep[]).map((step, index) => (
                    <div key={index}>
                      <strong>
                        Follow-up {index + 1} to {m.professor_email}:{" "}
                        {step.subject}
                      </strong>
                      <p>
                        {step.delay_value} {step.delay_unit} after{" "}
                        {step.relative_to === "original"
                          ? "original confirmed email"
                          : "previous confirmed follow-up"}
                        . Only if no reply, decline or opt-out; failed checks
                        postpone delivery.
                      </p>
                      <pre className="email-preview">{step.body}</pre>
                      <small>
                        {authorizeImportedFollowups
                          ? "Will be authorized with this approval"
                          : "Proposed; not authorized"}
                      </small>
                    </div>
                  ));
                return (
                  <div>
                    <strong>
                      {f.days}-day follow-up to {m.professor_email}: {f.subject}
                    </strong>
                    <pre className="email-preview">{f.body}</pre>
                    <small>
                      {authorizeImportedFollowups
                        ? "Will be authorized with this approval"
                        : "Inactive - not authorized"}
                    </small>
                  </div>
                );
              })()}
          </details>
        ))}
      </fieldset>
    );
  const deliveryLabel = (m: Message) => {
    const t = state.transports.find((t) => t.message_id === m.id);
    if (t?.state === "confirmed" && t.provider_id)
      return m.status === "replied" ? "Replied" : "Sent through Gmail";
    if (t?.state === "uncertain") return "Confirmation pending - do not resend";
    if (t?.state === "submitting" || t?.state === "leased") return "Sending";
    if (m.status === "sent" && !t) return "Simulated (historical)";
    if (m.status === "pending")
      return m.live_ready
        ? "Scheduled"
        : "Historical - awaiting fresh approval";
    return m.status === "draft"
      ? "Draft - awaiting approval"
      : m.status.charAt(0).toUpperCase() + m.status.slice(1);
  };
  const table = (items: Message[]) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>
              <span className="sr-only">Select manual drafts</span>
            </th>
            <th>Professor / email</th>
            <th>Follow-up status</th>
            <th>Status</th>
            <th>Schedule</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td>
                {m.mode === "manual" &&
                  (m.status === "draft" ||
                    (realWorkflow &&
                      m.status === "pending" &&
                      !m.live_ready)) && (
                    <input
                      aria-label={`Select ${m.professor_name}`}
                      type="checkbox"
                      checked={selected.includes(m.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, m.id]
                            : selected.filter((x) => x !== m.id),
                        )
                      }
                    />
                  )}
              </td>
              <td>
                <button className="text-link" onClick={() => setReview(m)}>
                  {m.professor_name}
                </button>
                <small>{m.parent_id ? "Follow-up" : "Initial email"}: {m.subject}</small><small>{m.professor_email}</small><small>{state.professors.find(p=>p.id===m.professor_id)?.university}</small>
              </td>
              <td>
                <span className="muted">{state.followup_steps?.some(f=>f.root_id===m.id&&!f.cancel_reason)?'Conditional follow-ups':m.parent_id?'Follow-up email':m.mode==='manual'?'No active sequence':'Reviewed workflow'}</span>

              </td>
              <td>
                <span className={"badge " + m.status}>
                  {realWorkflow ? deliveryLabel(m) : m.status}
                </span>
                {m.error && <small>{m.error}</small>}
              </td>
              <td>
                <small>
                  {displayDate(m.scheduled_at, m.timezone)}
                  <br />
                  {m.timezone}
                </small>
              </td>
              <td>
                <div className="actions">
                  <button className="secondary" onClick={() => setReview(m)}>
                    View
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await request(
                          `/messages/${m.id}/${m.archived_at || m.hidden_at ? "restore" : "archive"}`,
                          "POST",
                          {},
                        );
                      }, "Record visibility updated; approved delivery status unchanged")
                    }
                  >
                    {m.archived_at || m.hidden_at ? "Restore" : "Archive"}
                  </button>
                  {["sent", "replied", "failed", "cancelled"].includes(
                    m.status,
                  ) &&
                    !m.hidden_at && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Remove this record from the dashboard and cancel any pending automatic follow-up? This does not recall delivered Gmail messages or erase delivery, authorization or opt-out history.",
                            )
                          )
                            return;
                          act(async () => {
                            await request(`/messages/${m.id}/remove`, "POST", {
                              confirmed: true,
                            });
                          }, "Removed from dashboard; Gmail delivery and audit history retained");
                        }}
                      >
                        Remove from dashboard
                      </button>
                    )}
                  {(m.status === "draft" ||
                    (realWorkflow &&
                      m.status === "pending" &&
                      !m.live_ready)) && (
                    <button onClick={() => setReview(m)}>Review</button>
                  )}
                  {state.capabilities.mock_delivery &&
                    m.status === "pending" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            await request(
                              `/messages/${m.id}/simulate-failure`,
                              "POST",
                            );
                          }, "Provider failure simulated; no email sent")
                        }
                      >
                        Simulate failure
                      </button>
                    )}
                  {realWorkflow &&
                    m.status === "failed" &&
                    state.transports.some(
                      (t) => t.message_id === m.id && t.state === "failed",
                    ) &&
                    !m.parent_id && (
                      <button disabled={busy} onClick={() => setReview(m)}>
                        Review retry
                      </button>
                    )}
                  {["draft", "pending"].includes(m.status) && (
                    <button
                      onClick={() =>
                        act(async () => {
                          await request(`/messages/${m.id}/cancel`, "POST");
                        }, "Message cancelled")
                      }
                    >
                      Cancel
                    </button>
                  )}
                  {m.status === "sent" && (
                    <>
                      <button
                        onClick={() =>
                          act(async () => {
                            await request(`/messages/${m.id}/reply`, "POST");
                          }, "Reply recorded manually")
                        }
                      >
                        Mark replied
                      </button>
                      <button onClick={() => setReview(m)}>Follow up</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <div className="empty">
          <Mail size={30} />
          <h3>Your next conversation starts here</h3>
          <p>Add a professor and prepare your first outreach draft.</p>
          <button
            className="secondary"
            onClick={() =>
              professors.length ? compose() : setModal("professor")
            }
          >
            {professors.length ? "Compose email" : "Add professor"}
            <Plus size={15} />
          </button>
        </div>
      )}
    </div>
  );
  return (
    <div className={"app-shell redesign-shell"+(collapsed?" sidebar-collapsed":"")}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {mobile && (
        <button
          className="nav-overlay"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside id="workspace-navigation" ref={sidebarRef} className={"sidebar "+(mobile?"open":"")} aria-label="Workspace navigation" role={narrow&&mobile?"dialog":undefined} aria-modal={narrow&&mobile?true:undefined} inert={narrow&&!mobile}>
        <div className="brand-row"><a className="brand" href="/" aria-label="Professor Agent home"><div className="brand-icon"><GraduationCap size={23}/></div><div className="brand-copy">Professor Agent<span>Academic outreach</span></div></a><button className="icon-button drawer-close" aria-label="Close navigation" onClick={()=>setMobile(false)}><X size={20}/></button></div>
        <nav aria-label="Main navigation">{["primary","secondary"].map(group=><div key={group} className={"nav-group nav-"+group}>{group==='secondary'&&<span className="nav-section-label">Resources</span>}{nav.filter(([name,, ,section])=>section===group&&(!limitedWorkspace||["Overview","Professors","Documents","Getting Started","Practice Campaign","Settings","Help"].includes(name))).map(([name,Icon,label])=><button key={name} data-tour={"nav-"+name} aria-label={label} title={collapsed?label:undefined} aria-current={view===name||name==='Outreach'&&view==='Smart Import'||name==='Settings'&&['Academic profile','Follow-ups','Audit history'].includes(view)?'page':undefined} className={view===name||name==='Outreach'&&view==='Smart Import'||name==='Settings'&&['Academic profile','Follow-ups','Audit history'].includes(view)?'active':''} onClick={()=>{setView(name);if(name==='Outreach'){setCampaignFocus(null);setCampaignTab('Overview');}setQuery('');setMobile(false);}}><Icon size={18}/><span className="nav-label">{label}</span>{name==='Notifications'&&state.notifications.some(n=>!n.read)&&<span className="nav-count">{state.notifications.filter(n=>!n.read).length}</span>}</button>)}</div>)}</nav>
        <div className="sidebar-bottom"><button className="collapse-navigation" aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} onClick={()=>{const value=!collapsed;setCollapsed(value);try{localStorage.setItem('professor-agent-sidebar',value?'collapsed':'expanded');}catch{}}}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}<span>Collapse sidebar</span></button><button className="user" onClick={()=>{setSettingsSection('account');setView('Settings');setMobile(false);}}><span className="avatar">{(profile.name||state.account.email).slice(0,2).toUpperCase()}</span><span className="user-copy">{profile.name||'Your workspace'}<small>Student account</small></span><ChevronRight size={15}/></button><button className="logout" onClick={()=>act(async()=>{await request('/auth/logout','POST');setState(null);},'Signed out')}><LogOut size={16}/><span>Sign out</span></button></div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle"
              ref={navigationButton}
              aria-controls="workspace-navigation"
              aria-label="Open navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            Workspace <ChevronRight size={13} />
            <strong>{viewLabel(view)}</strong>{view==="Outreach"&&campaignFocus&&<><ChevronRight size={13}/><span className="breadcrumb-campaign">{state.campaigns?.find(c=>c.id===campaignFocus)?.name||"Draft review"}</span></>}
          </div>
          <div className="top-actions">
            <button
              className="theme-toggle"
              aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark";
                setTheme(next);
                document.documentElement.dataset.theme = next;
                localStorage.setItem("workspace-theme", next);
              }}
            >
              {theme === "dark" ? <Sun size={17}/> : <Moon size={17}/>}
            </button>
            <span className="sandbox">
              <span className="dot" />
              {state.capabilities.live_email
                ? state.capabilities.production_outreach
                  ? "Gmail sending enabled"
                  : "Limited sending access"
                : state.capabilities.mock_delivery
                  ? "Practice sending enabled"
                  : limitedWorkspace
                    ? "Verify account to send"
                    : "Sending unavailable for this workspace"}
            </span>
            <button
              disabled={limitedWorkspace}
              aria-label={"Notifications, "+state.notifications.filter(n=>!n.read).length+" unread"}
              className="notification"
              onClick={() => setView("Notifications")}
            >
              <Bell size={19} /><span>{state.notifications.filter(n=>!n.read).length}</span>
              
            </button>
            <span className="avatar small">
              {(profile.name || "ST").slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          {feedback}
          {identity && (
            <ProductTour
              key={state.account.email}
              userKey={state.account.email}
              limited={limitedWorkspace}
              view={view}
              navigate={setView}
              hasCampaigns={
                !!state.campaigns?.length || !!state.messages.length
              }
            />
          )}
          <div className="page-heading"><div><h1>{view==='Overview'?'Welcome back':view==='Outreach'&&campaignFocus?(state.campaigns?.find(c=>c.id===campaignFocus)?.name||'Review draft campaign'):viewLabel(view)}</h1><p>{view==='Overview'?'Manage your professor outreach and stay on top of replies.':view==='Outreach'?campaignFocus?'Your approved conversations, schedule and history.':'Organize each research goal, from first draft to final reply.':view==='Smart Import'?'Build a thoughtful outreach plan, one clear step at a time.':view==='Professors'?'Your academic contacts and research interests, in one place.':view==='Documents'?'Keep your CV and supporting documents ready to share.':view==='Notifications'?'Replies and important updates from your workspace.':view==='Settings'?'Manage your account, connections and sending preferences.':view==='Getting Started'?'Learn the workflow at your own pace.':view==='Practice Campaign'?'Try the complete process with fictional data and no real sending.':view==='Help'?'Find a guide or return to a workflow.':'Review and manage your workspace.'}</p></div>
            {!limitedWorkspace&&(view==='Overview'||view==='Outreach'&&!campaignFocus)&&<button data-tour="compose" className="primary" onClick={()=>{setCreateName('');setCampaignFocus(null);setView('Smart Import');}}><Plus size={17}/>{view==='Overview'?'Create Campaign':'New Campaign'}</button>}
            {importRows && (
              <ImportWizard
                key={smartPrepared?.drafts?.[0]?.id || "spreadsheet"}
                rows={importRows}
                preparedResult={smartPrepared}
                initialName={createName || campaignName}
                api={request}
                connections={state.connections}
                documents={state.documents}
                onRefresh={refresh}
                onClose={() => {
                  setImportRows(null);
                  setSmartPrepared(null);
                }}
              />
            )}
            {view === "Professors" && (
              <button
                data-tour="add-professor"
                className="primary"
                onClick={() => setModal("professor")}
              >
                <Plus size={17} /> Add professor
              </button>
            )}
          </div>
          {!limitedWorkspace && (profile.paused || profile.stopped) ? (
            <div className="control-banner">
              <Pause size={18} />
              {profile.stopped
                ? "Outreach stopped. All outstanding drafts and scheduled messages were cancelled."
                : "Outreach is paused. Scheduled messages will wait."}
              <button
                onClick={() =>
                  act(async () => {
                    await request("/control", "POST", { action: "resume" });
                  }, "Outreach resumed")
                }
              >
                Resume workspace
              </button>
            </div>
          ) : null}
          {identity&&(view==='Overview'&&limitedWorkspace||view==='Settings'&&settingsSection==='account')&&<ActivationPanel account={identity} ready={googleReady} limited={limitedWorkspace} live={state.capabilities.live_email} production={state.capabilities.production_outreach} gmailConnected={state.connections.some(c=>c.provider==='gmail'&&c.status==='connected')} api={request} refresh={refresh}/>}
          {view === "Getting Started" && (
            <LearningCenter
              userKey={state.account.email}
              navigate={setView}
              startTour={startProductTour}
            />
          )}
          {view === "Practice Campaign" && <PracticeCampaign />}
          {view === "Smart Import" && (
            <div hidden={!!importRows}><CreateCampaign name={createName} onName={name=>{setCreateName(name);setCampaignName(name);}} onManual={()=>{setCampaignName(createName);manualEntry.current=true;setRecordFilter("active");setEditingProfessor("");setProfessor({name:"",email:"",university:"",interests:""});setModal("professor");}}><SmartImport
              api={request}
              userKey={state.account.email}
              limited={limitedWorkspace}
              onDraft={(rows, result) => {
                setSmartPrepared(result);
                setImportRows(rows);
                refresh().catch(error=>setError(error.message));
                setNotice(
                  "Unapproved drafts created. Review messages, schedules and attachments; approval is a separate action.",
                );
                window.scrollTo({ top: 0, behavior: "instant" });
              }}
            /></CreateCampaign></div>
          )}
          {["Professors", "Outreach", "Documents", "Follow-ups"].includes(
            view,
          ) && (
            <Help
              text={
                view === "Professors"
                  ? "CSV headers must include name and email, not professor_name. Download the exact template and read Getting Started lesson 7 before importing."
                  : view === "Outreach"
                    ? "Review all recipients, initial messages, follow-ups, attachments and UTC dates before one approval. Import alone does not authorise sending. Read lesson 11 for the full review checklist."
                    : view === "Documents"
                      ? "Select the CV for initial messages during campaign review. Follow-up attachments are separate choices. Files expire; review availability before approval."
                      : "Replies detected in tracked Gmail threads stop eligible remaining follow-ups. Safety checks may delay steps. Never trigger a production send just to test scheduling."
              }
            />
          )}
          {view==='Overview'&&<WorkspaceDashboard state={state} onCreate={()=>{setCreateName('');setCampaignFocus(null);setView('Smart Import');}} navigate={setView} onOpen={id=>{setCampaignFocus(id);setCampaignTab('Overview');setView('Outreach');}}/>}
          {view==='Notifications'&&<NotificationsView state={state} busy={busy} onRead={()=>act(async()=>{await request('/notifications/read','POST');},'Notifications marked read')} onOpen={id=>{setCampaignFocus(id);setCampaignTab('Replies');setView('Outreach');}}/>}
          {view==='Help'&&<section className="panel help-workspace"><h2>How can we help?</h2><p>Find answers in the existing guides, or practise without sending email.</p><div className="help-links"><button className="secondary" onClick={()=>setView('Getting Started')}><BookOpen size={18}/>Read the guides</button><button className="secondary" onClick={()=>setView('Practice Campaign')}><FlaskConical size={18}/>Try a practice campaign</button><button className="secondary" onClick={()=>startProductTour('Overview')}>Take the product tour</button><button className="secondary" onClick={()=>{setSettingsSection('connections');setView('Settings');}}>Connection and sending help</button></div><details><summary>Privacy and terms</summary><button className="text-link" onClick={()=>setPolicy('privacy')}>Privacy policy</button><button className="text-link" onClick={()=>setPolicy('terms')}>Terms of use</button></details></section>}
          {view === "Professors" && (
            <>
              <div className="toolbar">
                <button
                  className="secondary"
                  onClick={() => setView("Smart Import")}
                >
                  Create a campaign from contacts
                </button>
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search professors"
                    placeholder="Search professors, universities, research…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <label>
                  Show records
                  <select
                    aria-label="Professor record visibility"
                    value={recordFilter}
                    onChange={(e) => {
                      setRecordFilter(e.target.value);
                      setSelected([]);
                    }}
                  >
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                    <option value="all">All history</option>
                  </select>
                </label>
                <label className="secondary upload-label">
                  <Upload size={16} /> Import CSV / Excel
                  <input
                    data-tour="file-upload"
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) act(() => importFile(file), "");
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <details className="professor-templates"><summary>Templates and import requirements</summary>
              <p className="helper">
                <a href="/professors-email-template.xlsx" download>
                  Download Excel template
                </a>
                {" | "}
                <a href="/professors-email-template.csv" download>
                  Download professor + email draft template
                </a>
              </p>
              <p className="helper">
                Columns: name, email, university, interests. Up to 500 rows.
                Duplicate emails are skipped.{" "}
                <a download href="/professors-template.csv">
                  Download CSV template
                </a>
              </p>
              </details>
              <div className="professor-grid">
                {professors
                  .filter((p) =>
                    (p.name + p.email + p.university + p.interests)
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((p) => (
                    <article className="professor-row" key={p.id}><span className="professor-avatar">{p.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</span><div className="professor-identity"><h2>{p.name}</h2><small>{p.email}</small><p>{p.university || "University not specified"}</p></div><span className="research-tag">{p.interests || "Research interests not added"}</span><button
                        className="secondary"
                        disabled={limitedWorkspace || !!p.archived_at}
                        onClick={() => compose(p.id)}
                      >
                        Prepare outreach <ArrowUpRight size={16} />
                      </button><details className="context-menu professor-actions"><summary aria-label={"Contact actions for "+p.name}>Actions <MoreHorizontal size={16}/></summary><div className="context-menu-content" onClickCapture={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.parentElement?.removeAttribute('open');event.currentTarget.parentElement?.querySelector('summary')?.focus();}}><button
                        className="text-link edit-professor"
                        onClick={() => {
                          setProfessor({
                            name: p.name,
                            email: p.email,
                            university: p.university,
                            interests: p.interests,
                          });
                          setEditingProfessor(p.id);
                          setModal("professor");
                        }}
                      >
                        Edit details
                      </button><button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setVerificationTarget(p);
                          setModal("verify");
                        }}
                      >
                        {p.verified_at
                          ? "Review source confirmation"
                          : "Confirm source for AI"}
                      </button><button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            act(
                              async () => {
                                await request(
                                  `/professors/${p.id}/${p.archived_at ? "restore" : "archive"}`,
                                  "POST",
                                  {},
                                );
                              },
                              p.archived_at
                                ? "Professor restored"
                                : "Professor archived; existing approved sending remains unchanged",
                            )
                          }
                        >
                          {p.archived_at ? "Restore" : "Archive"}
                        </button><button
                          className="danger"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete ${p.name}? Profile details will be removed and this record's queued emails/follow-ups cancelled. History is retained. You can import the address again for a new campaign; genuine opt-outs and account blocks remain enforced. Already accepted or in-flight Gmail messages cannot be recalled.`,
                              )
                            )
                              return;
                            act(async () => {
                              await request(
                                `/professors/${p.id}/delete`,
                                "POST",
                                { confirmed: true },
                              );
                            }, "Professor deleted; queued mail and automatic follow-ups cancelled");
                          }}
                        >
                          Delete
                        </button></div></details></article>
                  ))}
              </div>
              {!professors.length && (
                <div className="panel empty">
                  <Users size={32} />
                  <h3>Build your research shortlist</h3>
                  <p>Add professors individually or import your spreadsheet.</p>
                  <button
                    className="primary"
                    onClick={() => setModal("professor")}
                  >
                    Add your first professor
                  </button>
                </div>
              )}
            </>
          )}
          {view === "Outreach" && <CampaignDirectory api={request} onSaved={refresh} removeDraft={async(ids,name)=>{await request("/campaigns/delete-draft","POST",{ids,confirm_name:name});await refresh();}} tab={campaignTab} onTabChange={setCampaignTab} remove={async(id,name)=>{for(let batch=0;batch<20;batch++){const result=await request(`/campaigns/${id}/delete`,"POST",{confirm_name:name});if(result.done){await refresh();return;}}throw new Error("Deletion is still in progress. Reopen the campaign and retry to continue safely.");}} archive={async(id,restore)=>{await request(`/campaigns/${id}/${restore?"restore":"archive"}`,"POST",{});await refresh();}} state={state} focus={campaignFocus} onOpen={id=>{setCampaignFocus(id);setCampaignTab(id?.startsWith("draft:")||id==="drafts"?"Professors":"Overview");setQuery("");setSelected([]);}} activity={(id,before)=>request(`/campaigns/${id}/activity${before?`?before=${before}`:""}`)} openControls={()=>setView("Follow-ups")} rename={async(id,name)=>{await request(`/campaigns/${id}/name`,"POST",{name});await refresh();}} />}
          {view === "Outreach" && campaignFocus && (campaignTab==="Professors" || campaignFocus.startsWith("draft:") || campaignFocus==="drafts") && (
            <section className="panel">
              <label>
                Show records
                <select
                  aria-label="Outreach record visibility"
                  value={recordFilter}
                  onChange={(e) => {
                    setRecordFilter(e.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All history (including removed)</option>
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  aria-label="Select all campaign drafts"
                  checked={
                    scopedMessages.some(
                      (m) => m.mode === "manual" && m.status === "draft",
                    ) &&
                    scopedMessages
                      .filter(
                        (m) => m.mode === "manual" && m.status === "draft",
                      )
                      .every((m) => selected.includes(m.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? scopedMessages
                            .filter(
                              (m) =>
                                m.mode === "manual" &&
                                m.status === "draft" &&
                                !m.parent_id,
                            )
                            .map((m) => m.id)
                        : [],
                    )
                  }
                />
                Select all campaign drafts for one review and approval
              </label>
              <label className="status-filter">
                Filter status
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  {[
                    "all",
                    "draft",
                    "pending",
                    "sent",
                    "replied",
                    "failed",
                    "cancelled",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {value === "all" ? "All statuses" : value}
                    </option>
                  ))}
                </select>
              </label>
              <div className="panel-heading">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search outreach"
                    placeholder="Search messages or status…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      !selected.length ||
                      (realWorkflow &&
                        (!gmailAccount ||
                          selected.length > 25 ||
                          !state.capabilities.live_email))
                    }
                    onClick={() =>
                      act(async () => {
                        await request("/messages/approve", "POST", {
                          ids: selected,
                          ...approvalOptions(),
                        });
                        setSelected([]);
                      }, "Selected manual drafts approved")
                    }
                  >
                    {realWorkflow
                      ? authorizeImportedFollowups
                        ? "Approve initial emails and automatic follow-ups"
                        : "Approve initial emails only"
                      : "Approve selected"}{" "}
                    ({selected.length})
                  </button>
                  {state.capabilities.mock_delivery && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await request("/jobs/run", "POST");
                        }, "Due approved messages processed by mock provider")
                      }
                    >
                      Run mock scheduler
                    </button>
                  )}
                </div>
              </div>
              {selected.length > 0 &&
                approvalControls(
                  scopedMessages.filter((m) => selected.includes(m.id)),
                )}
              {table(filtered)}
              <div className="panel-footer">
                <ShieldCheck size={16} /> AI review drafts require individual
                approval. Gmail delivery requires your exact message approval;
                you can authorize its exact conditional follow-ups in this same
                one-time campaign approval.
              </div>
            </section>
          )}
          {view === "Documents" && (
            <section className="panel">
              <div className="upload-zone">
                <div className="upload-icon">
                  <Upload size={25} />
                </div>
                <h2>Your documents, ready for the right opportunity.</h2>
                <p>
                  Upload a CV, transcript, or research statement. Only you can
                  access these files.
                </p>
                <label className="primary upload-label">
                  <Plus size={16} /> Upload document
                  <input
                    disabled={busy}
                    type="file"
                    accept=".pdf,.docx,.txt"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        act(async () => {
                          const form = new FormData();
                          form.set("file", file);
                          if (file.size > 2 * 1024 * 1024)
                            throw new Error("Document limit is 2 MiB.");
                          await uploadPrivate(file);
                        }, "Private document uploaded. New files may take a minute to become downloadable.");
                      e.target.value = "";
                    }}
                  />
                </label>
                <small>
                  PDF, DOCX, TXT · Maximum 2 MiB per file; 10 files / 20 MiB per
                  student; unretained files expire after 30 days. Approved
                  campaign attachments stay available for their active plan
                </small>
              </div>
              {uploadProgress !== null && (
                <div className="upload-progress" role="status">
                  <label>
                    Uploading private document: {uploadProgress}%
                    <progress max="100" value={uploadProgress} />
                  </label>
                  <p>Processing and confirmation follow transfer completion.</p>
                </div>
              )}
              <div className="document-list">
                {state.documents.map((d) => (
                  <div className="document-row" key={d.id}>
                    <div className="file-icon">
                      <FileText size={23} />
                    </div>
                    <div>
                      <strong>{d.name}</strong>
                      <small>{(d.size / 1024).toFixed(1)} KB · Private</small>
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          if (d.name.toLowerCase().endsWith(".txt")) {
                            const response = await fetch(
                              `${API}/api/documents/${d.id}`,
                              { credentials: "include", cache: "no-store" },
                            );
                            if (!response.ok)
                              throw new Error(
                                "Document is not available yet. Try again shortly.",
                              );
                            setDocumentPreview({
                              name: d.name,
                              text: (await response.text()).slice(0, 65536),
                            });
                          } else
                            setDocumentPreview({
                              name: d.name,
                              text: `Private ${d.name.toLowerCase().endsWith(".pdf") ? "PDF" : "DOCX"} document · ${(d.size / 1024).toFixed(1)} KiB. Download to inspect this file locally. Inline active-document rendering is intentionally unavailable.`,
                            });
                        }, "Private preview opened")
                      }
                    >
                      Preview
                    </button>
                    <a
                      className="secondary"
                      href={`${API}/api/documents/${d.id}`}
                    >
                      Download <ArrowUpRight size={15} />
                    </a>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete this private document? Outstanding attachments must be cancelled first.",
                          )
                        )
                          act(async () => {
                            await request(`/documents/${d.id}/delete`, "POST");
                          }, "Document hidden; private storage cleanup is queued.");
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {view === "Academic profile" && identity && (
            <section className="panel settings-card identity-summary">
              <h2>
                {identity.first_name} {identity.last_name}
              </h2>
              <p>
                Display name:{" "}
                {identity.display_name || profile.name || "Not set"}
              </p>
              <p>{identity.email}</p>
              <span className="badge">
                {identity.email_verified_at
                  ? "Email verified"
                  : "Email not yet verified · existing account access"}
              </span>
              <button className="secondary" onClick={() => setView("Settings")}>
                Manage identity & security
              </button>
              <p>
                {
                  state.connections.filter(
                    (c) => c.provider === "gmail" && c.status === "connected",
                  ).length
                }{" "}
                connected Gmail accounts · {state.documents.length} private
                documents
              </p>
            </section>
          )}
          {view === "Academic profile" && (
            <form
              data-tour="profile-form"
              className="panel profile-form"
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  await request("/profile", "PUT", profile);
                }, "Academic profile updated");
              }}
            >
              <div className="section-title">
                <GraduationCap size={22} />
                <div>
                  <h2>The researcher behind the introduction</h2>
                  <p>Used to personalize your editable drafts.</p>
                </div>
              </div>
              <div className="form-grid">
                {(["name", "university", "degree", "gpa"] as const).map(
                  (key) => (
                    <label key={key}>
                      {
                        {
                          name: "Full name",
                          university: "University",
                          degree: "Degree / program",
                          gpa: "GPA / grade",
                        }[key]
                      }
                      <input
                        data-tour={"profile-" + key}
                        value={profile[key]}
                        onChange={(e) =>
                          setProfile({ ...profile, [key]: e.target.value })
                        }
                        placeholder={
                          {
                            name: "Your full name",
                            university: "Your current university",
                            degree: "BS Computer Science",
                            gpa: "3.8 / 4.0",
                          }[key]
                        }
                      />
                    </label>
                  ),
                )}
              </div>
              <label>
                Research interests
                <textarea
                  rows={4}
                  value={profile.interests}
                  onChange={(e) =>
                    setProfile({ ...profile, interests: e.target.value })
                  }
                  placeholder="e.g. Machine learning, computational biology, sustainable systems"
                />
              </label>
              <label>
                Default timezone
                <input
                  required
                  value={profile.timezone}
                  onChange={(e) =>
                    setProfile({ ...profile, timezone: e.target.value })
                  }
                  list="timezones"
                />
              </label>
              <button className="primary" disabled={busy}>
                Save academic profile <Check size={16} />
              </button>
            </form>
          )}
          {view === "Follow-ups" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Follow-ups and reminders</h2>
                  <p>
                    Automatic follow-ups require your exact authorization. A
                    reply, decline or opt-out cancels them. Manual reminders do
                    not send email.
                  </p>
                </div>
                <span className="badge pending">
                  {followups.length} reminders
                </span>
              </div>
              <details className="advanced-details"><summary>Advanced sending diagnostics</summary><SchedulerStatus scheduler={state.scheduler} /></details>
              {(state.campaigns || []).map((campaign) => (
                <div className="document-row" key={campaign.id}>
                  <div>
                    <strong>{campaign.name}</strong>
                    <p>
                      {campaign.initial_count} initial emails and{" "}
                      {campaign.followup_count} approved follow-ups
                      {campaign.cancelled ? " - cancelled" : ""}
                    </p>
                  </div>
                  <div className="campaign-progress">
                    <progress
                      aria-label={`Delivery progress for ${campaign.name}`}
                      max={campaign.initial_count + campaign.followup_count}
                      value={
                        (state.authorizations || []).filter(
                          (auth) =>
                            auth.campaign_id === campaign.id &&
                            state.messages.some(
                              (message) =>
                                message.id === auth.message_id &&
                                ["sent", "replied"].includes(message.status),
                            ),
                        ).length
                      }
                    />
                    <small>
                      {campaign.cancelled
                        ? "Campaign cancelled"
                        : "Confirmed delivery progress"}{" "}
                      � {campaign.initial_count + campaign.followup_count}{" "}
                      authorized messages
                    </small>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy || !!campaign.cancelled}
                    onClick={() => {
                      if (
                        confirm(
                          "Cancel all future messages and follow-ups in this campaign? Delivered email cannot be recalled.",
                        )
                      )
                        act(async () => {
                          await request(
                            `/campaigns/${campaign.id}/cancel`,
                            "POST",
                            {},
                          );
                        }, "Campaign cancelled");
                    }}
                  >
                    Cancel entire campaign
                  </button>
                </div>
              ))}
              <SequenceSteps
                steps={state.followup_steps || []}
                busy={busy}
                recipient={(root) =>
                  state.messages.find((message) => message.id === root)
                    ?.professor_email || root
                }
                cancel={(root, step) =>
                  act(async () => {
                    await request(
                      `/messages/${root}/sequence/${step}/cancel`,
                      "POST",
                      {},
                    );
                  }, "Sequence cancelled")
                }
              />
              {state.automation.map((a) => {
                const parent = state.messages.find(
                  (m) => m.id === a.message_id,
                );
                if (!parent || !visibleRecord(parent)) return null;
                const child = state.messages.find(
                  (m) => m.id === a.followup_id || m.parent_id === parent.id,
                );
                const due =
                  a.due_at ??
                  (a.sent_at || parent.sent_at
                    ? Date.parse(a.sent_at || parent.sent_at!) +
                      a.days * 86400000
                    : null);
                const reason = a.cancel_reason;
                const parentTransport = state.transports.find(
                  (transport) => transport.message_id === parent.id,
                );
                const accountStatus = state.connections.find(
                  (connection) =>
                    connection.id === parentTransport?.connection_id,
                )?.status;
                const label = a.followup_provider_id
                  ? "Follow-up sent"
                  : reason === "reply" ||
                      (parent.status === "replied" && reason !== "opt_out")
                    ? "Cancelled because of reply"
                    : reason === "opt_out"
                      ? "Cancelled because of opt-out"
                      : reason === "professor_deleted"
                        ? "Cancelled because professor was deleted"
                        : child?.status === "failed" ||
                            a.initial_status === "failed"
                          ? "Failed"
                          : a.generated &&
                              (!child || child.status === "cancelled")
                            ? "Follow-up cancelled"
                            : accountStatus !== "connected"
                              ? "Delayed: reconnect Gmail in Settings"
                              : a.child_transport_state === "uncertain"
                                ? "Delayed: reconciling Gmail acceptance; no resend"
                                : ["submitting", "leased"].includes(
                                      a.child_transport_state || "",
                                    )
                                  ? "Sending"
                                  : due && due <= Date.now()
                                    ? "Due; awaiting reply check and scheduler"
                                    : a.initial_provider_id
                                      ? "Follow-up scheduled"
                                      : "Automatic follow-up approved";
                return (
                  <div className="document-row" key={a.message_id}>
                    <div>
                      <strong>{label}</strong>
                      <p>
                        {parent.professor_email} - {a.days} day conditional
                        delay
                      </p>
                      {a.initial_provider_id && (
                        <p>
                          Initial email sent
                          {!a.generated && !a.followup_provider_id
                            ? " - Waiting for reply"
                            : ""}
                        </p>
                      )}
                      <p>Automatic follow-up approved: {a.subject}</p>
                      {parentTransport?.sync_error && (
                        <p role="alert">{parentTransport.sync_error}</p>
                      )}
                      <p>
                        Last reply check:{" "}
                        {parentTransport?.sync_checked_at
                          ? displayDate(
                              new Date(
                                parentTransport.sync_checked_at,
                              ).toISOString(),
                              "Asia/Karachi",
                            ) + " (Asia/Karachi)"
                          : "Pending"}
                        .
                      </p>
                      <p>
                        Next action:{" "}
                        {a.followup_provider_id || reason
                          ? "None"
                          : accountStatus !== "connected"
                            ? "Reconnect Gmail in Settings. Existing approval is retained."
                            : "Check replies, authorization and recipient eligibility before sending."}
                      </p>
                      <pre className="email-preview">{a.body}</pre>
                      <p>
                        {due
                          ? `Scheduled follow-up: ${displayDate(new Date(due).toISOString(), parent.timezone)} (${parent.timezone}) - UTC ${new Date(due).toISOString()}`
                          : "Exact due time will be calculated after Gmail accepts the initial email."}
                      </p>
                      {a.followup_provider_id && (
                        <small>
                          Gmail message ID: {a.followup_provider_id}
                        </small>
                      )}
                      <p className="helper">
                        Already authorized with its initial email. No
                        preparation or further approval is required.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => setReview(parent)}
                      >
                        View campaign
                      </button>
                      {!a.followup_provider_id &&
                        !reason &&
                        child?.status !== "cancelled" && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                await request(
                                  `/messages/${parent.id}/automation/cancel`,
                                  "POST",
                                  {},
                                );
                              }, "Preapproved follow-up cancelled")
                            }
                          >
                            Cancel automatic follow-up
                          </button>
                        )}
                    </div>
                  </div>
                );
              })}
              {followups.map((m) => (
                <div className="document-row" key={m.id}>
                  <div className="file-icon">
                    <CalendarClock size={23} />
                  </div>
                  <div>
                    <strong>{m.professor_name}</strong>
                    <small>
                      {displayDate(m.followup_at!, m.timezone)} · {m.timezone}
                    </small>
                  </div>
                  <span
                    className={
                      "badge " +
                      (new Date(m.followup_at!) <= new Date()
                        ? "pending"
                        : "draft")
                    }
                  >
                    {new Date(m.followup_at!) <= new Date()
                      ? "Due"
                      : "Upcoming"}
                  </span>
                  <button
                    className="secondary"
                    onClick={() => compose(m.professor_id)}
                  >
                    Prepare follow-up
                  </button>
                </div>
              ))}
              {!followups.length &&
                !state.automation.length &&
                !state.followup_steps?.length && (
                  <div className="empty">
                    <CalendarClock size={30} />
                    <h3>A little space for the next conversation</h3>
                    <p>Open a sent message to set a follow-up reminder.</p>
                  </div>
                )}
            </section>
          )}
          {view === "Settings" && (
            <div className={"settings-workspace settings-show-"+settingsSection}><div className="settings-navigation" aria-label="Settings sections">{[['account','Account and security'],['connections','Email connections'],['usage','Usage'],['about','About']].map(([key,label])=><button key={key} aria-pressed={settingsSection===key} onClick={()=>setSettingsSection(key)}>{label}</button>)}<button data-tour="nav-Academic profile" onClick={()=>setView('Academic profile')}>Academic profile</button><button data-tour="nav-Follow-ups" onClick={()=>setView('Follow-ups')}>Sending and follow-ups</button><button data-tour="nav-Audit history" onClick={()=>setView('Audit history')}>Activity history</button></div><div className="settings-grid">
              {identity && (
                <AccountSettings
                  ready={googleReady}
                  account={identity}
                  api={request}
                  refresh={refresh}
                />
              )}
              {!limitedWorkspace && (
                <>
                  <section className="panel settings-card email-settings">
                    <h2>Email connections</h2>
                    <p>
                      Gmail delivers only approved messages. Reply access lets
                      the scheduler cancel follow-ups. Controlled testing
                      remains restricted until the owner activates professor
                      outreach.
                    </p>
                    {(["gmail", "outlook"] as const).map((provider) => (
                      <div className="provider" key={provider}>
                        <Mail size={21} />
                        <strong>
                          {provider === "gmail" ? "Gmail" : "Microsoft Outlook"}
                        </strong>
                        <button
                          className="secondary"
                          data-tour={"connect-" + provider}
                          disabled={busy || !state.capabilities[provider]}
                          onClick={() =>
                            act(async () => {
                              const result = await request(
                                `/connections/${provider}/start`,
                                "POST",
                                { read_replies: true },
                              );
                              window.location.assign(result.url);
                            }, "Opening provider consent")
                          }
                        >
                          Connect with reply access
                        </button>
                        {!state.capabilities[provider] && (
                          <small>Administrator setup required</small>
                        )}
                      </div>
                    ))}
                    <p className="helper">
                      Reply access permits reading mailbox threads to stop
                      follow-ups. You review the provider consent screen.
                      Microsoft users can also remove this app's consent in
                      their Microsoft account.
                    </p>
                    {state.connections.map((account) => (
                      <div className="provider" key={account.id}>
                        <strong>{account.address}</strong>
                        <span>
                          {account.provider === "gmail" ? "Gmail " : "Outlook "}
                          {account.status}
                        </span>
                        {state.mailbox_checks
                          ?.filter((k) => k.connection_id === account.id)
                          .map((k) => (
                            <small key={k.connection_id}>
                              {k.status}: {k.detail}
                            </small>
                          ))}
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              await request(
                                `/connections/${account.id}/disconnect`,
                                "POST",
                              );
                            }, "Account disconnected; outstanding messages cancelled")
                          }
                        >
                          Disconnect
                        </button>
                      </div>
                    ))}
                    <details className="connection-advanced"><summary>Advanced sending access and preparation</summary>
                    {realWorkflow && (
                      <div>
                        <h3>
                          Real sending{" "}
                          {state.capabilities.live_email
                            ? "enabled"
                            : "disabled"}
                        </h3>
                        <p>
                          {state.capabilities.production_outreach
                            ? "Professor outreach activated by owner"
                            : "Controlled testing: " +
                              state.capabilities.test_recipients.join(", ")}
                        </p>
                        {state.capabilities.live_owner && (
                          <>
                            <p>
                              Production activation requires a confirmed Gmail
                              delivery to both test addresses and a detected
                              reply to a test. Test delivery:{" "}
                              {state.capabilities.activation.delivered
                                ? "passed"
                                : "pending"}
                              . Reply detection:{" "}
                              {state.capabilities.activation.reply_detected
                                ? "passed"
                                : "pending"}
                              .
                            </p>
                            <button
                              className="secondary"
                              disabled={
                                busy ||
                                !state.capabilities.live_email ||
                                (!state.capabilities.production_outreach &&
                                  !state.capabilities.activation.can_activate)
                              }
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    state.capabilities.production_outreach
                                      ? "Restrict future sends to controlled test recipients?"
                                      : "Enable real outreach to professor addresses you explicitly enter/import and approve? This does not approve any messages.",
                                  )
                                )
                                  return;
                                act(async () => {
                                  await request("/outreach/mode", "POST", {
                                    production_enabled:
                                      !state.capabilities.production_outreach,
                                    confirmed: true,
                                  });
                                }, "Sending mode updated; message approval is still required");
                              }}
                            >
                              {state.capabilities.production_outreach
                                ? "Return to controlled testing"
                                : "Activate professor outreach"}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    <h3>AI provider</h3>
                    <p>
                      {state.capabilities.ai === "groq"
                        ? "Groq configured with safe template fallback"
                        : "Editable factual templates"}{" "}
                      ? {state.ai_usage.requests} AI requests /{" "}
                      {state.ai_usage.tokens} tokens used
                    </p>
                    <p className="helper">
                      AI selects from factual templates; it does not invent
                      research, publications, affiliations or funding. Only
                      student-entered profile and professor fields are used.
                      Always preview and edit before approval.
                    </p>
                    </details>
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        !state.connections.some(
                          (account) =>
                            account.status === "connected" &&
                            state.capabilities[account.provider] &&
                            /gmail.readonly|Mail.Read/.test(account.scopes),
                        )
                      }
                      onClick={() =>
                        act(async () => {
                          await request("/connections/sync", "POST");
                        }, "Bounded reply check completed")
                      }
                    >
                      Check replies now
                    </button>
                    {realWorkflow && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            await request("/connections/check", "POST", {});
                          }, "Gmail provider verification updated; review the connection result above")
                        }
                      >
                        Verify Gmail connection
                      </button>
                    )}
                    <button className="text-link" onClick={()=>setView('Notifications')}>Open notification inbox <ArrowUpRight size={15}/></button>
                    <h3>Recipient opt-out</h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const address = String(
                          new FormData(form).get("address"),
                        );
                        act(async () => {
                          await request("/suppressions", "POST", { address });
                          form.reset();
                        }, "Recipient blocked from live sending and follow-ups");
                      }}
                    >
                      <input
                        type="email"
                        name="address"
                        aria-label="Recipient email address to block"
                        required
                        placeholder="Recipient who declined or opted out"
                      />
                      <button className="secondary" disabled={busy}>
                        Block recipient
                      </button>
                    </form>
                  </section>
                  <section className="panel settings-card outreach-settings">
                    <h2>Outreach controls</h2>
                    <p>
                      Controls apply to your student account and are checked by
                      every scheduler run.
                    </p>
                    <div className="control-buttons">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(
                            async () => {
                              await request("/control", "POST", {
                                action: profile.paused ? "resume" : "pause",
                              });
                            },
                            profile.paused
                              ? "Outreach resumed"
                              : "Outreach paused",
                          )
                        }
                      >
                        {profile.paused ? (
                          <Play size={17} />
                        ) : (
                          <Pause size={17} />
                        )}{" "}
                        {profile.paused ? "Resume outreach" : "Pause outreach"}
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Stop outreach and cancel all your outstanding drafts and scheduled messages?",
                            )
                          )
                            act(async () => {
                              await request("/control", "POST", {
                                action: "stop",
                              });
                            }, "Outreach stopped; outstanding messages cancelled");
                        }}
                      >
                        <Square size={16} /> Stop all outreach
                      </button>
                    </div>
                    <div className="helper">
                      Pause preserves the queue. Stop cancels outstanding
                      messages. Resuming does not restore cancelled messages.
                    </div>
                    <h3>Account</h3>
                    <p>{state.account.email}</p>
                    <span className="security-note">
                      <ShieldCheck size={15} /> Private documents · Isolated
                      student records
                    </span>
                  </section>
                </>
              )}
              <section className="panel settings-card usage-settings"><h2>Usage and limits</h2><p>Initial emails and follow-ups share a rolling 24-hour allowance. A one-minute minimum interval applies between sends.</p><div className="usage-summary"><strong>{state.sending_usage?.sent||0} / 50 submitted</strong><span>{state.sending_usage?.remaining??50} remaining</span></div>{state.sending_usage?.remaining===0&&state.sending_usage.next_available_at&&<p>Next allowance: {new Date(state.sending_usage.next_available_at).toLocaleString()}</p>}<details><summary>Advanced usage and diagnostics</summary><p>AI requests today: {state.ai_usage.requests}. AI tokens today: {state.ai_usage.tokens}.</p><SchedulerStatus scheduler={state.scheduler}/></details></section>
              <section className="panel settings-card about-settings"><h2>About Professor Agent</h2><p>A student workspace for thoughtful academic outreach. You review and approve every sending plan.</p><details><summary>Developer credit</summary><DeveloperIntroduction/></details><button className="text-link" onClick={()=>setPolicy('privacy')}>Privacy policy</button><button className="text-link" onClick={()=>setPolicy('terms')}>Terms of use</button></section>
            </div></div>
          )}
          {view === "Audit history" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Workspace activity</h2>
                  <p>
                    Most recent 100 account events. All times shown in{" "}
                    {profile.timezone}.
                  </p>
                </div>
              </div>
              {state.audit.map((a) => (
                <div className="audit-row" key={a.id}>
                  <History size={16} />
                  <strong>
                    {a.action.replaceAll(".", " · ").replaceAll("_", " ")}
                  </strong>
                  <small>
                    {displayDate(
                      a.created_at.includes("T")
                        ? a.created_at
                        : a.created_at.replace(" ", "T") + "Z",
                      profile.timezone,
                    )}
                  </small>
                </div>
              ))}
            </section>
          )}
          {limitedWorkspace &&
            view !== "Overview" &&
            view !== "Practice Campaign" &&
            view !== "Getting Started" &&
            view !== "Smart Import" && (
              <section className="panel verification-reminder" role="status">
                <strong>Email Not Verified</strong>
                <p>
                  You can manage your academic profile, professors and private
                  documents. Email connections, outreach and campaign approvals
                  require verified access.
                </p>
                <p>
                  {googleReady
                    ? "Use Verify with Google & Connect Gmail on Overview. Choose the Google account matching your registered email."
                    : "Google OAuth activation is not configured. Your private workspace remains accessible; verification remains required."}
                </p>
              </section>
            )}
          <footer className="main-footer">
            <span>Made for your next academic chapter.</span>
            <span>
              <ShieldCheck size={13} /> Your workspace. Your pace.
            </span>
          </footer>
        </main>
      </div>
      <datalist id="timezones">
        {[
          "Asia/Seoul",
          "Asia/Karachi",
          "Asia/Kolkata",
          "Asia/Dhaka",
          "Europe/London",
          "Europe/Berlin",
          "America/New_York",
          "America/Chicago",
          "America/Los_Angeles",
          "Asia/Shanghai",
          "Asia/Tokyo",
          "Australia/Sydney",
          "UTC",
        ].map((t) => (
          <option key={t}>{t}</option>
        ))}
      </datalist>
      {documentPreview && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
          >
            <div className="modal-heading">
              <h2 id="preview-title">{documentPreview.name}</h2>
              <button
                aria-label="Close document preview"
                onClick={() => setDocumentPreview(null)}
              >
                <X size={21} />
              </button>
            </div>
            <pre className="email-preview">{documentPreview.text}</pre>
          </section>
        </div>
      )}
      {(modal || review) && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">BUILD A MEANINGFUL CONNECTION</span>
                <h2 id="dialog-title">
                  {review
                    ? "Review outreach"
                    : modal === "professor"
                      ? editingProfessor
                        ? "Edit professor"
                        : "Add a professor"
                      : "Compose outreach"}
                </h2>
              </div>
              <button
                aria-label="Close dialog"
                onClick={() => {
                  manualEntry.current=false;
                  setModal(null);
                  setReview(null);
                  setEditingProfessor("");
                }}
              >
                <X size={21} />
              </button>
            </div>
            {error && (
              <div role="alert" className="feedback error">
                {error}
              </div>
            )}
            {modal === "verify" && verificationTarget && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const source_url = String(
                    new FormData(e.currentTarget).get("source_url"),
                  );
                  act(async () => {
                    await request(
                      `/professors/${verificationTarget.id}/verify`,
                      "POST",
                      { source_url, confirmed: true },
                    );
                    setModal(null);
                  }, "Official source confirmation recorded");
                }}
              >
                <h3>Confirm the professor information</h3>
                <p>
                  {verificationTarget.name} | {verificationTarget.email} ?{" "}
                  {verificationTarget.university} ?{" "}
                  {verificationTarget.interests}
                </p>
                <label>
                  Official HTTPS profile/source URL
                  <input
                    type="url"
                    name="source_url"
                    required
                    defaultValue={verificationTarget.source_url || ""}
                    placeholder="https://example.edu/faculty/profile"
                  />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" required />I checked these facts
                  against this source. The app does not independently verify the
                  webpage.
                </label>
                <button className="primary" disabled={busy}>
                  Confirm source
                </button>
              </form>
            )}
            {modal === "professor" && (
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  act(async () => {
                    await request(
                      editingProfessor
                        ? `/professors/${editingProfessor}`
                        : "/professors",
                      editingProfessor ? "PUT" : "POST",
                      editingProfessor ? professor : [professor],
                    );
                    if(manualEntry.current){manualEntry.current=false;setPendingManualEmail(professor.email.trim().toLowerCase());}
                    setEditingProfessor("");
                    setProfessor({
                      name: "",
                      email: "",
                      university: "",
                      interests: "",
                    });
                    setModal(null);
                  }, "Professor added to your shortlist");
                }}
              >
                {(["name", "email", "university", "interests"] as const).map(
                  (key) => (
                    <label key={key}>
                      {key === "name"
                        ? "Professor name"
                        : key[0].toUpperCase() + key.slice(1)}
                      <input
                        required={key === "name" || key === "email"}
                        type={key === "email" ? "email" : "text"}
                        value={professor[key]}
                        onChange={(e) =>
                          setProfessor({ ...professor, [key]: e.target.value })
                        }
                      />
                    </label>
                  ),
                )}
                <button className="primary" disabled={busy}>
                  {editingProfessor ? "Save professor" : "Add professor"}{" "}
                  <Plus size={16} />
                </button>
              </form>
            )}
            {modal === "compose" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act(
                    async () => {
                      const savedDraft=await request("/messages", "POST", {
                        ...draft,
                        sending_account_id: draft.sending_account_id || null,
                        mode:
                          realWorkflow && draft.mode === "auto"
                            ? "review"
                            : draft.mode,
                        followup: draft.followup_enabled
                          ? {
                              days:
                                followupUnit === "days"
                                  ? draft.followup_days
                                  : 1,
                              delay_value: draft.followup_days,
                              delay_unit: followupUnit,
                              subject: draft.followup_subject,
                              body: draft.followup_body,
                              authorized: draft.followup_authorized,
                            }
                          : undefined,
                        scheduled_at: zonedISO(
                          draft.scheduled_at,
                          draft.timezone,
                        ),
                      });
                      if(view==="Smart Import"&&draft.mode!=="auto")setPendingDraftId(savedDraft.id);
                      setModal(null);
                    },
                    draft.mode === "auto"
                      ? "Email scheduled with explicit authorization"
                      : "Draft saved for approval",
                  );
                }}
              >
                <label>
                  Sending account
                  <select
                    value={draft.sending_account_id}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sending_account_id: e.target.value,
                        authorized: false,
                        followup_enabled: false,
                        followup_authorized: false,
                      })
                    }
                  >
                    <option value="">
                      {realWorkflow
                        ? "Choose Gmail during review"
                        : "Mock mailbox (no real email)"}
                    </option>
                    {state.connections
                      .filter(
                        (a) =>
                          a.status === "connected" &&
                          (!realWorkflow || a.provider === "gmail"),
                      )
                      .map((a) => (
                        <option
                          key={a.id}
                          value={a.id}
                          disabled={!state.capabilities.live_email}
                        >
                          {a.address} - real Gmail
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Professor
                  <select
                    aria-label="Professor"
                    required
                    value={draft.professor_id}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        professor_id: e.target.value,
                        authorized: false,
                        followup_authorized: false,
                      })
                    }
                  >
                    <option value="">Choose a professor</option>
                    {professors.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.university}
                      </option>
                    ))}
                  </select>
                </label>
                {!professors.length && (
                  <p className="helper">
                    Add a professor before composing a message.
                  </p>
                )}
                <label>
                  Workflow
                  <select
                    value={draft.mode}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        mode: e.target.value,
                        authorized: false,
                        followup_authorized: false,
                      })
                    }
                  >
                    <option value="manual">
                      A · Manual email + batch approval
                    </option>
                    <option value="review">
                      B · AI draft + individual review
                    </option>
                    <option value="auto" disabled={realWorkflow}>
                      C · AI draft + explicit auto-send authorization
                    </option>
                  </select>
                </label>
                <div className="form-grid">
                  <label>
                    Writing tone
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                    >
                      <option value="professional">Professional</option>
                      <option value="concise">Concise</option>
                      <option value="warm">Warm & respectful</option>
                    </select>
                  </label>
                  <label>
                    Reusable template
                    <select
                      value={template}
                      onChange={(e) => setTemplate(e.target.value)}
                    >
                      <option value="0">Research introduction</option>
                      <option value="1">MS availability</option>
                      <option value="2">Research discussion</option>
                    </select>
                  </label>
                </div>
                {draft.mode === "manual" && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !draft.professor_id}
                    onClick={() =>
                      act(async () => {
                        const result = await request("/draft", "POST", {
                          professor_id: draft.professor_id,
                          template: Number(template),
                          tone,
                          manual_template: true,
                        });
                        setDraft({
                          ...draft,
                          subject: result.subject,
                          body: result.body,
                          authorized: false,
                          followup_authorized: false,
                        });
                      }, "Editable template prepared")
                    }
                  >
                    Use selected template
                  </button>
                )}
                {draft.mode !== "manual" && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !draft.professor_id}
                    onClick={() =>
                      act(async () => {
                        const result = await request("/draft", "POST", {
                          professor_id: draft.professor_id,
                        });
                        setDraftWarning(result.warning || "");
                        setDraft({
                          ...draft,
                          subject: result.subject,
                          body: result.body,
                          authorized: false,
                          followup_authorized: false,
                        });
                      }, "Draft ready - preview and personalize before approval")
                    }
                  >
                    <Sparkles size={16} /> Generate draft
                  </button>
                )}
                <label>
                  Subject
                  <input
                    required
                    maxLength={500}
                    value={draft.subject}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        subject: e.target.value,
                        authorized: false,
                        followup_authorized: false,
                      })
                    }
                  />
                </label>
                <label>
                  Email body
                  <textarea
                    required
                    rows={9}
                    maxLength={20000}
                    value={draft.body}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        body: e.target.value,
                        authorized: false,
                        followup_authorized: false,
                      })
                    }
                  />
                </label>
                {draftWarning && <p className="helper">{draftWarning}</p>}
                {draft.sending_account_id && (
                  <fieldset>
                    <legend>Optional first follow-up (one maximum)</legend>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={draft.followup_enabled}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            followup_enabled: e.target.checked,
                            followup_authorized: false,
                            authorized: false,
                          })
                        }
                      />
                      Prepare an exact follow-up for automatic sending if no
                      reply is detected
                    </label>
                    {draft.followup_enabled && (
                      <>
                        <label>
                          Delay value
                          <input
                            type="number"
                            min={1}
                            max={
                              followupUnit === "minutes"
                                ? MAX_SEQUENCE_DAYS * 1440
                                : followupUnit === "hours"
                                  ? MAX_SEQUENCE_DAYS * 24
                                  : MAX_SEQUENCE_DAYS
                            }
                            value={draft.followup_days}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                followup_days: Number(e.target.value),
                                followup_authorized: false,
                                authorized: false,
                              })
                            }
                          />
                        </label>
                        <label>
                          Exact follow-up subject
                          <select
                            aria-label="Follow-up delay unit"
                            value={followupUnit}
                            onChange={(event) => {
                              setFollowupUnit(
                                event.target.value as
                                  "minutes" | "hours" | "days",
                              );
                              setDraft({
                                ...draft,
                                followup_authorized: false,
                                authorized: false,
                              });
                            }}
                          >
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                          <input
                            required
                            maxLength={500}
                            value={draft.followup_subject}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                followup_subject: e.target.value,
                                followup_authorized: false,
                                authorized: false,
                              })
                            }
                          />
                        </label>
                        <label>
                          Exact follow-up body
                          <textarea
                            required
                            maxLength={20000}
                            value={draft.followup_body}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                followup_body: e.target.value,
                                followup_authorized: false,
                                authorized: false,
                              })
                            }
                          />
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            required
                            checked={draft.followup_authorized}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                followup_authorized: e.target.checked,
                              })
                            }
                          />
                          I authorize this exact single follow-up using the same
                          account, recipient and attachments after the initial
                          message is approved, only if reply checks succeed and
                          no reply/decline/opt-out is known.
                        </label>
                      </>
                    )}
                  </fieldset>
                )}
                <fieldset>
                  <legend>Attachments for this professor</legend>
                  {state.documents.map((d) => (
                    <label className="checkbox-label" key={d.id}>
                      <input
                        type="checkbox"
                        checked={draft.attachments.includes(d.id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            authorized: false,
                            followup_authorized: false,
                            attachments: e.target.checked
                              ? [...draft.attachments, d.id]
                              : draft.attachments.filter((x) => x !== d.id),
                          })
                        }
                      />
                      {d.name}
                    </label>
                  ))}
                  {!state.documents.length && (
                    <p className="helper">
                      Upload a private document in the Documents tab first.
                    </p>
                  )}
                </fieldset>
                <div className="form-grid">
                  <label>
                    Send at (in selected timezone)
                    <input
                      type="datetime-local"
                      required
                      value={draft.scheduled_at}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          scheduled_at: e.target.value,
                          authorized: false,
                          followup_authorized: false,
                        })
                      }
                    />
                  </label>
                  <label>
                    Scheduled email timezone
                    <input
                      required
                      list="timezones"
                      value={draft.timezone}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          timezone: e.target.value,
                          authorized: false,
                          followup_authorized: false,
                        })
                      }
                    />
                  </label>
                </div>
                <p className="helper">
                  A repeated daylight-saving hour resolves to one valid
                  occurrence. Review the UTC time after saving.
                </p>
                {draft.mode === "auto" && (
                  <label className="authorization">
                    <input
                      required
                      type="checkbox"
                      checked={draft.authorized}
                      onChange={(e) =>
                        setDraft({ ...draft, authorized: e.target.checked })
                      }
                    />
                    <span>
                      I reviewed this exact subject, body, recipient, schedule,
                      and attachments. I explicitly authorize its automatic{" "}
                      {draft.sending_account_id
                        ? "LIVE controlled-test email delivery from the selected account"
                        : "mock delivery (no real email)"}{" "}
                      without another approval.
                    </span>
                  </label>
                )}
                <button
                  className="primary full"
                  disabled={busy || !professors.length}
                >
                  {draft.mode === "auto"
                    ? draft.sending_account_id
                      ? "Save for Gmail review"
                      : "Authorize & schedule mock email"
                    : "Save draft for review"}
                  <Send size={16} />
                </button>
              </form>
            )}
            {review && (
              <>
                <div className="review-recipient">
                  <span className="badge draft">{review.mode}</span>
                  <strong>To: {review.professor_name}</strong>
                  <small>{review.professor_email}</small>
                </div>
                <h3>{review.subject}</h3>
                <pre className="email-preview">{review.body}</pre>
                {state.transports
                  .filter((t) => t.message_id === review.id)
                  .map((t) => (
                    <p className="helper" key={t.message_id}>
                      Sending account:{" "}
                      {
                        state.connections.find((a) => a.id === t.connection_id)
                          ?.address
                      }{" "}
                      ? Transport: {t.state}
                      {t.provider_id
                        ? " ? Confirmed provider message " + t.provider_id
                        : ""}
                    </p>
                  ))}
                {review.followup_proposal &&
                  !state.automation.some((a) => a.message_id === review.id) &&
                  (() => {
                    const proposal = JSON.parse(review.followup_proposal);
                    if (proposal.steps)
                      return (
                        <div>
                          <h3>
                            {state.followup_steps?.some(
                              (step) => step.root_id === review.id,
                            )
                              ? "Authorized sequence"
                              : "Proposed sequence; requires complete campaign approval"}
                          </h3>
                          {(proposal.steps as FollowupStep[]).map(
                            (step, index) => (
                              <div key={index}>
                                <strong>
                                  Follow-up {index + 1}: {step.subject}
                                </strong>
                                <p>
                                  {step.delay_value} {step.delay_unit} after{" "}
                                  {step.relative_to}
                                </p>
                                <pre className="email-preview">{step.body}</pre>
                              </div>
                            ),
                          )}
                          <p>
                            Only if no reply, decline or opt-out. View
                            Follow-ups for due times, mailbox checks and
                            delivery status. Changing a sequence requires a new
                            draft and complete approval.
                          </p>
                        </div>
                      );
                    return (
                      <div>
                        <h3>
                          {review.status === "replied"
                            ? "Cancelled due to reply ? inactive proposal:"
                            : "Proposed but inactive:"}{" "}
                          {proposal.days} days after confirmed sending
                        </h3>
                        <strong>{proposal.subject}</strong>
                        <pre className="email-preview">{proposal.body}</pre>
                        <p className="helper">
                          {review.status === "draft"
                            ? "Select the combined initial-email and automatic-follow-up option in this campaign review to authorize it once. Initial-only approval leaves it inactive."
                            : "This follow-up was not authorized with the initial campaign. The original approval is retained. You can separately approve this exact conditional follow-up below."}
                        </p>
                        {review.status === "sent" && (
                          <p className="helper">
                            Due{" "}
                            {new Date(
                              Date.parse(review.sent_at!) +
                                proposal.days * 86400000,
                            ).toLocaleString("en-PK", {
                              timeZone: review.timezone,
                            })}{" "}
                            ({review.timezone}). If already due, approval
                            permits sending on the next eligible cron run after
                            a fresh reply check.
                          </p>
                        )}
                        {review.status === "sent" && (
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                await request(
                                  `/messages/${review.id}/approve-followup`,
                                  "POST",
                                  { confirmed: true, ...proposal },
                                );
                                setReview(null);
                              })
                            }
                          >
                            Approve this exact automatic follow-up once
                          </button>
                        )}
                        {review.status === "draft" && (
                          <button
                            className="secondary"
                            onClick={() => {
                              setDraft({
                                ...draft,
                                professor_id: review.professor_id,
                                subject: review.subject,
                                body: review.body,
                                scheduled_at: localDate(
                                  review.timezone,
                                  new Date(review.scheduled_at),
                                ),
                                timezone: review.timezone,
                                mode: "review",
                                authorized: false,
                                sending_account_id: "",
                                attachments: review.attachments,
                                followup_enabled: true,
                                followup_days: proposal.days,
                                followup_subject: proposal.subject,
                                followup_body: proposal.body,
                                followup_authorized: false,
                              });
                              setReview(null);
                              setModal("compose");
                            }}
                          >
                            Use proposal in composer
                          </button>
                        )}
                      </div>
                    );
                  })()}
                {state.automation
                  .filter((a) => a.message_id === review.id)
                  .map((a) => (
                    <div key={a.message_id}>
                      <h3>Preauthorized first follow-up after {a.days} days</h3>
                      <strong>{a.subject}</strong>
                      <pre className="email-preview">{a.body}</pre>
                      {!a.generated && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              await request(
                                `/messages/${review.id}/automation/cancel`,
                                "POST",
                              );
                            }, "Automatic follow-up cancelled")
                          }
                        >
                          Cancel automatic follow-up
                        </button>
                      )}
                    </div>
                  ))}
                <p className="helper">
                  {displayDate(review.scheduled_at, review.timezone)} ·{" "}
                  {review.timezone}
                  <br />
                  UTC: {review.scheduled_at}
                  <br />
                  Attachments:{" "}
                  {review.attachments
                    .map(
                      (a) => state.documents.find((d) => d.id === a)?.name || a,
                    )
                    .join(", ") || "None"}
                </p>
                {review.status === "sent" && (
                  <div className="control-buttons">
                    {(["decline", "opt_out", "bounce"] as const).map((kind) => (
                      <button
                        className="secondary"
                        key={kind}
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            await request(
                              `/messages/${review.id}/outcome`,
                              "POST",
                              { kind },
                            );
                            setReview(null);
                          }, "Recipient outcome recorded; further live sending is blocked")
                        }
                      >
                        Record {kind.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                )}
                {(review.status === "draft" ||
                  (realWorkflow &&
                    review.status === "pending" &&
                    !review.live_ready)) &&
                  approvalControls([review])}
                {(review.status === "draft" ||
                  (realWorkflow &&
                    review.status === "pending" &&
                    !review.live_ready)) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await request("/messages/approve", "POST", {
                          ids: [review.id],
                          ...approvalOptions(),
                        });
                        setReview(null);
                      }, "Reviewed email approved for its selected mailbox")
                    }
                  >
                    <Check size={16} />{" "}
                    {realWorkflow
                      ? authorizeImportedFollowups
                        ? "Approve initial emails and automatic follow-ups"
                        : "Approve initial email only"
                      : "Approve this exact email"}
                  </button>
                )}
                {realWorkflow && (
                  <div>
                    <p>{deliveryLabel(review)}</p>
                    {state.transports
                      .filter((t) => t.message_id === review.id)
                      .map((t) => (
                        <p key={t.message_id}>
                          Attempts: {t.attempts}. Gmail message ID:{" "}
                          {t.provider_id || "Not accepted yet"}.{" "}
                          {t.state === "waiting" && t.next_at > Date.now()
                            ? "Retry scheduled: " +
                              new Date(t.next_at).toLocaleString()
                            : ""}
                        </p>
                      ))}
                    {state.delivery_attempts
                      ?.filter((a) => a.message_id === review.id)
                      .map((a) => (
                        <p key={a.id}>
                          Attempt {a.attempt}: {a.outcome} (
                          {new Date(a.started_at).toLocaleString()})
                        </p>
                      ))}
                    {review.status === "failed" &&
                      !review.parent_id &&
                      state.transports.some(
                        (t) =>
                          t.message_id === review.id && t.state === "failed",
                      ) && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "Retry this exact recipient and message through Gmail? Cancelled follow-ups will remain cancelled.",
                              )
                            )
                              return;
                            act(async () => {
                              await request(
                                `/messages/${review.id}/retry`,
                                "POST",
                                { confirmed: true },
                              );
                              setReview(null);
                            }, "Exact Gmail retry authorized");
                          }}
                        >
                          Retry exact message
                        </button>
                      )}
                  </div>
                )}
                {review.status === "sent" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      act(async () => {
                        await request(
                          `/messages/${review.id}/followup`,
                          "POST",
                          {
                            date: zonedISO(
                              String(data.get("date")),
                              review.timezone,
                            ),
                          },
                        );
                        setReview(null);
                      }, "Follow-up reminder saved");
                    }}
                  >
                    <label>
                      Follow-up reminder in {review.timezone}
                      <input name="date" type="datetime-local" required />
                    </label>
                    <button className="primary" disabled={busy}>
                      Set reminder <Bell size={16} />
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
