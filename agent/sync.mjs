// Sync — strip PHI from recorded sessions, build patterns, commit & push.
// Run: node sync.mjs
// Safe to run on the clinic computer — sanitized output only.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(__dirname, 'workflows');
const learnedDir = join(__dirname, 'learned');

// --- PHI stripping ---

// Patterns that look like patient names, emails, phones, etc.
const PHI_PATTERNS = [
  // Names: 2+ capitalized words, including hyphenated (First Last, First Middle-Last (NP))
  /\b[A-Z][a-z]+(?:[\s\-]+[A-Z][a-z\-]+){1,4}(?:\s*\(NP\))?/g,
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Phone numbers (various formats)
  /\b\d{10,11}\b/g,
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}/g,
  // SSN
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // Date of birth patterns
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  // Street addresses (number + street name)
  /\b\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Ct|Way|Pl|Pkwy|Cir)\b/gi,
];

// Fields that should always be fully redacted
const REDACT_FIELDS = ['value'];

// Fields where PHI patterns should be replaced
const SCRUB_FIELDS = ['text', 'selector', 'action', 'note', 'url'];

function scrubString(str) {
  if (!str || typeof str !== 'string') return str;
  let result = str;
  for (const pattern of PHI_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  // Clean up orphaned name fragments after redaction (e.g. [REDACTED]McCullough)
  result = result.replace(/\[REDACTED\]\s*[A-Z][a-z\-]+(?:\s*\(NP\))?/g, '[REDACTED]');
  return result;
}

function sanitizeEvent(evt) {
  const clean = { ...evt };

  // Always redact values (could be typed patient data)
  if (clean.value !== undefined) {
    clean.value = '[REDACTED]';
  }

  // Scrub PHI patterns from text fields
  for (const field of SCRUB_FIELDS) {
    if (clean[field]) {
      clean[field] = scrubString(clean[field]);
    }
  }

  // Keep: type, selector, tag, htmlType, placeholder, name, role, cls, title,
  //        section, x, y, w, h, seq, ts, file, label
  // These are UI structure, not patient data.

  return clean;
}

// --- Load sessions ---

function loadAllSessions() {
  if (!existsSync(workflowsDir)) return [];
  const sessions = [];
  for (const dir of readdirSync(workflowsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const eventsFile = join(workflowsDir, dir.name, 'events.jsonl');
    if (!existsSync(eventsFile)) continue;
    const lines = readFileSync(eventsFile, 'utf-8').trim().split('\n');
    const events = lines.filter(l => l).map(l => JSON.parse(l));
    sessions.push({ id: dir.name, events, eventCount: events.length });
  }
  return sessions;
}

// --- Build patterns (same as build-knowledge but on sanitized data) ---

function extractPatterns(sessions) {
  const selectorFreq = {};
  const clickTargets = {};
  const navFlows = [];
  const sectionUsage = {};
  const inputFields = {};
  const workflows = [];

  for (const session of sessions) {
    const navFlow = [];
    let currentWorkflow = { steps: [], section: '' };

    for (const evt of session.events) {
      if (evt.selector) {
        selectorFreq[evt.selector] = (selectorFreq[evt.selector] || 0) + 1;
      }

      if (evt.type === 'click' && evt.text) {
        const key = evt.text.slice(0, 50);
        if (!clickTargets[key]) {
          clickTargets[key] = { selector: evt.selector, section: evt.section, count: 0 };
        }
        clickTargets[key].count++;
      }

      if (evt.type === 'navigation' && evt.url) {
        // Strip query params and keep just path
        try {
          const u = new URL(evt.url);
          navFlow.push(u.pathname);
        } catch {
          navFlow.push(evt.url);
        }
      }

      if (evt.section) {
        if (!sectionUsage[evt.section]) {
          sectionUsage[evt.section] = { clicks: 0, inputs: 0, focuses: 0 };
        }
        if (evt.type === 'click') sectionUsage[evt.section].clicks++;
        if (evt.type === 'input') sectionUsage[evt.section].inputs++;
        if (evt.type === 'focus') sectionUsage[evt.section].focuses++;
      }

      if ((evt.type === 'input' || evt.type === 'focus') && evt.selector) {
        if (!inputFields[evt.selector]) {
          inputFields[evt.selector] = {
            name: evt.name, placeholder: evt.placeholder,
            htmlType: evt.htmlType, section: evt.section, count: 0,
          };
        }
        inputFields[evt.selector].count++;
      }

      const section = evt.section || '';
      if (section !== currentWorkflow.section && evt.type !== 'screenshot' && evt.type !== 'note') {
        if (currentWorkflow.steps.length > 0) workflows.push({ ...currentWorkflow });
        currentWorkflow = { section, steps: [] };
      }
      if (evt.type !== 'screenshot') {
        currentWorkflow.steps.push({
          type: evt.type,
          selector: evt.selector,
          text: evt.text,
          htmlType: evt.htmlType,
        });
      }
    }

    if (currentWorkflow.steps.length > 0) workflows.push(currentWorkflow);
    // Deduplicate consecutive identical nav paths
    const dedupedNav = [];
    for (const p of navFlow) {
      if (dedupedNav[dedupedNav.length - 1] !== p) dedupedNav.push(p);
    }
    if (dedupedNav.length > 0) navFlows.push(dedupedNav);
  }

  return { selectorFreq, clickTargets, navFlows, sectionUsage, inputFields, workflows };
}

// --- Generate clean knowledge doc ---

function generateKnowledge(sessions, patterns) {
  let md = `# Curve Hero — Learned Workflows\n\n`;
  md += `*${sessions.length} sessions, ${sessions.reduce((s, x) => s + x.eventCount, 0)} events*\n`;
  md += `*Updated: ${new Date().toISOString().slice(0, 16)}*\n\n`;

  // Sections
  const sections = Object.entries(patterns.sectionUsage)
    .sort((a, b) => (b[1].clicks + b[1].inputs) - (a[1].clicks + a[1].inputs));
  if (sections.length) {
    md += `## UI Sections\n\n`;
    for (const [section, u] of sections.slice(0, 25)) {
      md += `- **${section}**: ${u.clicks} clicks, ${u.inputs} inputs\n`;
    }
    md += '\n';
  }

  // Click targets
  const clicks = Object.entries(patterns.clickTargets).sort((a, b) => b[1].count - a[1].count);
  if (clicks.length) {
    md += `## Click Targets\n\n`;
    md += `| Label | Selector | Section | # |\n|-------|----------|---------|---|\n`;
    for (const [label, info] of clicks.slice(0, 30)) {
      const l = label.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 40);
      const s = (info.selector || '').replace(/\|/g, '\\|').slice(0, 60);
      md += `| ${l} | \`${s}\` | ${(info.section || '').slice(0, 20)} | ${info.count} |\n`;
    }
    md += '\n';
  }

  // Input fields
  if (Object.keys(patterns.inputFields).length) {
    md += `## Input Fields\n\n`;
    for (const [sel, info] of Object.entries(patterns.inputFields).slice(0, 20)) {
      md += `- \`${sel.slice(0, 60)}\` type=${info.htmlType} name="${info.name}" section=${info.section} (x${info.count})\n`;
    }
    md += '\n';
  }

  // Nav flows (clean paths only)
  if (patterns.navFlows.length) {
    md += `## Navigation Flows\n\n`;
    for (let i = 0; i < Math.min(patterns.navFlows.length, 5); i++) {
      md += `**Session ${i + 1}:** `;
      md += patterns.navFlows[i].map(p => `\`${p}\``).join(' → ');
      md += '\n\n';
    }
  }

  // Workflows
  const uniqueWfs = new Map();
  for (const wf of patterns.workflows) {
    if (wf.steps.length < 2) continue;
    const key = wf.section + ':' + wf.steps.slice(0, 5).map(s => s.type).join(',');
    if (!uniqueWfs.has(key)) uniqueWfs.set(key, wf);
  }
  if (uniqueWfs.size) {
    md += `## Workflow Sequences\n\n`;
    let idx = 0;
    for (const [, wf] of uniqueWfs) {
      idx++;
      md += `### ${idx}. ${wf.section || 'Page'}\n`;
      for (const step of wf.steps.slice(0, 12)) {
        const label = step.text || step.htmlType || '';
        md += `- ${step.type}: \`${(step.selector || '').slice(0, 50)}\` ${label.slice(0, 50)}\n`;
      }
      if (wf.steps.length > 12) md += `- ... +${wf.steps.length - 12} more\n`;
      md += '\n';
    }
  }

  return md;
}

// --- Main ---

console.log('=== Sync: Strip PHI → Build Patterns → Push ===\n');

const sessions = loadAllSessions();
if (sessions.length === 0) {
  console.log('No sessions found in workflows/. Record some first with: node observe.mjs');
  process.exit(0);
}

console.log(`Found ${sessions.length} session(s), ${sessions.reduce((s, x) => s + x.eventCount, 0)} total events`);

// Sanitize all events
const sanitizedSessions = sessions.map(s => ({
  id: s.id,
  eventCount: s.eventCount,
  events: s.events.map(sanitizeEvent),
}));

// Build patterns from sanitized data
const patterns = extractPatterns(sanitizedSessions);
const knowledge = generateKnowledge(sanitizedSessions, patterns);

// Write to learned/ (committed to git)
mkdirSync(learnedDir, { recursive: true });

// Session manifest (which sessions have been processed)
const manifest = {
  lastSync: new Date().toISOString(),
  sessions: sanitizedSessions.map(s => ({ id: s.id, events: s.eventCount })),
};
writeFileSync(join(learnedDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Sanitized events (all sessions merged, PHI stripped)
const allEvents = sanitizedSessions.flatMap(s =>
  s.events.map(e => ({ ...e, session: s.id }))
);
writeFileSync(join(learnedDir, 'events-sanitized.jsonl'),
  allEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

// Patterns & knowledge
writeFileSync(join(learnedDir, 'patterns.json'), JSON.stringify(patterns, null, 2));
writeFileSync(join(learnedDir, 'knowledge.md'), knowledge);

console.log(`\n✓ Sanitized ${allEvents.length} events → learned/events-sanitized.jsonl`);
console.log(`✓ Patterns → learned/patterns.json`);
console.log(`✓ Knowledge → learned/knowledge.md`);

// Git commit & push
console.log('\nCommitting to git...');
try {
  execSync('git add learned/', { cwd: __dirname, stdio: 'pipe' });
  const msg = `sync: ${sessions.length} sessions, ${allEvents.length} events (PHI stripped)`;
  execSync(`git commit -m "${msg}"`, { cwd: __dirname, stdio: 'pipe' });
  console.log('✓ Committed');

  execSync('git push', { cwd: __dirname, stdio: 'pipe' });
  console.log('✓ Pushed to remote');
} catch (e) {
  const stderr = e.stderr ? e.stderr.toString() : '';
  if (stderr.includes('nothing to commit') || e.stdout?.toString().includes('nothing to commit')) {
    console.log('  (nothing new to commit)');
  } else {
    console.log('  Git push failed — you can push manually:', stderr.slice(0, 200));
  }
}

console.log('\n=== Done! Sanitized learnings are now in the repo. ===');
