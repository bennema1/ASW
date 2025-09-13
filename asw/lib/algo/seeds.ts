let state = 1234567;
export function srand(seed:number) { state = (seed|0) || 1; }
export function rand() { state = (1103515245 * state + 12345) >>> 0; return state / 2**32; }

const topics = [
  "roommate drama over chores", "lost dog returned by neighbor",
  "workplace email mishap", "wedding seating disaster",
  "unexpected hero at the airport", "DIY gone wrong", "group project meltdown"
];
const styles = [
  "r/AmItheAsshole (PG-13)", "r/TIFU (PG-13)", "r/relationships (tasteful)", "r/MaliciousCompliance (work-safe)"
];

export function seededTopic(seed:number) { srand(seed * 17 + 5); return topics[Math.floor(rand()*topics.length)]; }
export function seededStyle(seed:number) { srand(seed * 31 + 9); return styles[Math.floor(rand()*styles.length)]; }
