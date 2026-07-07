require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

// Gemini is optional now — only loaded if the package is installed.
let GoogleGenerativeAI = null;
try { ({ GoogleGenerativeAI } = require('@google/generative-ai')); } catch { /* not installed — fine */ }

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow large JSON payloads
app.use(express.static(__dirname));

// ---- Providers (initialised only if their key exists) ----
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const genAI = (GoogleGenerativeAI && process.env.GEMINI_API_KEY)
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// Swap models via .env if you like. Opus = highest quality, Haiku = fastest/cheapest.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ---- Prompt ----
function buildPrompt(uiData) {
  return `You are an expert front-end engineer who ports a Roblox GUI tree into a faithful, INTERACTIVE HTML reproduction. Fidelity to the given tree is the top priority — this is a port, not a redesign.

Below is a JSON tree of a Roblox GUI. Value formats: Color3 = {r,g,b} 0-255; UDim2 = {xs,xo,ys,yo} (scale, offset per axis); UDim = {s,o}; fonts as Enum values.

STRICT FIDELITY RULES (do not violate these):
- Emit exactly one HTML element per node in the JSON tree, preserving the same nesting/hierarchy. Do not merge, split, omit, or reorder nodes.
- Do not invent extra decorative elements, characters, illustrations, icons, or scenery that are not represented by a node in the JSON. If a node is a plain Frame, render it as a plain rectangle with its given styling — do not turn it into art.
- Map every given property exactly: Color3 -> rgb(); UDim2 -> position/size as calc(scale% + offset px); UDim -> border-radius/padding/spacing offset px; UICorner -> border-radius; UIStroke -> inset border; UIListLayout -> flexbox (direction/padding/alignment from its props); UIPadding -> padding; BackgroundTransparency/TextTransparency -> rgba alpha; text props -> exact font-weight/size/color/alignment/wrap.
- Backdrop behind the GUI itself must stay minimal and neutral (e.g. a plain dark or softly shaded rectangle) purely so translucent panels read correctly — it must not depict a scene, characters, or unrelated imagery.

BEHAVIOR INFERENCE (apply only to elements that exist in the tree, but infer their real purpose — don't just make them decorative):
Read every available signal on each node — its Name, ClassName, Text/PlaceholderText, and its position among siblings/parent — to figure out what real feature it is part of, then implement that feature's FULL interaction loop, not just a cosmetic hover state. Recognize patterns like these wherever the naming/structure implies them (this list is illustrative, not exhaustive — apply the same reasoning to archetypes not listed here):
- A ScrollingFrame/Frame driven by a UIListLayout whose sibling is a TextBox+submit control (e.g. names like Messages/Log/Feed/Chat, or an input whose PlaceholderText talks about typing/commands): treat it as an append-only list. Submitting (Enter key and/or a send button) should add a new row using the typed text, clear the input, keep focus, and auto-scroll to the bottom. Seed it with a few plausible pre-existing rows first so it doesn't look empty.
- A TextBox whose PlaceholderText or Name implies commands (mentions "/", "command", "slash", etc.) paired with an otherwise-empty sibling Frame/List: treat that sibling as a live autocomplete/suggestion panel. Infer a small set of plausible commands from any other text in the tree (labels, mode names, button text) and filter/show them as the user types a trigger character; clicking or Tab-completing a suggestion should fill the input.
- A button (Name/Text like Mode/Options/Dropdown/▾) paired with a nearby Frame containing several TextButtons: treat the frame as a menu — the button toggles its visibility, and clicking an option updates the toggle button's label/state and closes the menu. If the option labels suggest mutually exclusive modes (e.g. Whisper/Normal/Shout, On/Off, tabs), persist the selected mode and let it visibly affect subsequent behavior (e.g. tag or color later submissions accordingly).
- Elements whose Name/Text implies transience (Bubble, Toast, Popup, Notification, Alert, Tooltip) must appear only for a few seconds and then fade/disappear automatically — never persist indefinitely.
- Numeric/resource displays (health, currency, progress, XP) should animate/tween value changes smoothly rather than snapping instantly.
- TextButtons/ImageButtons in general: hover + active states; if their Text/Name implies a specific action, wire it to the relevant existing nodes.
- You may seed realistic sample content (list rows, placeholder values) consistent with what the structure implies, but never add rows/items/elements that have no corresponding node in the JSON.

Return ONE self-contained HTML document (inline <style> + <script>, optionally a Google Fonts <link>). Return ONLY raw HTML, no markdown fences, no commentary.

JSON:
${JSON.stringify(uiData, null, 1)}`;
}

const stripFences = (s) => s.replace(/^```html/i, '').replace(/^```/, '').replace(/```$/i, '').trim();

// ---- Generators ----
async function generateWithClaude(uiData) {
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000, // room for a full interactive HTML file
    messages: [{ role: 'user', content: buildPrompt(uiData) }],
  });
  // Claude returns an array of content blocks; concatenate the text ones.
  const html = (msg.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return stripFences(html);
}

async function generateWithGemini(uiData) {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  const result = await model.generateContent(buildPrompt(uiData));
  return stripFences(result.response.text());
}

// ---- Route (same path/shape as before) ----
// Default provider is Claude. Add ?provider=gemini to use the fallback.
app.post('/api/generate-preview', async (req, res) => {
  const provider = (req.query.provider || 'claude').toLowerCase();
  try {
    let html;
    if (provider === 'gemini') {
      if (!genAI) return res.status(400).json({ error: 'Gemini not configured. Set GEMINI_API_KEY and install @google/generative-ai.' });
      html = await generateWithGemini(req.body);
    } else {
      if (!anthropic) return res.status(400).json({ error: 'Claude not configured. Set ANTHROPIC_API_KEY in your .env file.' });
      html = await generateWithClaude(req.body);
    }

    if (!html) throw new Error('Model returned an empty response.');
    res.json({ html, provider, model: provider === 'gemini' ? GEMINI_MODEL : CLAUDE_MODEL });
  } catch (error) {
    console.error(`[${provider}] generation error:`, error.message);
    res.status(500).json({ error: 'Failed to generate preview.', detail: error.message });
  }
});

// Quick health/config check: GET /health
app.get('/health', (_req, res) => res.json({ ok: true, claude: !!anthropic, gemini: !!genAI }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Proxy Server running on http://localhost:${PORT}`);
  console.log(`  Claude: ${anthropic ? `ready (${CLAUDE_MODEL})` : 'NOT configured — set ANTHROPIC_API_KEY'}`);
  console.log(`  Gemini: ${genAI ? `ready (${GEMINI_MODEL})` : 'not configured (optional)'}`);
});