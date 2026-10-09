import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { CurrentRoadmap, ImprovementChecklistItem, RoadmapData, RoadmapWeek } from '../types';

// While the agent builds the roadmap the page checks back this often, for at most this long
const POLL_MS = 4000;
const POLL_LIMIT_MS = 6 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The student's current 4-week roadmap, built after each mock interview. `refreshKey`
 * (the latest report id) refetches after a new interview; while the roadmap is being
 * built it polls until it is ready.
 */
export function useRoadmap(studentId: string | undefined, refreshKey?: string) {
  const [current, setCurrent] = useState<CurrentRoadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const pollStarted = useRef<number | null>(null);

  const load = useCallback(async () => {
    // Placeholder students (before the profile loads) have no roadmap on the server
    if (!studentId || !UUID_RE.test(studentId)) {
      setLoading(false);
      return;
    }
    try {
      setCurrent(await api.learning.getCurrentRoadmap(studentId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your roadmap');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  // Never show (or add to a checklist) another student's or an earlier interview's roadmap
  useEffect(() => {
    setCurrent(null);
  }, [studentId, refreshKey]);

  useEffect(() => {
    setLoading(true);
    pollStarted.current = null;
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (current?.status !== 'GENERATING') {
      pollStarted.current = null;
      return;
    }
    pollStarted.current ??= Date.now();
    if (Date.now() - pollStarted.current > POLL_LIMIT_MS) return;
    const timer = setTimeout(() => { void load(); }, POLL_MS);
    return () => clearTimeout(timer);
  }, [current, load]);

  const rebuild = useCallback(async () => {
    if (!studentId) return;
    setRebuilding(true);
    try {
      await api.learning.rebuildRoadmap(studentId);
      setError(null);
      pollStarted.current = null;
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rebuild the roadmap');
    } finally {
      setRebuilding(false);
    }
  }, [studentId, load]);

  // Only a roadmap built from (or after) the latest interview counts as the current one
  const roadmap = current?.status === 'READY' && current.plan?.isCurrent && current.plan.data?.weeklyPlan?.length
    ? { id: current.plan.id, data: current.plan.data }
    : null;

  return { current, roadmap, loading, error, rebuilding, rebuild };
}

// ── Roadmap → Post-Interview Improvement Checklist ───────────────────────────

const ROADMAP_ITEM_PREFIX = 'roadmap_';
// The generic 4-week template the checklist shows until a real roadmap exists
const TEMPLATE_ITEM_IDS = new Set(['chk_w1', 'chk_w2', 'chk_w3', 'chk_w4']);

const WEEK_CATEGORY: Record<string, ImprovementChecklistItem['category']> = {
  delivery: 'COMMUNICATION',
  projects: 'SYSTEM_DESIGN',
  topic: 'TECHNICAL',
  depth: 'TECHNICAL',
  simulation: 'TECHNICAL',
};

const checklistStorageKey = (studentKey: string) => `student_improvement_checklist_${studentKey}`;

/** One checklist item per roadmap day plus each week's checkpoint (older roadmaps: per activity). */
export function roadmapChecklistItems(planId: string, data: RoadmapData): ImprovementChecklistItem[] {
  const items: ImprovementChecklistItem[] = [];
  data.weeklyPlan.forEach((week: RoadmapWeek, index) => {
    const n = week.week || index + 1;
    const idBase = `${ROADMAP_ITEM_PREFIX}${planId}_w${n}`;
    const category = WEEK_CATEGORY[week.kind ?? ''] ?? 'TECHNICAL';
    if (Array.isArray(week.days) && week.days.length > 0) {
      for (const day of week.days) {
        items.push({
          id: `${idBase}_d${day.day}`,
          week: `Week ${n} · Day ${day.day}`,
          title: day.title,
          description: (day.tasks ?? []).map((task) => task.text).join(' • '),
          category,
          isCompleted: false,
        });
      }
      if (week.checkpoint?.task) {
        items.push({
          id: `${idBase}_cp`,
          week: `Week ${n} · Checkpoint`,
          title: `Week ${n} checkpoint${week.focus ? `: ${week.focus}` : ''}`,
          description: week.checkpoint.passIf
            ? `${week.checkpoint.task} Pass if: ${week.checkpoint.passIf}`
            : week.checkpoint.task,
          category,
          isCompleted: false,
        });
      }
    } else {
      (week.activities ?? []).forEach((activity, i) => {
        items.push({
          id: `${idBase}_a${i + 1}`,
          week: `Week ${n}`,
          title: week.focus || `Week ${n} activity ${i + 1}`,
          description: activity,
          category,
          isCompleted: false,
        });
      });
    }
  });
  return items;
}

/**
 * Adds the roadmap to the checklist, replacing the previous interview's roadmap and the
 * generic template. Returns null when this roadmap is already in the list.
 */
export function mergeRoadmapIntoChecklist(
  list: ImprovementChecklistItem[],
  planId: string,
  data: RoadmapData,
): ImprovementChecklistItem[] | null {
  if (list.some((item) => item.id.startsWith(`${ROADMAP_ITEM_PREFIX}${planId}_`))) return null;
  const items = roadmapChecklistItems(planId, data);
  if (items.length === 0) return null;
  const kept = list.filter((item) => !item.id.startsWith(ROADMAP_ITEM_PREFIX) && !TEMPLATE_ITEM_IDS.has(item.id));
  return [...items, ...kept];
}

/** Same as mergeRoadmapIntoChecklist, applied to the checklist saved in this browser. */
export function addRoadmapToSavedChecklist(
  studentKey: string,
  planId: string,
  data: RoadmapData,
  fallback: ImprovementChecklistItem[] = [],
): ImprovementChecklistItem[] | null {
  let list = fallback;
  try {
    const saved = localStorage.getItem(checklistStorageKey(studentKey));
    if (saved) list = JSON.parse(saved);
  } catch {}
  const updated = mergeRoadmapIntoChecklist(list, planId, data);
  if (updated) {
    try {
      localStorage.setItem(checklistStorageKey(studentKey), JSON.stringify(updated));
    } catch {}
  }
  return updated;
}
