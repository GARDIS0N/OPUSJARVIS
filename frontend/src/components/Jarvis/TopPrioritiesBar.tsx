import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  CheckCircle2,
  Circle,
  Flame,
  Volume2,
  VolumeX,
  AlertTriangle,
  RefreshCw,
  Calendar,
  Plus,
  ShieldAlert,
} from 'lucide-react';
import {
  fetchJarvisOverview,
  toggleJarvisPriority,
  saveJarvisPriorities,
  isStaticDeployment,
  type JarvisOverview,
} from '../../lib/jarvis-api';

interface TopPrioritiesBarProps {
  onQuickPrompt?: (prompt: string) => void;
}

export function TopPrioritiesBar({ onQuickPrompt }: TopPrioritiesBarProps) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<JarvisOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitles, setDraftTitles] = useState<string[]>(['', '', '']);
  const [saving, setSaving] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJarvisOverview();
      setOverview(data);
      const titles = data.priorities.map((p) => p.title);
      while (titles.length < 3) titles.push('');
      setDraftTitles(titles.slice(0, 3));
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not reach the local Jarvis server. Check that jarvis is running.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleToggle = async (id: number, current: boolean) => {
    try {
      const res = await toggleJarvisPriority(id, !current);
      setOverview((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          priorities: prev.priorities.map((p) => (p.id === id ? res.priority : p)),
          accountability: res.accountability,
        };
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update priority.');
    }
  };

  const handleSavePriorities = async () => {
    setSaving(true);
    setError(null);
    try {
      const clean = draftTitles
        .map((t) => t.trim())
        .filter(Boolean)
        .map((title) => ({ title }));
      await saveJarvisPriorities(clean, overview?.date);
      setEditing(false);
      await loadOverview();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save priorities.');
    } finally {
      setSaving(false);
    }
  };

  const handleSpeakBriefing = () => {
    if (!('speechSynthesis' in window)) {
      setError('Browser speech synthesis is not supported in this browser.');
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const text = overview?.briefing_text || 'No briefing loaded yet.';
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const priorities = overview?.priorities ?? [];
  const streak = overview?.accountability?.streak_days ?? 0;
  const rate = overview?.accountability?.today_completion_rate ?? 0;
  const leavesDevice = overview?.runtime && !overview.runtime.is_local;

  return (
    <section
      aria-label="Today's Top 3 Priorities"
      className="w-full max-w-[var(--chat-max-width)] mx-auto px-4 pt-3 pb-2 shrink-0"
    >
      {/* GitHub Pages status badge */}
      {isStaticDeployment() && (
        <div
          role="status"
          className="mb-2.5 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium"
          style={{
            background: 'rgba(34, 197, 94, 0.08)',
            border: '1px solid rgba(34, 197, 94, 0.25)',
            color: '#86efac',
          }}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>GitHub Pages Preview</span>
          </div>
          <button
            onClick={() => navigate('/settings')}
            className="text-[10px] underline underline-offset-2 opacity-80 hover:opacity-100 cursor-pointer"
          >
            Connect local backend (Settings &gt; Connection)
          </button>
        </div>
      )}
      {/* Cloud privacy warning banner whenever request would leave device */}
      {leavesDevice && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium"
          style={{
            background: 'rgba(245, 158, 11, 0.14)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            color: '#fde68a',
          }}
        >
          <ShieldAlert size={16} className="shrink-0" style={{ color: '#f59e0b' }} />
          <span>
            {overview?.runtime.leaves_device_warning ||
              'Cloud model active — requests will leave your device.'}
          </span>
        </div>
      )}

      {/* Plain-language error banner */}
      {error && (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs"
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            color: '#fecaca',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={15} className="shrink-0" style={{ color: '#f87171' }} />
            <span className="truncate">{error}</span>
          </div>
          <button
            onClick={() => void loadOverview()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer shrink-0"
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              color: '#fee2e2',
              border: 'none',
            }}
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      )}

      {/* Main Top-3 Priorities Card */}
      <div
        className="rounded-2xl p-4 transition-all"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                background: 'var(--color-accent)',
                boxShadow: '0 0 8px var(--color-accent-glow)',
              }}
            />
            <h2
              className="text-sm font-semibold tracking-tight"
              style={{ color: 'var(--color-text)' }}
            >
              Today’s Top 3 Priorities
            </h2>
            {overview?.date && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {overview.date}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Streak badge */}
            <button
              onClick={() => navigate('/accountability')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer"
              style={{
                background: 'var(--color-accent-subtle)',
                color: 'var(--color-accent)',
                border: '1px solid var(--color-border)',
              }}
              title="View accountability streak and completion stats"
            >
              <Flame size={13} />
              <span>{streak}d streak</span>
              <span style={{ opacity: 0.75 }}>• {rate}%</span>
            </button>

            {/* Voice briefing button */}
            <button
              onClick={handleSpeakBriefing}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs cursor-pointer"
              style={{
                background: speaking ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
                color: speaking ? 'var(--color-on-accent)' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}
              title="Read daily briefing aloud"
            >
              {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
              <span className="hidden sm:inline">{speaking ? 'Stop Voice' : 'Briefing'}</span>
            </button>

            {/* Edit Top 3 button */}
            <button
              onClick={() => setEditing((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs cursor-pointer"
              style={{
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}
            >
              <Plus size={12} />
              <span>{editing ? 'Cancel' : 'Edit'}</span>
            </button>

            {/* Schedule link */}
            <button
              onClick={() => navigate('/schedule')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs cursor-pointer"
              style={{
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}
              title="Open Monthly Schedule"
            >
              <Calendar size={12} />
              <span className="hidden sm:inline">Schedule</span>
            </button>
          </div>
        </div>

        {/* Loading state */}
        {loading && !overview ? (
          <div
            className="py-4 text-xs flex items-center gap-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            <span>Loading today’s priorities from SQLite...</span>
          </div>
        ) : editing ? (
          <div className="flex flex-col gap-2 pt-1">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span
                  className="text-xs font-mono w-5 text-center"
                  style={{ color: 'var(--color-accent)' }}
                >
                  #{idx + 1}
                </span>
                <input
                  type="text"
                  value={draftTitles[idx] || ''}
                  onChange={(e) => {
                    const next = [...draftTitles];
                    next[idx] = e.target.value;
                    setDraftTitles(next);
                  }}
                  placeholder={`Priority #${idx + 1}`}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none"
                  style={{
                    background: 'var(--color-input-bg)',
                    border: '1px solid var(--color-input-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => void handleSavePriorities()}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                style={{
                  background: 'var(--color-accent)',
                  color: 'var(--color-on-accent)',
                  border: 'none',
                }}
              >
                {saving ? 'Saving...' : 'Save Top 3'}
              </button>
            </div>
          </div>
        ) : priorities.length === 0 ? (
          <div
            className="py-3 text-xs flex items-center justify-between"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <span>No priorities set for today yet.</span>
            <button
              onClick={() => setEditing(true)}
              className="underline cursor-pointer"
              style={{ color: 'var(--color-accent)', background: 'transparent', border: 'none' }}
            >
              Set today’s Top 3
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {priorities.slice(0, 3).map((item) => (
              <div
                key={item.id}
                onClick={() => void handleToggle(item.id, item.completed)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void handleToggle(item.id, item.completed);
                  }
                }}
                className="flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer transition-all"
                style={{
                  background: item.completed
                    ? 'rgba(34, 197, 94, 0.08)'
                    : 'var(--color-bg-secondary)',
                  border: item.completed
                    ? '1px solid rgba(34, 197, 94, 0.35)'
                    : '1px solid var(--color-border)',
                }}
              >
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }}>
                  {item.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className="text-[10px] uppercase tracking-wider px-1.5 py-0.2 rounded font-medium"
                      style={{
                        background: 'var(--color-accent-subtle)',
                        color: 'var(--color-accent)',
                      }}
                    >
                      {item.category}
                    </span>
                  </div>
                  <p
                    className="text-xs font-medium leading-snug break-words"
                    style={{
                      color: item.completed
                        ? 'var(--color-text-secondary)'
                        : 'var(--color-text)',
                      textDecoration: item.completed ? 'line-through' : 'none',
                    }}
                  >
                    {item.title}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick-action chips */}
        {onQuickPrompt && (
          <div className="flex items-center gap-2 mt-3 pt-2.5 overflow-x-auto" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
            {[
              {
                label: 'Plan my day',
                prompt: 'Plan my day using my schedule and today’s top 3 priorities.',
              },
              {
                label: 'I finished something',
                prompt: 'I finished one of my tasks! Log an accountability check-in and tell me what is next.',
              },
              {
                label: 'Help me start',
                prompt: 'I am procrastinating right now. Push back firmly and give me a 10-minute starter step for my #1 priority.',
              },
            ].map((chip) => (
              <button
                key={chip.label}
                onClick={() => onQuickPrompt(chip.prompt)}
                className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap cursor-pointer transition-colors"
                style={{
                  background: 'var(--color-accent-subtle)',
                  color: 'var(--color-accent)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
