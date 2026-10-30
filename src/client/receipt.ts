// "How was this made?" panel (ADR 0060). The radial menu offers it on any object: the server
// sends the receipt it kept when the mod was built (your words, Spark's route, Wonder's code
// and its own test, the verifier's proof, Muse Image's prompt and sheet, the timings) and this
// file draws it as one vertical chain. The proof rows tick green one by one, so "verified"
// is something you watch happen rather than a word on a card.
//
// Nothing here calls a model, and the server spends nothing to answer.
import "./receipt.css";
import type { BuildReceipt, ClientMsg } from "../contract";
import { receiptSteps, timeSegments, type ReceiptStep } from "./receipt-model";
import { isMagenta } from "./sprites";

export interface ReceiptTarget { modId: string; title: string; entityType: string }

export interface ReceiptOptions {
  host: HTMLElement;
  send: (msg: ClientMsg) => void;
  say: (text: string, state?: string) => void;
  connected: () => boolean;
  log: (text: string) => void;
}

const ICON: Record<ReceiptStep["tone"], string> = { you: "🗣", model: "✦", rejected: "✗", proof: "✓", art: "🎨", live: "▶", note: "ℹ" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The raw Muse Image sheet beside the browser's cut-out of it: the image-to-asset step, visible. */
function artPair(url: string): HTMLElement {
  const wrap = el("div", "receipt-art");
  const raw = el("figure");
  const img = el("img");
  img.alt = "Muse Image sprite sheet";
  img.src = url;
  raw.append(img, el("figcaption", undefined, "Muse Image output"));
  const cut = el("figure", "receipt-cut");
  const canvas = el("canvas");
  cut.append(canvas, el("figcaption", undefined, "Cut out in your browser"));
  img.addEventListener("load", () => {
    try {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) if (isMagenta(px[i], px[i + 1], px[i + 2])) px[i + 3] = 0;
      ctx.putImageData(data, 0, 0);
    } catch { cut.hidden = true; }
  }, { once: true });
  img.addEventListener("error", () => { wrap.hidden = true; }, { once: true });
  wrap.append(raw, cut);
  return wrap;
}

export function initReceipt(opts: ReceiptOptions) {
  const panel = el("section");
  panel.id = "receipt-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "How this was made");

  const head = el("header", "receipt-head");
  const badge = el("span", "receipt-badge", "How was this made?");
  const titleEl = el("h3", "receipt-title");
  const closeBtn = el("button", "receipt-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  head.append(badge, titleEl, closeBtn);
  const body = el("div", "receipt-body");
  panel.append(head, body);
  opts.host.appendChild(panel);

  let target: ReceiptTarget | null = null;

  function note(text: string): void {
    body.replaceChildren(el("p", "receipt-wait", text));
  }

  function open(t: ReceiptTarget): void {
    target = t;
    titleEl.textContent = t.title || t.entityType;
    panel.hidden = false;
    if (t.modId === "engine") { note("This belongs to the engine itself: the loop, gravity and collisions. Everything you build sits on top of it as a mod, and every mod has a receipt."); return; }
    if (!opts.connected()) { note("The receipt lives on the server, and the server is not connected right now."); return; }
    note("Fetching the receipt…");
    opts.send({ kind: "receipt", modId: t.modId });
  }

  function close(): void {
    target = null;
    panel.hidden = true;
  }

  function render(r: BuildReceipt): void {
    titleEl.textContent = r.title || titleEl.textContent;
    const list = el("ol", "receipt-chain");
    let tick = 0;
    for (const s of receiptSteps(r)) {
      const li = el("li", `receipt-step tone-${s.tone}`);
      const top = el("div", "receipt-step-top");
      top.append(el("span", "receipt-icon", ICON[s.tone]), el("strong", undefined, s.title), el("span", "receipt-by", s.by));
      if (s.secs !== undefined) top.append(el("span", "receipt-secs", `${s.secs.toFixed(1)} s`));
      li.append(top);
      for (const line of s.lines) li.append(el("p", "receipt-line", line));
      if (s.checks && s.checks.length > 0) {
        const ul = el("ul", "receipt-checks");
        for (const c of s.checks) {
          const row = el("li", c.ok ? "ok" : "bad", c.text);
          row.style.animationDelay = `${180 + tick++ * 140}ms`;
          ul.append(row);
        }
        li.append(ul);
      }
      if (s.tone === "art" && r.art?.url) li.append(artPair(r.art.url));
      if (s.code) {
        const d = el("details", "receipt-code");
        d.append(el("summary", undefined, s.code.label), el("pre", undefined, s.code.text));
        li.append(d);
      }
      list.append(li);
    }
    body.replaceChildren(list);
    if (r.timings && r.timings.total > 0) {
      const bar = el("div", "receipt-time");
      for (const seg of timeSegments(r.timings)) {
        const part = el("span", `seg seg-${seg.label}`, `${seg.label} ${(seg.ms / 1000).toFixed(1)} s`);
        part.style.flexGrow = String(Math.max(0.08, seg.frac));
        bar.append(part);
      }
      body.append(bar);
    }
  }

  function onMsg(msg: { kind: "receiptResult"; receipt: BuildReceipt }): void {
    if (panel.hidden || !target || msg.receipt.modId !== target.modId) return;
    render(msg.receipt);
    opts.say(`Here is how ${msg.receipt.title || "it"} was made.`, "done");
    opts.log(`receipt: ${msg.receipt.modId} (${msg.receipt.origin}, ${msg.receipt.versions.length} version${msg.receipt.versions.length === 1 ? "" : "s"})`);
  }

  closeBtn.addEventListener("click", close);
  addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !panel.hidden) close(); });
  document.addEventListener("pointerdown", (ev) => {
    if (panel.hidden) return;
    const n = ev.target as Node | null;
    if (n && panel.contains(n)) return;
    close();
  });

  return { open, close, onMsg, isOpen: () => !panel.hidden };
}
