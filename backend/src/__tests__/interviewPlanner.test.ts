import { buildResumeTopics, chooseQuestionFocus, pickResumeTopic } from '../services/interviewPlanner';
import type { InterviewResume } from '../services/sessionContextService';

const resume: InterviewResume = {
  name: 'Priya',
  skills: ['Python', 'Django', 'PostgreSQL', 'Docker', 'C++'],
  projects: [
    { title: 'Campus Canteen Ordering App', tech_stack: ['Django', 'PostgreSQL'], description: 'Online ordering with live queue status.' },
    { title: 'Attendance Tracker', tech_stack: ['React'], description: 'Face-recognition attendance.' },
  ],
  text: 'Priya Sharma ...',
};

describe('buildResumeTopics', () => {
  it('lists projects first, then skills not already covered by a project', () => {
    const topics = buildResumeTopics(resume);
    expect(topics.map((t) => t.label)).toEqual([
      'Campus Canteen Ordering App', 'Attendance Tracker', 'Python', 'Docker', 'C++',
    ]);
    expect(topics[0].detail).toBe('Project "Campus Canteen Ordering App" (Django, PostgreSQL): Online ordering with live queue status.');
  });

  it('has no topics without a resume', () => {
    expect(buildResumeTopics(undefined)).toEqual([]);
    expect(buildResumeTopics({ name: 'X', skills: [], projects: [] })).toEqual([]);
  });
});

describe('pickResumeTopic', () => {
  const topics = buildResumeTopics(resume);

  it('prefers an item the candidate already talked about', () => {
    const turns = [{ answer: 'Recently I built an attendance tracker for my college using React.' }];
    expect(pickResumeTopic(topics, [], turns)?.label).toBe('Attendance Tracker');
  });

  it('matches skills as whole words only', () => {
    const turns = [{ answer: 'I mostly write c++ and some pythonic scripts.' }];
    expect(pickResumeTopic(topics, ['project:campus canteen ordering app', 'project:attendance tracker'], turns)?.label)
      .toBe('C++');
  });

  it('otherwise takes the next item in resume order, never one already asked', () => {
    expect(pickResumeTopic(topics, ['project:campus canteen ordering app'], [{ answer: 'nothing relevant' }])?.label)
      .toBe('Attendance Tracker');
  });

  it('returns null when every item has been asked', () => {
    expect(pickResumeTopic(topics, topics.map((t) => t.key), [])).toBeNull();
  });
});

describe('chooseQuestionFocus', () => {
  const answered = (turn: number, llmTechnicalScore = 70) => ({ turn, llmTechnicalScore });

  it('opens a resume item right after the introduction', () => {
    expect(chooseQuestionFocus({ topicAvailable: true, lastTurn: answered(1), followUpsInARow: 0 })).toBe('resume_topic');
  });

  it('follows up once on the answer, then moves to the next resume item', () => {
    expect(chooseQuestionFocus({ topicAvailable: true, lastTurn: answered(2), followUpsInARow: 0 })).toBe('follow_up');
    expect(chooseQuestionFocus({ topicAvailable: true, lastTurn: answered(3), followUpsInARow: 1 })).toBe('resume_topic');
  });

  it('moves to a new resume item after a non-answer', () => {
    expect(chooseQuestionFocus({ topicAvailable: true, lastTurn: answered(2, 0), followUpsInARow: 0 })).toBe('resume_topic');
  });

  it('always follows up when there is no resume or no item left', () => {
    expect(chooseQuestionFocus({ topicAvailable: false, lastTurn: answered(1), followUpsInARow: 3 })).toBe('follow_up');
    expect(chooseQuestionFocus({ topicAvailable: false, lastTurn: answered(4, 0), followUpsInARow: 0 })).toBe('follow_up');
  });
});
