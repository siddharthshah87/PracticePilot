// Workflow Knowledge Builder
// Reads all recorded sessions from workflows/ and builds a consolidated
// knowledge base of Curve Hero workflows, UI patterns, and element selectors.
// Run: node build-knowledge.mjs

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(__dirname, 'workflows');
const knowledgePath = join(workflowsDir, 'knowledge.md');
const patternsPath = join(workflowsDir, 'patterns.json');

function loadAllSessions() {
  if (!existsSync(workflowsDir)) return [];
  const sessions = [];
  for (const dir of readdirSync(workflowsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const eventsFile = join(workflowsDir, dir.name, 'events.jsonl');
    if (!existsSync(eventsFile)) continue;
    const lines = readFileSync(eventsFile, 'utf-8').trim().split('\n');
    const events = lines.filter(l => l).map(l => JSON.parse(l));
    sessions.push({ id: dir.name, events });
  }
  return sessions;
}

function extractPatterns(sessions) {
  // Track: element selectors, click targets, navigation flows, section usage
  const selectorFreq = {};     // selector -> count
  const clickTargets = {};     // text label -> { selector, section, count }
  const navFlows = [];         // sequence of URLs per session
  const sectionUsage = {};     // section name -> { clicks, inputs }
  const inputFields = {};      // selector -> { name, placeholder, section, count }
  const workflows = [];        // detected step sequences

  for (const session of sessions) {
    const navFlow = [];
    let currentWorkflow = { steps: [], section: '' };

    for (const evt of session.events) {
      // Selector frequency
      if (evt.selector) {
        selectorFreq[evt.selector] = (selectorFreq[evt.selector] || 0) + 1;
      }

      // Click targets
      if (evt.type === 'click' && evt.text) {
        const key = evt.text.slice(0, 50);
        if (!clickTargets[key]) {
          clickTargets[key] = { selector: evt.selector, section: evt.section, count: 0 };
        }
        clickTargets[key].count++;
      }

      // Navigation
      if (evt.type === 'navigation') {
        navFlow.push(evt.url);
      }

      // Section usage
      if (evt.section) {
        if (!sectionUsage[evt.section]) {
          sectionUsage[evt.section] = { clicks: 0, inputs: 0 };
        }
        if (evt.type === 'click') sectionUsage[evt.section].clicks++;
        if (evt.type === 'input') sectionUsage[evt.section].inputs++;
      }

      // Input fields
      if (evt.type === 'input' || evt.type === 'focus') {
        const key = evt.selector || evt.name || evt.placeholder;
        if (key && !inputFields[key]) {
          inputFields[key] = { name: evt.name, placeholder: evt.placeholder, section: evt.section, count: 0 };
        }
        if (key) inputFields[key].count++;
      }

      // Workflow detection — group by section transitions
      const section = evt.section || '';
      if (section !== currentWorkflow.section && evt.type !== 'screenshot' && evt.type !== 'note') {
        if (currentWorkflow.steps.length > 0) {
          workflows.push({ ...currentWorkflow });
        }
        currentWorkflow = { section, steps: [] };
      }
      if (evt.type !== 'screenshot') {
        currentWorkflow.steps.push({
          type: evt.type,
          selector: evt.selector,
          text: evt.text,
          value: evt.value,
        });
      }
    }

    if (currentWorkflow.steps.length > 0) workflows.push(currentWorkflow);
    if (navFlow.length > 0) navFlows.push(navFlow);
  }

  return { selectorFreq, clickTargets, navFlows, sectionUsage, inputFields, workflows };
}

function generateKnowledgeDoc(sessions, patterns) {
  let md = `# Curve Hero — Learned Workflows & UI Knowledge\n\n`;
  md += `*Auto-generated from ${sessions.length} recorded session(s)*\n`;
  md += `*Last updated: ${new Date().toISOString()}*\n\n`;

  // Most-used UI sections
  md += `## Sections Used\n\n`;
  const sections = Object.entries(patterns.sectionUsage)
    .sort((a, b) => (b[1].clicks + b[1].inputs) - (a[1].clicks + a[1].inputs));
  for (const [section, usage] of sections.slice(0, 20)) {
    md += `- **${section}**: ${usage.clicks} clicks, ${usage.inputs} inputs\n`;
  }

  // Most-clicked elements
  md += `\n## Frequently Clicked Elements\n\n`;
  md += `| Label | Selector | Section | Count |\n|-------|----------|---------|-------|\n`;
  const clicks = Object.entries(patterns.clickTargets)
    .sort((a, b) => b[1].count - a[1].count);
  for (const [label, info] of clicks.slice(0, 30)) {
    const safeLabel = label.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 40);
    const safeSel = (info.selector || '').replace(/\|/g, '\\|').slice(0, 50);
    md += `| ${safeLabel} | \`${safeSel}\` | ${(info.section || '').slice(0, 20)} | ${info.count} |\n`;
  }

  // Input fields
  md += `\n## Input Fields Encountered\n\n`;
  for (const [sel, info] of Object.entries(patterns.inputFields).slice(0, 20)) {
    md += `- \`${sel.slice(0, 60)}\` — name: "${info.name}", placeholder: "${info.placeholder}", section: ${info.section} (×${info.count})\n`;
  }

  // Navigation flows
  md += `\n## Navigation Patterns\n\n`;
  for (let i = 0; i < Math.min(patterns.navFlows.length, 5); i++) {
    md += `### Session ${i + 1}\n`;
    for (const url of patterns.navFlows[i]) {
      // Strip base URL for readability
      const short = url.replace(/https?:\/\/[^/]+/, '');
      md += `  → ${short || '/'}\n`;
    }
    md += '\n';
  }

  // Detected workflow sequences
  md += `## Detected Workflow Steps\n\n`;
  const uniqueWorkflows = new Map();
  for (const wf of patterns.workflows) {
    const key = wf.section + ':' + wf.steps.map(s => s.type + ':' + (s.text || s.value || '')).join('|');
    if (!uniqueWorkflows.has(key)) {
      uniqueWorkflows.set(key, wf);
    }
  }
  let wfIdx = 0;
  for (const [, wf] of uniqueWorkflows) {
    if (wf.steps.length < 2) continue;
    wfIdx++;
    md += `### Workflow ${wfIdx}: ${wf.section || 'Page'}\n`;
    for (const step of wf.steps.slice(0, 15)) {
      md += `${step.type === 'click' ? '1.' : '-'} ${step.type} \`${(step.selector || '').slice(0, 50)}\` — ${(step.text || step.value || '').slice(0, 60)}\n`;
    }
    if (wf.steps.length > 15) md += `  ... +${wf.steps.length - 15} more steps\n`;
    md += '\n';
  }

  return md;
}

// Main
const sessions = loadAllSessions();
if (sessions.length === 0) {
  console.log('No recorded sessions found in workflows/');
  console.log('Run `node observe.mjs` first to record a session.');
  process.exit(0);
}

console.log(`Found ${sessions.length} session(s), ${sessions.reduce((s, x) => s + x.events.length, 0)} total events`);

const patterns = extractPatterns(sessions);
const knowledgeDoc = generateKnowledgeDoc(sessions, patterns);

writeFileSync(knowledgePath, knowledgeDoc);
writeFileSync(patternsPath, JSON.stringify(patterns, null, 2));

console.log(`✓ Knowledge base written to ${knowledgePath}`);
console.log(`✓ Patterns JSON written to ${patternsPath}`);
