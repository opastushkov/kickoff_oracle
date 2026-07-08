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

import {
  fetchMatchFixture,
  searchRealMatches,
  startMatchFeed,
  type MatchFixture,
  type RemoteMatch,
} from "../engine/feed";
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
import {
  createWdkWallet,
  detectWdkWallet,
  executeOnChainSettlement,
  executeStakeTransfer,
  importWdkWallet,
} from "../engine/wdk";
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
function policyLabel(view: RoomView): string {
  const j = view.room?.policy.jury;
  const fb = view.room?.policy.fallback.model;
  if (!j) return "";
  return `Distributed jury · quorum ${j.quorum} · juror ${j.model} · tiebreaker ${fb}`;
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
function EvidenceTimeline({ events, label }: { events: TimelineEvent[]; label: string }) {
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
        {label}
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
  status,
  yesStake,
  noStake,
  onClick,
  noConsensus,
}: {
  question: string;
  status: string;
  yesStake: string;
  noStake: string;
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
        <StatusChip status={status} />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ ...fontBody, color: C.muted }}>YES</span>
          <span className="text-xs font-medium" style={{ ...fontBody, color: C.green }}>{yesStake} test USDt</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ ...fontBody, color: C.muted }}>NO</span>
          <span className="text-xs font-medium" style={{ ...fontBody, color: C.red }}>{noStake} test USDt</span>
        </div>
      </div>

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
  onLoginWallet,
  identity,
}: {
  onNav: (s: Screen) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onLoginWallet: () => void;
  identity: LocalIdentity;
}) {
  const connected = identity.source === "wdk";
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
          {connected ? (
            <button
              onClick={onLoginWallet}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-80"
              style={{ ...fontBody, background: "rgba(0,122,122,0.12)", color: C.teal, border: `1px solid ${C.teal}44` }}
              title="Manage wallet"
            >
              <Wallet size={14} />
              {shortWallet(identity.wallet)}
              <span
                className="ml-1 px-1.5 py-0.5 rounded text-xs font-semibold"
                style={{ ...fontBody, background: "rgba(0,122,122,0.15)", color: C.teal }}
              >
                WDK · Sepolia
              </span>
            </button>
          ) : (
            <button
              onClick={onLoginWallet}
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
              Markets are tagged by the kind of question they ask — but every market
              resolves the same way: the oracle committee judges the locked evidence.
            </p>
            <div className="flex flex-col gap-3">
              {[
                { cat: "Objective", example: "Did Spain score before 80'?", note: "Clear-cut from the feed evidence" },
                { cat: "Interpretive", example: "Was the penalty decision correct?", note: "Requires weighing the evidence" },
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
            <h3 className="font-bold" style={{ ...fontCondensed, fontSize: 26, color: C.chalk }}>No consensus? A tiebreaker decides.</h3>
            <p className="leading-relaxed" style={{ ...fontBody, color: C.muted, fontSize: 15, lineHeight: 1.7 }}>
              When oracles split — one YES, one NO, one INSUFFICIENT — the system does not force a resolution. A dedicated tiebreaker LLM, chosen by the room creator, judges the same locked evidence; if even it finds the evidence insufficient, the market cancels and every stake is refunded.
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
            className="rounded-xl border overflow-hidden"
            style={{ background: C.panel, borderColor: C.hairline }}
          >
            <div
              className="flex items-center gap-2 px-5 py-2.5 border-b"
              style={{ borderColor: C.hairline, background: "rgba(30,122,70,0.05)" }}
            >
              <ShieldQuestion size={14} style={{ color: C.green }} />
              <span className="text-sm font-bold" style={{ ...fontCondensed, color: C.chalk, fontSize: 16, letterSpacing: 0.5 }}>
                DISTRIBUTED JURY
              </span>
              <span className="text-xs" style={{ ...fontBody, color: C.muted }}>
                every participant's device judges — set by the room creator, fixed for the room
              </span>
            </div>
            <div className="grid grid-cols-3 divide-x" style={{ borderColor: C.hairline }}>
              {[
                { label: "Quorum", value: `${room.policy.jury?.quorum} agreeing`, sub: "jurors to resolve" },
                { label: "Juror model", value: room.policy.jury?.model ?? "—", sub: "default · each device can override" },
                { label: "Tiebreaker", value: room.policy.fallback.model, sub: "decides a split" },
              ].map((c) => (
                <div key={c.label} className="px-5 py-3" style={{ borderColor: C.hairline }}>
                  <div className="text-xs uppercase tracking-widest mb-1" style={{ ...fontBody, color: C.muted }}>
                    {c.label}
                  </div>
                  <div className="text-sm font-semibold" style={{ ...fontBody, color: C.chalk }}>
                    {c.value}
                  </div>
                  <div className="text-xs" style={{ ...fontBody, color: C.muted }}>
                    {c.sub}
                  </div>
                </div>
              ))}
            </div>
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
                  status={STATUS_LABEL[m.status] ?? m.status}
                  yesStake={formatUSDt(stakeTotal(m, "YES"))}
                  noStake={formatUSDt(stakeTotal(m, "NO"))}
                  onClick={() => onSelectMarket(m.id)}
                  noConsensus={m.status === "NO_CONSENSUS"}
                />
              ))}
            </div>
          )}
        </div>

        {/* Timeline sidebar */}
        <EvidenceTimeline events={view.timeline} label={room.matchContext} />
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
  onStake: (side: Side, amount: bigint) => Promise<string | null>;
}) {
  const [side, setSide] = useState<Side>("YES");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
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
    setBusy(true);
    setError(null);
    const err = await onStake(side, minor);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setAmount("");
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
          disabled={busy}
          className="px-5 py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
          style={{ ...fontBody, background: busy ? C.panel2 : C.teal, color: busy ? C.muted : "#fff" }}
        >
          {busy ? "Staking on-chain…" : "Stake"}
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
  jurorModel,
  onJurorModel,
  onJudge,
  onRunFallback,
  onStake,
}: {
  onNav: (s: Screen) => void;
  view: RoomView;
  me: string;
  marketId: string;
  oracleOnline: boolean;
  jurorModel: string;
  onJurorModel: (m: string) => void;
  onJudge: () => void;
  onRunFallback: () => void;
  onStake: (side: Side, amount: bigint) => Promise<string | null>;
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
  const running = view.runningOracles.includes(market.id); // this device is judging
  const done = market.resolution != null;
  const quorum = room.policy.jury?.quorum ?? 1;
  const jurorVerdicts = market.verdicts.filter((v) => v.juror);
  const yesVotes = jurorVerdicts.filter((v) => v.verdict === "YES").length;
  const noVotes = jurorVerdicts.filter((v) => v.verdict === "NO").length;
  const tiebreaker = market.verdicts.find((v) => v.oracle === "TIEBREAKER");
  const myVerdict = jurorVerdicts.find((v) => v.juror === me);
  const matchEnded = view.timeline.some((e) => e.type === "FULL_TIME");
  // This device can judge once the match has ended (evidence auto-locked) and it
  // hasn't voted yet.
  const canJudge = market.status === "RESOLVING" && market.bundle != null && !myVerdict && !running && oracleOnline;
  const idleHint = !oracleOnline
    ? "Oracle node offline — start the sidecar so this device can judge"
    : !matchEnded
      ? "Staking is open — the market resolves when the match ends"
      : myVerdict
        ? "Your verdict is in — waiting for the rest of the jury"
        : "Run your device's juror on the locked match feed";

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
            <p className="text-xs" style={{ ...fontBody, color: C.muted }}>
              {market.status === "OPEN"
                ? "Staking is open — this market resolves automatically when the match ends."
                : market.status === "SETTLED"
                  ? "Resolved by the distributed jury."
                  : "Staking closed at full time — the jury is judging the match feed."}
            </p>
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
                      <span className="flex items-center gap-1.5" style={{ ...fontBody, color: C.green }}>
                        {formatUSDt(s.amount)} test USDt
                        {s.txRef && (
                          <a href={`https://sepolia.etherscan.io/tx/${s.txRef}`} target="_blank" rel="noreferrer" className="text-xs underline" style={{ ...fontMono, color: C.teal }} title="on-chain stake">
                            ↗
                          </a>
                        )}
                      </span>
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
                      <span className="flex items-center gap-1.5" style={{ ...fontBody, color: C.red }}>
                        {formatUSDt(s.amount)} test USDt
                        {s.txRef && (
                          <a href={`https://sepolia.etherscan.io/tx/${s.txRef}`} target="_blank" rel="noreferrer" className="text-xs underline" style={{ ...fontMono, color: C.teal }} title="on-chain stake">
                            ↗
                          </a>
                        )}
                      </span>
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
                  Feed locked at full time — the jury judges these {market.bundle.items.length} events
                </div>
              ) : (
                <p className="text-xs leading-relaxed" style={{ ...fontBody, color: C.muted }}>
                  The jury judges the <strong>whole match feed</strong>. When the match
                  ends, the feed is automatically frozen and hashed — so every juror's
                  verdict is bound to exactly this evidence.
                </p>
              )}
            </div>

            {/* B. Distributed jury — each device signs one verdict */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ ...fontBody, color: C.chalk }}>Distributed jury</span>
                <span className="text-xs px-2 py-0.5 rounded" style={{ ...fontBody, background: C.panel2, color: C.muted }}>
                  quorum {quorum}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {view.participants.map((p) => {
                  const v = jurorVerdicts.find((x) => x.juror === p.wallet);
                  const judging = running && p.wallet === me && !v;
                  const vc = !v ? C.muted : v.verdict === "YES" ? C.green : v.verdict === "NO" ? C.red : C.amber;
                  return (
                    <div key={p.wallet} className="p-3 rounded-lg border" style={{ background: C.panel, borderColor: v ? vc + "44" : C.hairline }}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold" style={{ ...fontBody, color: C.chalk }}>
                          {p.displayName}
                          {p.wallet === me && <span className="ml-1 text-xs" style={{ color: C.muted }}>(you)</span>}
                          {v?.model && (
                            <span className="ml-2 text-xs font-normal" style={{ ...fontMono, color: C.muted }}>
                              {v.model}
                            </span>
                          )}
                        </span>
                        {v ? (
                          <span className="font-bold px-2 py-0.5 rounded" style={{ ...fontCondensed, color: vc, background: vc + "18", fontSize: 16 }}>
                            {v.verdict === "INSUFFICIENT_EVIDENCE" ? "INSUFF" : v.verdict}
                          </span>
                        ) : judging ? (
                          <span className="text-xs animate-pulse" style={{ ...fontBody, color: C.amber }}>judging…</span>
                        ) : (
                          <span className="text-xs" style={{ ...fontBody, color: C.muted }}>waiting</span>
                        )}
                      </div>
                      {v?.reason && <p className="text-xs mt-1 leading-snug" style={{ ...fontBody, color: C.muted }}>{v.reason}</p>}
                    </div>
                  );
                })}
              </div>

              {canJudge && (
                <div className="flex flex-col gap-2">
                  <JurorModelPicker
                    value={jurorModel}
                    fallback={room.policy.jury?.model ?? "Llama 3.2 1B"}
                    onChange={onJurorModel}
                  />
                  <button
                    onClick={onJudge}
                    className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
                    style={{ ...fontBody, background: C.green, color: "#fff" }}
                  >
                    ⚖ Run my juror
                  </button>
                </div>
              )}
              <div className="text-xs text-center" style={{ ...fontBody, color: C.muted }}>
                {running ? "Your device is judging…" : idleHint}
              </div>
              {market.bundle && (
                <div className="text-xs text-center" style={{ ...fontBody, color: C.muted }}>
                  {view.oracleRuntime}
                </div>
              )}
            </div>

            {/* C. Jury result */}
            <div className="p-5 rounded-lg border flex flex-col gap-4" style={{ background: C.panel, borderColor: C.hairline }}>
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ ...fontBody, color: C.chalk }}>Jury result</span>

              <div className="flex flex-col gap-3">
                <div className="text-xs" style={{ ...fontBody, color: C.muted }}>
                  {quorum} agreeing {quorum === 1 ? "juror" : "jurors"} resolves the market
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex flex-col items-center p-2 rounded" style={{ background: C.green + "18" }}>
                    <span style={{ ...fontCondensed, color: C.green, fontSize: 24 }}>{yesVotes}</span>
                    <span className="text-xs" style={{ ...fontBody, color: C.green }}>YES</span>
                  </div>
                  <div className="flex-1 flex flex-col items-center p-2 rounded" style={{ background: C.red + "18" }}>
                    <span style={{ ...fontCondensed, color: C.red, fontSize: 24 }}>{noVotes}</span>
                    <span className="text-xs" style={{ ...fontBody, color: C.red }}>NO</span>
                  </div>
                </div>

                {done && market.resolution!.via === "CONSENSUS" && (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-center">
                    <div className="font-bold" style={{ ...fontCondensed, color: C.green, fontSize: 26 }}>
                      QUORUM REACHED
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
                    {market.resolution!.via === "TIEBREAKER" ? "Decided by the tiebreaker after a split · " : ""}
                    YES: {market.resolution!.counts.yes} · NO: {market.resolution!.counts.no} ·
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
                    No quorum — tiebreaker deciding
                  </div>
                  <p className="text-xs" style={{ ...fontBody, color: C.muted }}>
                    The jury split, so a tiebreaker judge ({room.policy.fallback.model})
                    rules on the same locked evidence. {tiebreaker ? "" : "Running…"}
                  </p>
                  {isCreator && (
                    <button
                      onClick={onRunFallback}
                      disabled={running}
                      className="w-full mt-2 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                      style={{ ...fontBody, background: running ? C.panel2 : C.amber, color: running ? C.muted : "#fff" }}
                    >
                      {running ? "Tiebreaker analyzing…" : "Run tiebreaker now"}
                    </button>
                  )}
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
                  {market.refundTxs && market.refundTxs.length > 0 && (
                    <div className="text-xs mt-1.5 flex items-center gap-2" style={{ ...fontBody, color: C.muted }}>
                      Refunds on-chain:
                      {market.refundTxs.map((tx) => (
                        <a key={tx.txHash} href={`https://sepolia.etherscan.io/tx/${tx.txHash}`} target="_blank" rel="noreferrer" className="underline" style={{ ...fontMono, color: C.teal }}>
                          ↗
                        </a>
                      ))}
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
        <EvidenceTimeline events={view.timeline} label={room.matchContext} />
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
              {settlement.payouts.map((p) => {
                const tx = settlement.txRefs?.find((t) => t.wallet === p.wallet);
                return (
                  <div key={p.wallet} className="flex items-center justify-between py-2 border-b last:border-b-0" style={{ borderColor: C.hairline }}>
                    <span style={{ ...fontBody, color: C.chalk }}>{nameOf(view, p.wallet)}</span>
                    <span className="flex items-center gap-3">
                      <span className="font-medium" style={{ ...fontBody, color: C.teal }}>
                        receives {formatUSDt(p.amount)} test USDt
                      </span>
                      {tx ? (
                        <a
                          href={`https://sepolia.etherscan.io/tx/${tx.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline"
                          style={{ ...fontMono, color: C.teal }}
                        >
                          on-chain ↗
                        </a>
                      ) : (
                        <span className="text-xs" style={{ ...fontBody, color: C.muted }}>
                          ledger
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
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

/** A field label with a collapsible ⓘ hint — keeps modals uncluttered. */
function FieldLabelHint({ label, hint }: { label: string; hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs uppercase tracking-widest" style={{ ...fontBody, color: C.muted }}>{label}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full text-xs leading-none transition-all hover:opacity-80"
          style={{ ...fontBody, background: open ? C.green : C.panel2, color: open ? "#fff" : C.muted }}
          title="What's this?"
        >
          i
        </button>
      </div>
      {open && (
        <p className="text-xs mt-1" style={{ ...fontBody, color: C.muted, textTransform: "none" }}>
          {hint}
        </p>
      )}
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
  // Download failures were invisible (the load runs in the background on the
  // sidecar) — surface both an outright refusal and a failed background load.
  const [requestError, setRequestError] = useState<string | null>(null);
  useEffect(() => setRequestError(null), [value]);
  const error = requestError ?? (info?.downloading == null && !info?.loaded ? info?.error : null);
  return (
    <div>
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
        <ModelStatusBadge
          info={info}
          online={online}
          onDownload={async () => setRequestError(await requestQvacModel(value))}
        />
      </div>
      {error && (
        <p className="text-xs mt-1 ml-24 pl-3" style={{ ...fontBody, color: C.red }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Per-device juror model picker (UC-07): this participant's own "brain". */
function JurorModelPicker({
  value,
  fallback,
  onChange,
}: {
  value: string;
  fallback: string;
  onChange: (m: string) => void;
}) {
  const [models, setModels] = useState<QvacModelInfo[] | null>(null);
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
  const current = value || fallback;
  return (
    <div>
      <div className="text-xs uppercase tracking-widest mb-1" style={{ ...fontBody, color: C.muted }}>
        Your juror model {value ? "" : "(room default)"}
      </div>
      <ModelSlotRow label="You" value={current} onChange={onChange} catalog={catalog} online={models != null} />
    </div>
  );
}

/** UC-01: room creation with the room-level resolution policy. */
function CreateRoomModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: {
    name: string;
    matchContext: string;
    feedMatchId: string;
    fixture: MatchFixture;
    policy: RoomPolicy;
  }) => void;
}) {
  const [name, setName] = useState("My Watch Party");
  const [matchQuery, setMatchQuery] = useState("");
  const [matchResults, setMatchResults] = useState<RemoteMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<RemoteMatch | null>(null);
  const [searching, setSearching] = useState(false);
  const [jurorModel, setJurorModel] = useState("Llama 3.2 1B");
  const [tiebreakerModel, setTiebreakerModel] = useState("Llama 3.2 1B");
  const [quorum, setQuorum] = useState(2);
  const [models, setModels] = useState<QvacModelInfo[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

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

  const MAX_QUORUM = 5;
  // The juror model and the tiebreaker model must be downloaded first.
  const neededModels = [...new Set([jurorModel, tiebreakerModel])];
  const modelReady = neededModels.every((n) => infoOf(n)?.loaded);
  // Real matches only: a room must bind to a real match, which needs the sidecar.
  const valid = sidecarOnline && name.trim().length > 0 && modelReady && selectedMatch != null;

  const doSearch = async () => {
    if (searching || matchQuery.trim().length === 0) return;
    setSearching(true);
    const results = await searchRealMatches(matchQuery.trim());
    setMatchResults(results);
    setSearching(false);
  };

  const submit = async () => {
    if (!valid || creating || !selectedMatch) return;
    setCreating(true);
    setCreateErr(null);
    // Fetch the real match timeline now; refuse to create if it has none
    // (no silent fixture fallback — the jury only judges real match data).
    const fixture = await fetchMatchFixture(selectedMatch.id);
    if (!fixture) {
      setCreateErr("This match has no event timeline available yet — pick another match.");
      setCreating(false);
      return;
    }
    onCreate({
      name: name.trim(),
      matchContext: selectedMatch.label,
      feedMatchId: selectedMatch.id,
      fixture,
      policy: {
        committee: [], // jury mode: no fixed committee — every device is a juror
        threshold: quorum,
        fallback: { kind: "TIEBREAKER_LLM", model: tiebreakerModel },
        jury: { quorum, model: jurorModel },
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
          <FieldLabel>Match — pick a real match to judge</FieldLabel>
          {!sidecarOnline ? (
            <p className="text-xs" style={{ ...fontBody, color: C.amber }}>
              Real match data needs the local sidecar. Start it
              (<span style={{ ...fontMono }}>start-host.cmd</span>) and reopen this.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  style={inputStyle}
                  placeholder="Type a team (e.g. Arsenal, Argentina, Real Madrid)"
                  value={matchQuery}
                  onChange={(e) => setMatchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                />
                <button
                  onClick={doSearch}
                  disabled={searching}
                  className="px-4 py-2 rounded-lg text-sm font-semibold shrink-0 transition-all hover:opacity-90"
                  style={{ ...fontBody, background: searching ? C.panel2 : C.teal, color: searching ? C.muted : "#fff" }}
                >
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
              {matchResults.length === 0 && !searching && (
                <p className="text-xs" style={{ ...fontBody, color: C.muted }}>
                  Search a team to list its recent real matches, then pick one.
                </p>
              )}
              {matchResults.map((m) => (
                <div
                  key={m.id}
                  onClick={() => setSelectedMatch(m)}
                  className="px-3 py-2 rounded-lg border cursor-pointer transition-all"
                  style={{
                    borderColor: selectedMatch?.id === m.id ? C.green : C.hairline,
                    background: selectedMatch?.id === m.id ? "rgba(30,122,70,0.06)" : C.bg,
                  }}
                >
                  <span className="text-sm" style={{ ...fontBody, color: C.chalk }}>
                    {m.label}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ ...fontBody, color: C.muted }}>
                    Real events, replayed on an accelerated clock
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <FieldLabelHint
            label="Jury quorum"
            hint="Every participant's device runs the juror model and signs one verdict; the market resolves once this many agree. Solo demo → set 1."
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuorum((q) => Math.max(1, q - 1))}
              className="w-8 h-8 rounded-lg border text-lg font-bold"
              style={{ ...fontBody, color: C.chalk, borderColor: C.hairline }}
            >
              −
            </button>
            <span className="text-sm font-semibold" style={{ ...fontMono, color: C.chalk }}>
              {quorum} {quorum === 1 ? "juror" : "jurors"}
            </span>
            <button
              onClick={() => setQuorum((q) => Math.min(MAX_QUORUM, q + 1))}
              className="w-8 h-8 rounded-lg border text-lg font-bold"
              style={{ ...fontBody, color: C.chalk, borderColor: C.hairline }}
            >
              +
            </button>
          </div>
        </div>

        <div>
          <FieldLabelHint
            label={`Default juror model ${sidecarOnline ? "(local, via QVAC)" : "(node offline — mock)"}`}
            hint="The starting model for the jury. Each participant can override it on their own device before judging — different brains, one verdict each. Bigger models judge better; download is peer-to-peer via QVAC."
          />
          <ModelSlotRow
            label="Juror"
            value={jurorModel}
            onChange={setJurorModel}
            catalog={catalog}
            online={sidecarOnline}
          />
        </div>

        <div>
          <FieldLabelHint
            label="Tiebreaker model"
            hint="If the jury never reaches quorum, a tiebreaker judge rules on the same locked evidence; if it too finds the evidence insufficient, the market cancels and stakes are refunded."
          />
          <ModelSlotRow
            label="Tiebreaker"
            value={tiebreakerModel}
            onChange={setTiebreakerModel}
            catalog={catalog}
            online={sidecarOnline}
          />
          {sidecarOnline && !modelReady && (
            <p className="text-xs mt-1.5" style={{ ...fontBody, color: C.amber }}>
              The juror or tiebreaker model isn't on this machine yet — download it to create the room.
            </p>
          )}
        </div>

        <div className="pt-2 border-t" style={{ borderColor: C.hairline }}>
          <p className="text-xs mb-3" style={{ ...fontBody, color: C.muted }}>
            The policy is fixed at creation and applies to every market in this room.
          </p>
          {sidecarOnline && !selectedMatch && (
            <p className="text-xs mb-2" style={{ ...fontBody, color: C.amber }}>
              Pick a real match above to create the room.
            </p>
          )}
          {createErr && (
            <p className="text-xs mb-2" style={{ ...fontBody, color: C.red }}>
              {createErr}
            </p>
          )}
          <button
            onClick={submit}
            disabled={!valid || creating}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
            style={{
              ...fontBody,
              background: valid && !creating ? C.green : C.panel2,
              color: valid && !creating ? "#fff" : C.muted,
              cursor: valid && !creating ? "pointer" : "default",
            }}
          >
            {creating ? "Fetching match & creating…" : "Create room"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/** UC-02: join an existing room by invite key. */
type JoinResult = { ok: true } | { ok: false; reason: "empty" | "no-sidecar" | "not-found" };

function JoinRoomModal({
  onClose,
  onJoin,
}: {
  onClose: () => void;
  onJoin: (key: string) => Promise<JoinResult>;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await onJoin(key);
    if (!res.ok) {
      setError(
        res.reason === "no-sidecar"
          ? "No local helper is running on this machine. Start the sidecar (run start-viewer.cmd, or `node server.mjs` in frontend/sidecar), open http://127.0.0.1:8791/health to confirm it returns ok, then try again."
          : res.reason === "empty"
            ? "Enter the invite key the room creator gave you."
            : "Room not found on the swarm yet. On first contact two machines can take up to a minute to find each other — the search keeps running in the background, so just click Join again (a retry is usually instant). Also check the key is exact and that the creator's machine is online.",
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

/** UC-03: create a market. It inherits the room's jury policy automatically. */
function CreateMarketModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (question: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const valid = question.trim().length > 0;
  return (
    <ModalShell title="Create market" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>Ask a YES / NO question about the match</FieldLabel>
          <input
            className={inputClass}
            style={inputStyle}
            placeholder="Was the penalty decision correct?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && valid && onCreate(question.trim())}
            autoFocus
          />
        </div>
        <button
          onClick={() => valid && onCreate(question.trim())}
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

/** UC-16: self-custodial wallet onboarding — create new or import existing. */
function WalletModal({
  sidecarOnline,
  current,
  onClose,
  onConnected,
}: {
  sidecarOnline: boolean;
  current: string | null;
  onClose: () => void;
  onConnected: (address: string) => void;
}) {
  const [mode, setMode] = useState<"choose" | "create" | "import">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<string | null>(null); // shown once on create
  const [address, setAddress] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [importText, setImportText] = useState("");

  const useDevice = async () => {
    setBusy(true);
    setError(null);
    const w = await detectWdkWallet();
    setBusy(false);
    if (w) onConnected(w.address);
    else setError("Couldn't read the device wallet — is the sidecar running?");
  };

  const startCreate = async () => {
    setMode("create");
    setBusy(true);
    setError(null);
    try {
      const w = await createWdkWallet();
      setSeed(w.seedPhrase);
      setAddress(w.address);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const addr = await importWdkWallet(importText);
      onConnected(addr);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Your wallet" onClose={onClose}>
      {!sidecarOnline ? (
        <p className="text-sm leading-relaxed" style={{ ...fontBody, color: C.chalk }}>
          A self-custodial WDK wallet needs the local sidecar running. Start it
          (<span style={{ ...fontMono }}>start-host.cmd</span>) and reopen this. Until then
          you play as a local guest.
        </p>
      ) : mode === "choose" ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ ...fontBody, color: C.muted }}>
            Your identity is a self-custodial wallet — you hold the keys, on-device. Every
            stake and payout signs from it on Sepolia.
          </p>
          {current && (
            <button
              onClick={useDevice}
              disabled={busy}
              className="flex items-center justify-between px-4 py-3 rounded-lg border transition-all hover:opacity-90"
              style={{ ...fontBody, borderColor: C.teal + "55", background: "rgba(0,122,122,0.06)" }}
            >
              <span style={{ color: C.chalk }}>Continue with this wallet</span>
              <span className="text-xs" style={{ ...fontMono, color: C.teal }}>{shortWallet(current)}</span>
            </button>
          )}
          <button
            onClick={useDevice}
            disabled={busy}
            className="px-4 py-3 rounded-lg border text-left transition-all hover:opacity-90"
            style={{ ...fontBody, borderColor: C.hairline, color: C.chalk }}
          >
            Use this device's wallet
            <span className="block text-xs" style={{ color: C.muted }}>The wallet already held by this machine's sidecar.</span>
          </button>
          <button
            onClick={startCreate}
            disabled={busy}
            className="px-4 py-3 rounded-lg text-left transition-all hover:opacity-90"
            style={{ ...fontBody, background: C.green, color: "#fff" }}
          >
            Create a new wallet
            <span className="block text-xs" style={{ color: "rgba(255,255,255,0.8)" }}>Generate a fresh self-custodial wallet + recovery phrase.</span>
          </button>
          <button
            onClick={() => { setMode("import"); setError(null); }}
            disabled={busy}
            className="px-4 py-3 rounded-lg border text-left transition-all hover:opacity-90"
            style={{ ...fontBody, borderColor: C.hairline, color: C.chalk }}
          >
            Import existing wallet
            <span className="block text-xs" style={{ color: C.muted }}>Paste a 12/24-word recovery phrase.</span>
          </button>
        </div>
      ) : mode === "create" ? (
        <div className="flex flex-col gap-4">
          {busy || !seed ? (
            <p className="text-sm" style={{ ...fontBody, color: C.muted }}>Generating your wallet…</p>
          ) : (
            <>
              <div>
                <FieldLabel>Your recovery phrase — write it down, never share it</FieldLabel>
                <div
                  className="p-3 rounded-lg border grid grid-cols-3 gap-2"
                  style={{ background: C.bg, borderColor: C.amber + "66" }}
                >
                  {seed.split(" ").map((w, i) => (
                    <span key={i} className="text-sm" style={{ ...fontMono, color: C.chalk }}>
                      <span style={{ color: C.muted }}>{i + 1}.</span> {w}
                    </span>
                  ))}
                </div>
                <p className="text-xs mt-1.5" style={{ ...fontBody, color: C.amber }}>
                  This is the only copy. Anyone with these words controls the wallet; lose
                  them and it's gone. (Demo note: shown in-browser for convenience.)
                </p>
              </div>
              <div className="text-xs" style={{ ...fontMono, color: C.muted }}>
                Address: {address ? shortWallet(address) : "…"}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ ...fontBody, color: C.chalk }}>
                <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} />
                I've saved my recovery phrase
              </label>
              <button
                onClick={() => address && onConnected(address)}
                disabled={!backedUp || !address}
                className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
                style={{ ...fontBody, background: backedUp ? C.green : C.panel2, color: backedUp ? "#fff" : C.muted }}
              >
                Continue
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <FieldLabel>Recovery phrase (12–24 words)</FieldLabel>
          <textarea
            className={`${inputClass} h-20 resize-none`}
            style={{ ...inputStyle, ...fontMono }}
            placeholder="word1 word2 word3 …"
            value={importText}
            onChange={(e) => { setImportText(e.target.value); setError(null); }}
          />
          <button
            onClick={doImport}
            disabled={busy || importText.trim().length === 0}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
            style={{ ...fontBody, background: busy ? C.panel2 : C.green, color: busy ? C.muted : "#fff" }}
          >
            {busy ? "Importing…" : "Import wallet"}
          </button>
          <button onClick={() => { setMode("choose"); setError(null); }} className="text-xs" style={{ ...fontBody, color: C.muted }}>
            ← back
          </button>
        </div>
      )}
      {error && <p className="text-xs mt-3" style={{ ...fontBody, color: C.red }}>{error}</p>}
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
    "createRoom" | "joinRoom" | "createMarket" | "wallet" | null
  >(null);
  const feedStops = useRef<Record<string, () => void>>({});
  const [view, setView] = useState<RoomView | null>(null);
  const [sidecarUp, setSidecarUp] = useState(false);
  const [identity, setIdentity] = useState<LocalIdentity>(() => loadOrCreateIdentity());
  // This device's chosen juror model ("" → use the room default). Persisted so
  // each participant keeps their own "brain" across markets.
  const [jurorModel, setJurorModelState] = useState<string>(() => {
    try {
      return localStorage.getItem("kickoff.jurormodel") ?? "";
    } catch {
      return "";
    }
  });
  const setJurorModel = (m: string) => {
    setJurorModelState(m);
    try {
      localStorage.setItem("kickoff.jurormodel", m);
    } catch {
      /* private mode */
    }
  };

  // Sidecar present → ops replicate cross-machine over its Hyperswarm room node;
  // absent → BroadcastChannel still replicates between tabs on this machine.
  const makeAdapter = (inviteKey: string, viaSidecar: boolean): P2PAdapter =>
    viaSidecar ? new WebSocketAdapter(inviteKey) : new BroadcastChannelAdapter(inviteKey);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const qvac = await detectQvacRuntime();
      if (!cancelled) setSidecarUp(qvac != null);
      // Identity is explicit now: the user picks "Log in with wallet" → create or
      // import a WDK wallet (UC-16). Until then they keep a local placeholder id.
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

  // Jury mode auto-drives verdicts + resolution; the tiebreaker is a manual
  // safety nudge for the creator on a split that hasn't auto-resolved.
  const handleRunFallback = () => {
    void activeEngine?.runFallback(selectedMarketId);
  };
  const handleStake = async (side: Side, amount: bigint): Promise<string | null> => {
    if (!activeEngine || !view?.room) return "No active room.";
    const host = view.room.creator;
    let txRef: string | undefined;
    // Real chain interaction: the stake moves staker → host escrow on Sepolia
    // whenever the full WDK path exists. The host's own stakes stay in their
    // wallet (already at the escrow), so no self-transfer is made.
    if (
      sidecarUp &&
      identity.source === "wdk" &&
      host.startsWith("0x") &&
      host.toLowerCase() !== identity.wallet.toLowerCase()
    ) {
      try {
        txRef = await executeStakeTransfer(host, amount);
      } catch (e) {
        return `On-chain stake failed: ${(e as Error).message}`;
      }
    }
    activeEngine.placeStake(selectedMarketId, identity.wallet, side, amount, txRef);
    return null;
  };
  // Staking auto-closes and evidence auto-locks at full time; each participant
  // then runs their OWN chosen model on the locked feed.
  const handleJudge = () => {
    const model = jurorModel || view?.room?.policy.jury?.model;
    void activeEngine?.castJuryVerdict(selectedMarketId, model);
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

  const handleCreateRoom = async (input: {
    name: string;
    matchContext: string;
    feedMatchId: string;
    fixture: MatchFixture;
    policy: RoomPolicy;
  }) => {
    const qvac = await detectQvacRuntime();
    const key = `room_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const engine = new KickoffEngine({
      runtime: qvac ?? new MockOracleRuntime(1200),
      runtimeLabel: qvac ? "Runs locally via QVAC — models chosen per room · no cloud" : undefined,
      adapter: makeAdapter(key, qvac != null),
      onSettlement: qvac ? executeOnChainSettlement : undefined,
      autoJury: true, // this device auto-casts its juror verdict; creator tallies quorum
    });
    engine.adoptIdentity(asParticipant(identity));
    engine.createRoom({
      name: input.name,
      matchContext: input.matchContext,
      inviteKey: key,
      feedMatchId: input.feedMatchId,
      policy: input.policy,
    });
    // The creator's client drives the real match feed (already fetched + validated).
    feedStops.current[key] = startMatchFeed(engine, input.fixture);
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

  const handleJoinRoom = async (rawKey: string): Promise<JoinResult> => {
    const key = rawKey.trim();
    if (!key) return { ok: false, reason: "empty" };

    // Rooms already known in this session first.
    const local = Object.keys(rooms).find((r) => r.toLowerCase() === key.toLowerCase());
    if (local) {
      activateRoom(local, rooms[local]);
      return { ok: true };
    }

    // Unknown key → join over P2P: connect to the swarm topic via the sidecar
    // and wait for the room's op log to arrive from its peers (UC-02).
    // Detect the sidecar NOW rather than trusting page-load state — it may
    // have been started after the page loaded.
    const qvac = await detectQvacRuntime();
    if (!qvac) return { ok: false, reason: "no-sidecar" }; // sidecar down → no cross-machine transport
    if (!sidecarUp) setSidecarUp(true);
    const engine = new KickoffEngine({
      runtime: qvac,
      runtimeLabel: "Runs locally via QVAC — models chosen per room · no cloud",
      adapter: makeAdapter(key, true),
      onSettlement: executeOnChainSettlement,
      autoJury: true, // this device auto-casts its juror verdict
    });
    const guest = asParticipant(identity);
    engine.adoptIdentity(guest);
    // First DHT contact for a topic can take 30-90s; keep searching for 90s.
    // The sidecar stays joined to the swarm afterwards, so a retry is fast.
    const found = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve(false);
      }, 90_000);
      const unsub = engine.subscribe((v) => {
        if (v.room) {
          clearTimeout(timer);
          unsub();
          resolve(true);
        }
      });
    });
    if (!found) return { ok: false, reason: "not-found" };
    engine.joinAs(guest); // announce ourselves: avatar appears on every peer
    // If we are this room's creator rejoining after a reload, resume the feed.
    const joinedRoom = engine.getView().room;
    if (joinedRoom?.creator === identity.wallet && !feedStops.current[key]) {
      const remote = joinedRoom.feedMatchId ? await fetchMatchFixture(joinedRoom.feedMatchId) : null;
      if (remote) feedStops.current[key] = startMatchFeed(engine, remote);
    }
    setRooms((prev) => ({ ...prev, [key]: engine }));
    activateRoom(key, engine);
    return { ok: true };
  };

  const handleCreateMarket = (question: string) => {
    if (!activeEngine) return;
    const id = activeEngine.createMarket({ question, category: "INTERPRETIVE" });
    setSelectedMarketId(id);
    setModal(null);
  };
  const handleWalletConnected = (address: string) => {
    setIdentity(saveWdkIdentity(address));
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
              onLoginWallet={() => setModal("wallet")}
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
              jurorModel={jurorModel}
              onJurorModel={setJurorModel}
              onJudge={handleJudge}
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
        <CreateMarketModal onClose={() => setModal(null)} onCreate={handleCreateMarket} />
      )}
      {modal === "wallet" && (
        <WalletModal
          sidecarOnline={sidecarUp}
          current={identity.source === "wdk" ? identity.wallet : null}
          onClose={() => setModal(null)}
          onConnected={handleWalletConnected}
        />
      )}
    </div>
  );
}
