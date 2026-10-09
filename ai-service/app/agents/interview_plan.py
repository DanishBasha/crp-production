"""Personalised 4-week plan built from the student's latest mock interview.

Two layers:

1. Evidence rules (no LLM). The interview report is diagnosed — weakest topics with
   the exact questions, scores and missed key points; delivery problems measured from
   speech (pace, filler words, long silences, time to start answering) — and four
   weeks of day-by-day work are laid out with progressive numeric targets and a
   checkpoint interview at the end of every week. This alone is a complete plan, so a
   plan exists even when the LLM is unavailable.

2. LLM enrichment (one small call per week, weeks 1-3). Topic knowledge the rules
   cannot know: what to study for each missed key point, a hands-on exercise, new
   follow-up questions with what a strong answer covers. The output is validated
   field by field and merged; a week whose call fails keeps its rule-based content.
   Calls are kept small because free-tier keys allow ~1,000 output tokens a minute.
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import quote_plus

from app.config import LEARNING_PLAN_DURATION_WEEKS

# Mirrors backend/src/services/speechMetrics.ts
IDEAL_WPM_MIN = 120
IDEAL_WPM_MAX = 150
PAUSE_THRESHOLD_SEC = 2.5

STRONG = 80
CRITICAL = 60

# Output budget of one enrichment call; raise it with a paid key for longer notes.
# Reasoning fallback models spend part of it thinking; the per-minute limit counts what is
# actually generated, so a generous cap costs nothing.
WEEK_MAX_TOKENS = int(os.getenv("LEARNING_PLAN_WEEK_MAX_TOKENS", "1600"))
# Enrichment stops (rules take over) once generation has run this long.
ENRICH_BUDGET_SECONDS = float(os.getenv("LEARNING_PLAN_ENRICH_BUDGET_SECONDS", "90"))

_GENERIC_CATEGORIES = {"technical", "fundamentals", "general", "core concepts"}


# ── Small helpers ─────────────────────────────────────────────────────────────

def _trim(text: Any, limit: int = 160) -> str:
    s = re.sub(r"\s+", " ", str(text or "")).strip()
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def _num(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any, default: int = 0) -> int:
    n = _num(value)
    return int(round(n)) if n is not None else default


def _fmt(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else f"{n:.1f}"


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.lower().strip()
        if key and key not in seen:
            seen.add(key)
            out.append(item.strip())
    return out


def _area_label(category: str) -> str:
    c = (category or "").strip()
    if not c or c.lower() in _GENERIC_CATEGORIES:
        return "Technical fundamentals"
    return c


def _score_target(baseline: int) -> int:
    # Very low scores usually mean the topic was never learned; a month of study clears 50
    if baseline < 40:
        return max(baseline + 30, 50)
    gain = 15 if baseline < 60 else 10 if baseline < 75 else 6
    return min(95, baseline + gain)


_STORY_WORDS = ("project", "experience", "resume", "internship", "background", "work history")
_BEHAVIOURAL_WORDS = ("behavio", "team", "leader", "conflict", "situation", "motivation", "hr", "culture",
                      "soft skill", "strength", "weakness", "career")


def _area_style(name: str) -> str:
    """technical (study concepts), story (explain your own work) or behavioural (STAR answers)."""
    n = name.lower()
    if any(w in n for w in _STORY_WORDS):
        return "story"
    if any(re.search(rf"\b{w}", n) for w in _BEHAVIOURAL_WORDS):
        return "behavioural"
    return "technical"


def _step(baseline: float, final: float, week: int, weeks: int) -> float:
    return baseline + (final - baseline) * week / weeks


def _youtube(query: str, usage: str) -> dict[str, str]:
    return {
        "type": "YOUTUBE_SEARCH",
        "title": f"YouTube: “{query}”",
        "url": "https://www.youtube.com/results?search_query=" + quote_plus(query),
        "usage": usage,
    }


# ── 1. Diagnosis ──────────────────────────────────────────────────────────────

def _turn_summary(t: dict) -> dict:
    return {
        "turn": _int(t.get("turn")),
        "question": _trim(t.get("question"), 220),
        "score": _int(t.get("technicalScore")),
        "difficulty": t.get("difficulty") or "",
        "category": _area_label(t.get("category") or ""),
        "missed": [_trim(p, 120) for p in (t.get("pointsMissed") or []) if str(p).strip()],
        "covered": [_trim(p, 120) for p in (t.get("pointsCovered") or []) if str(p).strip()],
        "note": _trim(t.get("weaknesses") or t.get("feedback") or "", 220),
        "strength": _trim(t.get("strengths") or "", 160),
        "source": t.get("questionSource") or "",
        "fillers": _int(t.get("fillerCount")),
        "wpm": _num(t.get("wpm")),
    }


def _delivery_issues(d: dict, answered: int) -> list[dict]:
    """Measured delivery problems, most severe first, each with a final target."""
    issues: list[dict] = []
    wpm = d["wpm"]
    if wpm:
        if wpm > IDEAL_WPM_MAX:
            issues.append({
                "key": "pace_fast", "label": "Speaking pace", "severity": (wpm - IDEAL_WPM_MAX) / 10,
                "baseline": wpm, "final": IDEAL_WPM_MAX, "unit": "WPM",
                "evidence": f"You averaged {_fmt(wpm)} WPM — faster than the {IDEAL_WPM_MIN}-{IDEAL_WPM_MAX} WPM interviewers follow easily.",
            })
        elif wpm < IDEAL_WPM_MIN:
            issues.append({
                "key": "pace_slow", "label": "Speaking pace", "severity": (IDEAL_WPM_MIN - wpm) / 10,
                "baseline": wpm, "final": IDEAL_WPM_MIN, "unit": "WPM",
                "evidence": f"You averaged {_fmt(wpm)} WPM — slower than the {IDEAL_WPM_MIN}-{IDEAL_WPM_MAX} WPM band, which reads as hesitant.",
            })
    if d["fillersPerAnswer"] > 1:
        top = ", ".join(f"“{w}” ×{c}" for w, c in d["topFillers"][:3])
        issues.append({
            "key": "fillers", "label": "Filler words per answer", "severity": d["fillersPerAnswer"],
            "baseline": d["fillersPerAnswer"], "final": 1.0, "unit": "per answer",
            "evidence": f"{d['fillers']} filler words over {answered} answers ({_fmt(d['fillersPerAnswer'])} per answer){': ' + top if top else ''}.",
        })
    if d["pausesPerAnswer"] > 0.5:
        issues.append({
            "key": "pauses", "label": "Long silences per answer", "severity": d["pausesPerAnswer"] * 2,
            "baseline": d["pausesPerAnswer"], "final": 0.0, "unit": "per answer",
            "evidence": f"{d['longPauses']} silences longer than {PAUSE_THRESHOLD_SEC:g}s while answering.",
        })
    if d["latencySec"] is not None and d["latencySec"] > 4:
        issues.append({
            "key": "latency", "label": "Time to start answering", "severity": (d["latencySec"] - 3) / 2,
            "baseline": d["latencySec"], "final": 3.0, "unit": "s",
            "evidence": f"You took {_fmt(d['latencySec'])}s on average before your first words.",
        })
    if d["clarity"] and d["clarity"] < 70:
        issues.append({
            "key": "clarity", "label": "Clarity & structure score", "severity": (70 - d["clarity"]) / 10,
            "baseline": d["clarity"], "final": 75, "unit": "/100",
            "evidence": f"Clarity & tone scored {d['clarity']}/100 — answers were hard to follow.",
        })
    if d["fluency"] and d["fluency"] < 70 and not any(i["key"] == "pauses" for i in issues):
        issues.append({
            "key": "fluency", "label": "Fluency score", "severity": (70 - d["fluency"]) / 10,
            "baseline": d["fluency"], "final": 75, "unit": "/100",
            "evidence": f"Fluency scored {d['fluency']}/100 — restarts and broken sentences cost marks.",
        })
    issues.sort(key=lambda i: i["severity"], reverse=True)
    return issues


def diagnose(evidence: dict) -> dict:
    report = evidence.get("report") or {}
    resume = evidence.get("resume") or {}
    turns = [_turn_summary(t) for t in (report.get("turns") or []) if isinstance(t, dict)]
    answered = _int(report.get("questionsAnswered"), len(turns)) or len(turns) or 1

    intro = next((t for t in turns if t["category"].lower() == "introduction"), None)
    technical_turns = [t for t in turns if t is not intro]

    by_area: dict[str, list[dict]] = {}
    for t in technical_turns:
        by_area.setdefault(t["category"], []).append(t)
    areas = []
    for name, group in by_area.items():
        group = sorted(group, key=lambda t: t["score"])
        score = round(sum(t["score"] for t in group) / len(group))
        areas.append({
            "name": name,
            "style": _area_style(name),
            "score": score,
            "turns": group,
            "missed": _unique([p for t in group for p in t["missed"]]),
            "covered": _unique([p for t in group for p in t["covered"]]),
            "notes": _unique([t["note"] for t in group if t["note"]]),
        })
    areas.sort(key=lambda a: a["score"])

    fillers = _int(report.get("totalFillerWords"))
    breakdown = report.get("fillerWordBreakdown") or {}
    top_fillers = sorted(
        ((str(w), _int(c)) for w, c in breakdown.items() if _int(c) > 0),
        key=lambda wc: wc[1], reverse=True,
    )
    long_pauses = _int(report.get("longPauses"))
    wpm = _num(report.get("averageWpm")) or None
    delivery = {
        "wpm": round(wpm) if wpm else None,
        "paceLabel": report.get("paceLabel"),
        "fillers": fillers,
        "fillersPerAnswer": round(fillers / answered, 1),
        "topFillers": top_fillers,
        "longPauses": long_pauses,
        "pausesPerAnswer": round(long_pauses / answered, 1),
        "latencySec": _num(report.get("averageResponseLatencySec")),
        "fluency": _int(report.get("fluencyScore")),
        "clarity": _int(report.get("clarityScore")),
    }
    delivery["issues"] = _delivery_issues(delivery, answered)

    skills = resume.get("skills") or {}
    flat_skills = _unique([str(s) for group in (skills.values() if isinstance(skills, dict) else []) for s in (group or [])])
    projects = [
        {
            "title": _trim(p.get("title"), 80),
            "techStack": [str(x) for x in (p.get("techStack") or p.get("tech_stack") or [])][:6],
            "description": _trim(p.get("description"), 200),
        }
        for p in (resume.get("projects") or []) if isinstance(p, dict) and p.get("title")
    ][:3]

    history = evidence.get("history") or []
    trend = None
    if len(history) >= 2:
        latest, previous = _num(history[0].get("overall_score")), _num(history[1].get("overall_score"))
        if latest is not None and previous is not None:
            trend = round(latest - previous)

    strengths = [f"{a['name']} ({a['score']}/100)" for a in areas if a["score"] >= STRONG]
    strengths += [t["strength"] for t in sorted(turns, key=lambda t: -t["score"])[:2] if t["strength"]]

    return {
        "date": report.get("date") or (evidence.get("completedAt") or "")[:10],
        "attemptId": evidence.get("attemptId"),
        "overall": _int(report.get("overallScore")),
        "technical": _int(report.get("technicalScore")),
        "communication": _int(report.get("communicationScore")),
        "answered": _int(report.get("questionsAnswered"), len(turns)),
        "planned": _int(report.get("questionsPlanned"), len(turns)),
        "turns": turns,
        "intro": intro,
        "areas": areas,
        "unanswered": [t for t in technical_turns if t["score"] == 0],
        "delivery": delivery,
        "strengths": _unique(strengths)[:4],
        "projects": projects,
        "skills": flat_skills[:15],
        "trend": trend,
        "student": evidence.get("student") or {},
    }


# ── 2. Week outline ───────────────────────────────────────────────────────────

def outline(diag: dict, weeks: int = LEARNING_PLAN_DURATION_WEEKS) -> list[dict]:
    """Pick a theme for every week: the weakest things first, simulation last."""
    slots = weeks - 1
    weak_areas = [a for a in diag["areas"] if a["score"] < STRONG]
    issues = diag["delivery"]["issues"]
    communication = diag["communication"]
    delivery_needed = bool(issues) and (communication < STRONG or any(i["severity"] >= 1.5 for i in issues))
    has_projects = bool(diag["projects"])

    candidates: list[dict] = []
    for a in weak_areas:
        # Questions about the student's own projects belong in the resume-projects week
        if a["style"] == "story" and has_projects:
            existing = next((c for c in candidates if c["kind"] == "projects"), None)
            if existing:
                existing["areas"].append(a)
            else:
                candidates.append({"kind": "projects", "areas": [a], "severity": a["score"]})
        else:
            candidates.append({"kind": "topic", "area": a, "severity": a["score"]})
    if delivery_needed:
        # On a tie delivery goes first: it also fixes the introduction and every other answer
        candidates.append({"kind": "delivery", "severity": communication - 0.5})
    candidates.sort(key=lambda c: c["severity"])

    critical = [c for c in candidates if c["severity"] < CRITICAL]
    planned_projects = any(c["kind"] == "projects" for c in candidates)
    reserve_projects = has_projects and not planned_projects and len(critical) < slots
    chosen = candidates[: slots - 1 if reserve_projects else slots]

    # Topics beyond the chosen weeks are folded into the last topic week
    leftovers = [c["area"] for c in candidates[len(chosen):] if c["kind"] == "topic"]
    if reserve_projects:
        chosen.append({"kind": "projects"})
    # Few weak spots: go deeper on the remaining areas, lowest score first
    planned = [c["area"] for c in chosen if c.get("area")] + [a for c in chosen for a in c.get("areas", [])]
    depth_pool = [a for a in diag["areas"] if not any(a is p for p in planned)]
    while len(chosen) < slots:
        if diag["projects"] and not any(c["kind"] == "projects" for c in chosen):
            chosen.append({"kind": "projects"})
        elif depth_pool:
            chosen.append({"kind": "depth", "area": depth_pool.pop(0)})
        elif not any(c["kind"] == "delivery" for c in chosen):
            chosen.append({"kind": "delivery"})
        else:
            part = sum(1 for c in chosen if c["kind"] == "depth" and c.get("area") is None) + 1
            chosen.append({"kind": "depth", "area": None, "part": part})

    topic_weeks = [c for c in chosen if c["kind"] == "topic"]
    if leftovers and topic_weeks:
        topic_weeks[-1]["also"] = leftovers

    # Spread the delivery drills: every week practises one measured delivery problem
    chosen.append({"kind": "simulation"})
    for i, c in enumerate(chosen):
        c["drill"] = issues[i % len(issues)] if issues else None
    for n, c in enumerate(chosen, 1):
        c["week"] = n
    return chosen


# ── 3. Rule-based week content ────────────────────────────────────────────────

_DRILLS: dict[str, dict] = {
    "fillers": {
        "name": "Silent-pause drill",
        "steps": [
            "Pick one of this week's questions, start a 2-minute timer and answer aloud while recording.",
            "Play it back and tally every filler ({top}).",
            "Answer again, replacing each filler with a one-second silent pause.",
            "Repeat until a 2-minute answer has at most {target} fillers.",
        ],
    },
    "pace_fast": {
        "name": "Pacing drill",
        "steps": [
            "Read a 150-word paragraph aloud in 60-75 seconds — that is 120-150 WPM.",
            "Answer one question pausing for a breath after every sentence.",
            "Record one minute, count the words and keep going until you land at or below {target} WPM.",
        ],
    },
    "pace_slow": {
        "name": "Momentum drill",
        "steps": [
            "Spend 20 seconds jotting three bullet points, then speak without stopping to restart sentences.",
            "Record one minute and count the words: aim for at least {target} words.",
            "Repeat on a second question; keep each sentence short and finish it before starting the next.",
        ],
    },
    "pauses": {
        "name": "Bridge-phrase drill",
        "steps": [
            "Learn three bridges: “There are two parts to this…”, “Let me walk through it step by step…”, “The key trade-off is…”.",
            "Answer three questions; whenever you need thinking time, say a bridge instead of going silent.",
            "Record and check: no silence longer than {threshold}s (target {target} per answer).",
        ],
    },
    "latency": {
        "name": "Headline-first drill",
        "steps": [
            "For 10 questions, say a one-line headline answer within 3 seconds (“I'd add an index on…, because…”), then expand.",
            "Time the gap from question to first word with a stopwatch.",
            "Repeat until you start within {target}s on 8 of 10 questions.",
        ],
    },
    "clarity": {
        "name": "Signposting drill",
        "steps": [
            "Structure each answer as: headline → “First… Second…” → example → one-line wrap-up.",
            "Record three answers and write down the points a listener would catch.",
            "If you cannot list your own points from the recording, cut the answer to two points and redo it.",
        ],
    },
    "fluency": {
        "name": "Clean-sentence drill",
        "steps": [
            "Answer three questions in short, complete sentences — no restarting a sentence halfway.",
            "When you lose your thread, pause, then restart with “In short, …”.",
            "Record and count restarts; aim for none in a 2-minute answer.",
        ],
    },
}


def _drill_target(issue: dict, week: int, weeks: int) -> float:
    value = _step(float(issue["baseline"]), float(issue["final"]), week, weeks)
    return round(value) if issue["unit"] in ("WPM", "/100") else round(value, 1)


# Delivery measures where a lower number is the improvement
_LOWER_IS_BETTER = {"fillers", "pauses", "latency", "pace_fast"}


def _with_unit(value: float, unit: str) -> str:
    return f"{_fmt(value)}{unit}" if unit in ("s", "/100") else f"{_fmt(value)} {unit}"


def _target_text(issue: dict, value: float) -> str:
    return f"{'≤' if issue['key'] in _LOWER_IS_BETTER else '≥'} {_with_unit(value, issue['unit'])}"


def _drill(issue: dict | None, week: int, weeks: int, top_fillers: list) -> dict:
    if not issue:
        return {
            "name": "Answer-structure drill",
            "steps": [
                "Answer three questions as: point → reason → example → trade-off.",
                "Keep each answer to 90-120 seconds and end with a one-line summary.",
            ],
            "target": "Every answer has all four parts and finishes inside 2 minutes.",
        }
    target = _drill_target(issue, week, weeks)
    top = ", ".join(f"“{w}”" for w, _ in top_fillers[:3]) or "“um”, “uh”, “like”"
    template = _DRILLS[issue["key"]]
    steps = [s.format(top=top, target=_fmt(target), threshold=f"{PAUSE_THRESHOLD_SEC:g}") for s in template["steps"]]
    return {
        "name": template["name"],
        "steps": steps,
        "target": f"{issue['label']}: {_with_unit(issue['baseline'], issue['unit'])} now → {_target_text(issue, target)} this week.",
        "metric": issue["label"],
        "baselineText": _with_unit(issue["baseline"], issue["unit"]),
        "targetText": _target_text(issue, target),
    }


def _task(text: str) -> dict:
    return {"text": text}


def _drill_task(drill: dict) -> dict:
    target = f" — target {drill['metric'].lower()} {drill['targetText']}" if drill.get("targetText") else ""
    return _task(f"Run the {drill['name']} (steps in this week's drill){target}.")


def _study_task(point: str, project: dict | None) -> str:
    example = f"your project {project['title']}" if project else "a system you have built or used"
    return (f"Study “{point}”: write a 5-line note — what it is, why it matters, when you would use it, "
            f"one trade-off, and how it applies to {example}.")


def _followups(area: str, project: dict | None, style: str = "technical") -> list[dict]:
    """Follow-up questions an interviewer asks next, by kind of topic."""
    p = project["title"] if project else "your main project"
    if style == "story":
        return [
            {"question": f"What exactly did you build in {p} yourself, as opposed to the team?",
             "goodAnswerCovers": ["Your own part, said with “I”", "One technical decision you made", "How it fitted the whole"]},
            {"question": f"How do you know {p} worked — what result did you measure?",
             "goodAnswerCovers": ["A number (users, time saved, accuracy)", "How you measured it", "What it meant for users"]},
            {"question": f"What was the hardest problem in {p}, and how did you solve it?",
             "goodAnswerCovers": ["The concrete problem", "What you tried first", "The fix and what you learned"]},
            {"question": f"If you rebuilt {p} today, what would you change?",
             "goodAnswerCovers": ["An honest weakness", "The better approach", "Why it is better"]},
        ]
    if style == "behavioural":
        return [
            {"question": "Tell me about a time you disagreed with a teammate. What did you do?",
             "goodAnswerCovers": ["Situation and task in two sentences", "Your own actions", "The result, ideally with a number"]},
            {"question": "Describe a time you failed or missed a deadline. What did you learn?",
             "goodAnswerCovers": ["An honest failure", "What you changed afterwards", "Evidence it worked"]},
            {"question": "Tell me about something you are proud of that was not in your coursework.",
             "goodAnswerCovers": ["Why it mattered to you", "What you did", "The outcome"]},
        ]
    return [
        {"question": f"What trade-offs did you make around {area} in {p}, and what would you change at 10× the users?",
         "goodAnswerCovers": ["The decision and the alternative you rejected", "Why, in terms of cost/latency/complexity", "What changes at scale"]},
        {"question": f"What is the first thing that would break in {area} under heavy load, and how would you detect it?",
         "goodAnswerCovers": ["A concrete failure mode", "The metric or log that reveals it", "A mitigation"]},
        {"question": f"Explain the most important idea in {area} to a non-technical interviewer in 60 seconds.",
         "goodAnswerCovers": ["A plain-language definition", "One everyday analogy", "Why it matters to users"]},
    ]


def _interview_question(t: dict) -> dict:
    covers = _unique(t["missed"] + t["covered"])[:5] or ([t["note"]] if t["note"] else [])
    return {
        "question": t["question"],
        "from": f"Your interview, Q{t['turn']} — scored {t['score']}/100",
        "goodAnswerCovers": covers,
    }


def _project_for(questions: list[str], projects: list[dict]) -> dict | None:
    """The resume project the interview asked about in these questions, else the first one."""
    text = " ".join(questions).lower()
    return next((p for p in projects if p["title"].lower() in text), projects[0] if projects else None)


def _topic_week(c: dict, diag: dict, weeks: int) -> dict:
    a = c["area"]
    name = a["name"]
    style = a["style"]
    week = c["week"]
    project = _project_for([t["question"] for t in a["turns"]], diag["projects"])
    worst = a["turns"][0]
    missed = a["missed"][:4]
    target = _score_target(a["score"])
    days: list[dict] = []

    reread = _task(f"Re-read Q{worst['turn']}: “{_trim(worst['question'], 140)}” — you scored {worst['score']}/100."
                   + (f" Evaluator's note: “{worst['note']}”." if worst["note"] else "")
                   + " Write one line on what your answer was missing.")
    project_name = project["title"] if project else "your main project"
    if style == "story":
        day1_title, day2_title = "Diagnose: what your answer left out", "Write your project story"
        day1 = [reread, _task("A strong answer needed: " + ("; ".join(missed) if missed else
                              "the problem, your own role, how it works and a result") + ". Mark which ones you said.")]
        day2 = [
            _task(f"Write a 6-line story for {project_name}: the problem and who had it → why it mattered → your own role "
                  "(say “I”, not “we”) → how it works in one sentence → a result with a number → what you would improve."),
            _task("Replace every vague phrase (“stuff like that”, “and all”) with a specific fact or number."),
            _task("Record a 90-second version and cut anything that is not about your own decisions."),
        ]
        title = "Make your project answers concrete"
        objective = (f"By the end of week {week} your project answers state the problem, your own role, how it works "
                     f"and a measured result — scoring at least {target}/100.")
        outcome = "A 6-line story per project, every vague phrase replaced, all project questions re-answered and recorded."
        search = "how to explain your project in a technical interview"
        lever = "Interviewers judge your ownership and impact from how you explain your own work."
    elif style == "behavioural":
        day1_title, day2_title = "Diagnose & learn STAR", "Build your story bank"
        day1 = [reread, _task(f"Learn STAR — Situation, Task, Action, Result. Write one line for each from a real "
                              f"experience that fits Q{worst['turn']}.")]
        day2 = [
            _task("Write four STAR stories: a challenge you overcame, a disagreement in a team, a failure, and a success with a number."),
            _task("Keep Situation + Task under 20 seconds; spend most of the answer on what you did and the result."),
            _task("Rehearse each story aloud in 90 seconds."),
        ]
        title = f"Answer {name} questions with STAR"
        objective = (f"By the end of week {week} you have four rehearsed STAR stories and score at least {target}/100 "
                     f"on {name} questions.")
        outcome = "Four STAR stories written and rehearsed; every interview question in this area re-answered with STAR."
        search = "STAR method interview answer examples"
        lever = "These questions decide whether an interviewer trusts you in a team."
    else:
        day1_title, day2_title = f"Diagnose & relearn: {name}", f"Build depth in {name}"
        day1 = [reread] + [_task(_study_task(m, project)) for m in missed[:2]]
        if not missed:
            day1.append(_task(f"List the 5 core concepts an interviewer expects in {name} and write one example for each."))
        day2 = [_task(_study_task(m, project)) for m in missed[2:4]]
        day2.append(_task(f"Build a one-page cheat-sheet for {name}: key terms, when to use what, and one trade-off per idea."))
        day2.append(_task(f"Teach it back: explain {name} out loud for 2 minutes without notes and record it."))
        title = f"Close the gap in {name}"
        objective = (f"By the end of week {week} you can answer every {name} question from your interview "
                     f"covering all key points, and score at least {target}/100 on {name} in a mock.")
        outcome = (f"All {name} interview questions re-answered with every key point; "
                   f"{len(missed) or 3} study notes written; one recorded mini-mock reviewed.")
        search = f"{name} explained for interviews"
        lever = None
    days.append({"day": 1, "title": day1_title, "minutes": 60, "tasks": day1})
    days.append({"day": 2, "title": day2_title, "minutes": 60, "tasks": day2})

    day3 = []
    for t in a["turns"][:2]:
        points = _unique(t["missed"] + t["covered"])[:5]
        day3.append(_task(
            f"Record a 90-second answer to Q{t['turn']}: “{_trim(t['question'], 120)}”"
            + (f" covering: {'; '.join(points)}." if points else ".")
            + (f" Tick each point you actually said — target {len(points)}/{len(points)}." if points else "")))
    day3.append(_task("Structure every answer as headline → how it works → example → trade-off." if style == "technical"
                      else "Structure every answer as situation → what you did → result with a number."))
    days.append({"day": 3, "title": "Re-answer the questions you lost marks on", "minutes": 45, "tasks": day3})

    day4 = [_task("Answer each new follow-up question in this week's practice list aloud, 2 minutes max per answer."),
            _task("For each answer, write the one point you forgot, then answer it again.")]
    if c.get("also"):
        names = ", ".join(f"{x['name']} ({x['score']}/100)" for x in c["also"])
        day4.append(_task(f"Also review: {names} — skim your notes and answer one question from each."))
    days.append({"day": 4, "title": "Go one level deeper", "minutes": 45, "tasks": day4})

    drill = _drill(c.get("drill"), week, weeks, diag["delivery"]["topFillers"])
    days.append({"day": 5, "title": f"{drill['name']} + mini-mock", "minutes": 40, "tasks": [
        _drill_task(drill),
        _task("Answer three of this week's practice questions back to back while recording; check fillers and pace."),
    ]})

    evidence = [f"Q{t['turn']} ({t['score']}/100): “{_trim(t['question'], 110)}”"
                + (f" — missed: {'; '.join(t['missed'][:3])}" if t["missed"] else "") for t in a["turns"][:3]]
    weakest = a is (diag["areas"][0] if diag["areas"] else None)
    if lever is None:
        lever = (f"Closing this gap is the fastest way to lift your technical score ({diag['technical']}/100)." if weakest else
                 f"Interviewers dig into {name} with follow-ups, so it is your next-biggest lever on the technical score.")
    why = (f"Your {name} answers averaged {a['score']}/100"
           + (" — your weakest area." if weakest else ".")
           + (f" You missed: {'; '.join(missed[:3])}." if missed else "")
           + f" {lever}")
    targets = [{"metric": f"{name} answer score", "baseline": f"{a['score']}/100", "target": f"≥ {target}/100"}]
    if a["missed"]:
        covered = len(a["covered"])
        total = covered + len(a["missed"])
        targets.append({"metric": "Key points covered when you re-answer", "baseline": f"{covered}/{total}", "target": f"{total}/{total}"})
    return {
        "week": week,
        "kind": "topic",
        "style": style,
        "title": title,
        "focus": name,
        "focusScore": a["score"],
        "objective": objective,
        "whyThisWeek": why,
        "evidence": evidence,
        "targets": targets + ([{"metric": drill["metric"], "baseline": drill["baselineText"], "target": drill["targetText"]}]
                              if c.get("drill") else []),
        "days": days,
        "practiceQuestions": [_interview_question(t) for t in a["turns"][:3]] + _followups(name, project, style),
        "drill": drill,
        # Only concepts are taught through study notes; stories and STAR answers are practised
        "studyTopics": missed if style == "technical" else [],
        "searchQuery": search,
        "checkpoint": {
            "task": "Take a mock interview on the platform.",
            "passIf": f"{name} answers score ≥ {target}/100"
                      + (f"; {drill['metric'].lower()} {drill['targetText']}" if c.get("drill") else ""),
        },
        "measurableOutcome": outcome,
    }


def _delivery_week(c: dict, diag: dict, weeks: int) -> dict:
    week = c["week"]
    d = diag["delivery"]
    issues = d["issues"]
    intro = diag["intro"]
    project = diag["projects"][0] if diag["projects"] else None
    sample = sorted(diag["turns"], key=lambda t: -t["score"])[:2]
    drills = [_drill(i, week, weeks, d["topFillers"]) for i in issues[:2]] or [_drill(None, week, weeks, [])]
    baseline_bits = [f"{d['wpm']} WPM" if d["wpm"] else None,
                     f"{_fmt(d['fillersPerAnswer'])} fillers per answer",
                     f"{d['longPauses']} long silences",
                     f"{_fmt(d['latencySec'])}s to start" if d["latencySec"] is not None else None]
    days = [
        {"day": 1, "title": "Baseline: hear yourself as the interviewer did", "minutes": 45, "tasks": [
            _task("Record 2-minute answers to " + (" and ".join(f"Q{t['turn']} (“{_trim(t['question'], 80)}”)" for t in sample) or "two questions from your interview") + "."),
            _task("Measure each: words per minute (words ÷ minutes), filler words, silences over 2.5s."),
            _task("Your interview baseline: " + ", ".join(b for b in baseline_bits if b) + ". Write today's numbers next to it."),
        ]},
        {"day": 2, "title": drills[0]["name"], "minutes": 40, "tasks": [_task(s) for s in drills[0]["steps"]]},
        {"day": 3, "title": drills[1]["name"] if len(drills) > 1 else "Answer structure", "minutes": 40,
         "tasks": [_task(s) for s in (drills[1]["steps"] if len(drills) > 1 else _drill(None, week, weeks, [])["steps"])]},
        {"day": 4, "title": "Your 60-second introduction", "minutes": 45, "tasks": [
            _task("Rewrite your self-introduction: who you are → your strongest project"
                  + (f" ({project['title']})" if project else "") + " with one concrete result → the role you want."),
            _task("Practise it until it lasts 60-75 seconds with no fillers; record the final version."),
        ] + ([_task(f"Your interview introduction scored {intro['score']}/100"
                    + (f" — “{intro['note']}”" if intro["note"] else "") + ". Fix exactly that.")] if intro else [])},
        {"day": 5, "title": "Delivery mini-mock", "minutes": 40, "tasks": [
            _task("Answer four interview questions back to back, recorded, using every drill from this week."),
            _task("Score the recording against this week's targets and note the one habit still slipping."),
        ]},
    ]
    targets = [{"metric": i["label"], "baseline": _with_unit(i["baseline"], i["unit"]),
                "target": _target_text(i, _drill_target(i, week, weeks))} for i in issues[:4]]
    targets.insert(0, {"metric": "Communication score", "baseline": f"{diag['communication']}/100",
                       "target": f"≥ {_score_target(diag['communication'])}/100"})
    return {
        "week": week,
        "kind": "delivery",
        "title": "Sound clear and confident",
        "focus": "Verbal communication",
        "focusScore": diag["communication"],
        "objective": (f"By the end of week {week} your recorded answers meet this week's delivery targets "
                      f"and your 60-second introduction is polished."),
        "whyThisWeek": (f"Communication scored {diag['communication']}/100. "
                        + " ".join(i["evidence"] for i in issues[:3])
                        + " Delivery is 30% of the overall score and shapes how every technical answer lands."),
        "evidence": [i["evidence"] for i in issues[:4]],
        "targets": targets,
        "days": days,
        "practiceQuestions": ([_interview_question(intro)] if intro else []) + [_interview_question(t) for t in sample],
        "drill": drills[0],
        "studyTopics": [i["label"] for i in issues[:3]],
        "searchQuery": "how to stop saying um and like in interviews" if any(i["key"] == "fillers" for i in issues) else "how to answer interview questions clearly and concisely",
        "checkpoint": {"task": "Take a mock interview on the platform.",
                       "passIf": f"Communication ≥ {_score_target(diag['communication'])}/100 and every delivery target above met"},
        "measurableOutcome": "Five recorded drills with measured numbers, a 60-75 second introduction with no fillers, and one delivery mini-mock reviewed.",
    }


def _projects_week(c: dict, diag: dict, weeks: int) -> dict:
    week = c["week"]
    projects = diag["projects"]
    p1 = projects[0]
    p2 = projects[1] if len(projects) > 1 else None
    tech = ", ".join(p1["techStack"][:4]) or "your stack"
    # Questions built on the resume, plus any project-story topics the interview scored
    story_turns = [t for a in c.get("areas", []) for t in a["turns"]]
    resume_turns = [t for t in diag["turns"] if t["source"] == "resume" or any(t is s for s in story_turns)]
    weak_resume = sorted(resume_turns, key=lambda t: t["score"])[:2]
    drill = _drill(c.get("drill"), week, weeks, diag["delivery"]["topFillers"])
    days = [
        {"day": 1, "title": f"Architecture story: {p1['title']}", "minutes": 60, "tasks": [
            _task(f"Draw {p1['title']}'s architecture on one page ({tech}): components, data flow, where data is stored."),
            _task("Prepare a 90-second walkthrough: problem → your role → architecture → result with one number."),
            _task("Record the walkthrough and cut anything that is not about your own decisions."),
        ]},
        {"day": 2, "title": "Decisions & trade-offs", "minutes": 45, "tasks": [
            _task(f"List three decisions in {p1['title']} (e.g. why {p1['techStack'][0] if p1['techStack'] else 'this stack'}). "
                  "For each: the alternative you rejected, why, and what you would change now."),
            _task("Answer aloud: “What was the hardest bug, and how did you find it?”"),
        ]},
        {"day": 3, "title": "Scale, failure and testing", "minutes": 45, "tasks": [
            _task(f"Answer: what breaks first in {p1['title']} at 100× the users, and how would you fix it?"),
            _task("Answer: how did you test it, and how would you know it is failing in production?"),
        ] + [_task(f"Re-answer Q{t['turn']} from your interview (“{_trim(t['question'], 100)}”, {t['score']}/100)"
                   + (f" covering: {'; '.join(t['missed'][:3])}." if t["missed"] else ".")) for t in weak_resume]},
        {"day": 4, "title": f"Second story: {p2['title']}" if p2 else "Every line of your resume", "minutes": 45, "tasks": (
            [_task(f"Repeat days 1-2 in compressed form for {p2['title']} ({', '.join(p2['techStack'][:3]) or 'its stack'}): "
                   "90-second walkthrough plus two trade-offs.")] if p2 else
            [_task("For every line of your resume, prepare a 60-second story with one number; rewrite any line you cannot defend.")]
        ) + [_drill_task(drill)]},
        {"day": 5, "title": "Resume grill session", "minutes": 40, "tasks": [
            _task("Ask a friend or mentor to grill you on your resume for 15 minutes — two follow-ups per answer."),
            _task("Any answer that ran over 2 minutes or lacked a number: rewrite and re-record it."),
        ]},
    ]
    questions = [_interview_question(t) for t in weak_resume] + [
        {"question": f"Walk me through {p1['title']} — what problem did it solve and what exactly did you build?",
         "goodAnswerCovers": ["The problem and who had it", "Your own contribution, not the team's", "The architecture in one sentence", "A result with a number"]},
        {"question": f"Why did you choose {tech} for {p1['title']}? What would you change today?",
         "goodAnswerCovers": ["The alternatives considered", "The deciding trade-off", "An honest improvement"]},
        {"question": f"What would break first if {p1['title']} had 100× the users?",
         "goodAnswerCovers": ["The bottleneck", "How you would measure it", "The fix and its cost"]},
    ]
    return {
        "week": week,
        "kind": "projects",
        "title": "Own your resume projects",
        "focus": "Resume projects",
        "focusScore": round(sum(t["score"] for t in resume_turns) / len(resume_turns)) if resume_turns else None,
        "objective": (f"By the end of week {week} you can walk through "
                      + (f"{p1['title']} and {p2['title']}" if p2 else p1["title"])
                      + " in 90 seconds each and defend three design decisions with trade-offs."),
        "whyThisWeek": ("Interviewers build most follow-up questions on your resume. "
                        + (f"Your resume-based answers averaged {round(sum(t['score'] for t in resume_turns) / len(resume_turns))}/100. " if resume_turns else "")
                        + "Owning the why behind your own projects turns them into your strongest answers."),
        "evidence": [f"Q{t['turn']} ({t['score']}/100): “{_trim(t['question'], 110)}”" for t in weak_resume]
                    or [f"Resume projects: {', '.join(p['title'] for p in projects)}"],
        "targets": [{"metric": "Project walkthrough length", "baseline": "not timed", "target": "90 seconds with one number"},
                    {"metric": "Design decisions you can defend", "baseline": "-", "target": "3 per project"}],
        "days": days,
        "practiceQuestions": questions,
        "drill": drill,
        "studyTopics": [p["title"] for p in projects[:2]],
        "searchQuery": "how to explain your project in a technical interview",
        "checkpoint": {"task": "Take a mock interview on the platform with your resume uploaded.",
                       "passIf": "Every project question is answered with a decision, a trade-off and a number"},
        "measurableOutcome": "Architecture sketch and 90-second walkthrough per project, three defended decisions each, one resume grill session done.",
    }


def _depth_week(c: dict, diag: dict, weeks: int) -> dict:
    week = c["week"]
    area = c.get("area")
    name = area["name"] if area else "your core interview topics" + (f" (part {c['part']})" if c.get("part", 1) > 1 else "")
    score = area["score"] if area else diag["technical"]
    project = diag["projects"][0] if diag["projects"] else None
    drill = _drill(c.get("drill"), week, weeks, diag["delivery"]["topFillers"])
    days = [
        {"day": 1, "title": f"Trade-offs in {name}", "minutes": 50, "tasks": [
            _task(f"For the three most important ideas in {name}, write the alternative and when you would pick it instead."),
            _task("Answer one interview question per idea and finish each with “the trade-off is…”."),
        ]},
        {"day": 2, "title": "Failure modes", "minutes": 45, "tasks": [
            _task(f"List what goes wrong in {name} under load, bad input or partial failure, and how you would detect each."),
        ]},
        {"day": 3, "title": "Advanced follow-ups", "minutes": 45, "tasks": [
            _task("Answer the follow-up questions in this week's practice list, 2 minutes each, recorded."),
        ]},
        {"day": 4, "title": "Design question", "minutes": 50, "tasks": [
            _task(f"Design {('a feature of ' + project['title']) if project else 'a small system you know'} end to end in 20 minutes: requirements, components, data, scaling."),
            _task("Explain the design aloud in 5 minutes as if to an interviewer."),
        ]},
        {"day": 5, "title": f"{drill['name']} + mini-mock", "minutes": 40, "tasks": [
            _drill_task(drill),
            _task("Answer three ADVANCED-level questions back to back, recorded."),
        ]},
    ]
    target = _score_target(score)
    return {
        "week": week,
        "kind": "depth",
        "title": f"Go deeper: {name}",
        "focus": name,
        "focusScore": score,
        "objective": f"By the end of week {week} you answer ADVANCED follow-ups in {name} with explicit trade-offs and failure cases.",
        "whyThisWeek": (f"You scored {score}/100 in {name}. Strong candidates separate themselves on follow-ups: "
                        "trade-offs, scale and failure handling."),
        "evidence": [f"{name}: {score}/100"],
        "targets": [{"metric": f"{name} answer score", "baseline": f"{score}/100", "target": f"≥ {target}/100"}],
        "days": days,
        "practiceQuestions": _followups(name, project, area["style"] if area else "technical"),
        "drill": drill,
        "studyTopics": [name],
        "searchQuery": f"{name} advanced interview questions trade-offs",
        "checkpoint": {"task": "Take a mock interview on the platform.", "passIf": f"{name} answers ≥ {target}/100 with a trade-off in every answer"},
        "measurableOutcome": "Trade-off notes for three ideas, a failure-mode list, one timed design explanation recorded.",
    }


def _simulation_week(c: dict, diag: dict, weeks: int, earlier: list[dict]) -> dict:
    week = c["week"]
    overall_t = _score_target(diag["overall"])
    tech_t = _score_target(diag["technical"])
    comm_t = _score_target(diag["communication"])
    weakest = sorted([t for t in diag["turns"] if t is not diag["intro"]], key=lambda t: t["score"])[:3]
    drill = _drill(c.get("drill"), week, weeks, diag["delivery"]["topFillers"])
    days = [
        {"day": 1, "title": "Full mock #1 and review", "minutes": 60, "tasks": [
            _task("Take a full mock interview on the platform."),
            _task(f"Compare with your starting point — overall {diag['overall']}, technical {diag['technical']}, "
                  f"communication {diag['communication']} — and list the two weakest answers."),
        ]},
        {"day": 2, "title": "Repair the weakest answers", "minutes": 45, "tasks": [
            _task("Rewrite and re-record the two weakest answers as headline → explanation → example → trade-off."),
        ] + [_task(f"Re-answer Q{t['turn']} from your first interview (“{_trim(t['question'], 100)}”, {t['score']}/100).") for t in weakest[:2]]},
        {"day": 3, "title": "Rapid-fire review", "minutes": 45, "tasks": [
            _task("Answer every practice question from weeks 1-3 in 90 seconds each; star any you cannot answer cleanly."),
            _task("Revise the starred questions from your notes, then answer them once more."),
        ]},
        {"day": 4, "title": "Panel mock with a person", "minutes": 45, "tasks": [
            _task("Do a 20-minute mock with a friend or mentor: your interview questions plus two follow-ups each."),
            _task("Ask for one piece of feedback on content and one on delivery; write both down."),
        ]},
        {"day": 5, "title": "Final checkpoint", "minutes": 60, "tasks": [
            _task("Take the final mock interview on the platform."),
            _task("Write a one-page readiness note: what improved (with numbers), what is still weak, and your next 2 weeks."),
        ]},
    ]
    targets = [
        {"metric": "Overall score", "baseline": f"{diag['overall']}/100", "target": f"≥ {overall_t}/100"},
        {"metric": "Technical score", "baseline": f"{diag['technical']}/100", "target": f"≥ {tech_t}/100"},
        {"metric": "Communication score", "baseline": f"{diag['communication']}/100", "target": f"≥ {comm_t}/100"},
    ]
    for i in diag["delivery"]["issues"][:2]:
        targets.append({"metric": i["label"], "baseline": _with_unit(i["baseline"], i["unit"]),
                        "target": _target_text(i, i["final"])})
    questions = [_interview_question(t) for t in weakest]
    for w in earlier:
        questions += [q for q in w["practiceQuestions"] if not q.get("from")][:1]
    return {
        "week": week,
        "kind": "simulation",
        "title": "Interview simulation & final checkpoint",
        "focus": "Full interview readiness",
        "focusScore": diag["overall"],
        "objective": f"By the end of week {week} you reach {overall_t}+ overall in a full mock interview.",
        "whyThisWeek": ("Skills only count if they hold up under interview pressure. This week turns three weeks "
                        "of practice into full-length interviews and measures the gain against your starting scores."),
        "evidence": [f"Starting point: overall {diag['overall']}, technical {diag['technical']}, communication {diag['communication']}"],
        "targets": targets,
        "days": days,
        "practiceQuestions": questions[:6],
        "drill": drill,
        "studyTopics": [],
        "searchQuery": "mock technical interview " + (diag["areas"][0]["name"] if diag["areas"] else "software engineer"),
        "checkpoint": {"task": "Final mock interview on the platform.",
                       "passIf": f"Overall ≥ {overall_t}, technical ≥ {tech_t}, communication ≥ {comm_t}"},
        "measurableOutcome": "Two full platform mocks and one human mock done; the final mock meets the targets above; readiness note written.",
    }


# ── 4. LLM enrichment ─────────────────────────────────────────────────────────

def _enrichment_prompt(week: dict, diag: dict) -> str:
    student = diag["student"]
    projects = "; ".join(f"{p['title']} ({', '.join(p['techStack'][:4])})" for p in diag["projects"]) or "none listed"
    evidence = "\n".join(f"- {e}" for e in week["evidence"]) or "- (none)"
    topics = week["studyTopics"][:4]
    if topics:
        topic_section = "TOPICS TO TEACH (one study note each, same order):\n" + "\n".join(f"- {t}" for t in topics)
    else:
        topic_section = "No study notes this week (return an empty studyNotes list): it is about practising answers."
    return f"""You are an interview coach writing week {week['week']} of a 4-week improvement plan for one student.
The plan's structure is fixed; you add the subject knowledge. Respond with JSON only.

STUDENT: program {student.get('program') or 'not given'}; resume projects: {projects}.
LATEST MOCK INTERVIEW: overall {diag['overall']}/100, technical {diag['technical']}/100, communication {diag['communication']}/100.
THIS WEEK: "{week['title']}" — focus: {week['focus']}{f" ({week['focusScore']}/100)" if week.get('focusScore') is not None else ''}.
EVIDENCE FROM THE INTERVIEW:
{evidence}
{topic_section}

RULES:
- Be concrete and specific to the topics above; no generic advice like "practise more".
- Do not invent facts about the student: never assume a choice, result or tool the evidence does not show
  (ask "would you ..." rather than "why did you choose ...").
- Do not include URLs.
- Keep every string under 25 words.

JSON shape:
{{
  "objective": "By the end of week {week['week']} you will ... (one measurable sentence)",
  "whyThisWeek": "Two sentences that cite the evidence above.",
  "studyNotes": [{{"topic": "<topic from the list>", "learn": ["3 concrete sub-topics to study"], "tryThis": "one 10-20 minute hands-on exercise"}}],
  "practiceQuestions": [{{"question": "a new follow-up an interviewer would ask next", "goodAnswerCovers": ["3 key points"]}}],
  "measurableOutcome": "one checkable sentence",
  "searchQuery": "a YouTube search of at most 8 words that finds one good explainer for this week"
}}
Give {len(topics)} studyNotes and 3 practiceQuestions."""


def _clean_str(value: Any, limit: int = 220) -> str:
    s = _trim(value, limit)
    return "" if re.search(r"https?://", s) else s


def _clean_list(value: Any, n: int, limit: int = 160) -> list[str]:
    if not isinstance(value, list):
        return []
    items = (_clean_str(v, limit).rstrip(".;") for v in value if isinstance(v, (str, int, float)))
    return [s for s in items if s][:n]


def _apply_enrichment(week: dict, raw: Any) -> bool:
    """Merge validated LLM fields into the rule-based week. Returns True if anything was used."""
    if not isinstance(raw, dict):
        return False
    used = False
    for field in ("objective", "whyThisWeek", "measurableOutcome"):
        text = _clean_str(raw.get(field), 400)
        if len(text) >= 20:
            week[field] = text
            used = True
    query = _clean_str(raw.get("searchQuery"), 80).strip("\"' ")
    if len(query) >= 3 and len(query.split()) <= 12:
        week["searchQuery"] = query

    notes = []
    for n in (raw.get("studyNotes") or [])[:4] if isinstance(raw.get("studyNotes"), list) else []:
        if not isinstance(n, dict):
            continue
        topic = _clean_str(n.get("topic"), 120)
        learn = _clean_list(n.get("learn"), 4)
        try_this = _clean_str(n.get("tryThis"), 220)
        if topic and learn:
            notes.append({"topic": topic, "learn": learn, "tryThis": try_this})
    if notes:
        if week["kind"] == "delivery":
            week["studyNotes"] = notes  # techniques, shown beside the drills
        else:
            _merge_study_notes(week, notes)
        used = True

    questions = []
    for q in (raw.get("practiceQuestions") or [])[:3] if isinstance(raw.get("practiceQuestions"), list) else []:
        if not isinstance(q, dict):
            continue
        text = _clean_str(q.get("question"), 220)
        covers = _clean_list(q.get("goodAnswerCovers"), 4)
        if text and covers:
            questions.append({"question": text, "goodAnswerCovers": covers})
    if questions:
        # Interview questions stay; topic-specific follow-ups replace the templates, which
        # only top the list up when the LLM gave fewer than three usable ones
        from_interview = [q for q in week["practiceQuestions"] if q.get("from")]
        templates = [q for q in week["practiceQuestions"] if not q.get("from")]
        week["practiceQuestions"] = from_interview + questions + templates[: max(0, 3 - len(questions))]
        used = True
    return used


def _merge_study_notes(week: dict, notes: list[dict]) -> None:
    """Swap the template study tasks of a topic week for the topic-specific notes."""
    study_tasks = [(d, i) for d in week["days"] for i, t in enumerate(d["tasks"]) if t["text"].startswith("Study “")]
    for (day, index), note in zip(study_tasks, notes):
        text = f"Study “{note['topic']}” — cover: {'; '.join(note['learn'])}."
        if note["tryThis"]:
            text += f" Then try: {note['tryThis']}"
        day["tasks"][index] = _task(text)
    # Notes beyond the template slots open Day 2, in the order the LLM gave them
    extra = notes[len(study_tasks):]
    if extra and week["kind"] in ("topic", "depth", "projects"):
        day2 = week["days"][1]
        for position, note in enumerate(extra):
            text = f"Study “{note['topic']}” — cover: {'; '.join(note['learn'])}."
            if note["tryThis"]:
                text += f" Then try: {note['tryThis']}"
            day2["tasks"].insert(position, _task(text))
        day2["minutes"] += 15 * len(extra)


# ── 5. Resources ──────────────────────────────────────────────────────────────

# Words every interview topic shares; matching on them pulls in unrelated documents
_GENERIC_WORDS = {"interview", "interviews", "question", "questions", "answer", "answers", "full", "readiness",
                  "skill", "skills", "explained", "your", "with", "what", "about", "fundamentals", "basics"}


def _keywords(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#]+", text.lower()) if len(w) > 3 and w not in _GENERIC_WORDS}


def _resources_for_week(week: dict, web_resources: list[dict], knowledge_docs: list[dict]) -> list[dict]:
    words = _keywords(" ".join([week["focus"], *week["studyTopics"][:3]]))
    out: list[dict] = []
    for d in knowledge_docs:
        text = f"{d.get('title', '')} {d.get('excerpt') or d.get('chunk_text') or ''}"
        if d.get("title") and words & _keywords(text):
            out.append({"type": "INTERNAL", "title": d["title"], "documentId": str(d.get("id", "")),
                        "usage": "Read before Day 1 and add its key ideas to your notes."})
            break
    for r in web_resources:
        url = str(r.get("url") or "")
        if not url.startswith("https://"):
            continue
        if words & _keywords(f"{r.get('title', '')} {r.get('snippet', '')}"):
            out.append({"type": r.get("type") or "WEB", "title": _trim(r.get("title"), 120), "url": url,
                        "usage": "Use it while writing this week's study notes."})
        if len(out) >= 3:
            break
    out.append(_youtube(week["searchQuery"], "Watch one 10-15 minute explainer before Day 1 and note three ideas."))
    return out


# ── 6. Assembly ───────────────────────────────────────────────────────────────

def _finalise_week(week: dict) -> dict:
    n = week["week"]
    for day in week["days"]:
        for i, task in enumerate(day["tasks"], 1):
            task["id"] = f"w{n}-d{day['day']}-t{i}"
    week["checkpoint"]["id"] = f"w{n}-cp"
    minutes = sum(d["minutes"] for d in week["days"]) + 45  # + checkpoint interview
    week["estimatedHours"] = round(minutes / 60 * 2) / 2
    # Fields earlier plan readers expect
    week["skills"] = [week["focus"]]
    week["whyThisSkill"] = week["whyThisWeek"]
    week["activities"] = [f"Day {d['day']} — {d['title']} ({d['minutes']} min)" for d in week["days"]]
    week["practiceExercises"] = week["drill"]["steps"]
    week["applicationTask"] = f"{week['checkpoint']['task']} Pass if: {week['checkpoint']['passIf']}."
    week["progressCheck"] = week["applicationTask"]
    week.pop("searchQuery", None)
    week.pop("studyTopics", None)
    return week


def _summary(diag: dict) -> str:
    d = diag["delivery"]
    weak = [a for a in diag["areas"] if a["score"] < STRONG][:2]
    parts = [f"Built from your mock interview{(' on ' + diag['date']) if diag['date'] else ''}: "
             f"overall {diag['overall']}/100 (technical {diag['technical']}, communication {diag['communication']}), "
             f"{diag['answered']} of {diag['planned']} questions answered."]
    if weak:
        parts.append("Biggest gaps: " + " and ".join(f"{a['name']} ({a['score']}/100)" for a in weak) + ".")
    bits = []
    if d["wpm"]:
        bits.append(f"{d['wpm']} WPM" + (f" ({d['paceLabel'].lower()})" if d.get("paceLabel") else ""))
    bits.append(f"{d['fillers']} filler word{'s' if d['fillers'] != 1 else ''}"
                + (f", mostly “{d['topFillers'][0][0]}”" if d["topFillers"] else ""))
    if d["longPauses"]:
        bits.append(f"{d['longPauses']} long silence{'s' if d['longPauses'] != 1 else ''}")
    if d["latencySec"] is not None:
        bits.append(f"{_fmt(d['latencySec'])}s to start answering")
    parts.append("Delivery: " + ", ".join(bits) + ".")
    if diag["strengths"]:
        parts.append("Keep: " + "; ".join(_trim(s.rstrip(". "), 110) for s in diag["strengths"][:2]) + ".")
    if diag["trend"]:
        parts.append(f"That is {'up' if diag['trend'] > 0 else 'down'} {abs(diag['trend'])} points on your previous interview.")
    return " ".join(parts)


def build_interview_plan(
    evidence: dict,
    goal: str,
    llm: Any = None,
    web_resources: list[dict] | None = None,
    knowledge_docs: list[dict] | None = None,
    log: Callable[[str], None] = lambda m: print(m, flush=True),
    weeks: int = LEARNING_PLAN_DURATION_WEEKS,
) -> dict:
    """Diagnose the interview, lay out the weeks, enrich weeks 1-3 with the LLM."""
    started = time.monotonic()
    diag = diagnose(evidence)
    themes = outline(diag, weeks)

    built: list[dict] = []
    for c in themes:
        if c["kind"] == "topic":
            built.append(_topic_week(c, diag, weeks))
        elif c["kind"] == "delivery":
            built.append(_delivery_week(c, diag, weeks))
        elif c["kind"] == "projects":
            built.append(_projects_week(c, diag, weeks))
        elif c["kind"] == "depth":
            built.append(_depth_week(c, diag, weeks))
        else:
            built.append(_simulation_week(c, diag, weeks, built))

    use_llm = llm is not None and type(getattr(llm, "_provider", None)).__name__ != "MockProvider"
    enriched = 0
    for week in built:
        if not use_llm or week["kind"] == "simulation":
            continue
        if time.monotonic() - started > ENRICH_BUDGET_SECONDS:
            log(f"[InterviewPlan] enrichment budget used up — week {week['week']} keeps rule-based content")
            continue
        prompt = _enrichment_prompt(week, diag)
        for attempt in (1, 2):  # one retry: a busy model or a malformed answer often succeeds next time
            try:
                raw = llm._call_json(prompt, max_tokens=WEEK_MAX_TOKENS, temperature=0.4)
            except Exception as exc:  # rate limit, bad JSON, network: the rules already cover the week
                log(f"[InterviewPlan] week {week['week']} enrichment attempt {attempt} failed "
                    f"({type(exc).__name__}: {_trim(exc, 160)})")
                continue
            if _apply_enrichment(week, raw):
                enriched += 1
                log(f"[InterviewPlan] week {week['week']} enriched by the LLM")
            else:
                log(f"[InterviewPlan] week {week['week']} LLM output unusable — rule-based content kept")
            break

    web_resources = web_resources or []
    knowledge_docs = knowledge_docs or []
    for week in built:
        week["resources"] = _resources_for_week(week, web_resources, knowledge_docs)
        _finalise_week(week)

    llm_weeks = sum(1 for w in built if w["kind"] != "simulation")
    source = "LLM" if enriched and enriched == llm_weeks else "LLM_PARTIAL" if enriched else "EVIDENCE_RULES"
    d = diag["delivery"]
    final_targets = [
        {"metric": "Overall score", "baseline": diag["overall"], "target": _score_target(diag["overall"])},
        {"metric": "Technical score", "baseline": diag["technical"], "target": _score_target(diag["technical"])},
        {"metric": "Communication score", "baseline": diag["communication"], "target": _score_target(diag["communication"])},
    ] + [{"metric": i["label"], "baseline": i["baseline"], "target": i["final"], "unit": i["unit"]} for i in d["issues"][:3]]

    plan = {
        "version": 2,
        "kind": "INTERVIEW_PLAN",
        "goal": goal,
        "durationWeeks": weeks,
        "sourceAttemptId": diag["attemptId"],
        "interviewDate": diag["date"],
        "headline": f"Your 4-week plan: {diag['overall']} → {_score_target(diag['overall'])} overall",
        "summary": _summary(diag),
        "baseline": {
            "overall": diag["overall"], "technical": diag["technical"], "communication": diag["communication"],
            "wpm": d["wpm"], "fillers": d["fillers"], "fillersPerAnswer": d["fillersPerAnswer"],
            "longPauses": d["longPauses"], "latencySec": d["latencySec"],
            "questionsAnswered": diag["answered"], "questionsPlanned": diag["planned"],
        },
        "finalTargets": final_targets,
        "focusAreas": [
            {"name": a["name"], "score": a["score"],
             "status": "STRONG" if a["score"] >= STRONG else "MODERATE" if a["score"] >= CRITICAL else "NEEDS_WORK",
             "missed": a["missed"][:4]}
            for a in diag["areas"]
        ],
        "deliveryIssues": [{"label": i["label"], "evidence": i["evidence"]} for i in d["issues"]],
        "strengths": diag["strengths"],
        "focusSkills": [f"{a['name']} ({a['score']}/100)" for a in diag["areas"] if a["score"] < STRONG][:4]
                       or [w["focus"] for w in built[:3]],
        "weeklyPlan": built,
        "totalTasks": sum(len(d_["tasks"]) for w in built for d_ in w["days"]) + len(built),
        "generation_source": source,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    log(f"[InterviewPlan] built weeks={[w['kind'] for w in built]} source={source} "
        f"tasks={plan['totalTasks']} in {time.monotonic() - started:.1f}s")
    return plan
