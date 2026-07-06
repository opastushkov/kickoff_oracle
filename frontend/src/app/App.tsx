import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Gavel,
  ShieldQuestion,
  Copy,
  Check,
  ChevronRight,
  Zap,
  Users,
  Lock,
  CheckCircle2,
  Circle,
  AlertTriangle,
  XCircle,
  Clock,
  Wifi,
  Wallet,
  ArrowRight,
  Eye,
  FileText,
  Play,
  X,
} from "lucide-react";

import { MATCH_FIXTURE, startMatchFeed } from "../engine/feed";
import { KickoffEngine, formatUSDt, shortHash, stakeTotal } from "../engine/engine";
import { asParticipant, loadOrCreateIdentity, shortWallet, type LocalIdentity } from "../engine/identity";
import { MockOracleRuntime } from "../engine/oracles";
import { BroadcastChannelAdapter, WebSocketAdapter, type P2PAdapter } from "../engine/p2p";
import {
  detectQvacRuntime,
  listQvacModels,
  requestQvacModel,
  type QvacModelInfo,
} from "../engine/qvac";
import { detectWdkWallet } from "../engine/wdk";
import { saveWdkIdentity } from "../engine/identity";
import type {
  AuditEntry,
  Category,
  EvidenceItem,
  RoomPolicy,
  RoomView,
  Side,
  TimelineEvent,
} from "../engine/types";

// ─── Design tokens (raw values for inline use when Tailwind can't reach) ────
const C = {
  bg: "#F5F7F2",
  panel: "#FFFFFF",
  panel2: "#E8EDE5",
  chalk: "#1A2B1E",
  muted: "#6B7B6E",
  hairline: "rgba(26,43,30,0.12)",
  green: "#1E7A46",
  red: "#C93535",
  amber: "#D4A017",
  teal: "#007A7A",
};

// ─── Type definitions ────────────────────────────────────────────────────────
type Screen = "landing" | "room" | "market" | "settlement";
type OracleState = "idle" | "analyzing" | "revealed";

// ─── Engine-derived display helpers ──────────────────────────────────────────
const CATEGORY_LABEL: Record<string, string> = {
  OBJECTIVE: "Objective",
  INTERPRETIVE: "Interpretive",
};
const STATUS_LABEL: Record<string, string> = {
  OPEN: "OPEN",
  AWAITING_EVIDENCE: "AWAITING EVIDENCE",
  RESOLVING: "RESOLVING",
  NO_CONSENSUS: "NO CONSENSUS",
  RESOLVED: "RESOLVED",
  SETTLED: "SETTLED",
  CANCELLED: "CANCELLED",
};
/** "3 × Llama 3.2 1B" when the committee shares one model, else a list. */
function committeeSummary(committee: { id: string; model: string }[]): string {
  const models = [...new Set(committee.map((c) => c.model))];
  return models.length === 1
    ? `${committee.length} × ${models[0]}`
    : committee.map((c) => `${c.id} (${c.model})`).join(" / ");
}

function policyLabel(view: RoomView): string {
  const p = view.room?.policy;
  if (!p) return "";
  const fb = p.fallback.kind === "FACTS" ? "Facts" : "Tiebreaker LLM";
  return `${p.threshold}-of-${p.committee.length} LLM consensus · Fallback: ${fb}`;
}
function nameOf(view: RoomView, wallet: string): string {
  return view.participants.find((p) => p.wallet === wallet)?.displayName ?? wallet;
}
function liveMinute(view: RoomView): string {
  return `${view.timeline
    .filter((e) => e.type !== "FULL_TIME")
    .reduce((a, e) => Math.max(a, e.minute), 0)}'`;
}

// ─── Shared fonts ─────────────────────────────────────────────────────────────
const fontCondensed = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800 };
const fontBody = { fontFamily: "'Inter', sans-serif" };
const fontMono = { fontFamily: "'JetBrains Mono', monospace" };

// ─── Status chip ─────────────────────────────────────────────────────────────
function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string; pulse?: boolean; strikethrough?: boolean }> = {
    DRAFT: { label: "Draft", color: C.muted, bg: "transparent" },
    OPEN: { label: "Open", color: C.green, bg: "transparent" },
    LOCKED: { label: "Locked", color: C.amber, bg: "rgba(228,182,60,0.12)" },
    "AWAITING EVIDENCE": { label: "Awaiting evidence", color: C.amber, bg: "rgba(228,182,60,0.12)", pulse: true },
    RESOLVING: { label: "Resolving", color: C.chalk, bg: "rgba(237,239,233,0.08)" },
    RESOLVED: { label: "Resolved", color: C.green, bg: "rgba(47,158,99,0.18)" },
    SETTLED: { label: "Settled", color: C.teal, bg: "rgba(0,122,122,0.15)" },
    "NO CONSENSUS": { label: "No consensus", color: C.amber, bg: "rgba(228,182,60,0.1)" },
    CANCELLED: { label: "Cancelled", color: C.muted, bg: "transparent", strikethrough: true },
  };
  const s = map[status] ?? map["DRAFT"];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-semibold border"
      style={{ ...fontBody, color: s.color, background: s.bg, borderColor: s.color + "44" }}
    >
      {s.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.amber }} />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: C.amber }} />
        </span>
      )}
      <span style={s.strikethrough ? { textDecoration: "line-through" } : {}}>{s.label}</span>
    </span>
  );
}

// ─── Category tag ─────────────────────────────────────────────────────────────
function CategoryTag({ cat }: { cat: string }) {
  const colors: Record<string, string> = {
    Interpretive: "rgba(228,182,60,0.15)",
    Objective: "rgba(47,158,99,0.15)",
  };
  const text: Record<string, string> = {
    Interpretive: C.amber,
    Objective: C.green,
  };
  return (
    <span
      className="inline-block px-2.5 py-0.5 rounded text-sm font-semibold"
      style={{ ...fontBody, background: colors[cat] ?? colors.Objective, color: text[cat] ?? C.green }}
    >
      {cat}
    </span>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────────
function TopBar({
  minute,
  onNav,
  roomName,
  balance,
  initials,
}: {
  minute: string;
  onNav: (s: Screen) => void;
  roomName: string;
  balance: string;
  initials: string[];
}) {
  return (
    <header
      className="sticky top-0 z-50 flex items-center justify-between px-8 py-3 border-b shadow-sm"
      style={{ background: C.panel, borderColor: C.hairline, borderLeftWidth: 4, borderLeftColor: C.green }}
    >
      <div className="flex items-center gap-4">
        <button onClick={() => onNav("room")} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <span style={{ ...fontCondensed, color: C.green, fontSize: 24, letterSpacing: 1 }}>
            KICKOFF ORACLE
          </span>
        </button>
        <span className="text-sm px-2.5 py-1 rounded font-medium" style={{ ...fontBody, background: C.panel2, color: C.muted }}>
          {roomName}
        </span>
        <span
          className="px-3 py-1 rounded"
          style={{ ...fontCondensed, background: "rgba(30,122,70,0.12)", color: C.green, fontSize: 22 }}
        >
          {minute}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* Peer avatars */}
        <div className="flex items-center -space-x-2">
          {initials.map((l, i) => (
            <div
              key={i}
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2"
              style={{ background: C.green, borderColor: C.panel, color: "#fff", fontFamily: "'Archivo', sans-serif" }}
            >
              {l}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs" style={{ ...fontBody, color: C.muted }}>
          <Wifi size={11} />
          <span>P2P · synced</span>
        </div>
        <span
          className="px-2 py-0.5 rounded text-xs font-semibold border"
          style={{ ...fontBody, color: C.amber, borderColor: C.amber + "55", background: "rgba(228,182,60,0.08)" }}
        >
          TESTNET USDt
        </span>
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium"
          style={{ ...fontBody, background: "rgba(0,147,147,0.15)", color: C.teal, border: `1px solid ${C.teal}44` }}
        >
          <Wallet size={13} />
          Balance: {balance} test USDt
        </div>
      </div>
    </header>
  );
}

// ─── Evidence timeline ────────────────────────────────────────────────────────
function EvidenceTimeline({ events }: { events: TimelineEvent[] }) {
  const sorted = [...events].sort((a, b) => a.minute - b.minute);
  const latestId = events.reduce<TimelineEvent | null>((a, e) => (!a || e.minute >= a.minute ? e : a), null)?.id;
  const fullTime = events.some((e) => e.type === "FULL_TIME");
  return (
    <aside
      className="w-72 shrink-0 flex flex-col gap-4 p-5 rounded-lg border"
      style={{ background: C.panel, borderColor: C.hairline }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest" style={{ ...fontBody, color: C.muted }}>
          Evidence feed
        </span>
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold border"
          style={{
            ...fontBody,
            color: fullTime ? C.muted : C.green,
            borderColor: (fullTime ? C.muted : C.green) + "55",
            background: fullTime ? "transparent" : "rgba(30,122,70,0.08)",
          }}
        >
          {!fullTime && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.green }} />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: C.green }} />
            </span>
          )}
          {fullTime ? "FULL TIME" : "REPLAY FEED"}
        </span>
      </div>
      <p className="text-xs -mt-2" style={{ ...fontMono, color: C.muted }}>
        {MATCH_FIXTURE.label}
      </p>

      {sorted.length === 0 ? (
        <p className="text-xs leading-relaxed" style={{ ...fontBody, color: C.muted }}>
          Waiting for the first feed event…
        </p>
      ) : (
        <div className="relative flex flex-col gap-0">
          <div className="absolute left-4 top-0 bottom-0 w-px" style={{ background: C.hairline }} />
          {sorted.map((ev) => {
            const isNew = ev.id === latestId;
            return (
              <motion.div
                key={ev.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4 }}
                className="relative flex items-start gap-3 py-3"
              >
                <div
                  className="relative z-10 w-2 h-2 rounded-full mt-1 shrink-0 ml-3"
                  style={{ background: isNew ? C.green : C.muted, boxShadow: isNew ? `0 0 6px ${C.green}` : "none" }}
                />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold" style={{ ...fontCondensed, color: isNew ? C.green : C.chalk, fontSize: 20 }}>
                      {ev.minute}'
                    </span>
                    <span style={{ ...fontBody, color: C.chalk, fontSize: 15, fontWeight: 500 }}>
                      {ev.description}
                    </span>
                  </div>
                  {ev.detail && (
                    <span className="text-xs" style={{ ...fontBody, color: C.muted }}>
                      {ev.detail}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

// ─── Market card ──────────────────────────────────────────────────────────────
function MarketCard({
  question,
  category,
  status,
  yesStake,
  noStake,
  policy,
  onClick,
  noConsensus,
}: {
  question: string;
  category: string;
  status: string;
  yesStake: string;
  noStake: string;
  policy: string;
  onClick?: () => void;
  noConsensus?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-5 rounded-lg border transition-all hover:border-opacity-40 group"
      style={{ background: C.panel, borderColor: C.hairline }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-base font-semibold leading-snug flex-1 transition-colors" style={{ ...fontBody, color: C.chalk }}>
          {question}
        </p>
        <ChevronRight size={14} className="mt-0.5 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" style={{ color: C.muted }} />
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <CategoryTag cat={category} />
        <StatusChip status={status} />
      </div>

      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ ...fontBody, color: C.muted }}>YES</span>
          <span className="text-xs font-medium" style={{ ...fontBody, color: C.green }}>{yesStake} test USDt</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ ...fontBody, color: C.muted }}>NO</span>
          <span className="text-xs font-medium" style={{ ...fontBody, color: C.red }}>{noStake} test USDt</span>
        </div>
      </div>

      <div className="text-xs" style={{ ...fontMono, color: C.muted }}>{policy}</div>

      {noConsensus && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: C.hairline }}>
          <div className="text-xs mb-1.5" style={{ ...fontBody, color: C.amber }}>No consensus — fallback: Tiebreaker LLM</div>
          <div className="flex items-center gap-1.5 text-xs" style={{ ...fontBody, color: C.muted }}>
            <ShieldQuestion size={11} style={{ color: C.amber }} />
            Tiebreaker Oracle judges the locked evidence bundle
          </div>
        </div>
      )}
    </button>
  );
}

// ─── Oracle card ──────────────────────────────────────────────────────────────
function OracleCard({
  name,
  icon: Icon,
  verdict,
  confidence,
  reason,
  state,
  delay,
  model,
}: {
  name: string;
  icon: React.ElementType;
  verdict: "YES" | "NO" | "INSUFFICIENT_EVIDENCE";
  confidence: number;
  reason: string;
  state: OracleState;
  delay: number;
  model?: string;
}) {
  const verdictColor = verdict === "YES" ? C.green : verdict === "NO" ? C.red : C.amber;
  const verdictLabel = verdict === "YES" ? "YES" : verdict === "NO" ? "NO" : "INSUFFICIENT";

  return (
    <div
      className="p-5 rounded-lg border flex flex-col gap-3 relative overflow-hidden"
      style={{ background: C.panel, borderColor: state === "revealed" ? verdictColor + "44" : C.hairline }}
    >
      {/* shimmer overlay while analyzing */}
      {state === "analyzing" && (
        <div
          className="absolute inset-0 animate-pulse rounded-lg"
          style={{ background: "rgba(30,122,70,0.04)" }}
        />
      )}

      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: C.panel2 }}
        >
          <Icon size={15} style={{ color: state === "revealed" ? verdictColor : C.muted }} />
        </div>
        <div>
          <div className="text-base font-semibold" style={{ ...fontBody, color: C.chalk }}>
            {name}
            {model && (
              <span className="ml-2 text-xs font-normal" style={{ ...fontMono, color: C.muted }}>
                {model}
              </span>
            )}
          </div>
          {state === "idle" && <div className="text-sm" style={{ ...fontBody, color: C.muted }}>Waiting</div>}
          {state === "analyzing" && (
            <div className="text-sm flex items-center gap-1" style={{ ...fontBody, color: C.amber }}>
              <span className="animate-pulse">Analyzing evidence…</span>
            </div>
          )}
        </div>
        {state === "revealed" && (
          <motion.div
            initial={{ scale: 1.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay, duration: 0.3, type: "spring" }}
            className="ml-auto"
          >
            <span
              className="font-bold px-3 py-1.5 rounded"
              style={{ ...fontCondensed, color: verdictColor, background: verdictColor + "18", fontSize: 26, letterSpacing: 1 }}
            >
              {verdictLabel}
            </span>
          </motion.div>
        )}
      </div>

      {state === "revealed" && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: delay + 0.15 }}
        >
          {/* Confidence bar — visually secondary */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs" style={{ ...fontBody, color: C.muted }}>Confidence</span>
            <div className="flex-1 h-1 rounded-full" style={{ background: C.panel2 }}>
              <div
                className="h-1 rounded-full transition-all"
                style={{ width: `${confidence}%`, background: verdictColor + "88" }}
              />
            </div>
            <span className="text-xs" style={{ ...fontMono, color: C.muted }}>{confidence}%</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ ...fontBody, color: C.muted }}>{reason}</p>
        </motion.div>
      )}
    </div>
  );
}

// ─── Landing screen ───────────────────────────────────────────────────────────
function LandingScreen({
  onNav,
  onCreateRoom,
  onJoinRoom,
  identity,
}: {
  onNav: (s: Screen) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  identity: LocalIdentity;
}) {
  const [walletConnected, setWalletConnected] = useState(false);
  return (
    <div className="flex flex-col" style={{ background: C.bg }}>

      {/* ── Nav ── */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-20 py-5 border-b"
        style={{ background: C.panel, borderColor: C.hairline, borderLeftWidth: 4, borderLeftColor: C.green }}
      >
        <span style={{ ...fontCondensed, color: C.green, fontSize: 26, letterSpacing: 1 }}>
          KICKOFF ORACLE
        </span>
        <div className="flex items-center gap-4">
          <span
            className="px-3 py-1 rounded text-sm font-semibold border"
            style={{ ...fontBody, color: C.amber, borderColor: C.amber + "66", background: "rgba(212,160,23,0.08)" }}
          >
            TESTNET USDt
          </span>
          {walletConnected ? (
            <div
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ ...fontBody, background: "rgba(0,122,122,0.12)", color: C.teal, border: `1px solid ${C.teal}44` }}
            >
              <Wallet size={14} />
              {identity.displayName} · {shortWallet(identity.wallet)}
              {identity.source === "wdk" && (
                <span
                  className="ml-1 px-1.5 py-0.5 rounded text-xs font-semibold"
                  style={{ ...fontBody, background: "rgba(0,122,122,0.15)", color: C.teal }}
                >
                  WDK · Sepolia
                </span>
              )}
            </div>
          ) : (
            <button
              onClick={() => setWalletConnected(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold border transition-all hover:opacity-80"
              style={{ ...fontBody, background: "transparent", color: C.teal, border: `1.5px solid ${C.teal}55` }}
            >
              <Wallet size={14} />
              Log in with wallet
            </button>
          )}
          <button
            onClick={onJoinRoom}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold border transition-all hover:opacity-80"
            style={{ ...fontBody, background: "transparent", color: C.chalk, border: `1.5px solid ${C.hairline}` }}
          >
            Join with invite key
          </button>
          <button
            onClick={onCreateRoom}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
            style={{ ...fontBody, background: C.green, color: "#fff" }}
          >
            Create a room
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section
        className="px-20 py-24 flex flex-col items-center text-center border-b"
        style={{ background: C.panel, borderColor: C.hairline }}
      >
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex flex-col items-center">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-8 border"
            style={{ ...fontBody, color: C.green, borderColor: C.green + "55", background: "rgba(30,122,70,0.07)" }}
          >
            <Wifi size={13} />
            Serverless · P2P · Evidence-driven · No real-money stakes
          </div>

          <h1
            className="leading-none mb-6"
            style={{ ...fontCondensed, fontSize: 120, color: C.chalk, letterSpacing: -3 }}
          >
            Kickoff <span style={{ color: C.green }}>Oracle</span>
          </h1>

          <p className="max-w-2xl mb-10" style={{ ...fontBody, color: C.muted, lineHeight: 1.7, fontSize: 20 }}>
            A private football prediction room where live match evidence is reviewed by a committee of local AI oracles.
            A market resolves only when a threshold is reached — for example, 2 of 3 oracles agreeing.
          </p>

          <div className="flex items-center gap-4 mb-16">
            <button
              onClick={onCreateRoom}
              className="flex items-center gap-2 px-10 py-4 rounded-xl font-semibold text-lg transition-all hover:opacity-90 active:scale-95"
              style={{ ...fontBody, background: C.green, color: "#fff" }}
            >
              Create a room
              <ArrowRight size={18} />
            </button>
            <button
              onClick={onJoinRoom}
              className="flex items-center gap-2 px-10 py-4 rounded-xl font-semibold text-lg border transition-all hover:opacity-80"
              style={{ ...fontBody, color: C.chalk, borderColor: C.hairline, background: C.bg }}
            >
              Join with invite key
            </button>
          </div>

          {/* Live stats strip */}
          <div className="flex items-center gap-8">
            {[
              { value: "N-of-M", label: "You pick the threshold" },
              { value: "1–5", label: "Oracles per room" },
              { value: "Test USDt", label: "Testnet stakes only" },
              { value: "P2P", label: "No central server" },
            ].map(({ value, label }, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span style={{ ...fontCondensed, fontSize: 28, color: C.green }}>{value}</span>
                <span className="text-sm" style={{ ...fontBody, color: C.muted }}>{label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── How it works ── */}
      <section className="px-20 py-20 border-b" style={{ borderColor: C.hairline }}>
        <div className="mb-12">
          <p className="text-sm font-semibold uppercase tracking-widest mb-2" style={{ ...fontBody, color: C.green }}>How it works</p>
          <h2 className="leading-tight" style={{ ...fontCondensed, fontSize: 56, color: C.chalk }}>
            Evidence in. Consensus out.
          </h2>
        </div>

        <div className="grid grid-cols-4 gap-6">
          {[
            {
              step: "01",
              icon: Users,
              title: "Create a room",
              body: "Start a private watch-party room and set its resolution policy — oracle committee, LLM per oracle, threshold, and fallback. Share the invite key with friends; everyone joins with a demo USDt balance — no real money involved.",
            },
            {
              step: "02",
              icon: Eye,
              title: "Build the evidence",
              body: "The room host records match events — goals, VAR decisions, red cards — on the shared evidence timeline, then locks a tamper-proof evidence bundle (with optional notes and rulebook excerpts) for each market.",
            },
            {
              step: "03",
              icon: Gavel,
              title: "Oracles deliberate",
              body: "A committee of independent local AI oracles — you choose how many and the consensus threshold — each reviews the locked evidence bundle in its own inference run and issues a YES, NO, or INSUFFICIENT EVIDENCE verdict.",
            },
            {
              step: "04",
              icon: CheckCircle2,
              title: "Threshold resolves",
              body: "When the room's threshold is reached — say 2 of 3 oracles agreeing — the market resolves automatically. QVAC generates a plain-language explanation. The audit log records every hash for verification.",
            },
          ].map(({ step, icon: Icon, title, body }) => (
            <div
              key={step}
              className="p-7 rounded-xl border flex flex-col gap-4"
              style={{ background: C.panel, borderColor: C.hairline }}
            >
              <div className="flex items-center justify-between">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(30,122,70,0.1)" }}
                >
                  <Icon size={20} style={{ color: C.green }} />
                </div>
                <span style={{ ...fontCondensed, fontSize: 36, color: C.green + "30" }}>{step}</span>
              </div>
              <div>
                <h3 className="font-bold mb-2" style={{ ...fontCondensed, fontSize: 24, color: C.chalk }}>{title}</h3>
                <p className="leading-relaxed" style={{ ...fontBody, color: C.muted, fontSize: 15 }}>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Market types ── */}
      <section className="px-20 py-20 border-b" style={{ borderColor: C.hairline, background: C.panel }}>
        <div className="grid grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest mb-2" style={{ ...fontBody, color: C.green }}>Market types</p>
            <h2 className="leading-tight mb-6" style={{ ...fontCondensed, fontSize: 52, color: C.chalk }}>
              Two categories, one system
            </h2>
            <p className="leading-relaxed mb-8" style={{ ...fontBody, color: C.muted, fontSize: 17, lineHeight: 1.7 }}>
              Markets are tagged by how they resolve. Objective questions settle on facts alone.
              Interpretive questions require oracle reasoning.
            </p>
            <div className="flex flex-col gap-3">
              {[
                { cat: "Objective", example: "Did Spain score before 80'?", note: "Settled by feed event match" },
                { cat: "Interpretive", example: "Was the penalty decision correct?", note: "Requires oracle reasoning" },
              ].map(({ cat, example, note }) => (
                <div key={cat} className="flex items-start gap-4 p-4 rounded-xl border" style={{ borderColor: C.hairline, background: C.bg }}>
                  <CategoryTag cat={cat} />
                  <div>
                    <div className="font-semibold text-sm mb-0.5" style={{ ...fontBody, color: C.chalk }}>{example}</div>
                    <div className="text-sm" style={{ ...fontBody, color: C.muted }}>{note}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Oracle committee preview */}
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold uppercase tracking-widest mb-2" style={{ ...fontBody, color: C.muted }}>Oracle committee</p>
            {[
              { name: "Oracle 1", icon: Gavel, verdict: "YES", confidence: 86, reason: "The recorded contact in the box plus the VAR confirmation support the decision." },
              { name: "Oracle 2", icon: Gavel, verdict: "YES", confidence: 82, reason: "The feed confirms a penalty was awarded and VAR upheld the decision." },
              { name: "Oracle 3", icon: Gavel, verdict: "NO", confidence: 58, reason: "Without video, the severity of the contact cannot be verified from this evidence." },
            ].map(({ name, icon: Icon, verdict, confidence, reason }) => {
              const vc = verdict === "YES" ? C.green : C.red;
              return (
                <div key={name} className="p-5 rounded-xl border flex items-start gap-4" style={{ background: C.bg, borderColor: vc + "44" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: vc + "15" }}>
                    <Icon size={18} style={{ color: vc }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold" style={{ ...fontBody, color: C.chalk, fontSize: 15 }}>{name}</span>
                      <span className="font-bold px-2.5 py-0.5 rounded" style={{ ...fontCondensed, fontSize: 18, color: vc, background: vc + "15" }}>{verdict}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="flex-1 h-1.5 rounded-full" style={{ background: C.panel2 }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${confidence}%`, background: vc + "99" }} />
                      </div>
                      <span className="text-xs" style={{ ...fontMono, color: C.muted }}>{confidence}%</span>
                    </div>
                    <p className="text-sm leading-snug" style={{ ...fontBody, color: C.muted }}>{reason}</p>
                  </div>
                </div>
              );
            })}
            <div className="text-sm text-center mt-1" style={{ ...fontBody, color: C.muted }}>
              Runs locally via <span style={{ color: C.green, fontWeight: 600 }}>QVAC</span> — no data leaves your machine
            </div>
          </div>
        </div>
      </section>

      {/* ── Transparency & no-consensus ── */}
      <section className="px-20 py-20 border-b" style={{ borderColor: C.hairline }}>
        <div className="grid grid-cols-3 gap-8">
          <div className="p-8 rounded-xl border flex flex-col gap-4" style={{ background: C.panel, borderColor: C.hairline }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(30,122,70,0.1)" }}>
              <Lock size={22} style={{ color: C.green }} />
            </div>
            <h3 className="font-bold" style={{ ...fontCondensed, fontSize: 26, color: C.chalk }}>Evidence locked before voting</h3>
            <p className="leading-relaxed" style={{ ...fontBody, color: C.muted, fontSize: 15, lineHeight: 1.7 }}>
              The evidence bundle is hashed and locked before any oracle sees it. No oracle can be retried with different evidence after a verdict is issued. Every hash is visible in the audit log.
            </p>
          </div>
          <div className="p-8 rounded-xl border flex flex-col gap-4" style={{ background: C.panel, borderColor: C.hairline }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(212,160,23,0.1)" }}>
              <AlertTriangle size={22} style={{ color: C.amber }} />
            </div>
            <h3 className="font-bold" style={{ ...fontCondensed, fontSize: 26, color: C.chalk }}>No consensus? Facts or tiebreaker LLM.</h3>
            <p className="leading-relaxed" style={{ ...fontBody, color: C.muted, fontSize: 15, lineHeight: 1.7 }}>
              When oracles split — one YES, one NO, one INSUFFICIENT — the system does not force a resolution. It falls back to the room policy: re-check the question against objective feed facts, or hand the same locked evidence to a dedicated tiebreaker LLM chosen by the room creator.
            </p>
            <div className="p-4 rounded-lg border mt-auto" style={{ background: C.bg, borderColor: C.hairline }}>
              <div className="text-sm font-semibold mb-2" style={{ ...fontBody, color: C.chalk }}>Was the red card deserved?</div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs px-2 py-0.5 rounded" style={{ ...fontBody, background: "rgba(30,122,70,0.1)", color: C.green }}>YES</span>
                <span className="text-xs px-2 py-0.5 rounded" style={{ ...fontBody, background: "rgba(212,160,23,0.1)", color: C.amber }}>INSUFFICIENT</span>
                <span className="text-xs px-2 py-0.5 rounded" style={{ ...fontBody, background: "rgba(201,53,53,0.1)", color: C.red }}>NO</span>
              </div>
              <div className="text-xs mb-2" style={{ ...fontBody, color: C.amber }}>No consensus — fallback: Tiebreaker LLM</div>
              <div className="flex items-center gap-1.5 text-xs" style={{ ...fontBody, color: C.muted }}>
                <ShieldQuestion size={12} style={{ color: C.amber }} />
                Tiebreaker Oracle judges the same locked evidence bundle
              </div>
            </div>
          </div>
          <div className="p-8 rounded-xl border flex flex-col gap-4" style={{ background: C.panel, borderColor: C.hairline }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,122,122,0.1)" }}>
              <FileText size={22} style={{ color: C.teal }} />
            </div>
            <h3 className="font-bold" style={{ ...fontCondensed, fontSize: 26, color: C.chalk }}>Full audit trail</h3>
            <p className="leading-relaxed" style={{ ...fontBody, color: C.muted, fontSize: 15, lineHeight: 1.7 }}>
              Every resolution produces a verifiable audit log with evidence hash, oracle vote hash, threshold, outcome, and timestamp — formatted like a match official's record.
            </p>
            <div className="p-4 rounded-lg border mt-auto" style={{ background: C.bg, borderColor: C.hairline }}>
              {[
                ["Evidence hash", "hash_evidence_penalty_001"],
                ["Threshold", "2_of_3"],
                ["Outcome", "YES"],
                ["Mode", "TEST_USDT"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3 py-1 border-b last:border-b-0" style={{ borderColor: C.hairline }}>
                  <span className="text-xs w-28 shrink-0" style={{ ...fontMono, color: C.muted }}>{k}</span>
                  <span className="text-xs" style={{ ...fontMono, color: C.chalk }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA footer ── */}
      <section className="px-20 py-24 flex flex-col items-center text-center" style={{ background: C.green }}>
        <h2 className="leading-tight mb-4" style={{ ...fontCondensed, fontSize: 64, color: "#fff" }}>
          Ready to run your first oracle?
        </h2>
        <p className="max-w-xl mb-10" style={{ ...fontBody, color: "rgba(255,255,255,0.75)", fontSize: 18, lineHeight: 1.6 }}>
          Create a room, invite friends, emit match events, and watch three AI oracles deliberate in real time. No real money. No server. Just evidence and consensus.
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={onCreateRoom}
            className="flex items-center gap-2 px-10 py-4 rounded-xl font-semibold text-lg transition-all hover:opacity-90 active:scale-95"
            style={{ ...fontBody, background: "#fff", color: C.green }}
          >
            Create a room
            <ArrowRight size={18} />
          </button>
          <button
            onClick={onJoinRoom}
            className="flex items-center gap-2 px-10 py-4 rounded-xl font-semibold text-lg border border-white/30 transition-all hover:bg-white/10"
            style={{ ...fontBody, color: "#fff" }}
          >
            Join with invite key
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Room home screen ─────────────────────────────────────────────────────────
function RoomScreen({
  onNav,
  view,
  me,
  onCreateMarket,
  onSelectMarket,
  onLeave,
}: {
  onNav: (s: Screen) => void;
  view: RoomView;
  me: string;
  onCreateMarket: () => void;
  onSelectMarket: (id: string) => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const room = view.room!;
  const copyKey = () => {
    navigator.clipboard.writeText(room.inviteKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex-1 flex flex-col" style={{ background: C.bg }}>
      <TopBar
        minute={liveMinute(view)}
        onNav={onNav}
        roomName={room.name}
        balance={formatUSDt(view.balances[me] ?? 0n)}
        initials={view.participants.map((p) => p.displayName.charAt(0))}
      />

      <div className="flex-1 flex gap-6 px-8 py-6">
        {/* Main */}
        <div className="flex-1 flex flex-col gap-5">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold" style={{ ...fontCondensed, color: C.chalk, fontSize: 36 }}>
                {room.name}
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs" style={{ ...fontBody, color: C.muted }}>
                  {view.participants.length} participants
                </span>
                <span className="text-xs" style={{ ...fontMono, color: C.muted }}>
                  Invite key:{" "}
                  <span style={{ color: C.chalk }}>{room.inviteKey}</span>
                </span>
                <button onClick={copyKey} className="p-1 rounded hover:bg-white/5 transition-colors">
                  {copied ? <Check size={12} style={{ color: C.green }} /> : <Copy size={12} style={{ color: C.muted }} />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onLeave}
                className="px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:opacity-80"
                style={{ ...fontBody, color: C.muted, borderColor: C.hairline, background: "transparent" }}
              >
                Leave room
              </button>
              <button
                onClick={onCreateMarket}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                style={{ ...fontBody, background: C.green, color: "#fff" }}
              >
                Create market
              </button>
            </div>
          </div>

          {/* Room resolution policy — set once by the room creator, applies to every market */}
          <div
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg border"
            style={{ background: C.panel, borderColor: C.hairline }}
          >
            <span className="text-xs uppercase tracking-widest shrink-0" style={{ ...fontBody, color: C.muted }}>
              Room resolution policy
            </span>
            <span className="text-xs" style={{ ...fontMono, color: C.chalk }}>
              {room.policy.threshold}-of-{room.policy.committee.length} threshold ·{" "}
              {committeeSummary(room.policy.committee)} · Fallback:{" "}
              {room.policy.fallback.kind === "FACTS" ? "Facts" : `Tiebreaker LLM (${room.policy.fallback.model})`}
            </span>
            <span className="ml-auto text-xs shrink-0" style={{ ...fontBody, color: C.muted }}>
              Set by room creator
            </span>
          </div>

          {/* Market grid — or the empty state for a fresh room (UC-01 alt flow) */}
          {view.markets.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-4 p-12 rounded-lg border"
              style={{ background: C.panel, borderColor: C.hairline }}
            >
              <p style={{ ...fontBody, color: C.muted }}>
                No markets yet — create the first one for this match.
              </p>
              <button
                onClick={onCreateMarket}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
                style={{ ...fontBody, background: C.green, color: "#fff" }}
              >
                Create market
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {view.markets.map((m) => (
                <MarketCard
                  key={m.id}
                  question={m.question}
                  category={CATEGORY_LABEL[m.category] ?? m.category}
                  status={STATUS_LABEL[m.status] ?? m.status}
                  yesStake={formatUSDt(stakeTotal(m, "YES"))}
                  noStake={formatUSDt(stakeTotal(m, "NO"))}
                  policy={policyLabel(view)}
                  onClick={() => onSelectMarket(m.id)}
                  noConsensus={m.status === "NO_CONSENSUS"}
                />
              ))}
            </div>
          )}
        </div>

        {/* Timeline sidebar */}
        <EvidenceTimeline events={view.timeline} />
      </div>
    </div>
  );
}

// ─── Stake controls (UC-04) ───────────────────────────────────────────────────
function StakeControls({
  balance,
  onStake,
}: {
  balance: bigint;
  onStake: (side: Side, amount: bigint) => void;
}) {
  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const whole = Math.floor(Number(amount));
    if (!Number.isFinite(whole) || whole <= 0) {
      setError("Enter a positive whole amount of test USDt.");
      return;
    }
    const minor = BigInt(whole) * 100n;
    if (minor > balance) {
      setError(`Insufficient balance — you have ${formatUSDt(balance)} test USDt.`);
      return;
    }
    onStake(side, minor);
    setAmount("");
    setError(null);
  };

  return (
    <div className="mt-4 pt-4 border-t" style={{ borderColor: C.hairline }}>
      <div className="flex items-center gap-2">
        {(["YES", "NO"] as Side[]).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className="px-4 py-2 rounded-lg text-sm font-bold border transition-all"
            style={{
              ...fontBody,
              background: side === s ? (s === "YES" ? C.green : C.red) : "transparent",
              color: side === s ? "#fff" : s === "YES" ? C.green : C.red,
              borderColor: s === "YES" ? C.green + "77" : C.red + "77",
            }}
          >
            {s}
          </button>
        ))}
        <input
          type="number"
          min={1}
          step={1}
          placeholder="Amount"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-28 px-3 py-2 rounded-lg text-sm outline-none"
          style={{ ...fontBody, background: C.bg, border: `1px solid ${C.hairline}`, color: C.chalk }}
        />
        <button
          onClick={submit}
          className="px-5 py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
          style={{ ...fontBody, background: C.teal, color: "#fff" }}
        >
          Stake
        </button>
        <span className="ml-auto text-xs" style={{ ...fontBody, color: C.muted }}>
          Balance: {formatUSDt(balance)} test USDt
        </span>
      </div>
      {error && (
        <p className="text-xs mt-2" style={{ ...fontBody, color: C.red }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Market detail screen ─────────────────────────────────────────────────────
function MarketScreen({
  onNav,
  view,
  me,
  marketId,
  oracleOnline,
  onCloseStaking,
  onLockBundle,
  onRun,
  onRunFallback,
  onStake,
}: {
  onNav: (s: Screen) => void;
  view: RoomView;
  me: string;
  marketId: string;
  oracleOnline: boolean;
  onCloseStaking: () => void;
  onLockBundle: () => void;
  onRun: () => void;
  onRunFallback: () => void;
  onStake: (side: Side, amount: bigint) => void;
}) {
  const room = view.room!;
  const market = view.markets.find((m) => m.id === marketId);

  if (!market) {
    return (
      <div className="flex-1 flex flex-col" style={{ background: C.bg }}>
        <TopBar
          minute={liveMinute(view)}
          onNav={onNav}
          roomName={room.name}
          balance={formatUSDt(view.balances[me] ?? 0n)}
          initials={view.participants.map((p) => p.displayName.charAt(0))}
        />
        <div className="flex-1 flex items-center justify-center">
          <div
            className="p-8 rounded-lg border text-center max-w-md"
            style={{ background: C.panel, borderColor: C.hairline }}
          >
            <p className="mb-4" style={{ ...fontBody, color: C.chalk }}>
              No market selected — pick one from the room grid.
            </p>
            <button
              onClick={() => onNav("room")}
              className="px-6 py-2.5 rounded-lg text-sm font-medium"
              style={{ ...fontBody, background: C.green, color: "#fff" }}
            >
              Back to room
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isCreator = room.creator === me;
  const running = view.runningOracles.includes(market.id);
  const done = market.resolution != null;
  const committee = room.policy.committee;
  const committeeVerdicts = market.verdicts.filter((v) => v.oracle !== "TIEBREAKER");
  const canRun =
    market.status === "RESOLVING" && market.bundle != null && !running && !done && oracleOnline;
  const idleHint = !oracleOnline
    ? "Oracle node offline — start the sidecar to run oracles"
    : market.status === "OPEN"
      ? "Close staking, then attach evidence to enable the oracles"
      : market.status === "AWAITING_EVIDENCE"
        ? "Attach evidence and lock the bundle to enable the oracles"
        : !market.bundle
          ? "Lock an evidence bundle to enable the oracles"
          : "Run oracles to see consensus";

  return (
    <div className="flex-1 flex flex-col" style={{ background: C.bg }}>
      <TopBar
        minute={liveMinute(view)}
        onNav={onNav}
        roomName={room.name}
        balance={formatUSDt(view.balances[me] ?? 0n)}
        initials={view.participants.map((p) => p.displayName.charAt(0))}
      />

      <div className="flex-1 flex gap-6 px-8 py-6">
        {/* Main */}
        <div className="flex-1 flex flex-col gap-5 min-w-0">
          {/* Question header */}
          <div
            className="p-6 rounded-lg border"
            style={{ background: C.panel, borderColor: C.hairline }}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <h1
                className="font-bold leading-tight flex-1"
                style={{ ...fontCondensed, color: C.chalk, fontSize: 42 }}
              >
                {market.question}
              </h1>
              <StatusChip status={STATUS_LABEL[market.status] ?? market.status} />
            </div>
            <div className="flex items-center gap-3">
              <CategoryTag cat={CATEGORY_LABEL[market.category] ?? market.category} />
              <span
                className="text-xs px-2.5 py-1 rounded border"
                style={{ ...fontMono, color: C.muted, borderColor: C.hairline }}
              >
                Room policy: {policyLabel(view)}
              </span>
              {isCreator && market.status === "OPEN" && (
                <button
                  onClick={onCloseStaking}
                  className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                  style={{ ...fontBody, color: C.amber, borderColor: C.amber + "66", background: "rgba(212,160,23,0.08)" }}
                >
                  Close staking
                </button>
              )}
            </div>
          </div>

          {/* Stake panel */}
          <div
            className="p-5 rounded-lg border"
            style={{ background: C.panel, borderColor: `${C.teal}44` }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Wallet size={13} style={{ color: C.teal }} />
              <span className="text-xs font-medium" style={{ ...fontBody, color: C.teal }}>Mode: Test USDt</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs mb-2" style={{ ...fontBody, color: C.muted }}>YES stakes</div>
                <div className="flex flex-col gap-1">
                  {market.stakes.filter((s) => s.side === "YES").map((s) => (
                    <div key={s.wallet} className="flex items-center justify-between text-sm">
                      <span style={{ ...fontBody, color: C.chalk }}>{nameOf(view, s.wallet)}</span>
                      <span style={{ ...fontBody, color: C.green }}>{formatUSDt(s.amount)} test USDt</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs mb-2" style={{ ...fontBody, color: C.muted }}>NO stakes</div>
                <div className="flex flex-col gap-1">
                  {market.stakes.filter((s) => s.side === "NO").map((s) => (
                    <div key={s.wallet} className="flex items-center justify-between text-sm">
                      <span style={{ ...fontBody, color: C.chalk }}>{nameOf(view, s.wallet)}</span>
                      <span style={{ ...fontBody, color: C.red }}>{formatUSDt(s.amount)} test USDt</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end justify-center">
                <div className="text-xs mb-1" style={{ ...fontBody, color: C.muted }}>Total pot</div>
                <div className="text-2xl font-bold" style={{ ...fontCondensed, color: C.teal, fontSize: 28 }}>
                  {formatUSDt(stakeTotal(market, "YES") + stakeTotal(market, "NO"))} test USDt
                </div>
              </div>
            </div>

            {market.status === "OPEN" && (
              <StakeControls balance={view.balances[me] ?? 0n} onStake={onStake} />
            )}
          </div>

          {/* Three-column panels */}
          <div className="grid grid-cols-3 gap-4">
            {/* A. Evidence bundle */}
            <div className="p-5 rounded-lg border flex flex-col gap-3" style={{ background: C.panel, borderColor: C.hairline }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ ...fontBody, color: C.chalk }}>Evidence bundle</span>
                <Lock size={12} style={{ color: C.amber }} />
              </div>
              <div className="text-xs break-all" style={{ ...fontMono, color: C.muted }}>
                {market.bundle
                  ? `Status: LOCKED · v${market.bundle.version} · hash: ${shortHash(market.bundle.hash)}`
                  : "Status: PENDING — assembles when evidence arrives"}
              </div>

              {(market.bundle?.items ?? []).map(({ weight, kind, content, author }) => (
                <div key={weight} className="p-3 rounded border" style={{ background: C.panel2, borderColor: C.hairline }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        ...fontMono,
                        fontSize: 10,
                        background: weight === "PRIMARY" ? "rgba(47,158,99,0.18)" : weight === "SECONDARY" ? "rgba(228,182,60,0.15)" : "rgba(138,148,140,0.15)",
                        color: weight === "PRIMARY" ? C.green : weight === "SECONDARY" ? C.amber : C.muted,
                      }}
                    >
                      {weight}
                    </span>
                    <span className="text-xs" style={{ ...fontBody, color: C.muted }}>
                      {kind === "FEED_EVENT"
                        ? "Replay feed"
                        : kind === "MANUAL_NOTE"
                          ? `Manual note · ${author ? nameOf(view, author) : "Room creator"}`
                          : "Rulebook excerpt"}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ ...fontBody, color: C.chalk }}>{content}</p>
                </div>
              ))}

              {market.bundle ? (
                <div className="flex items-center gap-1.5 text-xs" style={{ ...fontBody, color: C.muted }}>
                  <Lock size={10} style={{ color: C.amber }} />
                  Evidence locked before voting
                </div>
              ) : (
                <>
                  <p className="text-xs leading-relaxed" style={{ ...fontBody, color: C.muted }}>
                    The room creator assembles the bundle from timeline events, notes, and
                    rulebook excerpts. It is hashed and locked before any oracle sees it.
                  </p>
                  {isCreator && market.status === "AWAITING_EVIDENCE" && (
                    <button
                      onClick={onLockBundle}
                      className="w-full py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
                      style={{ ...fontBody, background: C.green, color: "#fff" }}
                    >
                      Attach evidence & lock bundle
                    </button>
                  )}
                  {isCreator && market.status === "OPEN" && (
                    <p className="text-xs" style={{ ...fontBody, color: C.muted }}>
                      Close staking first (button in the header), then attach evidence here.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* B. Oracle committee */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ ...fontBody, color: C.chalk }}>Oracle committee</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onRun}
                    disabled={!canRun}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all"
                    style={{
                      ...fontBody,
                      background: !canRun ? C.panel2 : C.green,
                      color: done ? C.green : running ? C.amber : !canRun ? C.muted : "#fff",
                      cursor: !canRun ? "default" : "pointer",
                    }}
                  >
                    {done ? (
                      <>
                        <Check size={10} />
                        Oracles revealed
                      </>
                    ) : running ? (
                      <>
                        <span className="animate-spin inline-block w-2 h-2 border border-amber-400 rounded-full border-t-transparent" />
                        Running…
                      </>
                    ) : (
                      <>
                        <Play size={10} />
                        Run oracles
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {committee.map((cfg, i) => {
                  const verdict = committeeVerdicts.find((v) => v.oracle === cfg.id);
                  const state: OracleState = verdict ? "revealed" : running ? "analyzing" : "idle";
                  return (
                    <OracleCard
                      key={cfg.id}
                      name={`Oracle ${i + 1}`}
                      icon={Gavel}
                      verdict={verdict?.verdict ?? "INSUFFICIENT_EVIDENCE"}
                      confidence={verdict?.confidence ?? 0}
                      reason={verdict?.reason ?? ""}
                      state={state}
                      delay={i * 0.15}
                      model={verdict?.model ?? cfg.model}
                    />
                  );
                })}
              </div>

              <div className="text-xs text-center" style={{ ...fontBody, color: C.muted }}>
                {view.oracleRuntime}
              </div>
            </div>

            {/* C. Consensus result */}
            <div className="p-5 rounded-lg border flex flex-col gap-4" style={{ background: C.panel, borderColor: C.hairline }}>
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ ...fontBody, color: C.chalk }}>Consensus result</span>

              {/* Threshold meter */}
              <div className="flex flex-col gap-3">
                <div className="text-xs" style={{ ...fontBody, color: C.muted }}>
                  Threshold: {room.policy.threshold} of {committee.length}
                </div>
                <div className="flex items-center gap-2">
                  {committee.map((cfg, i) => {
                    const v = committeeVerdicts[i];
                    const color = !v ? null : v.verdict === "YES" ? C.green : v.verdict === "NO" ? C.red : C.amber;
                    return (
                      <motion.div
                        key={cfg.id}
                        className="flex-1 h-10 rounded flex items-center justify-center"
                        style={{
                          background: color ? color + "33" : C.panel2,
                          border: `2px solid ${color ?? C.hairline}`,
                        }}
                        animate={v ? { scale: [1, 1.04, 1] } : {}}
                        transition={{ delay: i * 0.2 }}
                      >
                        {v && (
                          <span style={{ ...fontCondensed, color: color!, fontSize: 20, fontWeight: 700 }}>
                            {v.verdict === "INSUFFICIENT_EVIDENCE" ? "INSUFF" : v.verdict}
                          </span>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {done && market.resolution!.via === "CONSENSUS" && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center"
                  >
                    <div className="font-bold" style={{ ...fontCondensed, color: C.green, fontSize: 28 }}>
                      {room.policy.threshold} OF {committee.length} REACHED
                    </div>
                  </motion.div>
                )}
              </div>

              {done && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-4 rounded-lg"
                  style={{ background: "rgba(47,158,99,0.12)", border: `1px solid ${C.green}55` }}
                >
                  <div className="text-lg font-bold mb-1" style={{ ...fontCondensed, color: C.green, fontSize: 22 }}>
                    Market resolved: {market.resolution!.outcome}
                  </div>
                  <div className="text-xs" style={{ ...fontBody, color: C.muted }}>
                    YES votes: {market.resolution!.counts.yes} · NO votes: {market.resolution!.counts.no} ·
                    Insufficient: {market.resolution!.counts.insufficient}
                  </div>
                </motion.div>
              )}

              {market.status === "NO_CONSENSUS" && (
                <div
                  className="p-4 rounded-lg"
                  style={{ background: "rgba(212,160,23,0.1)", border: `1px solid ${C.amber}55` }}
                >
                  <div className="font-bold mb-1" style={{ ...fontCondensed, color: C.amber, fontSize: 20 }}>
                    No consensus — fallback:{" "}
                    {room.policy.fallback.kind === "FACTS" ? "Facts" : "Tiebreaker LLM"}
                  </div>
                  <p className="text-xs mb-3" style={{ ...fontBody, color: C.muted }}>
                    {room.policy.fallback.kind === "FACTS"
                      ? "The question is re-checked against objective feed data only."
                      : "A separate tiebreaker oracle judges the same locked evidence bundle."}
                  </p>
                  <button
                    onClick={onRunFallback}
                    disabled={running}
                    className="w-full py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                    style={{
                      ...fontBody,
                      background: running ? C.panel2 : C.amber,
                      color: running ? C.muted : "#fff",
                      cursor: running ? "default" : "pointer",
                    }}
                  >
                    {running ? "Tiebreaker analyzing…" : "Run fallback"}
                  </button>
                </div>
              )}

              {market.status === "CANCELLED" && (
                <div
                  className="p-4 rounded-lg"
                  style={{ background: "rgba(107,123,110,0.1)", border: `1px solid ${C.muted}55` }}
                >
                  <div className="text-sm font-bold mb-1" style={{ ...fontBody, color: C.muted }}>
                    Market cancelled — stakes refunded
                  </div>
                  {market.cancelReason && (
                    <div className="text-xs" style={{ ...fontBody, color: C.muted }}>
                      {market.cancelReason}
                    </div>
                  )}
                </div>
              )}

              {done && market.settlement && (
                <button
                  onClick={() => onNav("settlement")}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                  style={{ ...fontBody, background: C.teal, color: "#fff" }}
                >
                  View settlement
                  <ArrowRight size={14} />
                </button>
              )}

              {!done && market.status !== "NO_CONSENSUS" && market.status !== "CANCELLED" && (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8">
                  <Circle size={32} style={{ color: C.panel2 }} />
                  <p className="text-xs text-center" style={{ ...fontBody, color: C.muted }}>
                    {idleHint}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <EvidenceTimeline events={view.timeline} />
      </div>
    </div>
  );
}

// ─── Settlement screen ────────────────────────────────────────────────────────
function SettlementScreen({
  onNav,
  view,
  me,
  marketId,
  audit,
}: {
  onNav: (s: Screen) => void;
  view: RoomView;
  me: string;
  marketId: string;
  audit: AuditEntry[];
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const room = view.room!;
  const market = view.markets.find((m) => m.id === marketId);
  const settlement = market?.settlement;

  return (
    <div className="flex-1 flex flex-col" style={{ background: C.bg }}>
      <TopBar
        minute={liveMinute(view)}
        onNav={onNav}
        roomName={room.name}
        balance={formatUSDt(view.balances[me] ?? 0n)}
        initials={view.participants.map((p) => p.displayName.charAt(0))}
      />

      {!settlement ? (
        <div className="flex-1 flex items-center justify-center">
          <div
            className="p-8 rounded-lg border text-center max-w-md"
            style={{ background: C.panel, borderColor: C.hairline }}
          >
            <p className="mb-4" style={{ ...fontBody, color: C.chalk }}>
              No settlement yet — the selected market has to resolve first (close staking,
              attach evidence, then run the oracles).
            </p>
            <button
              onClick={() => onNav("market")}
              className="px-6 py-2.5 rounded-lg text-sm font-medium"
              style={{ ...fontBody, background: C.green, color: "#fff" }}
            >
              Go to market
            </button>
          </div>
        </div>
      ) : (
      <div className="flex-1 px-20 py-10 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        {/* Settlement panel */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-lg border"
          style={{ background: C.panel, borderColor: `${C.teal}55` }}
        >
          <div className="flex items-center gap-2 mb-5">
            <Wallet size={16} style={{ color: C.teal }} />
            <span className="font-semibold" style={{ ...fontBody, color: C.teal }}>Settlement</span>
            <span className="ml-auto text-xs px-2 py-0.5 rounded border" style={{ ...fontBody, color: C.amber, borderColor: C.amber + "55" }}>
              Mode: Test USDt
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-5">
            <div>
              <div className="text-xs mb-1" style={{ ...fontBody, color: C.muted }}>Total pot</div>
              <div className="font-bold" style={{ ...fontCondensed, color: C.teal, fontSize: 44 }}>
                {formatUSDt(settlement.pot)} test USDt
              </div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ ...fontBody, color: C.muted }}>Winning side</div>
              <div className="text-3xl font-bold" style={{ ...fontCondensed, color: C.green, fontSize: 36 }}>
                {settlement.winningSide}
              </div>
            </div>
            <div className="flex items-end justify-end">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg" style={{ background: "rgba(47,158,99,0.15)", border: `1px solid ${C.green}55` }}>
                <Check size={16} style={{ color: C.green }} />
                <span className="font-semibold" style={{ ...fontBody, color: C.green }}>Settlement confirmed</span>
              </div>
            </div>
          </div>

          <div className="border-t pt-4" style={{ borderColor: C.hairline }}>
            <div className="text-xs mb-3" style={{ ...fontBody, color: C.muted }}>Payouts</div>
            <div className="flex flex-col gap-2">
              {settlement.payouts.map((p) => (
                <div key={p.wallet} className="flex items-center justify-between py-2 border-b last:border-b-0" style={{ borderColor: C.hairline }}>
                  <span style={{ ...fontBody, color: C.chalk }}>{nameOf(view, p.wallet)}</span>
                  <span className="font-medium" style={{ ...fontBody, color: C.teal }}>
                    receives {formatUSDt(p.amount)} test USDt
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* QVAC explanation */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-6 rounded-lg border relative"
          style={{ background: C.panel, borderColor: C.hairline }}
        >
          <div
            className="absolute left-0 top-6 bottom-6 w-0.5 rounded-r-full"
            style={{ background: C.green }}
          />
          <div className="pl-5">
            <p className="leading-relaxed mb-3" style={{ ...fontBody, color: C.chalk, lineHeight: 1.75, fontSize: 18 }}>
              "{settlement.explanation}"
            </p>
            <div className="flex items-center gap-1.5 text-xs" style={{ ...fontBody, color: C.muted }}>
              <Zap size={11} style={{ color: C.green }} />
              Generated locally by QVAC
            </div>
          </div>
        </motion.div>

        {/* Audit log */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-6 rounded-lg border"
          style={{ background: C.panel, borderColor: C.hairline }}
        >
          <div className="flex items-center gap-2 mb-4">
            <FileText size={14} style={{ color: C.muted }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ ...fontBody, color: C.muted }}>
              Audit log
            </span>
          </div>

          <div
            className="p-4 rounded border"
            style={{ background: C.bg, borderColor: C.hairline }}
          >
            {audit.map(({ key, value }) => (
              <div
                key={key}
                className="flex items-start py-1.5 border-b last:border-b-0 group"
                style={{ borderColor: C.hairline }}
              >
                <span className="w-36 text-xs shrink-0" style={{ ...fontMono, color: C.muted }}>{key}</span>
                <span className="text-xs flex-1" style={{ ...fontMono, color: C.chalk }}>
                  {value.length > 40 ? shortHash(value) : value}
                </span>
                <button
                  onClick={() => copy(key, value)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 ml-2"
                >
                  {copied === key ? (
                    <Check size={10} style={{ color: C.green }} />
                  ) : (
                    <Copy size={10} style={{ color: C.muted }} />
                  )}
                </button>
              </div>
            ))}
          </div>
        </motion.div>

        <div className="flex justify-center">
          <button
            onClick={() => onNav("room")}
            className="flex items-center gap-2 text-sm px-6 py-2.5 rounded-lg border transition-all hover:border-opacity-60"
            style={{ ...fontBody, color: C.muted, borderColor: C.hairline }}
          >
            Back to room
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────
// Static fallback when the sidecar (and its model catalog) is unreachable.
const FALLBACK_MODELS: QvacModelInfo[] = [
  { name: "Llama 3.2 1B", sizeMB: 770, loaded: false, downloading: null },
];

const inputClass = "w-full px-3 py-2 rounded-lg text-sm outline-none";
const inputStyle = { ...fontBody, background: C.bg, border: `1px solid ${C.hairline}`, color: C.chalk };

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: "rgba(26,43,30,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border shadow-lg p-6 max-h-[85vh] overflow-y-auto"
        style={{ background: C.panel, borderColor: C.hairline }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 style={{ ...fontCondensed, color: C.chalk, fontSize: 28 }}>{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70">
            <X size={16} style={{ color: C.muted }} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-widest mb-1.5" style={{ ...fontBody, color: C.muted }}>
      {children}
    </div>
  );
}

function ModelStatusBadge({
  info,
  online,
  onDownload,
}: {
  info?: QvacModelInfo;
  online: boolean;
  onDownload: () => void;
}) {
  if (!online || !info) return null;
  if (info.loaded) {
    return (
      <span className="text-xs font-semibold shrink-0" style={{ ...fontBody, color: C.green }}>
        ✓ Downloaded
      </span>
    );
  }
  if (info.downloading != null) {
    return (
      <span className="flex items-center gap-2 shrink-0">
        <span className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: C.panel2 }}>
          <span
            className="block h-1.5 rounded-full transition-all"
            style={{ width: `${info.downloading}%`, background: C.green }}
          />
        </span>
        <span className="text-xs" style={{ ...fontMono, color: C.muted }}>
          {info.downloading}%
        </span>
      </span>
    );
  }
  return (
    <button
      onClick={onDownload}
      className="px-3 py-1 rounded text-xs font-semibold shrink-0 transition-all hover:opacity-90"
      style={{ ...fontBody, background: C.teal, color: "#fff" }}
    >
      Download
    </button>
  );
}

/** One oracle slot: pick a model; download it inline if it's not local yet. */
function ModelSlotRow({
  label,
  value,
  onChange,
  catalog,
  online,
}: {
  label: string;
  value: string;
  onChange: (model: string) => void;
  catalog: QvacModelInfo[];
  online: boolean;
}) {
  const info = catalog.find((m) => m.name === value);
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-sm shrink-0" style={{ ...fontBody, color: C.chalk }}>
        {label}
      </span>
      <select
        className="flex-1 px-2 py-1.5 rounded-lg text-sm"
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {catalog.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name} (~{m.sizeMB} MB)
          </option>
        ))}
      </select>
      <ModelStatusBadge info={info} online={online} onDownload={() => void requestQvacModel(value)} />
    </div>
  );
}

/** UC-01: room creation with the room-level resolution policy. */
function CreateRoomModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: { name: string; matchContext: string; policy: RoomPolicy }) => void;
}) {
  const [name, setName] = useState("My Watch Party");
  const [count, setCount] = useState(3);
  const [slotModels, setSlotModels] = useState<string[]>(() => Array(3).fill("Llama 3.2 1B"));
  const [tiebreakerModel, setTiebreakerModel] = useState("Llama 3.2 1B");
  const [threshold, setThreshold] = useState(2);
  const [fallbackKind, setFallbackKind] = useState<"FACTS" | "TIEBREAKER_LLM">("TIEBREAKER_LLM");
  const [models, setModels] = useState<QvacModelInfo[] | null>(null);

  // Poll the sidecar's model catalog while the modal is open so download
  // progress updates live (UC-01: pick + download the oracle model).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const list = await listQvacModels();
      if (!stop) setModels(list);
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const catalog = models ?? FALLBACK_MODELS;
  const sidecarOnline = models != null;
  const infoOf = (n: string) => catalog.find((m) => m.name === n);

  const MAX_ORACLES = 5;
  const effThreshold = Math.min(Math.max(threshold, 1), count);
  // Without a sidecar the mock runtime serves any name; with one, every model
  // used by the committee (and the tiebreaker) must be downloaded first.
  const neededModels = [
    ...new Set([
      ...slotModels.slice(0, count),
      ...(fallbackKind === "TIEBREAKER_LLM" ? [tiebreakerModel] : []),
    ]),
  ];
  const modelReady = !sidecarOnline || neededModels.every((n) => infoOf(n)?.loaded);
  const valid = name.trim().length > 0 && modelReady;

  const submit = () => {
    if (!valid) return;
    onCreate({
      name: name.trim(),
      matchContext: MATCH_FIXTURE.label,
      policy: {
        committee: Array.from({ length: count }, (_, i) => ({
          id: `oracle-${i + 1}`,
          model: slotModels[i] ?? slotModels[0] ?? "Llama 3.2 1B",
        })),
        threshold: effThreshold,
        fallback:
          fallbackKind === "FACTS"
            ? { kind: "FACTS" }
            : { kind: "TIEBREAKER_LLM", model: tiebreakerModel },
      },
    });
  };

  return (
    <ModalShell title="Create a room" onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div>
          <FieldLabel>Room name</FieldLabel>
          <input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <FieldLabel>Match</FieldLabel>
          <div
            className="text-sm px-3 py-2 rounded-lg border"
            style={{ ...fontBody, color: C.chalk, borderColor: C.hairline, background: C.bg }}
          >
            {MATCH_FIXTURE.label}
            <span className="block text-xs mt-0.5" style={{ ...fontBody, color: C.muted }}>
              Events arrive automatically from the match feed. More fixtures and live
              feeds are coming.
            </span>
          </div>
        </div>

        <div className="flex gap-6">
          <div>
            <FieldLabel>Oracles on the committee</FieldLabel>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCount((n) => Math.max(1, n - 1))}
                className="w-8 h-8 rounded-lg border text-lg font-bold"
                style={{ ...fontBody, color: C.chalk, borderColor: C.hairline }}
              >
                −
              </button>
              <span className="text-sm font-semibold" style={{ ...fontMono, color: C.chalk }}>
                {count}
              </span>
              <button
                onClick={() =>
                  setCount((n) => {
                    const next = Math.min(MAX_ORACLES, n + 1);
                    setSlotModels((prev) =>
                      prev.length < next ? [...prev, prev[prev.length - 1] ?? "Llama 3.2 1B"] : prev,
                    );
                    return next;
                  })
                }
                className="w-8 h-8 rounded-lg border text-lg font-bold"
                style={{ ...fontBody, color: C.chalk, borderColor: C.hairline }}
              >
                +
              </button>
            </div>
          </div>
          <div>
            <FieldLabel>Consensus threshold</FieldLabel>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setThreshold((t) => Math.max(1, t - 1))}
                className="w-8 h-8 rounded-lg border text-lg font-bold"
                style={{ ...fontBody, color: C.chalk, borderColor: C.hairline }}
              >
                −
              </button>
              <span className="text-sm font-semibold" style={{ ...fontMono, color: C.chalk }}>
                {effThreshold} of {count}
              </span>
              <button
                onClick={() => setThreshold((t) => Math.min(count, t + 1))}
                className="w-8 h-8 rounded-lg border text-lg font-bold"
                style={{ ...fontBody, color: C.chalk, borderColor: C.hairline }}
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div>
          <FieldLabel>
            Oracle models {sidecarOnline ? "(local, via QVAC)" : "(oracle node offline — mock verdicts)"}
          </FieldLabel>
          <div className="flex flex-col gap-2">
            {Array.from({ length: count }, (_, i) => (
              <ModelSlotRow
                key={i}
                label={`Oracle ${i + 1}`}
                value={slotModels[i] ?? "Llama 3.2 1B"}
                onChange={(v) => setSlotModels((prev) => prev.map((x, j) => (j === i ? v : x)))}
                catalog={catalog}
                online={sidecarOnline}
              />
            ))}
          </div>
          {sidecarOnline && !modelReady && (
            <p className="text-xs mt-1.5" style={{ ...fontBody, color: C.amber }}>
              Some selected models aren't on this machine yet — download them to create the room.
            </p>
          )}
        </div>

        <div>
          <FieldLabel>No-consensus fallback</FieldLabel>
          <div className="flex items-center gap-2 mb-2">
            {(["FACTS", "TIEBREAKER_LLM"] as const).map((kind) => (
              <button
                key={kind}
                onClick={() => setFallbackKind(kind)}
                className="px-4 py-2 rounded-lg text-sm font-medium border transition-all"
                style={{
                  ...fontBody,
                  background: fallbackKind === kind ? C.green : "transparent",
                  color: fallbackKind === kind ? "#fff" : C.chalk,
                  borderColor: fallbackKind === kind ? C.green : C.hairline,
                }}
              >
                {kind === "FACTS" ? "Facts" : "Tiebreaker LLM"}
              </button>
            ))}
          </div>
          {fallbackKind === "TIEBREAKER_LLM" && (
            <div className="mb-2">
              <ModelSlotRow
                label="Tiebreaker"
                value={tiebreakerModel}
                onChange={setTiebreakerModel}
                catalog={catalog}
                online={sidecarOnline}
              />
            </div>
          )}
          <p className="text-xs" style={{ ...fontBody, color: C.muted }}>
            {fallbackKind === "FACTS"
              ? "Split committee → the question is re-checked against objective feed data only."
              : "Split committee → a separate tiebreaker oracle judges the same locked evidence."}
          </p>
        </div>

        <div className="pt-2 border-t" style={{ borderColor: C.hairline }}>
          <p className="text-xs mb-3" style={{ ...fontBody, color: C.muted }}>
            The policy is fixed at creation and applies to every market in this room.
          </p>
          <button
            onClick={submit}
            disabled={!valid}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
            style={{
              ...fontBody,
              background: valid ? C.green : C.panel2,
              color: valid ? "#fff" : C.muted,
              cursor: valid ? "pointer" : "default",
            }}
          >
            Create room
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/** UC-02: join an existing room by invite key. */
function JoinRoomModal({
  onClose,
  onJoin,
}: {
  onClose: () => void;
  onJoin: (key: string) => Promise<boolean>;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await onJoin(key);
    if (!ok) {
      setError(
        "Room not found yet — check the key and that the room's creator is online, then try again. The search keeps running in the background, so a retry is often instant.",
      );
      setBusy(false);
    }
  };
  return (
    <ModalShell title="Join with invite key" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>Invite key</FieldLabel>
          <input
            className={inputClass}
            style={{ ...inputStyle, ...fontMono }}
            placeholder="room_XXXX"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <p className="text-xs mt-1.5" style={{ ...fontBody, color: C.muted }}>
            Ask the room creator for their key — it looks like{" "}
            <span style={{ ...fontMono, color: C.chalk }}>room_8XK2</span>.
          </p>
        </div>
        {error && (
          <p className="text-xs" style={{ ...fontBody, color: C.red }}>
            {error}
          </p>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
          style={{ ...fontBody, background: busy ? C.panel2 : C.green, color: busy ? C.muted : "#fff" }}
        >
          {busy ? "Searching the swarm… (first contact can take up to a minute)" : "Join room"}
        </button>
      </div>
    </ModalShell>
  );
}

/** UC-03: create a market; the room policy is inherited and shown read-only. */
function CreateMarketModal({
  onClose,
  onCreate,
  policyText,
}: {
  onClose: () => void;
  onCreate: (question: string, category: Category) => void;
  policyText: string;
}) {
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState<Category>("INTERPRETIVE");
  const valid = question.trim().length > 0;
  return (
    <ModalShell title="Create market" onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div>
          <FieldLabel>Question (YES / NO)</FieldLabel>
          <input
            className={inputClass}
            style={inputStyle}
            placeholder="Was the penalty decision correct?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel>Category</FieldLabel>
          <div className="flex items-center gap-2">
            {(["OBJECTIVE", "INTERPRETIVE"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className="px-4 py-2 rounded-lg text-sm font-medium border transition-all"
                style={{
                  ...fontBody,
                  background: category === c ? C.green : "transparent",
                  color: category === c ? "#fff" : C.chalk,
                  borderColor: category === c ? C.green : C.hairline,
                }}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Resolution policy (room-wide, read-only)</FieldLabel>
          <div className="text-xs px-3 py-2 rounded-lg border" style={{ ...fontMono, color: C.muted, borderColor: C.hairline, background: C.bg }}>
            {policyText} — set by the room creator
          </div>
        </div>
        <button
          onClick={() => valid && onCreate(question.trim(), category)}
          disabled={!valid}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
          style={{
            ...fontBody,
            background: valid ? C.green : C.panel2,
            color: valid ? "#fff" : C.muted,
            cursor: valid ? "pointer" : "default",
          }}
        >
          Create market
        </button>
      </div>
    </ModalShell>
  );
}

/** UC-06: the room creator assembles and permanently locks the evidence bundle. */
function LockBundleModal({
  view,
  me,
  onClose,
  onLock,
}: {
  view: RoomView;
  me: string;
  onClose: () => void;
  onLock: (items: EvidenceItem[]) => void;
}) {
  const events = [...view.timeline].sort((a, b) => a.minute - b.minute);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(events.length > 0 ? [events[events.length - 1].id] : []),
  );
  const [note, setNote] = useState("");
  const [context, setContext] = useState("");
  const valid = selected.size > 0 || note.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    const items: EvidenceItem[] = [];
    for (const ev of events) {
      if (!selected.has(ev.id)) continue;
      items.push({
        weight: "PRIMARY",
        kind: "FEED_EVENT",
        content: `${ev.minute}' — ${ev.description}${ev.detail ? ` · ${ev.detail}` : ""}`,
        eventRef: ev.id,
      });
    }
    if (note.trim()) items.push({ weight: "SECONDARY", kind: "MANUAL_NOTE", content: note.trim(), author: me });
    if (context.trim()) items.push({ weight: "CONTEXT", kind: "RULEBOOK", content: context.trim() });
    onLock(items);
  };

  return (
    <ModalShell title="Attach evidence & lock bundle" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>Timeline events (PRIMARY evidence)</FieldLabel>
          {events.length === 0 ? (
            <p className="text-xs" style={{ ...fontBody, color: C.muted }}>
              No events on the timeline yet — add one first, or rely on a manual note below.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
              {events.map((ev) => (
                <label key={ev.id} className="flex items-center gap-2 cursor-pointer text-sm" style={{ ...fontBody, color: C.chalk }}>
                  <input
                    type="checkbox"
                    checked={selected.has(ev.id)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(ev.id)) next.delete(ev.id);
                        else next.add(ev.id);
                        return next;
                      })
                    }
                  />
                  {ev.minute}' — {ev.description}
                  {ev.detail ? ` · ${ev.detail}` : ""}
                </label>
              ))}
            </div>
          )}
        </div>
        <div>
          <FieldLabel>Manual note (SECONDARY, optional)</FieldLabel>
          <textarea
            className={`${inputClass} h-16 resize-none`}
            style={inputStyle}
            placeholder="What you saw — e.g. defender made contact inside the box before the ball."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel>Rulebook / context excerpt (CONTEXT, optional)</FieldLabel>
          <textarea
            className={`${inputClass} h-16 resize-none`}
            style={inputStyle}
            placeholder="A direct free kick is awarded if a player trips or attempts to trip an opponent…"
            value={context}
            onChange={(e) => setContext(e.target.value)}
          />
        </div>
        <div className="pt-2 border-t" style={{ borderColor: C.hairline }}>
          <p className="text-xs mb-3" style={{ ...fontBody, color: C.amber }}>
            Locking is permanent: the bundle is hashed and the oracles judge exactly this
            evidence. It cannot be changed or re-rolled afterwards.
          </p>
          <button
            onClick={submit}
            disabled={!valid}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
            style={{
              ...fontBody,
              background: valid ? C.green : C.panel2,
              color: valid ? "#fff" : C.muted,
              cursor: valid ? "pointer" : "default",
            }}
          >
            Lock evidence bundle
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [rooms, setRooms] = useState<Record<string, KickoffEngine>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [modal, setModal] = useState<
    "createRoom" | "joinRoom" | "createMarket" | "lockBundle" | null
  >(null);
  const feedStops = useRef<Record<string, () => void>>({});
  const [view, setView] = useState<RoomView | null>(null);
  const [sidecarUp, setSidecarUp] = useState(false);
  const [identity, setIdentity] = useState<LocalIdentity>(() => loadOrCreateIdentity());

  // Sidecar present → ops replicate cross-machine over its Hyperswarm room node;
  // absent → BroadcastChannel still replicates between tabs on this machine.
  const makeAdapter = (inviteKey: string, viaSidecar: boolean): P2PAdapter =>
    viaSidecar ? new WebSocketAdapter(inviteKey) : new BroadcastChannelAdapter(inviteKey);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const qvac = await detectQvacRuntime();
      if (cancelled) return;
      setSidecarUp(qvac != null);
      // Identity: upgrade to the real WDK wallet address BEFORE entering rooms,
      // so every op we author carries the self-custodial address (UC-16).
      let id = loadOrCreateIdentity();
      if (qvac) {
        const wallet = await detectWdkWallet();
        if (wallet) id = saveWdkIdentity(wallet.address);
      }
      if (!cancelled) setIdentity(id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One engine per room, mirroring the one-log-per-room P2P design (§2/§5).
  const activeEngine = activeKey ? rooms[activeKey] ?? null : null;

  useEffect(() => {
    if (!activeEngine) return;
    return activeEngine.subscribe(setView);
  }, [activeEngine]);

  const ready = activeEngine != null && view?.room != null;

  const handleRun = () => {
    void activeEngine?.runOracles(selectedMarketId);
  };
  const handleRunFallback = () => {
    void activeEngine?.runFallback(selectedMarketId);
  };
  const handleStake = (side: Side, amount: bigint) => {
    activeEngine?.placeStake(selectedMarketId, identity.wallet, side, amount);
  };
  const handleCloseStaking = () => {
    activeEngine?.lockMarket(selectedMarketId);
  };
  const handleLockBundle = (items: EvidenceItem[]) => {
    void activeEngine?.lockBundle(selectedMarketId, items);
    setModal(null);
  };
  const handleLeaveRoom = () => {
    setActiveKey(null);
    setView(null);
    setSelectedMarketId("");
    setScreen("landing");
  };
  const handleNav = (s: Screen) => setScreen(s);
  const handleSelectMarket = (id: string) => {
    setSelectedMarketId(id);
    setScreen("market");
  };

  const handleCreateRoom = async (input: { name: string; matchContext: string; policy: RoomPolicy }) => {
    const qvac = await detectQvacRuntime();
    const key = `room_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const engine = new KickoffEngine({
      runtime: qvac ?? new MockOracleRuntime(1200),
      runtimeLabel: qvac ? "Runs locally via QVAC — models chosen per room · no cloud" : undefined,
      adapter: makeAdapter(key, qvac != null),
    });
    engine.adoptIdentity(asParticipant(identity));
    engine.createRoom({ ...input, inviteKey: key });
    // The creator's client drives the match feed (replay of the bound fixture).
    feedStops.current[key] = startMatchFeed(engine);
    setRooms((prev) => ({ ...prev, [key]: engine }));
    // Set the view synchronously — the subscription effect only re-fires when the
    // engine instance changes, so a null view could otherwise never repopulate.
    setView(engine.getView());
    setActiveKey(key);
    setSelectedMarketId("");
    setModal(null);
    setScreen("room");
  };

  const activateRoom = (key: string, engine: KickoffEngine) => {
    setView(engine.getView());
    setActiveKey(key);
    setSelectedMarketId("");
    setModal(null);
    setScreen("room");
  };

  const handleJoinRoom = async (rawKey: string): Promise<boolean> => {
    const key = rawKey.trim();
    if (!key) return false;

    // Rooms already known in this session first.
    const local = Object.keys(rooms).find((r) => r.toLowerCase() === key.toLowerCase());
    if (local) {
      activateRoom(local, rooms[local]);
      return true;
    }

    // Unknown key → join over P2P: connect to the swarm topic via the sidecar
    // and wait for the room's op log to arrive from its peers (UC-02).
    // Detect the sidecar NOW rather than trusting page-load state — it may
    // have been started after the page loaded.
    const qvac = await detectQvacRuntime();
    if (!qvac) return false; // no sidecar → no cross-machine transport
    if (!sidecarUp) setSidecarUp(true);
    const engine = new KickoffEngine({
      runtime: qvac,
      runtimeLabel: "Runs locally via QVAC — models chosen per room · no cloud",
      adapter: makeAdapter(key, true),
    });
    const guest = asParticipant(identity);
    engine.adoptIdentity(guest);
    // First DHT contact for a topic can take 30-90s; keep searching for 60s.
    // The sidecar stays joined to the swarm afterwards, so a retry is fast.
    const found = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve(false);
      }, 60_000);
      const unsub = engine.subscribe((v) => {
        if (v.room) {
          clearTimeout(timer);
          unsub();
          resolve(true);
        }
      });
    });
    if (!found) return false;
    engine.joinAs(guest); // announce ourselves: avatar appears on every peer
    // If we are this room's creator rejoining after a reload, resume the feed.
    if (engine.getView().room?.creator === identity.wallet && !feedStops.current[key]) {
      feedStops.current[key] = startMatchFeed(engine);
    }
    setRooms((prev) => ({ ...prev, [key]: engine }));
    activateRoom(key, engine);
    return true;
  };

  const handleCreateMarket = (question: string, category: Category) => {
    if (!activeEngine) return;
    const id = activeEngine.createMarket({ question, category });
    setSelectedMarketId(id);
    setModal(null);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: C.bg, fontFamily: "'Archivo', sans-serif", color: C.chalk }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={screen}
          className="flex-1 flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {screen === "landing" && (
            <LandingScreen
              onNav={handleNav}
              onCreateRoom={() => setModal("createRoom")}
              onJoinRoom={() => setModal("joinRoom")}
              identity={identity}
            />
          )}
          {screen !== "landing" && !ready && (
            <div
              className="flex-1 flex items-center justify-center"
              style={{ ...fontBody, color: C.muted }}
            >
              Connecting to the room…
            </div>
          )}
          {screen === "room" && ready && (
            <RoomScreen
              onNav={handleNav}
              view={view!}
              me={identity.wallet}
              onCreateMarket={() => setModal("createMarket")}
              onSelectMarket={handleSelectMarket}
              onLeave={handleLeaveRoom}
            />
          )}
          {screen === "market" && ready && (
            <MarketScreen
              onNav={handleNav}
              view={view!}
              me={identity.wallet}
              marketId={selectedMarketId}
              oracleOnline={sidecarUp}
              onCloseStaking={handleCloseStaking}
              onLockBundle={() => setModal("lockBundle")}
              onRun={handleRun}
              onRunFallback={handleRunFallback}
              onStake={handleStake}
            />
          )}
          {screen === "settlement" && ready && (
            <SettlementScreen
              onNav={handleNav}
              view={view!}
              me={identity.wallet}
              marketId={selectedMarketId}
              audit={activeEngine!.getAuditLog(selectedMarketId)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Modals */}
      {modal === "createRoom" && (
        <CreateRoomModal onClose={() => setModal(null)} onCreate={handleCreateRoom} />
      )}
      {modal === "joinRoom" && (
        <JoinRoomModal onClose={() => setModal(null)} onJoin={handleJoinRoom} />
      )}
      {modal === "createMarket" && view && (
        <CreateMarketModal
          onClose={() => setModal(null)}
          onCreate={handleCreateMarket}
          policyText={policyLabel(view)}
        />
      )}
      {modal === "lockBundle" && view && (
        <LockBundleModal
          view={view}
          me={identity.wallet}
          onClose={() => setModal(null)}
          onLock={handleLockBundle}
        />
      )}
    </div>
  );
}
