/**
 * Student resumes: text extraction + fact-only structuring by the AI service, stored
 * as versions in org.resumes (parsed_text + parsed_data). The live interview reads
 * the current version to ground its questions in the candidate's own experience.
 */

import axios from 'axios';
import { db } from '../shared/db/pool';
import { env } from '../config/env';
import { AppError } from '../shared/errors/AppError';

export interface ResumeSkills {
  languages: string[];
  frameworks: string[];
  databases: string[];
  tools: string[];
}

export interface ResumeProject {
  title: string;
  techStack: string[];
  description: string;
}

export interface ResumeExperience { title: string; company: string; duration: string; description: string }
export interface ResumeEducation { degree: string; institution: string; year: string }
export interface ResumeLinks { github: string | null; linkedin: string | null; portfolio: string | null }

// Stored in org.resumes.parsed_data; also the shape the frontend shows (ParsedResume)
export interface ParsedResumeData {
  summary: string;
  skills: ResumeSkills;
  projects: ResumeProject[];
  experience: ResumeExperience[];
  education: ResumeEducation[];
  certifications: string[];
  links: ResumeLinks;
}

const EMPTY_LINKS: ResumeLinks = { github: null, linkedin: null, portfolio: null };

export interface ParsedResumeView extends ParsedResumeData {
  fileName: string;
  parsedAt: string;
}

interface AiParseResponse {
  text: string;
  summary?: string;
  skills?: Partial<ResumeSkills>;
  projects?: { title: string; tech_stack?: string[]; description?: string }[];
  experience?: Partial<ResumeExperience>[];
  education?: Partial<ResumeEducation>[];
  certifications?: string[];
  links?: Partial<ResumeLinks>;
}

const strings = (values: unknown): string[] =>
  Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];

/** Sends the file (or pasted text) to the AI service; returns the text and the facts found in it. */
export async function parseResume(input: { fileName: string; buffer?: Buffer; text?: string }): Promise<{
  text: string;
  data: ParsedResumeData;
}> {
  let response: AiParseResponse;
  try {
    ({ data: response } = await axios.post<AiParseResponse>(
      `${env.AI_SERVICE_URL}/ai/parse-resume`,
      input.buffer
        ? { file_name: input.fileName, content_base64: input.buffer.toString('base64') }
        : { file_name: input.fileName, text: input.text ?? '' },
      { timeout: 90_000, maxBodyLength: 20 * 1024 * 1024 },
    ));
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 422) {
      const detail = (err.response.data as { detail?: string } | undefined)?.detail;
      throw new AppError(422, detail || 'No readable text was found in this resume.', 'RESUME_UNREADABLE');
    }
    throw new AppError(503, 'The resume reader is unavailable right now. Please try again shortly.', 'AI_UNAVAILABLE');
  }
  const skills = response.skills ?? {};
  return {
    text: String(response.text ?? ''),
    data: {
      summary: String(response.summary ?? ''),
      skills: {
        languages: strings(skills.languages),
        frameworks: strings(skills.frameworks),
        databases: strings(skills.databases),
        tools: strings(skills.tools),
      },
      projects: (response.projects ?? []).filter((p) => p?.title).map((p) => ({
        title: String(p.title),
        techStack: strings(p.tech_stack),
        description: String(p.description ?? ''),
      })),
      experience: experienceList(response.experience),
      education: educationList(response.education),
      certifications: strings(response.certifications),
      links: linkSet(response.links),
    },
  };
}

function experienceList(values: unknown): ResumeExperience[] {
  return (Array.isArray(values) ? values : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      title: String(e.title ?? ''), company: String(e.company ?? ''),
      duration: String(e.duration ?? ''), description: String(e.description ?? ''),
    }))
    .filter((e) => e.title || e.company);
}

function educationList(values: unknown): ResumeEducation[] {
  return (Array.isArray(values) ? values : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({ degree: String(e.degree ?? ''), institution: String(e.institution ?? ''), year: String(e.year ?? '') }))
    .filter((e) => e.degree || e.institution);
}

// Only https links survive (the AI service already checked they appear in the resume)
function linkSet(value: unknown): ResumeLinks {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const safe = (v: unknown) => (typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v) ? v : null);
  return { github: safe(raw.github), linkedin: safe(raw.linkedin), portfolio: safe(raw.portfolio) };
}

/**
 * Stores a new current resume version. The earlier version stops being current and any
 * mentor sign-off is reset, since it applied to the old resume.
 */
export async function saveResumeVersion(
  studentId: string,
  version: { objectKey: string | null; fileName: string; text: string; data: ParsedResumeData },
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE org.resumes SET is_current = false, updated_at = now() WHERE student_id = $1 AND is_current = true',
      [studentId]
    );
    const { rows } = await client.query<{ version: number }>(
      `INSERT INTO org.resumes (student_id, version, object_key, file_name, parsed_text, parsed_data, is_current)
       VALUES ($1, COALESCE((SELECT MAX(version) FROM org.resumes WHERE student_id = $1), 0) + 1, $2, $3, $4, $5, true)
       RETURNING version`,
      [studentId, version.objectKey, version.fileName, version.text, JSON.stringify(version.data)]
    );
    await client.query(
      `UPDATE placement.mentor_verifications SET status = 'PENDING', verified_at = NULL, updated_at = now()
       WHERE student_id = $1 AND verification_type = 'PROFILE'`,
      [studentId]
    );
    await client.query('COMMIT');
    return rows[0].version;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// parsed_data written before this format kept skills as one flat list
function normaliseData(raw: unknown): ParsedResumeData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const skillsRaw = data.skills;
  const skills: ResumeSkills = Array.isArray(skillsRaw)
    ? { languages: [], frameworks: strings(skillsRaw), databases: [], tools: [] }
    : {
        languages: strings((skillsRaw as Partial<ResumeSkills> | undefined)?.languages),
        frameworks: strings((skillsRaw as Partial<ResumeSkills> | undefined)?.frameworks),
        databases: strings((skillsRaw as Partial<ResumeSkills> | undefined)?.databases),
        tools: strings((skillsRaw as Partial<ResumeSkills> | undefined)?.tools),
      };
  const projects = (Array.isArray(data.projects) ? data.projects : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as { title?: unknown }).title === 'string')
    .map((p) => ({
      title: String(p.title),
      techStack: strings(p.techStack ?? p.tech_stack),
      description: String(p.description ?? ''),
    }));
  return {
    summary: String(data.summary ?? ''), skills, projects,
    experience: experienceList(data.experience),
    education: educationList(data.education),
    certifications: strings(data.certifications),
    links: linkSet(data.links),
  };
}

/** Resume details kept on the student record (uploads from before resumes were versioned). */
export async function getStoredResumeData(studentId: string): Promise<ParsedResumeData | null> {
  const { rows } = await db.query<{ resume_data: unknown }>(
    'SELECT resume_data FROM org.students WHERE id = $1',
    [studentId]
  );
  return normaliseData(rows[0]?.resume_data);
}

/** The student's current resume as stored, or null when none was parsed. */
export async function getCurrentResume(studentId: string): Promise<{ view: ParsedResumeView; text: string } | null> {
  const { rows } = await db.query<{ file_name: string | null; parsed_text: string | null; parsed_data: unknown; updated_at: Date }>(
    `SELECT file_name, parsed_text, parsed_data, updated_at FROM org.resumes
     WHERE student_id = $1 AND is_current = true`,
    [studentId]
  );
  const row = rows[0];
  const data = normaliseData(row?.parsed_data);
  if (!row || (!data && !row.parsed_text)) return null;
  return {
    view: {
      fileName: row.file_name || 'Resume',
      parsedAt: new Date(row.updated_at).toISOString().split('T')[0],
      ...(data ?? {
        summary: '', skills: { languages: [], frameworks: [], databases: [], tools: [] }, projects: [],
        experience: [], education: [], certifications: [], links: EMPTY_LINKS,
      }),
    },
    text: row.parsed_text ?? '',
  };
}
