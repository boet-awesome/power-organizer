// ai.js — client for the AI features. Each user supplies their own Google
// Gemini API key (Settings screen). The key lives only in this browser's
// localStorage and requests go straight from the browser to Google — there is
// no proxy and nothing is sent to the app's own server.

const KEY_STORAGE = 'po-ai-key';

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}
export function setApiKey(key) {
  if (key && key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
}
export function hasApiKey() {
  return !!getApiKey();
}

// Gemini's non-versioned alias, so this keeps working as Google retires dated
// model versions. Flash-Lite has the most generous free-tier daily quota; swap
// to 'gemini-flash-latest' for higher quality at a lower daily request cap.
const AI_MODEL = 'gemini-flash-lite-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`;

// Calls Google directly from the browser with the user's own key. No server of
// ours is involved, so the key and the prompt only ever go to Google.
async function callAI(system, prompt, maxTokens = 1024) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your Gemini API key in Settings first.' };
  let res, data;
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: 'user', parts: [{ text: String(prompt) }] }],
        generationConfig: { maxOutputTokens: Math.min(Math.max(parseInt(maxTokens, 10) || 1024, 1), 4096) }
      })
    });
    data = await res.json();
  } catch (e) {
    return { ok: false, error: 'Could not reach Google\'s AI service. Check your connection.' };
  }
  if (!res.ok) {
    if (res.status === 400 || res.status === 403) return { ok: false, error: 'Google rejected the request — check that your Gemini API key is correct.' };
    if (res.status === 429) return { ok: false, error: 'Gemini free-tier limit reached for now — try again later.' };
    return { ok: false, error: data?.error?.message || 'AI request failed' };
  }
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!text) return { ok: false, error: 'Gemini returned an empty response (it may have blocked the prompt) — try again.' };
  return { ok: true, text };
}

// Models are told to respond with ONLY JSON, but strip ```json fences
// defensively in case one slips through.
function extractJson(text) {
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ---------- 1. Break a task/goal down into subtasks ----------
export async function aiBreakdown(title, description) {
  const system = 'You turn a task or goal into a short, concrete checklist of subtasks. Respond with ONLY a JSON array of strings — no prose, no markdown fences. 3 to 7 items, each a short actionable step, ordered sensibly.';
  const prompt = `Task: ${title}${description ? `\nDetails: ${description}` : ''}`;
  const result = await callAI(system, prompt, 512);
  if (!result.ok) return result;
  try {
    const items = extractJson(result.text);
    if (!Array.isArray(items)) throw new Error('not an array');
    const subtasks = items.filter(s => typeof s === 'string' && s.trim()).slice(0, 10);
    if (!subtasks.length) throw new Error('empty');
    return { ok: true, subtasks };
  } catch (e) {
    return { ok: false, error: 'Could not parse the AI response — try again.' };
  }
}

// ---------- 2. Natural-language quick add -> structured task fields ----------
export async function aiQuickAdd(text) {
  const system = `Parse a quick task note into structured fields for a to-do app. Respond with ONLY JSON, no prose, no markdown fences, matching exactly this shape:
{"title": string, "priority": "LOW"|"MEDIUM"|"HIGH", "estimatedMinutes": number, "category": string, "dueDate": string|null}
dueDate must be an ISO 8601 date-time if a date/time is mentioned or implied (e.g. "tomorrow", "friday 3pm", "tonight"), else null. Today's date is ${new Date().toDateString()} — use it as the reference point for relative dates. category should be a short single word like "Work", "Home", "Errands", "Health", inferred from context; default to "General" if unclear.`;
  const result = await callAI(system, text, 512);
  if (!result.ok) return result;
  try {
    const parsed = extractJson(result.text);
    return {
      ok: true,
      title: String(parsed.title || text).trim(),
      priority: ['LOW', 'MEDIUM', 'HIGH'].includes(parsed.priority) ? parsed.priority : 'MEDIUM',
      estimatedMinutes: Number(parsed.estimatedMinutes) || 30,
      category: parsed.category || 'General',
      dueDate: parsed.dueDate ? (Number.isNaN(new Date(parsed.dueDate).getTime()) ? null : new Date(parsed.dueDate).getTime()) : null
    };
  } catch (e) {
    return { ok: false, error: 'Could not parse the AI response — try again.' };
  }
}

// ---------- 3. Weekly insights from aggregate stats (no task titles sent) ----------
export async function aiWeeklyInsights(stats) {
  const system = 'You are a concise, encouraging productivity coach. Given weekly stats from a task/habit organizer app, write a short insight in plain text — 3 to 5 sentences, no markdown, no bullet points, no headers. Reference the specific numbers given. Warm but not saccharine, and include one concrete, actionable suggestion.';
  const result = await callAI(system, JSON.stringify(stats), 400);
  if (!result.ok) return result;
  return { ok: true, text: result.text.trim() };
}

// ---------- 4. Suggest what to focus on next ----------
// tasks: [{ title, priority, dueDate: isoStringOrNull, estimatedMinutes, isBlocked }]
export async function aiFocusSuggestion(tasks) {
  const system = 'Given a JSON list of open tasks (title, priority, dueDate as ISO or null, estimatedMinutes, isBlocked), pick exactly ONE to recommend focusing on right now and explain why in one or two sentences. Never pick a task where isBlocked is true. Prefer overdue and high-priority tasks. Respond with ONLY JSON, no prose, no markdown fences: {"taskTitle": string, "reason": string}';
  const result = await callAI(system, JSON.stringify(tasks), 300);
  if (!result.ok) return result;
  try {
    const parsed = extractJson(result.text);
    if (!parsed.taskTitle) throw new Error('no pick');
    return { ok: true, taskTitle: String(parsed.taskTitle), reason: String(parsed.reason || '') };
  } catch (e) {
    return { ok: false, error: 'Could not parse the AI response — try again.' };
  }
}
