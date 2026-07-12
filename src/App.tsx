import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Cpu, Zap, Calendar, Clock, Trash2, ChevronDown, CheckCircle2,
  XCircle, Sparkles, BarChart3, Sun, Moon, AlignJustify, Minus,
  BookOpen, Users, MapPin, FlaskConical, GraduationCap, RotateCcw,
  TrendingDown, Activity
} from 'lucide-react';
import { SUBJECTS, DAYS_ORDER, GRID_START_HOUR, GRID_TOTAL_MINS } from './data';
import { Subject, Teacher, TimeSlot, SelectionState, OptimizationStrategy, Day } from './types';

// ─────────────────────────────────────────────
// Time Utilities
// ─────────────────────────────────────────────
const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const slotsOverlap = (a: TimeSlot, b: TimeSlot): boolean => {
  if (a.day !== b.day) return false;
  const aStart = toMinutes(a.startTime);
  const aEnd   = toMinutes(a.endTime);
  const bStart = toMinutes(b.startTime);
  const bEnd   = toMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
};

const hasConflict = (slotsA: TimeSlot[], slotsB: TimeSlot[]): boolean =>
  slotsA.some(a => slotsB.some(b => slotsOverlap(a, b)));

// ─────────────────────────────────────────────
// Penalty Calculation
// ─────────────────────────────────────────────
const calcPenalty = (
  allSlots: TimeSlot[],
  strategy: OptimizationStrategy
): number => {
  // Group slots by day
  const byDay: Record<string, number[]> = {};
  for (const slot of allSlots) {
    if (!byDay[slot.day]) byDay[slot.day] = [];
    byDay[slot.day].push(toMinutes(slot.startTime));
    byDay[slot.day].push(toMinutes(slot.endTime));
  }

  // Per-day sorted start/end arrays for gap analysis
  const daySlots: Record<string, { start: number; end: number }[]> = {};
  for (const slot of allSlots) {
    if (!daySlots[slot.day]) daySlots[slot.day] = [];
    daySlots[slot.day].push({ start: toMinutes(slot.startTime), end: toMinutes(slot.endTime) });
  }
  // Sort each day's slots by start time
  for (const d of Object.keys(daySlots)) {
    daySlots[d].sort((a, b) => a.start - b.start);
  }

  const activeDays = new Set(allSlots.map(s => s.day));
  let penalty = 0;

  if (strategy === 'LEAST_DAYS') {
    penalty += activeDays.size * 50000;
    for (const d of Object.keys(daySlots)) {
      const sorted = daySlots[d];
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].start - sorted[i - 1].end;
        if (gap > 0) penalty += gap;
      }
    }
  } else if (strategy === 'BALANCED_BREAKS') {
    penalty += activeDays.size * 1000;
    for (const d of Object.keys(daySlots)) {
      const sorted = daySlots[d];
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].start - sorted[i - 1].end;
        if (gap === 0) {
          penalty += 5000;
        } else {
          penalty += Math.abs(gap - 60);
        }
      }
    }
  } else if (strategy === 'EARLY_BIRD') {
    for (const slot of allSlots) {
      const s = toMinutes(slot.startTime);
      const e = toMinutes(slot.endTime);
      const earlyStart = 8 * 60; // 480
      if (s > earlyStart) penalty += (s - earlyStart) * 10;
      if (e > 15 * 60)    penalty += (e - 900) * 20;
    }
    // Average finish time penalty
    const ends = allSlots.map(s => toMinutes(s.endTime));
    const avgEnd = ends.reduce((a, b) => a + b, 0) / ends.length;
    penalty += avgEnd * 5;
  } else if (strategy === 'NIGHT_OWL') {
    for (const slot of allSlots) {
      const e = toMinutes(slot.endTime);
      const s = toMinutes(slot.startTime);
      if (e < 17 * 60) penalty += (1020 - e) * 10;
      penalty -= s * 5;
    }
  }

  return penalty;
};

// ─────────────────────────────────────────────
// Backtracking Solver
// ─────────────────────────────────────────────
interface SolverResult {
  selection: SelectionState;
  penalty: number;
}

const solve = (
  subjects: Subject[],
  strategy: OptimizationStrategy
): SolverResult | null => {
  let best: SolverResult | null = null;

  const bt = (
    idx: number,
    current: SelectionState,
    chosenSlots: TimeSlot[],
    chosenGroups: Set<number>
  ) => {
    if (idx === subjects.length) {
      const p = calcPenalty(chosenSlots, strategy);
      if (best === null || p < best.penalty) {
        best = { selection: { ...current }, penalty: p };
      }
      return;
    }

    const subj = subjects[idx];
    for (const teacher of subj.teachers) {
      // Conflict check: time slot overlap OR group already chosen
      if (chosenGroups.has(teacher.group)) continue;
      if (hasConflict(teacher.slots, chosenSlots)) continue;
      
      current[subj.id] = teacher.id;
      chosenGroups.add(teacher.group);
      
      bt(idx + 1, current, [...chosenSlots, ...teacher.slots], chosenGroups);
      
      chosenGroups.delete(teacher.group);
      delete current[subj.id];
    }
  };

  bt(0, {}, [], new Set<number>());
  return best;
};

// ─────────────────────────────────────────────
// Stats helper
// ─────────────────────────────────────────────
const computeStats = (allSlots: TimeSlot[]) => {
  const daySlots: Record<string, { start: number; end: number }[]> = {};
  for (const slot of allSlots) {
    if (!daySlots[slot.day]) daySlots[slot.day] = [];
    daySlots[slot.day].push({ start: toMinutes(slot.startTime), end: toMinutes(slot.endTime) });
  }
  for (const d of Object.keys(daySlots)) {
    daySlots[d].sort((a, b) => a.start - b.start);
  }

  let totalGapMins = 0;
  for (const d of Object.keys(daySlots)) {
    const sorted = daySlots[d];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].start - sorted[i - 1].end;
      if (gap > 0) totalGapMins += gap;
    }
  }

  return {
    activeDays: Object.keys(daySlots).length,
    totalGapMins,
  };
};

// ─────────────────────────────────────────────
// Color map per subject
// ─────────────────────────────────────────────
const SUBJECT_COLORS: Record<string, { border: string; bg: string; text: string; badge: string }> = {
  cs23511: { border: 'border-l-blue-500',    bg: 'bg-blue-600/25',    text: 'text-blue-300',    badge: 'bg-blue-500/20 text-blue-300'    },
  cs23512: { border: 'border-l-purple-500',  bg: 'bg-purple-600/25',  text: 'text-purple-300',  badge: 'bg-purple-500/20 text-purple-300'  },
  cs23531: { border: 'border-l-emerald-500', bg: 'bg-emerald-600/25', text: 'text-emerald-300', badge: 'bg-emerald-500/20 text-emerald-300' },
  cs23532: { border: 'border-l-amber-500',   bg: 'bg-amber-600/25',   text: 'text-amber-300',   badge: 'bg-amber-500/20 text-amber-300'   },
  cs23533: { border: 'border-l-rose-500',    bg: 'bg-rose-600/25',    text: 'text-rose-300',    badge: 'bg-rose-500/20 text-rose-300'    },
  cs23pe33: { border: 'border-l-indigo-500',  bg: 'bg-indigo-600/25',  text: 'text-indigo-300',  badge: 'bg-indigo-500/20 text-indigo-300'  },
};
const fallbackColor = { border: 'border-l-gray-500', bg: 'bg-gray-600/25', text: 'text-gray-300', badge: 'bg-gray-500/20 text-gray-300' };
const getColor = (id: string) => SUBJECT_COLORS[id] ?? fallbackColor;

// ─────────────────────────────────────────────
// Strategy meta
// ─────────────────────────────────────────────
const STRATEGIES: { id: OptimizationStrategy; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'LEAST_DAYS',      label: 'Least Days',      desc: 'Minimize active days', icon: <TrendingDown size={14} /> },
  { id: 'BALANCED_BREAKS', label: 'Balanced Breaks', desc: '~60 min gaps',         icon: <Activity size={14} />     },
  { id: 'EARLY_BIRD',      label: 'Early Bird',      desc: 'Pack mornings',        icon: <Sun size={14} />          },
  { id: 'NIGHT_OWL',       label: 'Night Owl',       desc: 'Prefer late slots',    icon: <Moon size={14} />         },
];

const LS_KEY = 'rosterpro_selections';

// ─────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────
export default function App() {
  const [selections, setSelections] = useState<SelectionState>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  const [activeSubjectId, setActiveSubjectId] = useState<string>(SUBJECTS[0].id);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [lastStrategy, setLastStrategy] = useState<OptimizationStrategy | null>(null);
  const [optimizerMsg, setOptimizerMsg] = useState('');

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(selections));
  }, [selections]);

  // All currently selected slots (flattened)
  const selectedSlots = useMemo<TimeSlot[]>(() => {
    const result: TimeSlot[] = [];
    for (const [subjId, teacherId] of Object.entries(selections)) {
      if (!teacherId) continue;
      const subj = SUBJECTS.find(s => s.id === subjId);
      const teacher = subj?.teachers.find(t => t.id === teacherId);
      if (teacher) result.push(...teacher.slots);
    }
    return result;
  }, [selections]);

  const stats = useMemo(() => computeStats(selectedSlots), [selectedSlots]);

  const activeSubject = SUBJECTS.find(s => s.id === activeSubjectId)!;

  // Which teachers of the active subject conflict with OTHER selections?
  const conflictingTeacherIds = useMemo<Set<string>>(() => {
    // Rebuild base slots: other slots = all selected slots minus the active subject's teacher slots
    const activeTid = selections[activeSubjectId];
    const excludedSlots = activeTid
      ? activeSubject.teachers.find(t => t.id === activeTid)?.slots ?? []
      : [];
    const baseSlots = selectedSlots.filter(sl => !excludedSlots.includes(sl));

    // Get groups selected by OTHER subjects
    const otherSelectedGroups = new Set<number>();
    for (const [subjId, teacherId] of Object.entries(selections)) {
      if (subjId === activeSubjectId || !teacherId) continue;
      const subj = SUBJECTS.find(s => s.id === subjId);
      const teacher = subj?.teachers.find(t => t.id === teacherId);
      if (teacher) {
        otherSelectedGroups.add(teacher.group);
      }
    }

    const result = new Set<string>();
    for (const teacher of activeSubject.teachers) {
      if (hasConflict(teacher.slots, baseSlots) || otherSelectedGroups.has(teacher.group)) {
        result.add(teacher.id);
      }
    }
    return result;
  }, [activeSubject, selections, selectedSlots, activeSubjectId]);

  const handleTeacherSelect = useCallback((subjectId: string, teacherId: string) => {
    setSelections(prev => ({
      ...prev,
      [subjectId]: prev[subjectId] === teacherId ? null : teacherId,
    }));
  }, []);

  const handleClearAll = useCallback(() => {
    setSelections({});
    setLastStrategy(null);
  }, []);

  const handleOptimize = useCallback((strategy: OptimizationStrategy) => {
    const msgs = [
      'Initializing backtracking engine…',
      'Mapping constraint graph…',
      'Pruning conflict branches…',
      'Evaluating penalty scores…',
      'Converging on optimal solution…',
    ];
    let i = 0;
    setOptimizerMsg(msgs[0]);
    setOptimizing(true);

    const interval = setInterval(() => {
      i = (i + 1) % msgs.length;
      setOptimizerMsg(msgs[i]);
    }, 420);

    setTimeout(() => {
      clearInterval(interval);
      const result = solve(SUBJECTS, strategy);
      setOptimizing(false);
      if (result) {
        setSelections(result.selection);
        setLastStrategy(strategy);
      } else {
        alert('No conflict-free combination found for the given dataset.');
      }
    }, 2200);
  }, []);

  // Slots to render on the timetable
  const timetableEntries = useMemo(() => {
    const entries: { subjectId: string; slot: TimeSlot; teacher: Teacher; subject: Subject }[] = [];
    for (const [subjId, teacherId] of Object.entries(selections)) {
      if (!teacherId) continue;
      const subj = SUBJECTS.find(s => s.id === subjId);
      const teacher = subj?.teachers.find(t => t.id === teacherId);
      if (subj && teacher) {
        for (const slot of teacher.slots) {
          entries.push({ subjectId: subjId, slot, teacher, subject: subj });
        }
      }
    }
    return entries;
  }, [selections]);

  const completedCount = SUBJECTS.filter(s => !!selections[s.id]).length;

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: '#0a0a0a', fontFamily: "'Inter', sans-serif" }}>

      {/* ── Optimization Overlay ── */}
      {optimizing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(20px)' }}>
          <div className="flex flex-col items-center gap-8 animate-slide-up">
            {/* Outer ring */}
            <div className="relative w-28 h-28">
              <div className="absolute inset-0 rounded-full border-2 border-purple-500/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-purple-500 loader-ring" style={{ width: '112px', height: '112px' }} />
              <div className="absolute inset-3 rounded-full border border-purple-400/20 border-t-blue-400 loader-ring" style={{ animationDuration: '1.4s', animationDirection: 'reverse' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <Cpu className="text-purple-400 animate-pulse-glow" size={32} />
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white mb-2">Optimizing Schedule</div>
              <div className="text-sm text-slate-400 font-mono min-h-[20px] animate-pulse-glow">{optimizerMsg}</div>
            </div>
            <div className="flex gap-1.5">
              {[0,1,2,3].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-purple-500"
                  style={{ animation: `pulse-glow 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── LEFT SIDEBAR ── */}
      <aside className="flex flex-col w-[360px] min-w-[360px] h-full border-r border-white/[0.06]"
        style={{ background: 'linear-gradient(180deg, #111118 0%, #0d0d14 100%)' }}>

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center glow-purple"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
              <GraduationCap size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none shimmer-text">Roster Pro</h1>
              <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">Manual Scheduling Portal</span>
            </div>
            <button
              onClick={handleClearAll}
              id="clear-all-btn"
              title="Clear all selections"
              className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Strategy Buttons */}
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-1.5 mb-3">
            <Sparkles size={12} className="text-purple-400" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Auto-Find Strategy</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {STRATEGIES.map(s => (
              <button
                key={s.id}
                id={`strategy-${s.id.toLowerCase()}`}
                onClick={() => handleOptimize(s.id)}
                className={`strategy-btn flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  lastStrategy === s.id
                    ? 'border-purple-500/50 bg-purple-600/15 glow-purple'
                    : 'border-white/[0.07] bg-white/[0.03] hover:border-purple-500/30'
                }`}
              >
                <div className={`flex items-center gap-1.5 mb-1 ${lastStrategy === s.id ? 'text-purple-300' : 'text-slate-300'}`}>
                  {s.icon}
                  <span className="text-xs font-semibold">{s.label}</span>
                </div>
                <span className="text-[10px] text-slate-500">{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Subject Dropdown */}
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-1.5 mb-3">
            <BookOpen size={12} className="text-blue-400" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Select Subject</span>
          </div>
          <div className="relative">
            <button
              id="subject-dropdown-btn"
              onClick={() => setDropdownOpen(o => !o)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-white/[0.09] bg-white/[0.04] hover:border-white/[0.16] transition-all text-left"
            >
              <div>
                <div className="text-xs font-semibold text-white truncate max-w-[230px]">{activeSubject.name}</div>
                <div className="text-[10px] text-slate-500 font-mono">{activeSubject.code}</div>
              </div>
              <ChevronDown size={14} className={`text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1.5 rounded-xl border border-white/[0.1] z-20 overflow-hidden"
                style={{ background: '#181825', boxShadow: '0 20px 40px rgba(0,0,0,0.6)' }}>
                {SUBJECTS.map(s => (
                  <button
                    key={s.id}
                    id={`subject-opt-${s.id}`}
                    onClick={() => { setActiveSubjectId(s.id); setDropdownOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-white/[0.05] transition-all ${activeSubjectId === s.id ? 'bg-purple-600/10' : ''}`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getColor(s.id).bg.replace('/25', '')}`}
                      style={{ background: s.id === 'pss' ? '#3b82f6' : s.id === 'os' ? '#a855f7' : s.id === 'sc' ? '#10b981' : s.id === 'dti' ? '#f59e0b' : '#f43f5e' }} />
                    <div>
                      <div className="text-xs font-medium text-white truncate">{s.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{s.code}</div>
                    </div>
                    {selections[s.id] && <CheckCircle2 size={12} className="ml-auto text-emerald-400 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Teacher List */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Users size={12} className="text-emerald-400" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Available Staff</span>
            <span className="ml-auto text-[10px] text-slate-600 font-mono">{activeSubject.teachers.length} instructor{activeSubject.teachers.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {activeSubject.teachers.map(teacher => {
              const isSelected  = selections[activeSubjectId] === teacher.id;
              const isConflict  = conflictingTeacherIds.has(teacher.id);
              return (
                <button
                  key={teacher.id}
                  id={`teacher-card-${teacher.id}`}
                  disabled={isConflict}
                  onClick={() => !isConflict && handleTeacherSelect(activeSubjectId, teacher.id)}
                  className={`teacher-card w-full text-left p-3.5 rounded-xl border transition-all ${
                    isConflict  ? 'disabled border-white/[0.05] bg-white/[0.02]' :
                    isSelected  ? 'selected border-purple-500/60 bg-purple-600/12' :
                    'border-white/[0.07] bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{teacher.name}</div>
                      <div className="text-[11px] text-slate-500">{teacher.department} · Grp {teacher.group}</div>
                    </div>
                    {isSelected && <CheckCircle2 size={16} className="text-purple-400 flex-shrink-0 mt-0.5" />}
                    {isConflict && <XCircle size={16} className="text-rose-500/60 flex-shrink-0 mt-0.5" />}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {teacher.slots.map((slot, i) => (
                      <span key={i}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium ${
                          slot.type === 'Lab' ? 'bg-rose-500/10 text-rose-300' : 'bg-sky-500/10 text-sky-300'
                        }`}
                      >
                        {slot.type === 'Lab' ? <FlaskConical size={8} /> : <BookOpen size={8} />}
                        {slot.day.slice(0,3)} {slot.startTime}–{slot.endTime}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer: Current Selections */}
        <div className="border-t border-white/[0.06] px-5 py-4"
          style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <AlignJustify size={12} className="text-slate-400" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Selections</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`text-sm font-bold ${completedCount === SUBJECTS.length ? 'text-emerald-400' : 'text-slate-300'}`}>
                {completedCount}/{SUBJECTS.length}
              </div>
              {/* Progress bar */}
              <div className="w-16 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(completedCount / SUBJECTS.length) * 100}%`,
                    background: completedCount === SUBJECTS.length
                      ? 'linear-gradient(90deg,#10b981,#34d399)'
                      : 'linear-gradient(90deg,#7c3aed,#818cf8)',
                  }} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {SUBJECTS.map(subj => {
              const tid = selections[subj.id];
              const teacher = subj.teachers.find(t => t.id === tid);
              const col = getColor(subj.id);
              return (
                <div key={subj.id}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all ${tid ? '' : 'opacity-40'}`}
                  style={{ background: tid ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${col.border.replace('border-l-', 'bg-')}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold text-slate-300 truncate">{subj.code}</div>
                    <div className="text-[9px] text-slate-500 truncate">{teacher ? `${teacher.name} · Grp ${teacher.group}` : 'Not selected'}</div>
                  </div>
                  {tid && (
                    <button
                      id={`deselect-${subj.id}`}
                      onClick={() => setSelections(prev => ({ ...prev, [subj.id]: null }))}
                      className="p-0.5 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all flex-shrink-0"
                    >
                      <Minus size={10} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* ── RIGHT: TIMETABLE VIEWPORT ── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">

        {/* Viewport Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.015)' }}>
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #0f172a, #1e1b4b)' }}>
              <Calendar size={13} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-none">Optimized Viewport</h2>
              <span className="text-[10px] text-slate-500">Weekly timetable canvas</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastStrategy && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold text-purple-300 bg-purple-500/10 border border-purple-500/20">
                <Zap size={10} />
                {STRATEGIES.find(s => s.id === lastStrategy)?.label}
              </div>
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.07] bg-white/[0.03]">
              <Calendar size={11} className="text-blue-400" />
              <span className="text-[11px] text-slate-300 font-mono">
                <span className="font-bold text-white">{stats.activeDays}</span> active day{stats.activeDays !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.07] bg-white/[0.03]">
              <Clock size={11} className="text-amber-400" />
              <span className="text-[11px] text-slate-300 font-mono">
                <span className="font-bold text-white">{stats.totalGapMins}</span> min gap{stats.totalGapMins !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Timetable Canvas */}
        <div className="flex-1 overflow-auto p-4">
          <div className="min-w-[900px] h-full flex flex-col" style={{ minHeight: '700px' }}>

            {/* Day Headers */}
            <div className="flex mb-0 flex-shrink-0">
              {/* Time label column */}
              <div className="w-14 flex-shrink-0" />
              {DAYS_ORDER.map(day => (
                <div key={day} className="flex-1 text-center py-2.5 border-b border-white/[0.06]">
                  <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{day.slice(0,3)}</span>
                  <div className="text-[9px] text-slate-600 capitalize">{day}</div>
                </div>
              ))}
            </div>

            {/* Grid Body */}
            <div className="flex flex-1 relative">
              {/* Hour labels */}
              <div className="w-14 flex-shrink-0 relative border-r border-white/[0.04]">
                {Array.from({ length: 13 }, (_, i) => {
                  const hour = GRID_START_HOUR + i;
                  const pct = (i / 12) * 100;
                  return (
                    <div key={hour} className="absolute right-0 pr-2 flex items-center"
                      style={{ top: `${pct}%`, transform: 'translateY(-50%)' }}>
                      <span className="text-[9px] font-mono text-slate-600">
                        {hour > 12 ? `${hour - 12}` : hour}:00{hour >= 12 ? 'pm' : 'am'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Day columns */}
              {DAYS_ORDER.map(day => {
                const dayEntries = timetableEntries.filter(e => e.slot.day === day);
                return (
                  <div key={day} className="flex-1 relative border-r border-white/[0.04]"
                    style={{ minHeight: '600px' }}>
                    {/* Hour grid lines */}
                    {Array.from({ length: 13 }, (_, i) => (
                      <div key={i} className="grid-line" style={{ top: `${(i / 12) * 100}%` }} />
                    ))}
                    {/* Half-hour grid lines */}
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={`half-${i}`} className="grid-line" style={{ top: `${((i + 0.5) / 12) * 100}%`, borderTopColor: 'rgba(255,255,255,0.02)' }} />
                    ))}

                    {/* Timetable cards */}
                    {dayEntries.map((entry, idx) => {
                      const startMins  = toMinutes(entry.slot.startTime) - GRID_START_HOUR * 60;
                      const durationMins = toMinutes(entry.slot.endTime) - toMinutes(entry.slot.startTime);
                      const topPct     = (startMins / GRID_TOTAL_MINS) * 100;
                      const heightPct  = (durationMins / GRID_TOTAL_MINS) * 100;
                      const col        = getColor(entry.subjectId);
                      return (
                        <div
                          key={`${entry.subjectId}-${idx}`}
                          className={`timetable-card ${col.border} ${col.bg}`}
                          style={{
                            top:    `calc(${topPct}% + 2px)`,
                            height: `calc(${heightPct}% - 4px)`,
                            left:   '3px',
                            right:  '3px',
                          }}
                        >
                          <div className={`text-[10px] font-bold leading-tight truncate ${col.text}`}>
                            {entry.subject.code}
                          </div>
                          <div className="text-[9px] text-slate-400 truncate leading-tight mt-0.5">
                            {entry.teacher.name}
                          </div>
                          {durationMins >= 60 && (
                            <div className="flex items-center gap-0.5 mt-1">
                              <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium ${
                                entry.slot.type === 'Lab'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-sky-500/20 text-sky-300'
                              }`}>
                                {entry.slot.type === 'Lab' ? <FlaskConical size={7} /> : <BookOpen size={7} />}
                                {entry.slot.type}
                              </span>
                            </div>
                          )}
                          {durationMins >= 80 && (
                            <div className="flex items-center gap-0.5 mt-0.5">
                              <MapPin size={7} className="text-slate-500 flex-shrink-0" />
                              <span className="text-[8px] text-slate-500 truncate">{entry.slot.location}</span>
                            </div>
                          )}
                          <div className="text-[8px] text-slate-500 font-mono mt-0.5 leading-none">
                            {entry.slot.startTime}–{entry.slot.endTime}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom legend */}
        <div className="flex-shrink-0 border-t border-white/[0.05] px-6 py-2.5 flex items-center gap-4"
          style={{ background: 'rgba(0,0,0,0.2)' }}>
          <span className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold">Legend</span>
          {SUBJECTS.map(s => {
            const col = getColor(s.id);
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-sm border-l-2 ${col.border} ${col.bg}`} />
                <span className={`text-[10px] font-mono font-medium ${col.text}`}>{s.code}</span>
              </div>
            );
          })}
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded-sm bg-sky-500/30 border-l-2 border-sky-400" />
              <span className="text-[10px] text-slate-500">Theory</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded-sm bg-rose-500/30 border-l-2 border-rose-400" />
              <span className="text-[10px] text-slate-500">Lab</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
