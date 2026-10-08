/**
 * Decides what each live-interview question builds on. With a resume, questions
 * alternate: open an item from the resume, then follow up once on the answer about it,
 * then the next resume item. Without one, every question follows up on the last answer.
 */

import type { InterviewResume, TurnResult } from './sessionContextService';

export type QuestionFocus = 'resume_topic' | 'follow_up';

export interface ResumeTopic {
  key: string;
  label: string;   // what to look for in the candidate's answers
  detail: string;  // what the interviewer is told about it
}

// Follow-ups allowed on one thread before moving to the next resume item
export const MAX_FOLLOW_UPS_PER_TOPIC = 1;
const MAX_SKILL_TOPICS = 6;

export function buildResumeTopics(resume: InterviewResume | undefined): ResumeTopic[] {
  if (!resume) return [];
  const topics: ResumeTopic[] = resume.projects.map((project) => ({
    key: `project:${project.title.toLowerCase()}`,
    label: project.title,
    detail: `Project "${project.title}"`
      + (project.tech_stack.length ? ` (${project.tech_stack.join(', ')})` : '')
      + (project.description ? `: ${project.description}` : ''),
  }));
  // Skills not already covered by a project become topics of their own
  const projectTech = new Set(resume.projects.flatMap((p) => p.tech_stack.map((t) => t.toLowerCase())));
  resume.skills
    .filter((skill) => !projectTech.has(skill.toLowerCase()))
    .slice(0, MAX_SKILL_TOPICS)
    .forEach((skill) => topics.push({
      key: `skill:${skill.toLowerCase()}`,
      label: skill,
      detail: `Skill listed on the resume: ${skill}`,
    }));
  return topics;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A topic counts as mentioned when its name (or most of a project title's words) appears in an answer
function mentionedIn(topic: ResumeTopic, answers: string): boolean {
  const words = topic.label.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [];
  if (topic.key.startsWith('skill:') || words.length <= 1) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(topic.label.toLowerCase())}([^a-z0-9]|$)`).test(answers);
  }
  const significant = words.filter((w) => w.length >= 4);
  if (significant.length === 0) return answers.includes(topic.label.toLowerCase());
  return significant.filter((w) => answers.includes(w)).length * 2 >= significant.length;
}

/** Next resume item not asked yet — one the candidate already talked about comes first. */
export function pickResumeTopic(
  topics: ResumeTopic[],
  asked: string[],
  turns: Pick<TurnResult, 'answer'>[],
): ResumeTopic | null {
  const remaining = topics.filter((topic) => !asked.includes(topic.key));
  if (remaining.length === 0) return null;
  const answers = turns.map((t) => t.answer).join(' ').toLowerCase();
  return remaining.find((topic) => mentionedIn(topic, answers)) ?? remaining[0];
}

export function chooseQuestionFocus(input: {
  topicAvailable: boolean;
  lastTurn: Pick<TurnResult, 'turn' | 'llmTechnicalScore'> | undefined;
  followUpsInARow: number;
}): QuestionFocus {
  if (!input.topicAvailable || !input.lastTurn) return 'follow_up';
  if (input.lastTurn.turn === 1) return 'resume_topic';                 // after the introduction
  if (input.lastTurn.llmTechnicalScore === 0) return 'resume_topic';    // no real answer: new ground
  return input.followUpsInARow >= MAX_FOLLOW_UPS_PER_TOPIC ? 'resume_topic' : 'follow_up';
}
