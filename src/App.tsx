import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Analytics } from "@vercel/analytics/next"
import {
  Cpu, Zap, Calendar, Clock, Trash2, ChevronDown, CheckCircle2,
  XCircle, Sparkles, BarChart3, Sun, Moon, AlignJustify, Minus,
  BookOpen, Users, MapPin, FlaskConical, GraduationCap, RotateCcw,
  TrendingDown, Activity
} from 'lucide-react';
import { SUBJECTS, DAYS_ORDER, GRID_START_HOUR, GRID_TOTAL_MINS } from './data';
import { Subject, Teacher, TimeSlot, SelectionState, OptimizationStrategy, Day } from './types';

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

const calcPenalty = (
  allSlots: TimeSlot[],
  strategy: OptimizationStrategy
): number => {
  const byDay: Record<string, number[]> = {};
  for (const slot of allSlots) {
    if (!byDay[slot.day]) byDay[slot.day] = [];
    byDay[slot.day].push(toMinutes(slot.startTime));
    byDay[slot.day].push(toMinutes(slot.endTime));
  }

  const daySlots: Record<string, { start: number; end: number }[]> = {};
  for (const slot of allSlots) {
    if (!daySlots[slot.day]) daySlots[slot.day] = [];
    daySlots[slot.day].push({ start: toMinutes(slot.startTime), end: toMinutes(slot.endTime) });
  }
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
      const earlyStart = 8 * 60;
      if (s > earlyStart) penalty += (s - earlyStart) * 10;
      if (e > 15 * 60)    penalty += (e - 900) * 20;
    }
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

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getInitialBg(name: string): string {
  const colors = [
    'bg-blue-500/20 text-blue-300',
    'bg-purple-500/20 text-purple-300',
    'bg-emerald-500/20 text-emerald-300',
    'bg-amber-500/20 text-amber-300',
    'bg-rose-500/20 text-rose-300',
    'bg-indigo-500/20 text-indigo-300',
    'bg-cyan-500/20 text-cyan-300',
    'bg-orange-500/20 text-orange-300',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

const SUBJECT_COLORS: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  cs23511:  { border: 'border-l-blue-500',    bg: 'bg-blue-500/10',    text: 'text-blue-300',    dot: 'bg-blue-500'    },
  cs23512:  { border: 'border-l-purple-500',  bg: 'bg-purple-500/10',  text: 'text-purple-300',  dot: 'bg-purple-500'  },
  cs23531:  { border: 'border-l-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-300', dot: 'bg-emerald-500' },
  cs23532:  { border: 'border-l-amber-500',   bg: 'bg-amber-500/10',   text: 'text-amber-300',   dot: 'bg-amber-500'   },
  cs23533:  { border: 'border-l-rose-500',    bg: 'bg-rose-500/10',    text: 'text-rose-300',    dot: 'bg-rose-500'    },
  cs23pe33: { border: 'border-l-indigo-500',  bg: 'bg-indigo-500/10',  text: 'text-indigo-300',  dot: 'bg-indigo-500'  },
};
const fallbackColor = { border: 'border-l-gray-500', bg: 'bg-gray-500/10', text: 'text-gray-300', dot: 'bg-gray-500' };
const getColor = (id: string) => SUBJECT_COLORS[id] ?? fallbackColor;

const STRATEGIES: { id: OptimizationStrategy; label: string; icon: React.ReactNode }[] = [
  { id: 'LEAST_DAYS',      label: 'Least Days', icon: <TrendingDown size={12} /> },
  { id: 'BALANCED_BREAKS', label: 'Balanced',   icon: <Activity size={12} />     },
  { id: 'EARLY_BIRD',      label: 'Early Bird', icon: <Sun size={12} />          },
  { id: 'NIGHT_OWL',       label: 'Night Owl',  icon: <Moon size={12} />         },
];

const LS_KEY = 'rosterpro_selections';

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

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(selections));
  }, [selections]);

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

  const conflictingTeacherIds = useMemo<Set<string>>(() => {
    const activeTid = selections[activeSubjectId];
    const excludedSlots = activeTid
      ? activeSubject.teachers.find(t => t.id === activeTid)?.slots ?? []
      : [];
    const baseSlots = selectedSlots.filter(sl => !excludedSlots.includes(sl));

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
      'Optimizing schedule\u2026',
      'Checking constraints\u2026',
      'Evaluating options\u2026',
      'Finding best fit\u2026',
    ];
    let i = 0;
    setOptimizerMsg(msgs[0]);
    setOptimizing(true);

    const interval = setInterval(() => {
      i = (i + 1) % msgs.length;
      setOptimizerMsg(msgs[i]);
    }, 500);

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
    }, 1800);
  }, []);

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
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: '#1c1c1e' }}>

      {/* ── Optimization Overlay ── */}
      {optimizing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overlay-blur">
          <div className="flex flex-col items-center gap-6" style={{ animation: 'slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}>
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full loader-ring" style={{ width: '80px', height: '80px' }} />
              <div className="absolute inset-2 rounded-full loader-ring" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <Cpu className="text-[#0a84ff]" size={24} />
              </div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-[#f5f5f7] mb-1">Optimizing Schedule</div>
              <div className="text-sm text-[rgba(255,255,255,0.45)] min-h-[18px]">{optimizerMsg}</div>
            </div>
            <div className="flex gap-2">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-[#0a84ff]"
                  style={{ animation: `pulse-dot 1s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── LEFT SIDEBAR ── */}
      <aside className="flex flex-col w-[340px] min-w-[340px] h-full apple-sidebar">

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#0a84ff' }}>
              <GraduationCap size={14} className="text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-sm font-semibold text-[#f5f5f7]">CSE Scheduler</h1>
              <span className="text-[10px] text-[rgba(255,255,255,0.45)]">Timetable Scheduler</span>
            </div>
            <div className="flex items-center gap-1.5">
              {lastStrategy && (
                <span className="text-[10px] font-medium text-[#0a84ff] bg-[#0a84ff]/15 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Zap size={10} />
                  {STRATEGIES.find(s => s.id === lastStrategy)?.label}
                </span>
              )}
              <button
                onClick={handleClearAll}
                id="clear-all-btn"
                title="Clear all selections"
                className="p-1.5 rounded-lg text-[rgba(255,255,255,0.45)] hover:text-[#ff453a] hover:bg-[#ff453a]/10 transition-all"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Strategy Segmented Control */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={11} className="text-[#0a84ff]" />
            <span className="text-[10px] font-semibold text-[rgba(255,255,255,0.45)] uppercase tracking-wider">Auto-Optimize</span>
          </div>
          <div className="segmented-control">
            {STRATEGIES.map(s => (
              <button
                key={s.id}
                id={`strategy-${s.id.toLowerCase()}`}
                onClick={() => handleOptimize(s.id)}
                className={lastStrategy === s.id ? 'active' : ''}
              >
                <div className="flex items-center justify-center gap-1">
                  {s.icon}
                  <span>{s.label}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Subject Picker */}
        <div className="px-4 pt-2 pb-1">
          <div className="flex items-center gap-1.5 mb-2">
            <BookOpen size={11} className="text-[#0a84ff]" />
            <span className="text-[10px] font-semibold text-[rgba(255,255,255,0.45)] uppercase tracking-wider">Subject</span>
          </div>
          <div className="relative">
            <button
              id="subject-dropdown-btn"
              onClick={() => setDropdownOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] hover:border-[#0a84ff]/40 transition-all text-left"
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${getColor(activeSubject.id).dot}`} />
                <div>
                  <div className="text-xs font-medium text-[#f5f5f7]">{activeSubject.name}</div>
                  <div className="text-[10px] text-[rgba(255,255,255,0.45)]">{activeSubject.code}</div>
                </div>
              </div>
              <ChevronDown size={13} className={`text-[rgba(255,255,255,0.45)] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-[rgba(255,255,255,0.1)] z-20 overflow-hidden bg-[#2c2c2e] shadow-lg"
                style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
                {SUBJECTS.map(s => (
                  <button
                    key={s.id}
                    id={`subject-opt-${s.id}`}
                    onClick={() => { setActiveSubjectId(s.id); setDropdownOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[rgba(255,255,255,0.05)] transition-all ${activeSubjectId === s.id ? 'bg-[#0a84ff]/8' : ''}`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getColor(s.id).dot}`} />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-[#f5f5f7]">{s.name}</div>
                      <div className="text-[10px] text-[rgba(255,255,255,0.45)]">{s.code}</div>
                    </div>
                    {selections[s.id] && <CheckCircle2 size={12} className="text-[#30d158]" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stats Bar */}
        <div className="px-4 py-2 flex gap-2">
          <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
            <Calendar size={11} className="text-[#0a84ff]" />
            <span className="text-[10px] text-[rgba(255,255,255,0.45)]">
              <span className="font-semibold text-[#f5f5f7]">{stats.activeDays}</span> day{stats.activeDays !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
            <Clock size={11} className="text-[#ff9f0a]" />
            <span className="text-[10px] text-[rgba(255,255,255,0.45)]">
              <span className="font-semibold text-[#f5f5f7]">{stats.totalGapMins}</span> gap{stats.totalGapMins !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
            <span className={`text-[11px] font-semibold ${completedCount === SUBJECTS.length ? 'text-[#30d158]' : 'text-[#f5f5f7]'}`}>
              {completedCount}/{SUBJECTS.length}
            </span>
          </div>
        </div>

        {/* Teacher List */}
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          <div className="flex items-center gap-1.5 mb-2 mt-1">
            <Users size={11} className="text-[#0a84ff]" />
            <span className="text-[10px] font-semibold text-[rgba(255,255,255,0.45)] uppercase tracking-wider">Instructors</span>
            <span className="ml-auto text-[10px] text-[rgba(255,255,255,0.45)]">{activeSubject.teachers.length} available</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {activeSubject.teachers.map(teacher => {
              const isSelected  = selections[activeSubjectId] === teacher.id;
              const isConflict  = conflictingTeacherIds.has(teacher.id);
              return (
                <button
                  key={teacher.id}
                  id={`teacher-card-${teacher.id}`}
                  disabled={isConflict}
                  onClick={() => !isConflict && handleTeacherSelect(activeSubjectId, teacher.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all ${
                    isConflict  ? 'apple-card disabled' :
                    isSelected  ? 'apple-card selected' :
                    'apple-card'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${getInitialBg(teacher.name)}`}>
                      {getInitials(teacher.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-[#f5f5f7] truncate">{teacher.name}</div>
                        {isSelected && <CheckCircle2 size={14} className="text-[#0a84ff] flex-shrink-0 ml-1" />}
                        {isConflict && <XCircle size={14} className="text-[#ff453a]/60 flex-shrink-0 ml-1" />}
                      </div>
                      <div className="text-[10px] text-[rgba(255,255,255,0.45)] mt-0.5">Group {teacher.group} · {teacher.department}</div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {teacher.slots.map((slot, i) => (
                          <span key={i}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[8px] font-medium ${
                              slot.type === 'Lab'
                                ? 'bg-[#ff453a]/10 text-[#ff453a]'
                                : 'bg-[#0a84ff]/10 text-[#0a84ff]'
                            }`}
                          >
                            {slot.type === 'Lab' ? <FlaskConical size={7} /> : <BookOpen size={7} />}
                            {slot.day.slice(0,3)} {slot.startTime}–{slot.endTime}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer: Current Selections */}
        <div className="border-t border-[rgba(255,255,255,0.06)] px-4 py-3 bg-[rgba(0,0,0,0.2)]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <AlignJustify size={11} className="text-[rgba(255,255,255,0.45)]" />
              <span className="text-[10px] font-semibold text-[rgba(255,255,255,0.45)] uppercase tracking-wider">Selections</span>
            </div>
            <div className="w-20 h-1 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(completedCount / SUBJECTS.length) * 100}%`,
                  background: completedCount === SUBJECTS.length
                    ? '#30d158'
                    : '#0a84ff',
                }} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {SUBJECTS.map(subj => {
              const tid = selections[subj.id];
              const teacher = subj.teachers.find(t => t.id === tid);
              const col = getColor(subj.id);
              return (
                <div key={subj.id}
                  className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-all ${tid ? '' : 'opacity-40'}`}
                  style={{ background: tid ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${col.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-medium text-[#f5f5f7] truncate">{subj.code}</div>
                    <div className="text-[8px] text-[rgba(255,255,255,0.45)] truncate">{teacher ? `${teacher.name} · Grp ${teacher.group}` : 'Not selected'}</div>
                  </div>
                  {tid && (
                    <button
                      id={`deselect-${subj.id}`}
                      onClick={() => setSelections(prev => ({ ...prev, [subj.id]: null }))}
                      className="p-0.5 rounded text-[rgba(255,255,255,0.45)] hover:text-[#ff453a] hover:bg-[#ff453a]/10 transition-all flex-shrink-0"
                    >
                      <Minus size={9} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* ── RIGHT: TIMETABLE VIEWPORT ── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden" style={{ background: '#1c1c1e' }}>

        {/* Viewport Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.06)] flex-shrink-0 bg-[rgba(30,30,32,0.8)]" style={{ backdropFilter: 'blur(20px)' }}>
          <div className="flex items-center gap-2">
            <Calendar size={13} className="text-[#0a84ff]" />
            <span className="text-sm font-semibold text-[#f5f5f7]">Weekly Schedule</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
              <Calendar size={11} className="text-[#0a84ff]" />
              <span className="text-[10px] text-[rgba(255,255,255,0.45)]">
                <span className="font-semibold text-[#f5f5f7]">{stats.activeDays}</span> day{stats.activeDays !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
              <Clock size={11} className="text-[#ff9f0a]" />
              <span className="text-[10px] text-[rgba(255,255,255,0.45)]">
                <span className="font-semibold text-[#f5f5f7]">{stats.totalGapMins}</span> gap{stats.totalGapMins !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Timetable Canvas */}
        <div className="flex-1 overflow-auto p-4">
          <div className="min-w-[900px] h-full flex flex-col bg-[rgba(255,255,255,0.03)] rounded-xl border border-[rgba(255,255,255,0.06)] shadow-sm" style={{ minHeight: '700px' }}>

            {/* Day Headers */}
            <div className="flex flex-shrink-0 border-b border-[rgba(255,255,255,0.06)]">
              <div className="w-14 flex-shrink-0" />
              {DAYS_ORDER.map(day => (
                <div key={day} className="flex-1 text-center py-2.5">
                  <span className="text-[11px] font-semibold text-[#f5f5f7]">{day.slice(0,3)}</span>
                  <div className="text-[9px] text-[rgba(255,255,255,0.45)] capitalize">{day}</div>
                </div>
              ))}
            </div>

            {/* Grid Body */}
            <div className="flex flex-1 relative">
              <div className="w-14 flex-shrink-0 relative border-r border-[rgba(255,255,255,0.04)]">
                {Array.from({ length: 13 }, (_, i) => {
                  const hour = GRID_START_HOUR + i;
                  const pct = (i / 12) * 100;
                  return (
                    <div key={hour} className="absolute right-0 pr-2 flex items-center"
                      style={{ top: `${pct}%`, transform: 'translateY(-50%)' }}>
                      <span className="text-[9px] font-mono text-[rgba(255,255,255,0.45)]">
                        {hour > 12 ? `${hour - 12}` : hour}:00{hour >= 12 ? 'pm' : 'am'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {DAYS_ORDER.map(day => {
                const dayEntries = timetableEntries.filter(e => e.slot.day === day);
                return (
                  <div key={day} className="flex-1 relative border-r border-[rgba(255,255,255,0.04)]"
                    style={{ minHeight: '600px' }}>
                    {Array.from({ length: 13 }, (_, i) => (
                      <div key={i} className="grid-line" style={{ top: `${(i / 12) * 100}%` }} />
                    ))}
                    {Array.from({ length: 12 }, (_, i) => (
                      <div key={`half-${i}`} className="grid-line" style={{ top: `${((i + 0.5) / 12) * 100}%`, borderTopColor: 'rgba(255,255,255,0.025)' }} />
                    ))}

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
                          <div className="text-[9px] text-[rgba(255,255,255,0.55)] truncate leading-tight mt-0.5">
                            {entry.teacher.name}
                          </div>
                          {durationMins >= 60 && (
                            <div className="flex items-center gap-0.5 mt-1">
                              <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium ${
                                entry.slot.type === 'Lab'
                                  ? 'bg-[#ff453a]/10 text-[#ff453a]'
                                  : 'bg-[#0a84ff]/10 text-[#0a84ff]'
                              }`}>
                                {entry.slot.type === 'Lab' ? <FlaskConical size={7} /> : <BookOpen size={7} />}
                                {entry.slot.type}
                              </span>
                            </div>
                          )}
                          {durationMins >= 80 && (
                            <div className="flex items-center gap-0.5 mt-0.5">
                              <MapPin size={7} className="text-[rgba(255,255,255,0.45)] flex-shrink-0" />
                              <span className="text-[8px] text-[rgba(255,255,255,0.45)] truncate">{entry.slot.location}</span>
                            </div>
                          )}
                          <div className="text-[7px] text-[rgba(255,255,255,0.45)] font-mono mt-0.5 leading-none">
                            {entry.slot.startTime}\u2013{entry.slot.endTime}
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
        <div className="flex-shrink-0 border-t border-[rgba(255,255,255,0.06)] px-5 py-2 flex items-center gap-4 bg-[rgba(0,0,0,0.15)]">
          <span className="text-[9px] text-[rgba(255,255,255,0.45)] uppercase tracking-wider font-semibold">Legend</span>
          {SUBJECTS.map(s => {
            const col = getColor(s.id);
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-sm border-l-2 ${col.border} ${col.bg}`} />
                <span className={`text-[9px] font-medium ${col.text}`}>{s.code}</span>
              </div>
            );
          })}
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-1.5 rounded-sm bg-[#0a84ff]/20 border-l-2 border-[#0a84ff]" />
              <span className="text-[9px] text-[rgba(255,255,255,0.45)]">Theory</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-1.5 rounded-sm bg-[#ff453a]/20 border-l-2 border-[#ff453a]" />
              <span className="text-[9px] text-[rgba(255,255,255,0.45)]">Lab</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
