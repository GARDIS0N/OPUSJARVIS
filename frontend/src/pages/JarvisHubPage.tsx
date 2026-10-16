import { useEffect, useState, useCallback } from 'react';
import {
  Calendar,
  Flame,
  Brain,
  Shield,
  CheckCircle2,
  Circle,
  Trash2,
  Plus,
  RefreshCw,
  AlertTriangle,
  Volume2,
  Send,
} from 'lucide-react';
import {
  fetchJarvisOverview,
  importJarvisScheduleText,
  toggleJarvisScheduleBlock,
  deleteJarvisScheduleBlock,
  submitJarvisCheckin,
  fetchJarvisMemory,
  storeJarvisMemory,
  deleteJarvisMemory,
  updateJarvisSettings,
  type JarvisOverview,
  type JarvisMemoryItem,
} from '../lib/jarvis-api';

export type JarvisTab = 'schedule' | 'accountability' | 'memory';

interface JarvisHubPageProps {
  initialTab?: JarvisTab;
}

export function JarvisHubPage({ initialTab = 'schedule' }: JarvisHubPageProps) {
  const [tab, setTab] = useState<JarvisTab>(initialTab);
  const [overview, setOverview] = useState<JarvisOverview | null>(null);
  const [memories, setMemories] = useState<JarvisMemoryItem[]>([]);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [scheduleInput, setScheduleInput] = useState('');
  const [checkinStatus, setCheckinStatus] = useState<'completed' | 'progress' | 'slipping' | 'blocked'>('completed');
  const [checkinSummary, setCheckinSummary] = useState('');
  const [pushbackBanner, setPushbackBanner] = useState<string | null>(null);
  const [soulDraft, setSoulDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, mem] = await Promise.all([
        fetchJarvisOverview(),
        fetchJarvisMemory(memoryQuery),
      ]);
      setOverview(ov);
      setSoulDraft(ov.settings.soul_prompt || '');
      setMemories(mem.items);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load Jarvis data from the local server.',
      );
    } finally {
      setLoading(false);
    }
  }, [memoryQuery]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleImportSchedule = async () => {
    if (!scheduleInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await importJarvisScheduleText(scheduleInput, overview?.date);
      setScheduleInput('');
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to import schedule.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBlock = async (blockId: number, current: boolean) => {
    try {
      await toggleJarvisScheduleBlock(blockId, !current);
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not toggle schedule block.');
    }
  };

  const handleDeleteBlock = async (blockId: number) => {
    try {
      await deleteJarvisScheduleBlock(blockId);
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete schedule block.');
    }
  };

  const handleCheckin = async () => {
    if (!checkinSummary.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submitJarvisCheckin({
        status: checkinStatus,
        summary: checkinSummary.trim(),
      });
      setPushbackBanner(res.jarvis_pushback);
      setCheckinSummary('');
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not submit check-in.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddMemory = async () => {
    if (!newMemoryText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await storeJarvisMemory(newMemoryText.trim(), 'user_note');
      setNewMemoryText('');
      const mem = await fetchJarvisMemory(memoryQuery);
      setMemories(mem.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save memory note.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await deleteJarvisMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete memory item.');
    }
  };

  const handleToggleSetting = async (
    key: 'codeact_enabled' | 'cloud_fallback_enabled' | 'voice_enabled',
    val: boolean,
  ) => {
    try {
      const next = await updateJarvisSettings({ [key]: val });
      setOverview((prev) => (prev ? { ...prev, settings: next } : prev));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update setting.');
    }
  };

  const handleSaveSoul = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await updateJarvisSettings({ soul_prompt: soulDraft });
      setOverview((prev) => (prev ? { ...prev, settings: next } : prev));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save persona file.');
    } finally {
      setBusy(false);
    }
  };

  const handleSpeakBriefing = () => {
    if (!('speechSynthesis' in window) || !overview?.briefing_text) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(overview.briefing_text));
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header & Secondary Tab Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
              Jarvis Personal Manager
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              All schedule blocks, accountability check-ins, and memory items are loaded dynamically from local SQLite.
            </p>
          </div>

          <div
            className="inline-flex rounded-xl p-1 gap-1 self-start"
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            {[
              { id: 'schedule' as const, label: 'Schedule & Briefing', icon: Calendar },
              { id: 'accountability' as const, label: 'Accountability', icon: Flame },
              { id: 'memory' as const, label: 'Memory & Persona', icon: Brain },
            ].map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  style={{
                    background: active ? 'var(--color-accent)' : 'transparent',
                    color: active ? 'var(--color-on-accent)' : 'var(--color-text-secondary)',
                    border: 'none',
                  }}
                >
                  <item.icon size={14} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Plain-language Error Banner */}
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-xs"
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#fecaca',
            }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} style={{ color: '#f87171' }} />
              <span>{error}</span>
            </div>
            <button
              onClick={() => void loadAll()}
              className="px-2.5 py-1 rounded-lg text-xs cursor-pointer"
              style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#fee2e2', border: 'none' }}
            >
              Retry
            </button>
          </div>
        )}

        {loading && !overview ? (
          <div className="flex items-center gap-2 py-8 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            <span>Loading from SQLite...</span>
          </div>
        ) : (
          <>
            {/* TAB 1: SCHEDULE & DAILY BRIEFING */}
            {tab === 'schedule' && (
              <div className="space-y-6">
                {/* Daily Briefing Card */}
                <div
                  className="rounded-2xl p-5"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                      Daily Morning Briefing
                    </h2>
                    <button
                      onClick={handleSpeakBriefing}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium cursor-pointer"
                      style={{
                        background: 'var(--color-accent-subtle)',
                        color: 'var(--color-accent)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <Volume2 size={13} />
                      <span>Read Briefing Aloud</span>
                    </button>
                  </div>
                  <pre
                    className="text-xs whitespace-pre-wrap font-sans leading-relaxed p-3.5 rounded-xl"
                    style={{
                      background: 'var(--color-bg-secondary)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    {overview?.briefing_text || 'No briefing available yet.'}
                  </pre>
                </div>

                {/* Add / Import Monthly Schedule Lines */}
                <div
                  className="rounded-2xl p-5 space-y-3"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    Add or Paste Schedule Blocks
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    One block per line (e.g. <code>YYYY-MM-DD 08:00-12:00 [category] Focus block</code>). Stored in <code>schedule.db</code>.
                  </p>
                  <textarea
                    rows={3}
                    value={scheduleInput}
                    onChange={(e) => setScheduleInput(e.target.value)}
                    placeholder="08:00-12:00 [shift] Morning work block&#10;14:00-16:00 [study] Afternoon study block&#10;19:00-21:00 [project] Evening project sprint"
                    className="w-full p-3 rounded-xl text-xs outline-none resize-y"
                    style={{
                      background: 'var(--color-input-bg)',
                      border: '1px solid var(--color-input-border)',
                      color: 'var(--color-text)',
                    }}
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => void handleImportSchedule()}
                      disabled={busy || !scheduleInput.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium cursor-pointer"
                      style={{
                        background: 'var(--color-accent)',
                        color: 'var(--color-on-accent)',
                        border: 'none',
                      }}
                    >
                      <Plus size={14} />
                      <span>Save to Schedule DB</span>
                    </button>
                  </div>
                </div>

                {/* Today's Structured Schedule List */}
                <div
                  className="rounded-2xl p-5 space-y-3"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    Today’s Schedule Blocks ({overview?.schedule_today.length ?? 0})
                  </h2>
                  {overview?.schedule_today.length === 0 ? (
                    <p className="text-xs py-2" style={{ color: 'var(--color-text-secondary)' }}>
                      No schedule blocks recorded for today yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {overview?.schedule_today.map((block) => (
                        <div
                          key={block.id}
                          className="flex items-center justify-between gap-3 p-3 rounded-xl"
                          style={{
                            background: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <div
                            onClick={() => void handleToggleBlock(block.id, block.completed)}
                            className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                          >
                            <span style={{ color: 'var(--color-accent)' }}>
                              {block.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                            </span>
                            <span
                              className="text-xs font-mono px-2 py-0.5 rounded"
                              style={{
                                background: 'var(--color-accent-subtle)',
                                color: 'var(--color-accent)',
                              }}
                            >
                              {block.start_time}–{block.end_time}
                            </span>
                            <span
                              className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
                              style={{
                                background: 'var(--color-bg-tertiary)',
                                color: 'var(--color-text-secondary)',
                              }}
                            >
                              {block.category}
                            </span>
                            <span
                              className="text-xs font-medium truncate"
                              style={{
                                color: block.completed
                                  ? 'var(--color-text-secondary)'
                                  : 'var(--color-text)',
                                textDecoration: block.completed ? 'line-through' : 'none',
                              }}
                            >
                              {block.title}
                            </span>
                          </div>
                          <button
                            onClick={() => void handleDeleteBlock(block.id)}
                            className="p-1.5 rounded-lg cursor-pointer"
                            style={{
                              color: 'var(--color-text-tertiary)',
                              background: 'transparent',
                              border: 'none',
                            }}
                            title="Delete block"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: ACCOUNTABILITY & STREAK */}
            {tab === 'accountability' && (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div
                    className="rounded-2xl p-4"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      Active Streak
                    </span>
                    <div className="text-2xl font-bold mt-1" style={{ color: 'var(--color-accent)' }}>
                      {overview?.accountability.streak_days ?? 0} days
                    </div>
                  </div>
                  <div
                    className="rounded-2xl p-4"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      Today’s Completion
                    </span>
                    <div className="text-2xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>
                      {overview?.accountability.today_completion_rate ?? 0}%
                    </div>
                  </div>
                  <div
                    className="rounded-2xl p-4"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      Overall Completion Rate
                    </span>
                    <div className="text-2xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>
                      {overview?.accountability.completion_rate ?? 0}%
                    </div>
                  </div>
                </div>

                {/* Check-in Form */}
                <div
                  className="rounded-2xl p-5 space-y-4"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    Log an Accountability Check-In
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {(['completed', 'progress', 'slipping', 'blocked'] as const).map((st) => (
                      <button
                        key={st}
                        onClick={() => setCheckinStatus(st)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium capitalize cursor-pointer"
                        style={{
                          background:
                            checkinStatus === st
                              ? 'var(--color-accent)'
                              : 'var(--color-bg-secondary)',
                          color:
                            checkinStatus === st
                              ? 'var(--color-on-accent)'
                              : 'var(--color-text-secondary)',
                          border: '1px solid var(--color-border)',
                        }}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={checkinSummary}
                      onChange={(e) => setCheckinSummary(e.target.value)}
                      placeholder="What did you finish, or what are you slipping on?"
                      className="flex-1 px-3.5 py-2 rounded-xl text-xs outline-none"
                      style={{
                        background: 'var(--color-input-bg)',
                        border: '1px solid var(--color-input-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                    <button
                      onClick={() => void handleCheckin()}
                      disabled={busy || !checkinSummary.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium cursor-pointer"
                      style={{
                        background: 'var(--color-accent)',
                        color: 'var(--color-on-accent)',
                        border: 'none',
                      }}
                    >
                      <Send size={13} />
                      <span>Check In</span>
                    </button>
                  </div>

                  {pushbackBanner && (
                    <div
                      className="p-3.5 rounded-xl text-xs leading-relaxed"
                      style={{
                        background: 'var(--color-accent-subtle)',
                        border: '1px solid var(--color-accent)',
                        color: 'var(--color-text)',
                      }}
                    >
                      <strong>Jarvis:</strong> {pushbackBanner}
                    </div>
                  )}
                </div>

                {/* Recent Check-ins */}
                <div
                  className="rounded-2xl p-5 space-y-3"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    Recent Check-Ins
                  </h2>
                  {overview?.accountability.recent_checkins.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      No check-ins recorded yet.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {overview?.accountability.recent_checkins.map((c) => (
                        <div
                          key={c.id}
                          className="p-3.5 rounded-xl space-y-1.5"
                          style={{
                            background: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span
                              className="uppercase tracking-wider text-[10px] font-semibold px-2 py-0.5 rounded"
                              style={{
                                background: 'var(--color-accent-subtle)',
                                color: 'var(--color-accent)',
                              }}
                            >
                              {c.status}
                            </span>
                            <span style={{ color: 'var(--color-text-tertiary)' }}>{c.date}</span>
                          </div>
                          <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                            {c.summary}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                            {c.jarvis_pushback}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: MEMORY & PERSONA / SAFETY TOGGLES */}
            {tab === 'memory' && (
              <div className="space-y-6">
                {/* Safety & Permission Toggles */}
                <div
                  className="rounded-2xl p-5 space-y-4"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Shield size={16} style={{ color: 'var(--color-accent)' }} />
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                      Safety & Explicit Permission Toggles
                    </h2>
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center justify-between gap-4 p-3 rounded-xl cursor-pointer" style={{ background: 'var(--color-bg-secondary)' }}>
                      <div>
                        <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                          CodeAct Python Execution (<code>native_openhands</code>)
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                          Disabled by default. When off, <code>native_openhands</code> refuses to execute code until you explicitly grant permission here.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(overview?.settings.codeact_enabled)}
                        onChange={(e) => void handleToggleSetting('codeact_enabled', e.target.checked)}
                        className="w-4 h-4 accent-green-500 cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-4 p-3 rounded-xl cursor-pointer" style={{ background: 'var(--color-bg-secondary)' }}>
                      <div>
                        <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                          Allow Cloud Model Fallback
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                          Local Ollama is always default. If enabled, Jarvis shows a warning banner whenever a request would leave your device.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(overview?.settings.cloud_fallback_enabled)}
                        onChange={(e) => void handleToggleSetting('cloud_fallback_enabled', e.target.checked)}
                        className="w-4 h-4 accent-green-500 cursor-pointer"
                      />
                    </label>
                  </div>
                </div>

                {/* Long-Term Memory Viewer */}
                <div
                  className="rounded-2xl p-5 space-y-4"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    Long-Term Memory Store (<code>memory.db</code>)
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    Used silently at runtime to inform answers — never hardcoded into the UI.
                  </p>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMemoryText}
                      onChange={(e) => setNewMemoryText(e.target.value)}
                      placeholder="Add a durable fact or project goal to long-term memory..."
                      className="flex-1 px-3.5 py-2 rounded-xl text-xs outline-none"
                      style={{
                        background: 'var(--color-input-bg)',
                        border: '1px solid var(--color-input-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                    <button
                      onClick={() => void handleAddMemory()}
                      disabled={busy || !newMemoryText.trim()}
                      className="px-4 py-2 rounded-xl text-xs font-medium cursor-pointer"
                      style={{
                        background: 'var(--color-accent)',
                        color: 'var(--color-on-accent)',
                        border: 'none',
                      }}
                    >
                      Remember
                    </button>
                  </div>

                  <div className="space-y-2">
                    {memories.length === 0 ? (
                      <p className="text-xs py-2" style={{ color: 'var(--color-text-secondary)' }}>
                        No memory entries match.
                      </p>
                    ) : (
                      memories.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-start justify-between gap-3 p-3 rounded-xl text-xs"
                          style={{
                            background: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <div className="space-y-1">
                            <span
                              className="text-[10px] uppercase px-1.5 py-0.5 rounded"
                              style={{
                                background: 'var(--color-accent-subtle)',
                                color: 'var(--color-accent)',
                              }}
                            >
                              {m.source || 'memory'}
                            </span>
                            <p style={{ color: 'var(--color-text)' }}>{m.content}</p>
                          </div>
                          {m.id && (
                            <button
                              onClick={() => void handleDeleteMemory(m.id)}
                              className="p-1 rounded cursor-pointer"
                              style={{
                                color: 'var(--color-text-tertiary)',
                                background: 'transparent',
                                border: 'none',
                              }}
                              title="Delete memory"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Editable Personal Manager Persona (SOUL.md) */}
                <div
                  className="rounded-2xl p-5 space-y-3"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                        Editable Persona Prompt (<code>SOUL.md</code>)
                      </h2>
                      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        Path: <code>{overview?.settings.soul_path}</code>
                      </p>
                    </div>
                    <button
                      onClick={() => void handleSaveSoul()}
                      disabled={busy}
                      className="px-4 py-1.5 rounded-xl text-xs font-medium cursor-pointer"
                      style={{
                        background: 'var(--color-accent)',
                        color: 'var(--color-on-accent)',
                        border: 'none',
                      }}
                    >
                      Save Persona
                    </button>
                  </div>
                  <textarea
                    rows={10}
                    value={soulDraft}
                    onChange={(e) => setSoulDraft(e.target.value)}
                    className="w-full p-3 rounded-xl text-xs font-mono outline-none resize-y"
                    style={{
                      background: 'var(--color-input-bg)',
                      border: '1px solid var(--color-input-border)',
                      color: 'var(--color-text)',
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
