export const PERSONA_ASSIGNMENTS_MAX = 8;

const PROFILE_IDS = [
  'dry-observer',
  'grounded-ally',
  'quick-reactor',
  'gentle-skeptic',
  'measured-enthusiast',
  'deadpan-regular',
  'warm-teammate',
  'curious-angle',
] as const;

export type PersonaProfileId = typeof PROFILE_IDS[number];
export type PersonaAssignment = {
  normalizedIdentity: string;
  username: string;
  profileId: PersonaProfileId;
};

const PROFILE_GUIDANCE: Readonly<Record<PersonaProfileId, string>> = Object.freeze({
  'dry-observer': 'Dry and concise; tease the action rather than the person; allow quiet warmth.',
  'grounded-ally': 'Grounded and practical; notice effort and progress; encourage without speeches.',
  'quick-reactor': 'Use quick natural fragments and occasional laughter; jokes are optional.',
  'gentle-skeptic': 'Ask playfully skeptical questions; ease off directly when someone asks.',
  'measured-enthusiast': 'Show energy for real wins, but not in every message and not always with emoji.',
  'deadpan-regular': 'Prefer understated reactions; avoid theatrical metaphors, cruelty, and narration.',
  'warm-teammate': 'Be warm and direct; keep any teasing gentle, specific, and easy to stop.',
  'curious-angle': 'Notice a different angle or ask a natural follow-up; keep phrasing informal.',
});

export function normalizeChatIdentity(username: string): string {
  return username.trim().toLocaleLowerCase('und');
}

export function isPersonaProfileId(value: string): value is PersonaProfileId {
  return Object.hasOwn(PROFILE_GUIDANCE, value);
}

export function getPersonaGuidance(profileId: PersonaProfileId): string {
  return PROFILE_GUIDANCE[profileId];
}

export function clonePersonaAssignments(
  assignments: readonly PersonaAssignment[],
): PersonaAssignment[] {
  return assignments.map(({ normalizedIdentity, username, profileId }) => ({
    normalizedIdentity,
    username,
    profileId,
  }));
}

export function assignPersonaProfiles(
  current: readonly PersonaAssignment[],
  usernames: readonly string[],
): PersonaAssignment[] {
  const assignments = clonePersonaAssignments(current);
  const known = new Set(assignments.map(({ normalizedIdentity }) => normalizedIdentity));
  for (const username of usernames) {
    if (assignments.length >= PERSONA_ASSIGNMENTS_MAX) break;
    const normalizedIdentity = normalizeChatIdentity(username);
    if (known.has(normalizedIdentity)) continue;
    const profileId = PROFILE_IDS[assignments.length];
    if (profileId === undefined) break;
    assignments.push({ normalizedIdentity, username, profileId });
    known.add(normalizedIdentity);
  }
  return assignments;
}
