import { apiFetch } from './api';

export interface JarvisPriority {
  id: number;
  date: string;
  rank: number;
  title: string;
  category: string;
  starter_step: string;
  completed: boolean;
}

export interface JarvisScheduleBlock {
  id: number;
  date: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  category: string;
  title: string;
  notes: string;
  completed: boolean;
}

export interface JarvisCheckinEntry {
  id: number;
  date: string;
  timestamp: number;
  status: string;
  summary: string;
  jarvis_pushback: string;
}

export interface JarvisAccountabilityStats {
  date: string;
  streak_days: number;
  completion_rate: number;
  today_completion_rate: number;
  completed_today: number;
  total_today: number;
  completed_all_time: number;
  total_all_time: number;
  nudge: string;
  recent_checkins: JarvisCheckinEntry[];
}

export interface JarvisSettings {
  codeact_enabled: boolean;
  cloud_fallback_enabled: boolean;
  voice_enabled: boolean;
  soul_prompt: string;
  soul_path: string;
}

export interface JarvisOverview {
  date: string;
  priorities: JarvisPriority[];
  schedule_today: JarvisScheduleBlock[];
  accountability: JarvisAccountabilityStats;
  briefing_text: string;
  settings: JarvisSettings;
  runtime: {
    model: string;
    engine: string;
    is_local: boolean;
    leaves_device_warning: string;
  };
}

export interface JarvisMemoryItem {
  id: string;
  content: string;
  source: string;
  score?: number;
  created_at?: number;
}

const OFFLINE_KEY = 'opusjarvis_offline_store';

function getOfflineStore(dateStr?: string): JarvisOverview {
  const today = dateStr || new Date().toISOString().split('T')[0];
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.priorities && parsed.accountability) return parsed;
    }
  } catch {}

  const defaultOverview: JarvisOverview = {
    date: today,
    priorities: [
      { id: 1, date: today, rank: 1, title: 'Morning Hospital Shift / Laboratory practicals', category: 'study', starter_step: 'Log shift start in schedule', completed: false },
      { id: 2, date: today, rank: 2, title: 'NestList marketplace engineering milestone', category: 'project', starter_step: 'Open IDE & check backlog', completed: false },
      { id: 3, date: today, rank: 3, title: 'Evening review & accountability check-in', category: 'accountability', starter_step: 'Update completed tasks & streak', completed: false },
    ],
    schedule_today: [
      { id: 101, date: today, day_of_week: 'Today', start_time: '08:00', end_time: '13:00', category: 'study', title: 'Clinical Laboratory Medicine Block', notes: 'Quality control & sample analysis', completed: false },
      { id: 102, date: today, day_of_week: 'Today', start_time: '14:30', end_time: '18:00', category: 'project', title: 'NestList Feature Sprint', notes: 'Kenya rental marketplace updates', completed: false },
      { id: 103, date: today, day_of_week: 'Today', start_time: '19:30', end_time: '20:30', category: 'accountability', title: 'Day Wrap-Up & Jarvis Check-In', notes: 'Protect your daily streak', completed: false },
    ],
    accountability: {
      date: today,
      streak_days: 7,
      completion_rate: 85,
      today_completion_rate: 0,
      completed_today: 0,
      total_today: 3,
      completed_all_time: 42,
      total_all_time: 49,
      nudge: 'Consistency compounds. Complete Priority 1 before noon to keep your streak blazing!',
      recent_checkins: [
        { id: 201, date: today, timestamp: Date.now() - 86400000, status: 'completed', summary: 'Completed clinical rotation and deployed NestList patch.', jarvis_pushback: 'Solid discipline. You showed up and executed. Maintain this momentum.' }
      ]
    },
    briefing_text: 'Good morning, Gardison. Today has clinical laboratory practicals on the morning agenda, followed by NestList engineering in the afternoon. Let us lock in Priority 1 first to keep your 7-day streak intact!',
    settings: {
      codeact_enabled: false,
      cloud_fallback_enabled: false,
      voice_enabled: true,
      soul_prompt: 'Personal Manager persona: warm, direct, encouraging, keeps Gardison accountable.',
      soul_path: 'SOUL.md',
    },
    runtime: {
      model: 'qwen3.5:2b',
      engine: 'Local Ollama / GitHub Pages Static Preview',
      is_local: true,
      leaves_device_warning: '',
    }
  };
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(defaultOverview));
  } catch {}
  return defaultOverview;
}

export function isStaticDeployment(): boolean {
  return typeof window !== 'undefined' && (
    window.location.hostname.endsWith('github.io') ||
    window.location.protocol === 'file:'
  );
}

async function parseJsonOrThrow<T>(res: Response, fallbackMsg: string): Promise<T> {
  if (!res.ok) {
    let detail = fallbackMsg;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // ignore json parse error
    }
    throw new Error(`${detail} (HTTP ${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchJarvisOverview(dateStr?: string): Promise<JarvisOverview> {
  const qs = dateStr ? `?date=${encodeURIComponent(dateStr)}` : '';
  try {
    const res = await apiFetch(`/api/jarvis/overview${qs}`);
    return await parseJsonOrThrow<JarvisOverview>(
      res,
      'Could not load today’s priorities and schedule from the local Jarvis server',
    );
  } catch (err) {
    // If static GitHub Pages or server is unreachable, use local offline store
    return getOfflineStore(dateStr);
  }
}

export async function saveJarvisPriorities(
  priorities: Array<{ title: string; category?: string; starter_step?: string; completed?: boolean }>,
  dateStr?: string,
): Promise<{ priorities: JarvisPriority[] }> {
  try {
    const res = await apiFetch('/api/jarvis/priorities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr, priorities }),
    });
    return await parseJsonOrThrow(res, 'Could not save today’s priorities');
  } catch (err) {
    const store = getOfflineStore(dateStr);
    const updated: JarvisPriority[] = priorities.map((p, idx) => ({
      id: idx + 1,
      date: dateStr || store.date,
      rank: idx + 1,
      title: p.title,
      category: p.category || 'general',
      starter_step: p.starter_step || '',
      completed: !!p.completed,
    }));
    store.priorities = updated;
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(store));
    return { priorities: updated };
  }
}

export async function toggleJarvisPriority(
  priorityId: number,
  completed?: boolean,
): Promise<{ priority: JarvisPriority; accountability: JarvisAccountabilityStats }> {
  try {
    const res = await apiFetch(`/api/jarvis/priorities/${priorityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });
    return await parseJsonOrThrow(res, 'Could not update priority status');
  } catch (err) {
    const store = getOfflineStore();
    const p = store.priorities.find((item) => item.id === priorityId);
    if (p) {
      p.completed = completed !== undefined ? completed : !p.completed;
      const doneCount = store.priorities.filter((item) => item.completed).length;
      store.accountability.completed_today = doneCount;
      store.accountability.today_completion_rate = Math.round((doneCount / store.priorities.length) * 100);
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(store));
      return { priority: p, accountability: store.accountability };
    }
    throw err;
  }
}

export async function fetchJarvisSchedule(params?: {
  date?: string;
  month?: string;
}): Promise<{ blocks: JarvisScheduleBlock[] }> {
  const search = new URLSearchParams();
  if (params?.date) search.set('date', params.date);
  if (params?.month) search.set('month', params.month);
  const qs = search.toString() ? `?${search.toString()}` : '';
  try {
    const res = await apiFetch(`/api/jarvis/schedule${qs}`);
    return await parseJsonOrThrow(res, 'Could not load your schedule');
  } catch {
    const store = getOfflineStore(params?.date);
    return { blocks: store.schedule_today };
  }
}

export async function importJarvisScheduleText(
  text: string,
  defaultDate?: string,
): Promise<{ added: number; blocks: JarvisScheduleBlock[] }> {
  try {
    const res = await apiFetch('/api/jarvis/schedule/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, date: defaultDate }),
    });
    return await parseJsonOrThrow(res, 'Could not import schedule text');
  } catch {
    const store = getOfflineStore(defaultDate);
    const newBlock: JarvisScheduleBlock = {
      id: Date.now(),
      date: defaultDate || store.date,
      day_of_week: 'Custom',
      start_time: '12:00',
      end_time: '13:00',
      category: 'imported',
      title: text.split('\n')[0] || 'Imported block',
      notes: text,
      completed: false,
    };
    store.schedule_today.push(newBlock);
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(store));
    return { added: 1, blocks: store.schedule_today };
  }
}

export async function toggleJarvisScheduleBlock(
  blockId: number,
  completed?: boolean,
): Promise<{ block: JarvisScheduleBlock; accountability: JarvisAccountabilityStats }> {
  try {
    const res = await apiFetch(`/api/jarvis/schedule/${blockId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });
    return await parseJsonOrThrow(res, 'Could not update schedule block');
  } catch {
    const store = getOfflineStore();
    const b = store.schedule_today.find((item) => item.id === blockId);
    if (b) {
      b.completed = completed !== undefined ? completed : !b.completed;
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(store));
      return { block: b, accountability: store.accountability };
    }
    throw new Error('Block not found');
  }
}

export async function deleteJarvisScheduleBlock(blockId: number): Promise<{ deleted: boolean }> {
  const res = await apiFetch(`/api/jarvis/schedule/${blockId}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow(res, 'Could not delete schedule block');
}

export async function fetchJarvisBriefing(dateStr?: string): Promise<{
  date: string;
  day_label: string;
  text: string;
  priorities: JarvisPriority[];
  schedule: JarvisScheduleBlock[];
  accountability: JarvisAccountabilityStats;
}> {
  const qs = dateStr ? `?date=${encodeURIComponent(dateStr)}` : '';
  const res = await apiFetch(`/api/jarvis/briefing${qs}`);
  return parseJsonOrThrow(res, 'Could not generate daily briefing');
}

export async function submitJarvisCheckin(payload: {
  status: string;
  summary: string;
  date?: string;
}): Promise<{
  id: number;
  date: string;
  status: string;
  summary: string;
  jarvis_pushback: string;
  stats: JarvisAccountabilityStats;
}> {
  const res = await apiFetch('/api/jarvis/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res, 'Could not record accountability check-in');
}

export async function fetchJarvisMemory(query = ''): Promise<{ items: JarvisMemoryItem[]; count: number }> {
  const qs = query ? `?query=${encodeURIComponent(query)}` : '';
  const res = await apiFetch(`/api/jarvis/memory${qs}`);
  return parseJsonOrThrow(res, 'Could not read long-term memory');
}

export async function storeJarvisMemory(content: string, source = 'user_note'): Promise<JarvisMemoryItem> {
  const res = await apiFetch('/api/jarvis/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, source }),
  });
  return parseJsonOrThrow(res, 'Could not store memory note');
}

export async function deleteJarvisMemory(docId: string): Promise<{ deleted: boolean }> {
  const res = await apiFetch(`/api/jarvis/memory/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow(res, 'Could not delete memory item');
}

export async function updateJarvisSettings(
  payload: Partial<{
    codeact_enabled: boolean;
    cloud_fallback_enabled: boolean;
    voice_enabled: boolean;
    soul_prompt: string;
  }>,
): Promise<JarvisSettings> {
  const res = await apiFetch('/api/jarvis/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res, 'Could not save Jarvis settings');
}
