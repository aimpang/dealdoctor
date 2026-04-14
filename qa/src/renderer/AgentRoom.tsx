import React, { useEffect, useRef, useState } from 'react';
import type { AgentKey, AgentPhase, Grade } from '../shared/types';

export interface AgentTile {
  phase: AgentPhase;
  transcript: string;
  message?: string;
  grade?: Grade;
  issueCount?: number;
  error?: string;
}

// ─── Office personalities ──────────────────────────────────────────────────
//  market      → DWIGHT    (Schrute, Asst. TO the Regional Manager)
//  consistency → JIM       (Halpert, deadpan, pranks)
//  narrative   → MICHAEL   (Scott, World's Best Boss)
//  developerA  → ANDY      (Bernard, data/calc fixer, Cornell)
//  developerB  → KEVIN     (Malone, narrative/template fixer, chili)

const PERSONA: Record<AgentKey, { name: string; title: string }> = {
  market:      { name: 'DWIGHT SCHRUTE',   title: 'Asst. (to the) Regional Fact-Checker' },
  consistency: { name: 'JIM HALPERT',      title: 'Invariant Sales Representative' },
  narrative:   { name: 'MICHAEL SCOTT',    title: "World's Best Narrative Auditor" },
  testwriter:  { name: 'OSCAR MARTINEZ',   title: 'Senior Regression-Test Accountant' },
  developerA:  { name: 'ANDY BERNARD',     title: 'Data & Calc Fixer (nard dog)' },
  developerB:  { name: 'KEVIN MALONE',     title: 'Narrative & Template Fixer' },
  reviewer:    { name: 'TOBY FLENDERSON',  title: 'HR / Diff Auditor' },
};

// Scranton branch floor plan — 16:9-ish aspect so it fits any panel shape.
const ROOM_W = 1600;
const ROOM_H = 900;

// Desk coordinates — Jim & Dwight classic facing pair in the bullpen, Kevin
// at the accounting cluster, Michael inside his glass office (right side).
const STATION: Record<AgentKey, {
  chairX: number; chairY: number;
  deskX: number; deskY: number;
  monitorX: number; monitorY: number;
  accent: string;
  facing: 'left' | 'right';
  label: 'desk' | 'office';
}> = {
  // Dwight — left of Jim/Dwight pair
  market: {
    deskX: 420, deskY: 440, monitorX: 470, monitorY: 400,
    chairX: 495, chairY: 555,
    accent: '#ff8f40', facing: 'right', label: 'desk',
  },
  // Jim — right of the pair, facing Dwight
  consistency: {
    deskX: 600, deskY: 440, monitorX: 640, monitorY: 400,
    chairX: 665, chairY: 555,
    accent: '#39bae6', facing: 'left', label: 'desk',
  },
  // Michael — glass-walled corner office
  narrative: {
    deskX: 1240, deskY: 340, monitorX: 1310, monitorY: 300,
    chairX: 1340, chairY: 450,
    accent: '#7fd962', facing: 'left', label: 'office',
  },
  // Andy — accounting cluster, upper desk (data/calc fixer)
  developerA: {
    deskX: 820, deskY: 440, monitorX: 870, monitorY: 400,
    chairX: 895, chairY: 555,
    accent: '#e6b450', facing: 'right', label: 'desk',
  },
  // Kevin — accounting cluster, lower desk (narrative/template fixer)
  developerB: {
    deskX: 820, deskY: 640, monitorX: 870, monitorY: 600,
    chairX: 895, chairY: 755,
    accent: '#d2a6ff', facing: 'right', label: 'desk',
  },
  // Oscar — accounting cluster, shares the row with Kevin (test-writer)
  testwriter: {
    deskX: 620, deskY: 640, monitorX: 670, monitorY: 600,
    chairX: 695, chairY: 755,
    accent: '#7fd962', facing: 'right', label: 'desk',
  },
  // Toby — annex, off to the side near reception entrance (reviewer / HR)
  reviewer: {
    deskX: 60, deskY: 440, monitorX: 110, monitorY: 400,
    chairX: 135, chairY: 555,
    accent: '#8b8b8b', facing: 'right', label: 'desk',
  },
};

// Where idle agents wander. Excludes Michael's office and the kitchenette.
const WANDER = { xMin: 120, xMax: 1100, yMin: 260, yMax: 820 };

// ── Collision obstacles ──────────────────────────────────────────────────
//  Axis-aligned rects that block agent movement. Tuned to the SVG furniture
//  positions above. The "running" agent is exempt so narrative can reach its
//  desk inside Michael's glass office.
interface Rect { x: number; y: number; w: number; h: number }
const OBSTACLES: Rect[] = [
  // top-wall fixtures so agents don't hug the back wall
  { x: 0,    y: 0,   w: ROOM_W, h: 180 },
  // exit door corridor
  { x: 230,  y: 180, w: 70,  h: 20 },
  // reception desk + chair
  { x: 50,   y: 48,  w: 180, h: 180 },
  // kitchenette (counter, fridge, microwave)
  { x: 30,   y: 200, w: 230, h: 90 },
  // break room round table
  { x: 90,   y: 310, w: 120, h: 110 },
  // water cooler
  { x: 276,  y: 298, w: 54,  h: 78 },
  // copier + fax already covered by top-wall block above (y<180)
  // Jim + Dwight shared desk
  { x: 410,  y: 430, w: 340, h: 140 },
  // Kevin's desk
  { x: 952,  y: 632, w: 180, h: 140 },
  // Michael's glass office — whole box off-limits to idle agents
  { x: 1148, y: 180, w: 460, h: 320 },
  // gap under the office doorway (y=480-540) so narrative can walk in
  { x: 1148, y: 540, w: 460, h: 160 },
  // conference room
  { x: 1148, y: 680, w: 460, h: 220 },
  // corner plants
  { x: 36,   y: 800, w: 56,  h: 80 },
  { x: 696,  y: 830, w: 56,  h: 80 },
];

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Agent collider is a small box around their feet, not their full sprite.
function colliderAt(x: number, y: number): Rect {
  return { x: x - 14, y: y - 10, w: 28, h: 18 };
}

function hitsAny(x: number, y: number): boolean {
  const c = colliderAt(x, y);
  for (const o of OBSTACLES) if (rectsOverlap(c, o)) return true;
  return false;
}

// Try to move from (x,y) to (nx,ny). If blocked, slide along the axis that
// remains free; else stop where we are.
function tryMove(x: number, y: number, nx: number, ny: number): { x: number; y: number } {
  if (!hitsAny(nx, ny)) return { x: nx, y: ny };
  if (!hitsAny(nx, y))  return { x: nx, y };
  if (!hitsAny(x,  ny)) return { x,  y: ny };
  return { x, y };
}

const IDLE_LINES: Record<AgentKey, string[]> = {
  market: [
    'FALSE. that is incorrect.',
    'bears. beets. battlestar galactica.',
    'identity theft is not a joke, JIM',
    'I am faster than 80% of snakes',
    'question: who brought eggs?',
    'Schrute Farms, five-star lodging',
    'assistant TO the regional manager',
    'fact: beets have lycopene',
    'by the way, I am ARMED',
    'mose is hiding in the beet field',
    'I grew up on a farm',
    'where is the stapler JIM',
    'through concentration. I can raise. my temperature.',
    'a BEAR with a SHARK brain',
    'I declare bankruptcy is NOT a declaration',
  ],
  consistency: [
    'hey, pam?',
    '*looks at camera*',
    'should we start a paper company',
    'beet sales are down',
    'did anyone move dwight\'s stapler?',
    'this meeting could have been an email',
    'sabre. as in the sword.',
    'i put dwight\'s stapler in jello again',
    'calling it at 4:30',
    'uhh… sure.',
    'nice',
    'bears eat beets',
    'question, what kind of bear is best',
    'dwight. why.',
    'good work everyone',
    'i\'m gonna go take a walk',
  ],
  narrative: [
    'that\'s what she said',
    "I'm not superstitious… just a little stitious",
    'I DECLARE BANKRUPTCY',
    'would I rather be feared or loved?',
    'no god, please no',
    'pizza by alfredo\'s tonight',
    'toby, you are killing me',
    'parkour!  parkour!',
    'Jan? …oh no.',
    'I am ROSS from FRIENDS',
    'it\'s britney… bitch',
    'boom, roasted',
    'the worst thing about prison was the DEMENTORS',
    'do I need to be liked? no. but I want to be liked.',
    'and i~ will always love you',
    'lazy scranton, the ELECTRIC CITY',
  ],
  testwriter: [
    'actually, that is factually…',
    '*sigh* fine.',
    'I know a lot about real estate',
    'the 401k is fine, Kevin',
    'I would love to correct you',
    'chariots of fire',
    'accounting 101',
    'the ledger doesn\'t lie',
    'I went to cornell, just kidding, that\'s Andy',
    'Angela, we need to talk about the forms',
    'sunshine',
  ],
  reviewer: [
    'hey, it\'s toby',
    'so…',
    'I didn\'t mean anything by it',
    'HR would like to remind you',
    '…costa rica',
    'I flagged this in the report',
    'is this inappropriate?',
    'the scranton strangler',
    'I should go',
    '*nervous laugh*',
    'I filed the complaint',
  ],
  developerA: [
    'nard dog!',
    'I went to cornell',
    'cornell. ever heard of it?',
    'rit dit doo-aa',
    'here comes treble',
    'broccoli rob',
    'big tuna, my man',
    'I am the tallest man',
    'sometimes I sing to myself',
    'the ears, the big ears',
    'me parents named me andrew baines',
    'tuna! tuna!',
    'rage. rage. rage.',
    'jim. nicknames. important.',
  ],
  developerB: [
    'why say lot word when few word do trick',
    'oh god, my chili',
    'me want snack',
    'keleven',
    'M&Ms anyone',
    'cookie?',
    'me think, why waste time',
    'accounting',
    'me drink so much tonight',
    'me fix bug later',
    'me type slow',
    '*burp*',
    "there… there's chili. on my shoe",
    'what. is. a. computer.',
    'me bring chili again',
  ],
};

const WORKING_LINES: Record<AgentKey, string[]> = {
  market: [
    'cross-referencing mls…',
    'SOURCE REQUIRED.',
    'zillow must yield to facts',
    'this comp is FALSE',
    'web-searching comps…',
    'redfin confirmed',
    'I will verify everything',
    'wrong building. FALSE.',
    'FACT: comp #3 is two eras off',
  ],
  consistency: [
    'IRR = IRR, obviously',
    'summing wealth projection',
    'dedup the comps…',
    'this looks fine actually',
    'standard invariant check',
    'cf + tax + eq = wealth',
    'spread % ≟ label',
    'hmm, breakeven mismatch',
    'nice, clean math',
  ],
  narrative: [
    'reading this prose…',
    'hmm, hallucination?',
    'is this a row home???',
    'does the math match?',
    'writers FORGET DETAILS',
    'this is a TEACHABLE moment',
    '$1,200 vs $2,050? no.',
    'WHY does it say condo',
    'DECLARE. BANKRUPTCY.',
  ],
  testwriter: [
    'writing test case…',
    'expect().toEqual()…',
    'this test must FAIL first',
    'vitest imports set',
    'nearest test file identified',
    'assertion drafted',
    'fixture ready',
  ],
  reviewer: [
    'reading the diff…',
    'git diff HEAD…',
    'this line looks suspicious',
    'checking call sites',
    'no regressions so far',
    'one concern to note',
    'verdict: ship',
  ],
  developerA: [
    'grep grep grep',
    'edit lib/calculations…',
    'running npm test',
    'fixing the IRR math',
    'comp filter fixed',
    'nice, test passed',
    'Cornell taught me this',
    'wealth table math patched',
    'Big tuna, you were right',
  ],
  developerB: [
    'me read prompt…',
    'patching narrative…',
    'running npm test',
    'me change a line',
    'oh god, hard part',
    'me see hallucination',
    'me fix',
    'committed. i think.',
    'me done? maybe.',
  ],
};

// ─── Background NPCs — office ensemble, no job, just milling about ─────────
type NpcKey = 'pam' | 'stanley' | 'angela' | 'creed';
const NPC_ORDER: NpcKey[] = ['pam', 'stanley', 'angela', 'creed'];

const NPC_LINES: Record<NpcKey, string[]> = {
  pam: [
    'hi, can I help you?',
    'jim :)',
    'good morning',
    '*giggles*',
    'party planning committee meeting at 4',
    'the yogurt was mine',
    'I used to be shy',
    'art school',
    'I\'m a receptionist… for now',
    'michael?  oh no.',
    'no, I am not pregnant',
  ],
  stanley: [
    'did I stutter',
    'PRETZEL DAY',
    'shove it up your butt',
    'I don\'t care',
    '…',
    'no',
    'just take the money',
    'beach games',
    'going home',
    'crossword time',
    'I\'m retiring to florida',
    'nah nah nah',
  ],
  angela: [
    'you did NOT',
    'cats are NOT accessories',
    'sprinkles is my senior',
    'the system is broken',
    'disgusting',
    'no',
    'dwight?',
    'I decide who is on the PPC',
    'this is an abomination',
    'approved. barely.',
    'I am not a cat lady, I have FIVE',
  ],
  creed: [
    'just pretend like you know me',
    'nobody steals from creed bratton',
    'scuba',
    'the man you met was toby',
    'what has four letters — fish',
    'I have not filed a tax return since…',
    'I was in the grassroots',
    "could've been jinx",
    'the only difference between me and a homeless man',
    'sometimes I forget my name',
  ],
};

type PairKey = `${AgentKey}:${AgentKey}`;
const PAIR_BANTER: Partial<Record<PairKey, Array<[string, string]>>> = {
  'market:consistency': [
    ['JIM. stop.', 'did you move your desk six inches'],
    ['I demand a formal APOLOGY', 'uhh… no.'],
    ['identity theft is NOT a joke', 'okay dwight'],
    ['FALSE.', 'wasn\'t a question'],
    ['where is my stapler', 'oh no. again?'],
  ],
  'consistency:market': [
    ['hey dwight — ', 'FALSE.'],
    ['stapler in jello again?', 'JIM.'],
    ['question, what kind of bear is best', 'BLACK BEAR.'],
    ['pam said hi', 'tell her FACT: i said hi back'],
  ],
  'narrative:market': [
    ['DWIGHT! my #2!', 'MICHAEL I am here'],
    ['would I rather be feared or loved', 'easy. BOTH.'],
    ['you are my #1', 'i AM #1'],
  ],
  'market:narrative': [
    ['Michael, regarding the report', 'NOT NOW dwight'],
    ['I brought beets', 'no. god, why.'],
  ],
  'narrative:consistency': [
    ['jim, my halpert', 'oh no'],
    ['make me laugh', "…that\'s what she said"],
    ['pam is at the desk', 'thanks michael'],
  ],
  'consistency:narrative': [
    ['how was your weekend', "I'M ROSS FROM FRIENDS"],
    ['we have a meeting', 'parkour! parkour!'],
  ],
  'developerB:narrative': [
    ['me want raise', 'KEVIN. no.'],
    ['chili?', 'oh god no'],
    ['michael. me hungry', 'pizza by alfredo\'s'],
  ],
  'narrative:developerB': [
    ['KEVIN!', '…yes?'],
    ['do the thing', 'me do thing'],
  ],
  'developerA:market': [
    ['me need snack', 'unacceptable'],
    ['cookie?', 'FALSE. we have beets.'],
  ],
  'market:developerA': [
    ['kevin. FACTS ONLY.', 'me like facts'],
    ['do you have the ledger', 'me lost ledger'],
  ],
  'developerA:consistency': [
    ['me confused', 'same.'],
    ['M&Ms?', 'yeah okay'],
  ],
  'consistency:developerA': [
    ['kevin, you good?', 'me hungry'],
    ['nice tie', 'it chili-resistant'],
  ],
  // Oscar interactions
  'testwriter:narrative': [
    ['that is factually inaccurate', 'OSCAR. no.'],
    ['I prepared a memo', 'I will not be reading that'],
  ],
  'narrative:testwriter': [
    ['OSCAR! actually…', 'please stop'],
    ['did you know in russia', 'I did know that'],
  ],
  'testwriter:market': [
    ['DWIGHT. the test already exists', 'FALSE.'],
    ['your test assumptions are off', 'PROVE IT.'],
  ],
  'market:testwriter': [
    ['OSCAR. is a SPY', 'I am an accountant'],
  ],
  'testwriter:developerB': [
    ['Kevin, the test asserts 2050', 'me write 1140'],
    ['…', 'me feel judged'],
  ],
  'developerB:testwriter': [
    ['chili?', 'I brought a salad'],
  ],
  'testwriter:developerA': [
    ['Andy, focus.', 'RIT DIT DOO'],
    ['the test I wrote tests IRR', 'on it, tuna'],
  ],
  'developerA:testwriter': [
    ['Oscar, partner', 'I am not your partner'],
  ],
  // Toby interactions
  'reviewer:narrative': [
    ['hey michael, about the forms —', 'WHY ARE YOU HERE'],
    ['I flagged it in the report', 'UGHHHH'],
  ],
  'narrative:reviewer': [
    ['toby. what do you want.', '…nothing, I should go'],
    ['I hate toby', '…heard that'],
  ],
  'reviewer:market': [
    ['Dwight, about your territorial claims', 'I REPEAT: FALSE.'],
  ],
  'reviewer:consistency': [
    ['Jim, the review is complete', 'thanks toby'],
    ['you look tired', '…yeah.'],
  ],
  'consistency:reviewer': [
    ['toby!', 'oh. hi jim.'],
  ],
  'reviewer:developerA': [
    ['Andy, this diff concerns me', 'NARD DOG IS FINE'],
  ],
  'reviewer:developerB': [
    ['kevin, that variable name', 'me name it chili'],
  ],
  'reviewer:testwriter': [
    ['oscar, test case #3 needs review', 'I agree with your assessment'],
  ],
  'testwriter:reviewer': [
    ['toby, read section 2', 'I will. thoroughly.'],
  ],
};

interface Bubble { text: string; until: number }

interface AgentSprite {
  key: AgentKey;
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: 'left' | 'right';
  bubble: Bubble | null;
  idleSeed: number;
  chatCooldownUntil: number;
}

interface NpcSprite {
  key: NpcKey;
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: 'left' | 'right';
  bubble: Bubble | null;
  idleSeed: number;
  chatCooldownUntil: number;
}

function pickIdleTarget(seed: number, tick: number): { x: number; y: number } {
  // Try up to 12 candidates; reject any that lands inside an obstacle so the
  // agent never sets a target it can't reach.
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = (seed * 9301 + (tick + attempt) * 49297) % 233280;
    const x = WANDER.xMin + (r % (WANDER.xMax - WANDER.xMin));
    const y = WANDER.yMin + ((r >> 8) % (WANDER.yMax - WANDER.yMin));
    if (!hitsAny(x, y)) return { x, y };
  }
  // Fallback to a known-safe spot — bullpen aisle
  return { x: 360, y: 640 };
}

// Pam's preferred zone — just outside her reception desk. She spends ~70%
// of her time here and occasionally wanders into the bullpen.
function pickPamTarget(seed: number, tick: number): { x: number; y: number } {
  const stayHome = ((seed + tick) & 0b111) < 5; // ~62%
  if (stayHome) {
    const r = (seed * 7919 + tick * 31) % 100;
    return { x: 230 + (r % 60), y: 200 + ((r >> 3) % 60) };
  }
  return pickIdleTarget(seed, tick);
}

const ORDER: AgentKey[] = ['market', 'consistency', 'narrative', 'testwriter', 'developerA', 'developerB', 'reviewer'];

export function AgentRoom({
  agents,
  onAgentClick,
}: {
  agents: Record<AgentKey, AgentTile>;
  onAgentClick?: (k: AgentKey) => void;
}) {
  // Time-of-day tint — recompute when hour changes.
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(id);
  }, []);
  const tint = tintForHour(hour);
  const [sprites, setSprites] = useState<Record<AgentKey, AgentSprite>>(() => {
    const now = Date.now();
    const mk = (key: AgentKey, i: number): AgentSprite => {
      const t = pickIdleTarget(i + 7, 0);
      return {
        key,
        x: t.x,
        y: t.y,
        tx: t.x,
        ty: t.y,
        facing: 'right',
        bubble: null,
        idleSeed: (i + 1) * 13,
        chatCooldownUntil: now,
      };
    };
    return {
      market: mk('market', 0),
      consistency: mk('consistency', 1),
      narrative: mk('narrative', 2),
      testwriter: mk('testwriter', 3),
      developerA: mk('developerA', 4),
      developerB: mk('developerB', 5),
      reviewer: mk('reviewer', 6),
    };
  });

  const tickRef = useRef(0);
  const pendingReply = useRef<Array<{ speaker: AgentKey; reply: string; at: number }>>([]);

  // ── NPCs — 5 background Dunder-Mifflin employees ──
  const [npcs, setNpcs] = useState<Record<NpcKey, NpcSprite>>(() => {
    const mk = (key: NpcKey, i: number): NpcSprite => {
      const t = pickIdleTarget(i * 41 + 100, i);
      return {
        key,
        x: t.x,
        y: t.y,
        tx: t.x,
        ty: t.y,
        facing: 'right',
        bubble: null,
        idleSeed: (i + 30) * 17,
        chatCooldownUntil: Date.now(),
      };
    };
    return {
      pam: mk('pam', 0),
      stanley: mk('stanley', 1),
      angela: mk('angela', 2),
      creed: mk('creed', 3),
    };
  });

  useEffect(() => {
    setSprites((prev) => {
      const next = { ...prev };
      (Object.keys(agents) as AgentKey[]).forEach((k) => {
        const phase = agents[k].phase;
        const cur = next[k];
        if (phase === 'running') {
          next[k] = { ...cur, tx: STATION[k].chairX, ty: STATION[k].chairY, facing: STATION[k].facing };
        } else {
          const t = pickIdleTarget(cur.idleSeed + tickRef.current, tickRef.current);
          next[k] = { ...cur, tx: t.x, ty: t.y };
        }
      });
      return next;
    });
  }, [agents.market.phase, agents.consistency.phase, agents.narrative.phase, agents.testwriter.phase, agents.developerA.phase, agents.developerB.phase, agents.reviewer.phase]);

  // ── 60fps movement loop (rAF) — smooth interpolation toward target ──
  const lastFrame = useRef<number>(performance.now());
  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - lastFrame.current) / 1000); // clamp to 50ms
      lastFrame.current = t;
      setSprites((prev) => {
        let dirty = false;
        const next = { ...prev };
        (Object.keys(next) as AgentKey[]).forEach((k) => {
          const s = next[k];
          const phase = agents[k].phase;
          const speed = phase === 'running' ? 420 : 160;
          const dx = s.tx - s.x;
          const dy = s.ty - s.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.5) {
            const step = Math.min(speed * dt, dist);
            const nx = s.x + (dx / dist) * step;
            const ny = s.y + (dy / dist) * step;
            if (phase === 'running') {
              // Straight shot to their chair — agents' stations are outside
              // the obstacle set (chairs sit in the furniture-free aisle).
              s.x = nx;
              s.y = ny;
            } else {
              const moved = tryMove(s.x, s.y, nx, ny);
              // If we slid along a wall and made no progress, re-target next
              // logical tick (set tx=x so the "near target" check triggers).
              if (moved.x === s.x && moved.y === s.y) {
                s.tx = s.x;
                s.ty = s.y;
              } else {
                s.x = moved.x;
                s.y = moved.y;
                s.facing = dx >= 0 ? 'right' : 'left';
              }
            }
            dirty = true;
          }
        });
        return dirty ? next : prev;
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [agents]);

  // ── NPC movement loop — identical motion, no phase concept ──
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      setNpcs((prev) => {
        let dirty = false;
        const next = { ...prev };
        (Object.keys(next) as NpcKey[]).forEach((k) => {
          const s = next[k];
          const dx = s.tx - s.x;
          const dy = s.ty - s.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.5) {
            const step = Math.min(140 * dt, dist);
            const nx = s.x + (dx / dist) * step;
            const ny = s.y + (dy / dist) * step;
            const moved = tryMove(s.x, s.y, nx, ny);
            if (moved.x === s.x && moved.y === s.y) {
              s.tx = s.x;
              s.ty = s.y;
            } else {
              s.x = moved.x;
              s.y = moved.y;
              s.facing = dx >= 0 ? 'right' : 'left';
              dirty = true;
            }
          }
        });
        return dirty ? next : prev;
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── logical tick — target re-pick, bubbles, pair chat. 320ms cadence. ──
  useEffect(() => {
    const interval = setInterval(() => {
      tickRef.current += 1;
      const now = Date.now();
      setSprites((prev) => {
        const next = { ...prev };

        // fire any pending replies whose time has come
        const kept: typeof pendingReply.current = [];
        for (const r of pendingReply.current) {
          if (now >= r.at) {
            next[r.speaker].bubble = { text: r.reply, until: now + 3200 };
          } else kept.push(r);
        }
        pendingReply.current = kept;

        // Target re-pick for idle agents near their current target.
        (Object.keys(next) as AgentKey[]).forEach((k) => {
          const s = next[k];
          const phase = agents[k].phase;
          if (phase !== 'running' && Math.hypot(s.x - s.tx, s.y - s.ty) < 12 && tickRef.current % 4 === 0) {
            const t = pickIdleTarget(s.idleSeed + tickRef.current, tickRef.current);
            s.tx = t.x;
            s.ty = t.y;
          }
          if (s.bubble && now > s.bubble.until) s.bubble = null;
        });

        // pair chatter
        const keys = Object.keys(next) as AgentKey[];
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
            const a = next[keys[i]];
            const b = next[keys[j]];
            if (agents[a.key].phase === 'running' || agents[b.key].phase === 'running') continue;
            if (a.bubble || b.bubble) continue;
            if (now < a.chatCooldownUntil || now < b.chatCooldownUntil) continue;

            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < 140 && Math.random() < 0.4) {
              const [speaker, listener] = Math.random() < 0.5 ? [a.key, b.key] : [b.key, a.key];
              const pair: PairKey = `${speaker}:${listener}`;
              const banter = PAIR_BANTER[pair];
              if (banter) {
                const [open, reply] = banter[Math.floor(Math.random() * banter.length)];
                next[speaker].bubble = { text: open, until: now + 3000 };
                pendingReply.current.push({ speaker: listener, reply, at: now + 1600 });
              } else {
                next[speaker].bubble = { text: pick(IDLE_LINES[speaker]), until: now + 2800 };
              }
              next[a.key].chatCooldownUntil = now + 8000;
              next[b.key].chatCooldownUntil = now + 8000;
            }
          }
        }

        // solo bubbles
        (Object.keys(next) as AgentKey[]).forEach((k) => {
          const s = next[k];
          const phase = agents[k].phase;
          if (s.bubble) return;
          if (phase === 'running' && Math.random() < 0.14) {
            s.bubble = { text: pick(WORKING_LINES[k]), until: now + 2600 };
          } else if (phase !== 'running' && Math.random() < 0.05) {
            s.bubble = { text: pick(IDLE_LINES[k]), until: now + 2800 };
          }
        });

        return next;
      });
    }, 320);
    return () => clearInterval(interval);
  }, [agents]);

  // ── NPC logical tick — retarget + random bubbles ──
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setNpcs((prev) => {
        const next = { ...prev };
        (Object.keys(next) as NpcKey[]).forEach((k) => {
          const s = next[k];
          // retire expired bubble
          if (s.bubble && now > s.bubble.until) s.bubble = null;
          // retarget when near current target
          if (Math.hypot(s.x - s.tx, s.y - s.ty) < 14 && Math.random() < 0.4) {
            const t = k === 'pam'
              ? pickPamTarget(s.idleSeed + Math.floor(now / 500), Math.floor(now / 500))
              : pickIdleTarget(s.idleSeed + Math.floor(now / 500), Math.floor(now / 500));
            s.tx = t.x;
            s.ty = t.y;
          }
          // random solo chatter
          if (!s.bubble && Math.random() < 0.04) {
            s.bubble = { text: pick(NPC_LINES[k]), until: now + 2800 };
          }
        });
        return next;
      });
    }, 420);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="room-frame">
      <div className="room-title">
        <span>◢ DUNDER · QA · MIFFLIN — SCRANTON BRANCH</span>
        <span className="room-sub">1725 slough ave · floor plan (not to scale)</span>
      </div>
      <div className="room-canvas-wrap">
        <svg
          className="room-canvas"
          viewBox={`0 0 ${ROOM_W} ${ROOM_H}`}
          preserveAspectRatio="none"
          style={{ background: tint.bg }}
        >
          <Defs />
          {/* window sky tint — evening warm, morning cool, night dark */}
          <rect x={0} y={0} width={ROOM_W} height={ROOM_H} fill={tint.overlay} pointerEvents="none" />

          {/* ── floor ── */}
          <rect x={0} y={0} width={ROOM_W} height={ROOM_H} fill="url(#carpet)" />
          {/* grey hallway carpet along the top */}
          <rect x={0} y={0} width={ROOM_W} height={180} fill="#1a1d25" />
          <rect x={0} y={178} width={ROOM_W} height={2} fill="#0b0e14" />

          {/* ── glass walls ── */}
          {/* Michael's office wall — vertical, left edge x=1150 */}
          <rect x={1148} y={180} width={4} height={500} fill="#3a414d" />
          <rect x={1150} y={180} width={450} height={500} fill="#39bae6" opacity={0.07} />
          {/* horizontal frame caps */}
          <rect x={1150} y={180} width={450} height={4} fill="#3a414d" />
          <rect x={1150} y={676} width={450} height={4} fill="#3a414d" />
          {/* door gap */}
          <rect x={1148} y={480} width={4} height={60} fill="#1a1d25" />
          {/* blinds */}
          {[190, 210, 230, 250, 270, 290, 310, 330, 350].map((y) => (
            <line key={y} x1={1152} y1={y} x2={1596} y2={y} stroke="#4a525e" strokeWidth={0.8} opacity={0.35} />
          ))}

          {/* Conference room wall — bottom right */}
          <rect x={1150} y={680} width={450} height={4} fill="#3a414d" />
          <rect x={1150} y={680} width={450} height={220} fill="#2a3040" opacity={0.25} />
          <rect x={1148} y={680} width={4} height={220} fill="#3a414d" />
          <ConferenceRoom x={1170} y={700} />

          {/* ── receptionist desk (Pam) — top left ── */}
          <ReceptionDesk x={60} y={60} />

          {/* ── break room / kitchenette — middle left ── */}
          <Kitchenette x={40} y={260} />

          {/* ── water cooler — between break room and bullpen ── */}
          <WaterCooler x={280} y={310} />

          {/* ── copier + fax — top area ── */}
          <Copier x={400} y={90} />
          <FaxMachine x={560} y={90} />

          {/* ── the JIM / DWIGHT paired desks (center bullpen) ── */}
          <PairedDesks
            leftStation={STATION.market}
            rightStation={STATION.consistency}
            agents={agents}
          />

          {/* ── Andy + Kevin: accounting cluster, paired vertically ── */}
          <SoloWorkstation s={STATION.developerA} persona={PERSONA.developerA} agent={agents.developerA} extra="andy" />
          <SoloWorkstation s={STATION.developerB} persona={PERSONA.developerB} agent={agents.developerB} extra="kevin" />

          {/* ── Michael's corner office (glass room) ── */}
          <MichaelsOffice s={STATION.narrative} persona={PERSONA.narrative} agent={agents.narrative} />

          {/* ── plants in corners ── */}
          <Plant x={40} y={800} />
          <Plant x={700} y={830} />

          {/* ── "World's Best Boss" mug + "TEAMWORK" poster on back wall ── */}
          <BackWallSigns />

          {/* ── exit door on the top ── */}
          <g transform="translate(230 40)">
            <rect width={70} height={140} fill="#3a2a18" />
            <rect x={2} y={2} width={66} height={136} fill="#2a1f10" />
            <rect x={60} y={68} width={4} height={10} fill="#e6b450" />
            <rect x={2} y={138} width={66} height={4} fill="#0b0e14" />
          </g>

          {/* ── NPCs first, then agents on top when they overlap ── */}
          {NPC_ORDER.map((k) => (
            <NpcCharacter key={k} sprite={npcs[k]} />
          ))}
          {ORDER.map((k) => (
            <AgentCharacter
              key={k}
              sprite={sprites[k]}
              phase={agents[k].phase}
              grade={agents[k].grade}
              onClick={onAgentClick ? () => onAgentClick(k) : undefined}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Time-of-day tint — a subtle overlay that warms the office in the afternoon
// and dims it at night. Doesn't block content; pointer-events: none on the
// rect means clicks pass through.
function tintForHour(h: number): { bg: string; overlay: string } {
  if (h >= 6 && h < 10) return { bg: '#13171f', overlay: 'rgba(255, 210, 140, 0.05)' }; // morning
  if (h >= 10 && h < 16) return { bg: '#13171f', overlay: 'rgba(255, 255, 255, 0.02)' }; // midday
  if (h >= 16 && h < 19) return { bg: '#13171f', overlay: 'rgba(255, 170, 110, 0.07)' }; // golden hour
  if (h >= 19 && h < 22) return { bg: '#0e1219', overlay: 'rgba(90, 60, 140, 0.12)' };  // dusk
  return { bg: '#080a10', overlay: 'rgba(20, 30, 60, 0.18)' };                            // night
}

// ────────────────────────────────────────────────────────────────────────
//  Scene props

function Defs() {
  return (
    <defs>
      <pattern id="carpet" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
        <rect width="32" height="32" fill="#13171f" />
        <rect width="32" height="2" y="30" fill="#1a1f2a" />
        <rect width="2" height="32" x="30" fill="#1a1f2a" />
        <rect x={5} y={6}  width={2} height={2} fill="#1d2430" />
        <rect x={17} y={14} width={2} height={2} fill="#1d2430" />
        <rect x={10} y={22} width={2} height={2} fill="#1d2430" />
        <rect x={25} y={20} width={2} height={2} fill="#1d2430" />
      </pattern>
      <pattern id="wood" x="0" y="0" width="48" height="12" patternUnits="userSpaceOnUse">
        <rect width="48" height="12" fill="#3a2814" />
        <rect x={0} y={0} width={48} height={1} fill="#2a1d0e" />
        <rect x={0} y={11} width={48} height={1} fill="#2a1d0e" />
        <rect x={15} y={2} width={1} height={8} fill="#4a321a" />
        <rect x={35} y={2} width={1} height={8} fill="#4a321a" />
      </pattern>
    </defs>
  );
}

function ReceptionDesk({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* desk counter */}
      <rect width={160} height={110} fill="#2a1f12" />
      <rect x={4} y={4} width={152} height={84} fill="url(#wood)" />
      {/* reception plaque */}
      <rect x={20} y={-12} width={120} height={12} fill="#1a1f28" />
      <text x={80} y={-3} textAnchor="middle" fill="#f4ecd8" style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', fontWeight: 700 }}>RECEPTION</text>
      {/* monitor + phone */}
      <rect x={24} y={18} width={40} height={30} fill="#12161d" />
      <rect x={26} y={20} width={36} height={26} fill="#39bae6" opacity={0.25} />
      <rect x={80} y={22} width={30} height={18} fill="#1a1f28" />
      <rect x={82} y={24} width={26} height={2} fill="#4a525e" />
      <rect x={82} y={28} width={26} height={2} fill="#4a525e" />
      {/* candy jar */}
      <rect x={120} y={20} width={22} height={26} fill="#f4ecd8" opacity={0.7} />
      <rect x={124} y={24} width={3} height={3} fill="#f07178" />
      <rect x={130} y={26} width={3} height={3} fill="#7fd962" />
      <rect x={136} y={24} width={3} height={3} fill="#39bae6" />
      <rect x={126} y={32} width={3} height={3} fill="#e6b450" />
      {/* chair */}
      <rect x={60} y={120} width={40} height={10} fill="#1a1f28" />
      <rect x={74} y={130} width={12} height={18} fill="#1a1f28" />
    </g>
  );
}

function Kitchenette({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* counter */}
      <rect width={220} height={28} fill="#1a1f28" />
      <rect x={2} y={2} width={216} height={22} fill="#2a3040" />
      {/* microwave */}
      <rect x={10} y={-32} width={56} height={32} fill="#2a2f3a" />
      <rect x={14} y={-28} width={36} height={20} fill="#12161d" />
      <circle cx={58} cy={-18} r={3} fill="#f07178" />
      {/* coffee pot */}
      <rect x={78} y={-34} width={32} height={34} fill="#2a2018" />
      <rect x={82} y={-30} width={24} height={8} fill="#1a1209" />
      <rect x={86} y={-20} width={18} height={16} fill="#3a2a18" />
      <rect x={88} y={-18} width={14} height={12} fill="#f07178" opacity={0.7} />
      {/* fridge */}
      <rect x={126} y={-70} width={60} height={98} fill="#d4d0c6" />
      <rect x={130} y={-66} width={52} height={40} fill="#b8b4aa" />
      <rect x={130} y={-22} width={52} height={48} fill="#b8b4aa" />
      <rect x={176} y={-46} width={4} height={12} fill="#3a414d" />
      <rect x={176} y={0}   width={4} height={12} fill="#3a414d" />
      {/* magnet on fridge */}
      <rect x={140} y={-58} width={10} height={6} fill="#f07178" />
      {/* break table */}
      <g transform="translate(40 54)">
        <circle cx={60} cy={32} r={34} fill="#3a2814" />
        <circle cx={60} cy={32} r={30} fill="url(#wood)" />
        <circle cx={60} cy={32} r={3} fill="#2a1d0e" />
        {/* chairs around */}
        <rect x={22} y={28} width={10} height={10} fill="#1a1f28" />
        <rect x={88} y={28} width={10} height={10} fill="#1a1f28" />
        <rect x={55} y={-2} width={10} height={10} fill="#1a1f28" />
        <rect x={55} y={66} width={10} height={10} fill="#1a1f28" />
      </g>
      {/* "KITCHEN" sign */}
      <rect x={50} y={-92} width={120} height={14} fill="#1a1f28" />
      <text x={110} y={-82} textAnchor="middle" fill="#e6b450" style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', fontWeight: 700 }}>KITCHEN</text>
    </g>
  );
}

function WaterCooler({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={40} height={14} fill="#4a525e" />
      <rect x={4} y={-36} width={32} height={40} fill="#bfd6e0" stroke="#0b0e14" />
      <rect x={8} y={-32} width={24} height={18} fill="#39bae6" opacity={0.7} />
      <rect x={14} y={-10} width={12} height={4} fill="#2a3040" />
      <rect x={0} y={14} width={40} height={44} fill="#2a3040" />
      <rect x={16} y={30} width={8} height={4} fill="#f07178" />
      {/* cup stack */}
      <rect x={44} y={-8} width={10} height={22} fill="#f4ecd8" opacity={0.8} />
    </g>
  );
}

function Copier({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={100} height={80} fill="#d4d0c6" />
      <rect x={6} y={6} width={88} height={24} fill="#3a414d" />
      <rect x={10} y={10} width={80} height={16} fill="#2a3040" />
      <rect x={6} y={34} width={88} height={2} fill="#0b0e14" />
      <rect x={16} y={40} width={68} height={10} fill="#f4ecd8" opacity={0.6} />
      <circle cx={80} cy={60} r={3} fill="#7fd962" />
      <circle cx={88} cy={60} r={3} fill="#f07178" />
      <text x={50} y={100} textAnchor="middle" fill="#565f78" style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>COPIER</text>
    </g>
  );
}

function FaxMachine({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={30} width={60} height={40} fill="#b8b4aa" />
      <rect x={4} y={34} width={52} height={18} fill="#2a3040" />
      <rect x={10} y={26} width={40} height={8} fill="#d4d0c6" />
      <text x={30} y={88} textAnchor="middle" fill="#565f78" style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>FAX</text>
    </g>
  );
}

function PairedDesks({
  leftStation,
  rightStation,
  agents,
}: {
  leftStation: typeof STATION[AgentKey];
  rightStation: typeof STATION[AgentKey];
  agents: Record<AgentKey, AgentTile>;
}) {
  const leftAgent = agents.market;
  const rightAgent = agents.consistency;
  return (
    <g>
      {/* one big shared desk block, two monitors facing each other */}
      <rect x={leftStation.deskX - 10} y={leftStation.deskY - 10} width={340} height={140} fill="#1a1f28" />
      <rect x={leftStation.deskX - 6}  y={leftStation.deskY - 6}  width={332} height={132} fill="url(#wood)" />
      {/* divider down the middle */}
      <rect x={leftStation.deskX + 160} y={leftStation.deskY - 30} width={4} height={140} fill="#2a2418" />
      <rect x={leftStation.deskX + 130} y={leftStation.deskY - 90} width={64} height={60} fill="#3a414d" opacity={0.5} />

      {/* Dwight monitor (facing right — screen on left side of his desk) */}
      <Monitor x={leftStation.monitorX} y={leftStation.monitorY} accent={leftStation.accent} phase={agents.market.phase} glyph="M" />
      {/* Dwight's bobblehead */}
      <g transform={`translate(${leftStation.deskX + 20} ${leftStation.deskY + 10})`}>
        <rect x={0} y={14} width={10} height={4} fill="#0b0e14" />
        <circle cx={5} cy={8} r={6} fill="#f0d4a5" />
        <rect x={2} y={4} width={6} height={3} fill="#4a3020" />
        <rect x={2} y={8} width={2} height={1} fill="#0b0e14" />
        <rect x={6} y={8} width={2} height={1} fill="#0b0e14" />
      </g>
      {/* Dwight's mustard mug + pencils cup */}
      <rect x={leftStation.deskX + 42} y={leftStation.deskY + 16} width={14} height={16} fill="#f4ecd8" />
      <rect x={leftStation.deskX + 42} y={leftStation.deskY + 24} width={14} height={8} fill="#8b6f2a" opacity={0.8} />
      <rect x={leftStation.deskX + 70} y={leftStation.deskY + 10} width={12} height={22} fill="#1a1f28" />
      <rect x={leftStation.deskX + 72} y={leftStation.deskY + 4}  width={1} height={8} fill="#e6b450" />
      <rect x={leftStation.deskX + 76} y={leftStation.deskY + 2}  width={1} height={10} fill="#e6b450" />
      <rect x={leftStation.deskX + 80} y={leftStation.deskY + 6}  width={1} height={6}  fill="#e6b450" />

      {/* Jim monitor */}
      <Monitor x={rightStation.monitorX} y={rightStation.monitorY} accent={rightStation.accent} phase={agents.consistency.phase} glyph="C" />
      {/* Jim's "stapler in jello" prop */}
      <g transform={`translate(${rightStation.deskX + 120} ${rightStation.deskY + 14})`}>
        <rect x={0} y={0} width={22} height={18} fill="#f07178" opacity={0.55} />
        <rect x={4} y={6} width={14} height={4} fill="#c0c0c0" />
      </g>
      {/* nameplates */}
      <NamePlate x={leftStation.deskX + 8}  y={leftStation.deskY + 100} name={PERSONA.market.name} accent={leftStation.accent} />
      <NamePlate x={rightStation.deskX + 8} y={rightStation.deskY + 100} name={PERSONA.consistency.name} accent={rightStation.accent} />
      {/* chairs */}
      <Chair x={leftStation.chairX - 20}  y={leftStation.chairY} />
      <Chair x={rightStation.chairX - 20} y={rightStation.chairY} />
      {/* status ribbons */}
      <StatusRibbon x={leftStation.deskX + 8}   y={leftStation.deskY + 148} w={148} agent={leftAgent} />
      <StatusRibbon x={rightStation.deskX + 8}  y={rightStation.deskY + 148} w={148} agent={rightAgent} />
    </g>
  );
}

function SoloWorkstation({
  s,
  persona,
  agent,
  extra,
}: {
  s: typeof STATION[AgentKey];
  persona: { name: string; title: string };
  agent: AgentTile;
  extra?: 'kevin';
}) {
  return (
    <g>
      <rect x={s.deskX - 8} y={s.deskY - 8} width={180} height={120} fill="#1a1f28" />
      <rect x={s.deskX - 4} y={s.deskY - 4} width={172} height={112} fill="url(#wood)" />
      <Monitor x={s.monitorX} y={s.monitorY} accent={s.accent} phase={agent.phase} glyph="D" />
      <NamePlate x={s.deskX} y={s.deskY + 86} name={persona.name} accent={s.accent} />
      <Chair x={s.chairX - 20} y={s.chairY} />
      <StatusRibbon x={s.deskX} y={s.deskY + 130} w={160} agent={agent} />
      {extra === 'kevin' && (
        <>
          {/* chili pot */}
          <g transform={`translate(${s.deskX + 24} ${s.deskY + 18})`}>
            <rect x={0} y={8} width={20} height={12} fill="#3a2418" />
            <rect x={0} y={6} width={20} height={3} fill="#4a3020" />
            <rect x={2} y={2} width={16} height={6} fill="#f07178" opacity={0.7} />
            <rect x={4} y={-2} width={2} height={4} fill="#f07178" opacity={0.4} />
            <rect x={10} y={-4} width={2} height={6} fill="#f07178" opacity={0.4} />
          </g>
          {/* calculator */}
          <rect x={s.deskX + 52} y={s.deskY + 28} width={24} height={34} fill="#1a1f28" />
          <rect x={s.deskX + 54} y={s.deskY + 30} width={20} height={8} fill="#39bae6" opacity={0.35} />
          <rect x={s.deskX + 54} y={s.deskY + 40} width={5} height={4} fill="#3a414d" />
          <rect x={s.deskX + 61} y={s.deskY + 40} width={5} height={4} fill="#3a414d" />
          <rect x={s.deskX + 68} y={s.deskY + 40} width={5} height={4} fill="#3a414d" />
          <rect x={s.deskX + 54} y={s.deskY + 46} width={5} height={4} fill="#3a414d" />
          <rect x={s.deskX + 61} y={s.deskY + 46} width={5} height={4} fill="#3a414d" />
          <rect x={s.deskX + 68} y={s.deskY + 46} width={5} height={4} fill="#3a414d" />
          {/* m&ms dish */}
          <ellipse cx={s.deskX + 120} cy={s.deskY + 40} rx={14} ry={5} fill="#d4d0c6" />
          <rect x={s.deskX + 108} y={s.deskY + 34} width={3} height={3} fill="#f07178" />
          <rect x={s.deskX + 115} y={s.deskY + 36} width={3} height={3} fill="#7fd962" />
          <rect x={s.deskX + 122} y={s.deskY + 34} width={3} height={3} fill="#e6b450" />
          <rect x={s.deskX + 128} y={s.deskY + 36} width={3} height={3} fill="#39bae6" />
        </>
      )}
    </g>
  );
}

function MichaelsOffice({
  s,
  persona,
  agent,
}: {
  s: typeof STATION[AgentKey];
  persona: { name: string; title: string };
  agent: AgentTile;
}) {
  return (
    <g>
      {/* office label on the door */}
      <rect x={s.deskX - 60} y={200} width={200} height={16} fill="#1a1f28" />
      <text x={s.deskX + 40} y={212} textAnchor="middle" fill="#7fd962" style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', fontWeight: 700 }}>REGIONAL MANAGER</text>

      {/* big desk */}
      <rect x={s.deskX - 10} y={s.deskY - 10} width={260} height={150} fill="#1a1f28" />
      <rect x={s.deskX - 6}  y={s.deskY - 6}  width={252} height={142} fill="url(#wood)" />
      <Monitor x={s.monitorX} y={s.monitorY} accent={s.accent} phase={agent.phase} glyph="N" />
      {/* "World's Best Boss" mug — larger */}
      <g transform={`translate(${s.deskX + 40} ${s.deskY + 20})`}>
        <rect x={0} y={0} width={20} height={22} fill="#f4ecd8" stroke="#0b0e14" strokeWidth={0.8} />
        <rect x={2} y={4} width={16} height={12} fill="#7fd962" opacity={0.25} />
        <text x={10} y={10} textAnchor="middle" fill="#0b0e14" style={{ fontSize: 4.5, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>WORLD'S</text>
        <text x={10} y={15} textAnchor="middle" fill="#0b0e14" style={{ fontSize: 4.5, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>BEST BOSS</text>
        <rect x={20} y={6} width={4} height={10} fill="none" stroke="#0b0e14" strokeWidth={0.8} />
      </g>
      {/* nameplate */}
      <NamePlate x={s.deskX + 10} y={s.deskY + 120} name={persona.name} accent={s.accent} />

      {/* chair */}
      <Chair x={s.chairX - 22} y={s.chairY} wide />

      {/* visitor couch */}
      <rect x={s.deskX + 10} y={620} width={230} height={38} fill="#3a2f4a" />
      <rect x={s.deskX + 10} y={608} width={230} height={14} fill="#4a3e5c" />
      <rect x={s.deskX + 6}  y={614} width={8}   height={40} fill="#4a3e5c" />
      <rect x={s.deskX + 236} y={614} width={8}  height={40} fill="#4a3e5c" />

      {/* plant */}
      <Plant x={1540} y={260} />

      {/* ribbon */}
      <StatusRibbon x={s.deskX + 10} y={s.deskY + 160} w={220} agent={agent} />
    </g>
  );
}

function ConferenceRoom({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* long table */}
      <rect x={0} y={40} width={400} height={80} fill="#3a2814" />
      <rect x={4} y={44} width={392} height={72} fill="url(#wood)" />
      {/* chairs around */}
      {[30, 100, 170, 240, 310].map((cx) => (
        <g key={`top-${cx}`}>
          <rect x={cx} y={14} width={30} height={16} fill="#1a1f28" />
          <rect x={cx + 8} y={30} width={14} height={6} fill="#1a1f28" />
        </g>
      ))}
      {[30, 100, 170, 240, 310].map((cx) => (
        <g key={`bot-${cx}`}>
          <rect x={cx} y={130} width={30} height={16} fill="#1a1f28" />
          <rect x={cx + 8} y={124} width={14} height={6} fill="#1a1f28" />
        </g>
      ))}
      {/* whiteboard */}
      <rect x={20} y={160} width={360} height={30} fill="#f4ecd8" />
      <text x={40} y={178} fill="#0b0e14" style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>THREAT LEVEL: MIDNIGHT</text>
      {/* room sign */}
      <rect x={150} y={-10} width={100} height={14} fill="#1a1f28" />
      <text x={200} y={0} textAnchor="middle" fill="#e6b450" style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', fontWeight: 700 }}>CONFERENCE</text>
    </g>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={4} y={48} width={40} height={24} fill="#3a2814" />
      <rect x={4} y={48} width={40} height={6} fill="#2a1d0e" />
      <circle cx={24} cy={28} r={22} fill="#5e8a3a" />
      <circle cx={12} cy={20} r={12} fill="#7fd962" opacity={0.85} />
      <circle cx={36} cy={20} r={11} fill="#7fd962" opacity={0.75} />
      <circle cx={24} cy={10} r={10} fill="#7fd962" opacity={0.9} />
    </g>
  );
}

function BackWallSigns() {
  return (
    <g>
      {/* "TEAMWORK" motivational */}
      <g transform="translate(560 20)">
        <rect width={200} height={42} fill="#e6b450" />
        <rect x={3} y={3} width={194} height={36} fill="#0b0e14" />
        <text x={100} y={22} textAnchor="middle" fill="#e6b450" style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.18em', fontWeight: 700 }}>TEAMWORK</text>
        <text x={100} y={34} textAnchor="middle" fill="#a08757" style={{ fontSize: 7, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em' }}>make the dream work</text>
      </g>
      {/* Dundie shelf */}
      <g transform="translate(820 22)">
        <rect width={200} height={40} fill="#2a2018" />
        {[10, 55, 100, 145, 182].map((dx) => (
          <g key={dx} transform={`translate(${dx} 6)`}>
            <rect width={16} height={22} fill="#d4a64a" />
            <rect x={3} y={3} width={10} height={5} fill="#eec97a" />
            <rect x={5} y={12} width={6} height={10} fill="#b8893a" />
            <rect x={1} y={22} width={14} height={3} fill="#3a2f1a" />
          </g>
        ))}
      </g>
      <ClockWidget x={420} y={30} />
      {/* "DUNDIES" hanging banner */}
      <g transform="translate(1060 18)">
        <rect width={70} height={30} fill="#1a1f28" />
        <text x={35} y={20} textAnchor="middle" fill="#e6b450" style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.15em', fontWeight: 700 }}>DUNDIES</text>
      </g>
    </g>
  );
}

function ClockWidget({ x, y }: { x: number; y: number }) {
  // Recompute every 10s; visible minute granularity is plenty.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const hAngle = ((h + m / 60) / 12) * 2 * Math.PI - Math.PI / 2;
  const mAngle = (m / 60) * 2 * Math.PI - Math.PI / 2;
  const cx = 22, cy = 22, rFace = 22;
  const hx = cx + Math.cos(hAngle) * 10;
  const hy = cy + Math.sin(hAngle) * 10;
  const mx = cx + Math.cos(mAngle) * 16;
  const my = cy + Math.sin(mAngle) * 16;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx={cx} cy={cy} r={rFace} fill="#f4ecd8" stroke="#0b0e14" strokeWidth={1.2} />
      {/* ticks */}
      {[0, 3, 6, 9].map((t) => {
        const a = (t / 12) * 2 * Math.PI - Math.PI / 2;
        const x1 = cx + Math.cos(a) * (rFace - 3);
        const y1 = cy + Math.sin(a) * (rFace - 3);
        const x2 = cx + Math.cos(a) * (rFace - 1);
        const y2 = cy + Math.sin(a) * (rFace - 1);
        return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0b0e14" strokeWidth={1.8} />;
      })}
      <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="#0b0e14" strokeWidth={2.4} />
      <line x1={cx} y1={cy} x2={mx} y2={my} stroke="#0b0e14" strokeWidth={1.6} />
      <circle cx={cx} cy={cy} r={2} fill="#0b0e14" />
    </g>
  );
}

function Monitor({ x, y, accent, phase, glyph }: { x: number; y: number; accent: string; phase: AgentPhase; glyph: string }) {
  const isOn = phase === 'running';
  const isDone = phase === 'done';
  const isErr = phase === 'error';
  const screen = isErr ? '#f07178' : isDone ? '#7fd962' : isOn ? accent : '#2a303b';
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-2} y={-2} width={84} height={62} fill="#0b0e14" />
      <rect x={0} y={0} width={80} height={58} fill="#12161d" stroke={accent} strokeWidth={2} />
      <rect x={4} y={4} width={72} height={50} fill={screen} opacity={isOn ? 0.92 : 0.6}>
        {isOn && <animate attributeName="opacity" values="0.55;1;0.55" dur="0.9s" repeatCount="indefinite" />}
      </rect>
      {/* scanlines */}
      <rect x={4} y={18} width={72} height={1} fill="#000" opacity={0.24} />
      <rect x={4} y={34} width={72} height={1} fill="#000" opacity={0.24} />
      <text x={40} y={38} textAnchor="middle" fill="#0b0e14" style={{ fontSize: 28, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{glyph}</text>
      {/* stand */}
      <rect x={32} y={58} width={16} height={6} fill="#3a414d" />
      <rect x={24} y={62} width={32} height={4} fill="#3a414d" />
    </g>
  );
}

function Chair({ x, y, wide }: { x: number; y: number; wide?: boolean }) {
  const w = wide ? 58 : 46;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={w} height={10} fill="#1a1f28" />
      <rect x={0} y={-30} width={w} height={6} fill="#1a1f28" />
      <rect x={2} y={-28} width={w - 4} height={26} fill="#2a3040" />
      <rect x={w / 2 - 4} y={10} width={8} height={20} fill="#1a1f28" />
      <rect x={w / 2 - 12} y={30} width={24} height={4} fill="#2a3040" />
    </g>
  );
}

function NamePlate({ x, y, name, accent }: { x: number; y: number; name: string; accent: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={150} height={18} fill="#1a1f28" />
      <text x={75} y={13} textAnchor="middle" fill={accent} style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', fontWeight: 700 }}>{name}</text>
    </g>
  );
}

function StatusRibbon({ x, y, w, agent }: { x: number; y: number; w: number; agent: AgentTile }) {
  const isOn = agent.phase === 'running';
  const isDone = agent.phase === 'done';
  const isErr = agent.phase === 'error';
  const bg = isErr ? '#f07178' : isDone ? '#3a5a2a' : isOn ? '#4a3a1a' : '#1a1f28';
  const fg = isErr ? '#0b0e14' : isDone ? '#bfffb0' : isOn ? '#ffd48a' : '#565f78';
  const text = isErr
    ? 'ERROR'
    : isDone
      ? `DONE · ${agent.grade ?? '?'} · ${agent.issueCount ?? 0}`
      : isOn
        ? 'WORKING…'
        : 'IDLE';
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={16} fill={bg} />
      <text x={w / 2} y={12} textAnchor="middle" fill={fg} style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', fontWeight: 700 }}>{text}</text>
    </g>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Characters — bigger, Office-like.

function NpcCharacter({ sprite }: { sprite: NpcSprite }) {
  const { x, y, facing, bubble, key } = sprite;
  const flip = facing === 'left' ? -1 : 1;
  const walking = Math.hypot(sprite.tx - x, sprite.ty - y) > 3;
  const bob = walking ? (Math.floor(Date.now() / 180) % 2) * 2 : 0;
  return (
    <g transform={`translate(${x - 22} ${y - 72 + bob})`} opacity={0.96}>
      <ellipse cx={22} cy={82} rx={18} ry={4} fill="#000" opacity={0.3} />
      <g transform={`scale(${flip} 1) translate(${flip === -1 ? -44 : 0} 0)`}>
        {renderNpc(key, walking)}
      </g>
      {bubble && <SpeechBubble text={bubble.text} />}
    </g>
  );
}

function renderNpc(key: NpcKey, walking: boolean) {
  const legSwing = walking ? 3 : 0;
  switch (key) {
    case 'pam': // blue cardigan, light brown hair in ponytail, glasses off, pale skin
      return (
        <g>
          <rect x={14} y={70 - legSwing} width={6} height={10} fill="#2a2840" />
          <rect x={24} y={70 + legSwing} width={6} height={10} fill="#2a2840" />
          <rect x={14} y={78} width={6} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={6} height={4} fill="#0b0e14" />
          {/* skirt */}
          <rect x={10} y={58} width={24} height={14} fill="#3a5680" />
          {/* cardigan */}
          <rect x={10} y={38} width={24} height={22} fill="#4a7fb0" />
          <rect x={18} y={38} width={8} height={18} fill="#f4ecd8" />
          <rect x={6}  y={42} width={4} height={18} fill="#4a7fb0" />
          <rect x={34} y={42} width={4} height={18} fill="#4a7fb0" />
          {/* hands */}
          <rect x={4}  y={60} width={6} height={6} fill="#f4d5b8" />
          <rect x={34} y={60} width={6} height={6} fill="#f4d5b8" />
          {/* head */}
          <rect x={10} y={10} width={24} height={30} fill="#f4d5b8" />
          {/* hair — light brown, bangs + sides */}
          <rect x={8}  y={4}  width={28} height={10} fill="#7a5528" />
          <rect x={6}  y={12} width={4}  height={14} fill="#7a5528" />
          <rect x={34} y={12} width={4}  height={14} fill="#7a5528" />
          {/* eyes */}
          <rect x={14} y={24} width={3} height={3} fill="#0b0e14" />
          <rect x={27} y={24} width={3} height={3} fill="#0b0e14" />
          <rect x={15} y={25} width={1} height={1} fill="#f4ecd8" />
          <rect x={28} y={25} width={1} height={1} fill="#f4ecd8" />
          {/* warm smile */}
          <rect x={16} y={32} width={12} height={2} fill="#0b0e14" />
          <rect x={18} y={33} width={8} height={1} fill="#c07080" />
        </g>
      );
    case 'stanley': // bald with grey mustache, pink/grey shirt, brown skin
      return (
        <g>
          <rect x={14} y={70 - legSwing} width={6} height={10} fill="#2a2418" />
          <rect x={24} y={70 + legSwing} width={6} height={10} fill="#2a2418" />
          <rect x={14} y={78} width={6} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={6} height={4} fill="#0b0e14" />
          {/* shirt — dusty pink */}
          <rect x={6}  y={38} width={32} height={34} fill="#b07078" />
          <rect x={6}  y={38} width={32} height={6}  fill="#905860" />
          <rect x={20} y={38} width={4}  height={20} fill="#f4ecd8" />
          {/* tie */}
          <rect x={21} y={42} width={2}  height={16} fill="#2a3040" />
          {/* sleeves */}
          <rect x={2}  y={42} width={4}  height={22} fill="#b07078" />
          <rect x={38} y={42} width={4}  height={22} fill="#b07078" />
          {/* dark brown hands */}
          <rect x={0}  y={62} width={6}  height={6}  fill="#6a4020" />
          <rect x={38} y={62} width={6}  height={6}  fill="#6a4020" />
          {/* head — brown skin */}
          <rect x={10} y={10} width={24} height={30} fill="#7a4a24" />
          {/* bald — side hair only */}
          <rect x={10} y={14} width={3}  height={10} fill="#d0ccc4" opacity={0.85} />
          <rect x={31} y={14} width={3}  height={10} fill="#d0ccc4" opacity={0.85} />
          {/* grey mustache */}
          <rect x={14} y={28} width={16} height={3}  fill="#d0ccc4" />
          {/* glasses */}
          <rect x={12} y={22} width={8}  height={5}  fill="none" stroke="#0b0e14" strokeWidth={1} />
          <rect x={24} y={22} width={8}  height={5}  fill="none" stroke="#0b0e14" strokeWidth={1} />
          <rect x={20} y={24} width={4}  height={1}  fill="#0b0e14" />
          <rect x={15} y={24} width={2}  height={2}  fill="#0b0e14" />
          <rect x={27} y={24} width={2}  height={2}  fill="#0b0e14" />
          {/* flat unimpressed mouth */}
          <rect x={16} y={34} width={12} height={2}  fill="#0b0e14" />
        </g>
      );
    case 'angela': // blonde high bun, pink cardigan, very petite (smaller torso)
      return (
        <g>
          <rect x={15} y={68 - legSwing} width={5} height={12} fill="#1a2030" />
          <rect x={24} y={68 + legSwing} width={5} height={12} fill="#1a2030" />
          <rect x={15} y={78} width={5} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={5} height={4} fill="#0b0e14" />
          {/* grey skirt */}
          <rect x={12} y={56} width={20} height={16} fill="#3a414d" />
          {/* pink cardigan */}
          <rect x={12} y={38} width={20} height={20} fill="#e0a6b8" />
          <rect x={12} y={38} width={20} height={4}  fill="#c88090" />
          <rect x={18} y={38} width={6}  height={16} fill="#f4ecd8" />
          {/* tiny brooch */}
          <rect x={20} y={44} width={2}  height={2}  fill="#e6b450" />
          <rect x={8}  y={42} width={4}  height={16} fill="#e0a6b8" />
          <rect x={32} y={42} width={4}  height={16} fill="#e0a6b8" />
          <rect x={6}  y={58} width={5}  height={5}  fill="#f4d5b8" />
          <rect x={33} y={58} width={5}  height={5}  fill="#f4d5b8" />
          {/* head — small */}
          <rect x={12} y={12} width={20} height={28} fill="#f4d5b8" />
          {/* blonde high bun */}
          <rect x={14} y={4}  width={16} height={10} fill="#e6c47a" />
          <rect x={18} y={-2} width={8}  height={6}  fill="#e6c47a" />
          <rect x={20} y={-5} width={4}  height={3}  fill="#cfa858" />
          {/* tight eyes */}
          <rect x={15} y={24} width={2} height={2} fill="#0b0e14" />
          <rect x={27} y={24} width={2} height={2} fill="#0b0e14" />
          {/* thin pressed lips */}
          <rect x={18} y={32} width={8} height={1} fill="#0b0e14" />
        </g>
      );
    case 'creed': // long grey hair, scruffy beard, olive vest
      return (
        <g>
          <rect x={14} y={70 - legSwing} width={6} height={10} fill="#2a2418" />
          <rect x={24} y={70 + legSwing} width={6} height={10} fill="#2a2418" />
          <rect x={14} y={78} width={6} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={6} height={4} fill="#0b0e14" />
          {/* olive vest over white shirt */}
          <rect x={10} y={38} width={24} height={34} fill="#f4ecd8" />
          <rect x={8}  y={40} width={8}  height={30} fill="#6a6a3a" />
          <rect x={28} y={40} width={8}  height={30} fill="#6a6a3a" />
          <rect x={20} y={38} width={4}  height={24} fill="#4a3018" />
          {/* sleeves */}
          <rect x={4}  y={42} width={4}  height={20} fill="#f4ecd8" />
          <rect x={36} y={42} width={4}  height={20} fill="#f4ecd8" />
          <rect x={2}  y={62} width={6}  height={6}  fill="#d4b890" />
          <rect x={36} y={62} width={6}  height={6}  fill="#d4b890" />
          {/* head + weathered skin */}
          <rect x={10} y={10} width={24} height={30} fill="#d4b890" />
          {/* long grey hair — drooping sides */}
          <rect x={8}  y={4}  width={28} height={10} fill="#a0a0a0" />
          <rect x={6}  y={12} width={6}  height={20} fill="#a0a0a0" />
          <rect x={32} y={12} width={6}  height={20} fill="#a0a0a0" />
          {/* scruffy beard */}
          <rect x={10} y={28} width={24} height={12} fill="#a0a0a0" opacity={0.95} />
          <rect x={11} y={38} width={22} height={3}  fill="#a0a0a0" opacity={0.7} />
          {/* eyes — hollow stare */}
          <rect x={14} y={22} width={3} height={3} fill="#0b0e14" />
          <rect x={27} y={22} width={3} height={3} fill="#0b0e14" />
          {/* slight open mouth */}
          <rect x={18} y={32} width={8} height={2} fill="#0b0e14" />
          <rect x={20} y={32} width={4} height={1} fill="#5a2020" />
        </g>
      );
  }
}

function AgentCharacter({
  sprite,
  phase,
  grade,
  onClick,
}: {
  sprite: AgentSprite;
  phase?: AgentPhase;
  grade?: Grade;
  onClick?: () => void;
}) {
  const { x, y, facing, bubble, key } = sprite;
  const flip = facing === 'left' ? -1 : 1;
  const walking = Math.hypot(sprite.tx - x, sprite.ty - y) > 3;
  // Celebration — bounce for ~1.2s when an agent lands a grade A. Tracked via
  // a local ref that activates on the phase→done transition.
  const [celebrating, setCelebrating] = useState(false);
  const lastPhaseRef = useRef<AgentPhase | undefined>(phase);
  useEffect(() => {
    if (lastPhaseRef.current !== 'done' && phase === 'done' && grade === 'A') {
      setCelebrating(true);
      const t = setTimeout(() => setCelebrating(false), 1200);
      return () => clearTimeout(t);
    }
    lastPhaseRef.current = phase;
  }, [phase, grade]);

  const bob = walking ? (Math.floor(Date.now() / 180) % 2) * 2 : 0;
  // Celebration jump: a fast y offset using time modulo
  const jumpY = celebrating ? -Math.abs(Math.sin(Date.now() / 70)) * 14 : 0;

  return (
    <g
      transform={`translate(${x - 22} ${y - 72 + bob + jumpY})`}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <ellipse cx={22} cy={82 - jumpY} rx={20} ry={5} fill="#000" opacity={0.38} />
      <g transform={`scale(${flip} 1) translate(${flip === -1 ? -44 : 0} 0)`}>
        {renderPersona(key, walking)}
      </g>
      {/* tiny ! bubble on error */}
      {phase === 'error' && !bubble && (
        <g transform="translate(36 -8)">
          <circle cx={0} cy={0} r={10} fill="#f07178" stroke="#0b0e14" strokeWidth={1.2} />
          <text x={0} y={3.5} textAnchor="middle" fill="#0b0e14" style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>!</text>
        </g>
      )}
      {bubble && <SpeechBubble text={bubble.text} />}
    </g>
  );
}

function renderPersona(key: AgentKey, walking: boolean) {
  // Each character drawn on a 44×84 canvas, flat-pixel shading. Tripled from
  // the previous 22×40 sprite.
  const legSwing = walking ? 3 : 0;
  switch (key) {
    case 'market': // DWIGHT — mustard shirt, glasses, buzzcut
      return (
        <g>
          {/* legs */}
          <rect x={14} y={70 - legSwing} width={6} height={10} fill="#2a2418" />
          <rect x={24} y={70 + legSwing} width={6} height={10} fill="#2a2418" />
          <rect x={14} y={78} width={6} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={6} height={4} fill="#0b0e14" />
          {/* torso — mustard short-sleeve */}
          <rect x={10} y={38} width={24} height={34} fill="#8b6f2a" />
          <rect x={10} y={38} width={24} height={6} fill="#705724" />
          {/* shirt collar/tie */}
          <rect x={20} y={38} width={4} height={20} fill="#f4ecd8" />
          <rect x={20} y={42} width={4} height={16} fill="#3a2a18" />
          {/* sleeves */}
          <rect x={6}  y={42} width={4} height={18} fill="#8b6f2a" />
          <rect x={34} y={42} width={4} height={18} fill="#8b6f2a" />
          {/* hands */}
          <rect x={4}  y={60} width={6} height={6} fill="#f0d4a5" />
          <rect x={34} y={60} width={6} height={6} fill="#f0d4a5" />
          {/* head */}
          <rect x={10} y={10} width={24} height={30} fill="#f0d4a5" />
          {/* buzzcut hair */}
          <rect x={10} y={6}  width={24} height={8} fill="#4a3020" />
          <rect x={11} y={4}  width={22} height={2} fill="#3a2418" />
          {/* glasses frames */}
          <rect x={10} y={22} width={10} height={6} fill="none" stroke="#0b0e14" strokeWidth={1.2} />
          <rect x={24} y={22} width={10} height={6} fill="none" stroke="#0b0e14" strokeWidth={1.2} />
          <rect x={20} y={24} width={4}  height={2} fill="#0b0e14" />
          {/* eyes */}
          <rect x={14} y={24} width={2} height={2} fill="#0b0e14" />
          <rect x={28} y={24} width={2} height={2} fill="#0b0e14" />
          {/* stern mouth */}
          <rect x={18} y={32} width={8} height={2} fill="#0b0e14" />
          {/* mustard tie stripe belt accent */}
          <rect x={10} y={66} width={24} height={3} fill="#705724" />
        </g>
      );
    case 'consistency': // JIM — blue shirt, floppy hair, tall
      return (
        <g>
          <rect x={14} y={70 - legSwing} width={6} height={10} fill="#1a2030" />
          <rect x={24} y={70 + legSwing} width={6} height={10} fill="#1a2030" />
          <rect x={14} y={78} width={6} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={6} height={4} fill="#0b0e14" />
          {/* blue button-up */}
          <rect x={10} y={38} width={24} height={34} fill="#3a5680" />
          <rect x={10} y={38} width={24} height={5} fill="#2a4060" />
          {/* collar */}
          <rect x={18} y={38} width={8} height={6} fill="#f4ecd8" />
          <rect x={20} y={38} width={4} height={14} fill="#2a3a5a" />
          {/* sleeves */}
          <rect x={6}  y={42} width={4} height={20} fill="#3a5680" />
          <rect x={34} y={42} width={4} height={20} fill="#3a5680" />
          {/* hands */}
          <rect x={4}  y={62} width={6} height={6} fill="#f2d9b2" />
          <rect x={34} y={62} width={6} height={6} fill="#f2d9b2" />
          {/* head */}
          <rect x={10} y={10} width={24} height={30} fill="#f2d9b2" />
          {/* floppy brown hair — longer on top, side-swept */}
          <rect x={8}  y={4} width={28} height={8} fill="#3a2010" />
          <rect x={32} y={12} width={6} height={4} fill="#3a2010" />
          <rect x={8}  y={12} width={4} height={2} fill="#3a2010" />
          {/* sideways glance eyes */}
          <rect x={14} y={24} width={3} height={3} fill="#0b0e14" />
          <rect x={28} y={24} width={3} height={3} fill="#0b0e14" />
          <rect x={16} y={25} width={1} height={1} fill="#f2d9b2" />
          <rect x={30} y={25} width={1} height={1} fill="#f2d9b2" />
          {/* smirk */}
          <rect x={16} y={32} width={10} height={2} fill="#0b0e14" />
          <rect x={26} y={30} width={2} height={2} fill="#0b0e14" />
        </g>
      );
    case 'narrative': // MICHAEL — navy suit, white shirt, green tie, grin
      return (
        <g>
          <rect x={14} y={70 - legSwing} width={6} height={10} fill="#0a1020" />
          <rect x={24} y={70 + legSwing} width={6} height={10} fill="#0a1020" />
          <rect x={14} y={78} width={6} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={6} height={4} fill="#0b0e14" />
          {/* navy suit jacket */}
          <rect x={8}  y={38} width={28} height={34} fill="#1a2b47" />
          {/* white shirt V */}
          <rect x={18} y={38} width={8} height={20} fill="#f4ecd8" />
          {/* green tie */}
          <rect x={20} y={40} width={4} height={20} fill="#7fd962" />
          <rect x={19} y={40} width={6} height={3} fill="#5fb048" />
          {/* lapels */}
          <rect x={14} y={40} width={4} height={16} fill="#0a1222" />
          <rect x={26} y={40} width={4} height={16} fill="#0a1222" />
          {/* sleeves */}
          <rect x={4}  y={42} width={4} height={22} fill="#1a2b47" />
          <rect x={36} y={42} width={4} height={22} fill="#1a2b47" />
          {/* hands */}
          <rect x={2}  y={64} width={6} height={6} fill="#f0d4a5" />
          <rect x={36} y={64} width={6} height={6} fill="#f0d4a5" />
          {/* round face */}
          <rect x={9}  y={10} width={26} height={30} fill="#f0d4a5" />
          <rect x={8}  y={14} width={2}  height={22} fill="#f0d4a5" />
          <rect x={34} y={14} width={2}  height={22} fill="#f0d4a5" />
          {/* dark hair parted */}
          <rect x={9}  y={6}  width={26} height={6} fill="#2a1810" />
          <rect x={20} y={10} width={4}  height={2} fill="#2a1810" />
          {/* bright eyes */}
          <rect x={14} y={22} width={3} height={3} fill="#0b0e14" />
          <rect x={27} y={22} width={3} height={3} fill="#0b0e14" />
          <rect x={15} y={23} width={1} height={1} fill="#f4ecd8" />
          <rect x={28} y={23} width={1} height={1} fill="#f4ecd8" />
          {/* big grin */}
          <rect x={14} y={32} width={16} height={3} fill="#0b0e14" />
          <rect x={16} y={33} width={12} height={2} fill="#f4ecd8" />
        </g>
      );
    case 'testwriter': // OSCAR — mustache, glasses, blue button-up, olive skin
      return (
        <g>
          <rect x={14} y={70 - legSwing} width={6} height={10} fill="#1a2030" />
          <rect x={24} y={70 + legSwing} width={6} height={10} fill="#1a2030" />
          <rect x={14} y={78} width={6} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={6} height={4} fill="#0b0e14" />
          {/* light blue button-up */}
          <rect x={10} y={38} width={24} height={34} fill="#6a8fc0" />
          <rect x={10} y={38} width={24} height={5} fill="#4e6ea0" />
          <rect x={18} y={38} width={8} height={22} fill="#f4ecd8" />
          {/* striped tie */}
          <rect x={20} y={40} width={4} height={20} fill="#6a8fc0" />
          <rect x={20} y={43} width={4} height={2} fill="#f4ecd8" />
          <rect x={20} y={49} width={4} height={2} fill="#f4ecd8" />
          <rect x={20} y={55} width={4} height={2} fill="#f4ecd8" />
          <rect x={4}  y={42} width={4} height={22} fill="#6a8fc0" />
          <rect x={36} y={42} width={4} height={22} fill="#6a8fc0" />
          <rect x={2}  y={62} width={6} height={6} fill="#c89070" />
          <rect x={36} y={62} width={6} height={6} fill="#c89070" />
          {/* olive-toned head */}
          <rect x={10} y={10} width={24} height={30} fill="#c89070" />
          {/* black side-parted hair */}
          <rect x={9}  y={4} width={26} height={7} fill="#1a1008" />
          <rect x={28} y={11} width={6} height={4} fill="#1a1008" />
          <rect x={10} y={11} width={2} height={2} fill="#1a1008" />
          {/* glasses */}
          <rect x={11} y={22} width={8} height={5} fill="none" stroke="#0b0e14" strokeWidth={1.2} />
          <rect x={25} y={22} width={8} height={5} fill="none" stroke="#0b0e14" strokeWidth={1.2} />
          <rect x={19} y={24} width={6} height={1} fill="#0b0e14" />
          <rect x={14} y={24} width={2} height={2} fill="#0b0e14" />
          <rect x={28} y={24} width={2} height={2} fill="#0b0e14" />
          {/* mustache */}
          <rect x={14} y={30} width={16} height={2} fill="#1a1008" />
          <rect x={16} y={33} width={12} height={1} fill="#0b0e14" />
        </g>
      );
    case 'reviewer': // TOBY — sad eyes, receding hairline, grey shirt, sorry posture
      return (
        <g>
          <rect x={14} y={70 - legSwing} width={6} height={10} fill="#2a2818" />
          <rect x={24} y={70 + legSwing} width={6} height={10} fill="#2a2818" />
          <rect x={14} y={78} width={6} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={6} height={4} fill="#0b0e14" />
          {/* dull grey polo */}
          <rect x={10} y={38} width={24} height={34} fill="#7a7a7a" />
          <rect x={10} y={38} width={24} height={4} fill="#5a5a5a" />
          <rect x={18} y={38} width={8} height={10} fill="#9a9a9a" />
          <rect x={6}  y={42} width={4} height={20} fill="#7a7a7a" />
          <rect x={34} y={42} width={4} height={20} fill="#7a7a7a" />
          <rect x={4}  y={62} width={6} height={6} fill="#f2d9b2" />
          <rect x={34} y={62} width={6} height={6} fill="#f2d9b2" />
          {/* head */}
          <rect x={10} y={10} width={24} height={30} fill="#f2d9b2" />
          {/* thinning side hair only */}
          <rect x={10} y={10} width={3} height={8} fill="#6a4528" />
          <rect x={31} y={10} width={3} height={8} fill="#6a4528" />
          <rect x={10} y={6}  width={24} height={3} fill="#6a4528" opacity={0.4} />
          {/* sad down-turned eyes */}
          <rect x={14} y={22} width={3} height={2} fill="#0b0e14" />
          <rect x={27} y={22} width={3} height={2} fill="#0b0e14" />
          <rect x={14} y={24} width={1} height={1} fill="#0b0e14" opacity={0.6} />
          <rect x={29} y={24} width={1} height={1} fill="#0b0e14" opacity={0.6} />
          {/* flat/down mouth */}
          <rect x={16} y={32} width={12} height={2} fill="#0b0e14" />
          <rect x={16} y={34} width={2} height={1} fill="#0b0e14" />
          <rect x={26} y={34} width={2} height={1} fill="#0b0e14" />
        </g>
      );
    case 'developerA': // ANDY — white shirt, tan sweater vest, red tie, auburn side-part
      return (
        <g>
          <rect x={14} y={70 - legSwing} width={6} height={10} fill="#1a2030" />
          <rect x={24} y={70 + legSwing} width={6} height={10} fill="#1a2030" />
          <rect x={14} y={78} width={6} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={6} height={4} fill="#0b0e14" />
          {/* white shirt */}
          <rect x={10} y={38} width={24} height={34} fill="#f4ecd8" />
          {/* tan sweater vest */}
          <rect x={10} y={40} width={24} height={30} fill="#d4a464" />
          <rect x={10} y={40} width={24} height={5}  fill="#b88844" />
          <rect x={18} y={38} width={8}  height={18} fill="#f4ecd8" />
          {/* red tie */}
          <rect x={20} y={40} width={4}  height={18} fill="#a83030" />
          <rect x={19} y={40} width={6}  height={3}  fill="#7a2020" />
          {/* sleeves */}
          <rect x={4}  y={42} width={4}  height={22} fill="#f4ecd8" />
          <rect x={36} y={42} width={4}  height={22} fill="#f4ecd8" />
          {/* hands */}
          <rect x={2}  y={62} width={6}  height={6}  fill="#f4d5b8" />
          <rect x={36} y={62} width={6}  height={6}  fill="#f4d5b8" />
          {/* head */}
          <rect x={10} y={10} width={24} height={30} fill="#f4d5b8" />
          {/* auburn hair side-parted */}
          <rect x={10} y={4}  width={24} height={8}  fill="#7a3018" />
          <rect x={28} y={12} width={6}  height={4}  fill="#7a3018" />
          <rect x={10} y={12} width={2}  height={2}  fill="#7a3018" />
          {/* wide excited eyes */}
          <rect x={14} y={22} width={3} height={3} fill="#0b0e14" />
          <rect x={27} y={22} width={3} height={3} fill="#0b0e14" />
          <rect x={15} y={23} width={1} height={1} fill="#f4ecd8" />
          <rect x={28} y={23} width={1} height={1} fill="#f4ecd8" />
          {/* toothy grin */}
          <rect x={14} y={32} width={16} height={3} fill="#0b0e14" />
          <rect x={16} y={33} width={12} height={1} fill="#f4ecd8" />
        </g>
      );
    case 'developerB': // KEVIN — light blue shirt, wide, thinning hair, beard
      return (
        <g>
          <rect x={12} y={70 - legSwing} width={8} height={10} fill="#1a2030" />
          <rect x={24} y={70 + legSwing} width={8} height={10} fill="#1a2030" />
          <rect x={12} y={78} width={8} height={4} fill="#0b0e14" />
          <rect x={24} y={78} width={8} height={4} fill="#0b0e14" />
          {/* wider torso + belt */}
          <rect x={4}  y={36} width={36} height={36} fill="#5a7ea0" />
          <rect x={4}  y={36} width={36} height={6}  fill="#3f617f" />
          <rect x={4}  y={68} width={36} height={4}  fill="#1a2030" />
          {/* buttons */}
          <rect x={20} y={44} width={2} height={2} fill="#2a3a5a" />
          <rect x={20} y={52} width={2} height={2} fill="#2a3a5a" />
          <rect x={20} y={60} width={2} height={2} fill="#2a3a5a" />
          {/* sleeves */}
          <rect x={0}  y={40} width={4} height={24} fill="#5a7ea0" />
          <rect x={40} y={40} width={4} height={24} fill="#5a7ea0" />
          {/* hands */}
          <rect x={-2} y={62} width={6} height={6} fill="#e8c8a0" />
          <rect x={40} y={62} width={6} height={6} fill="#e8c8a0" />
          {/* head */}
          <rect x={10} y={10} width={24} height={30} fill="#e8c8a0" />
          {/* thinning hair — strips on sides only */}
          <rect x={10} y={8}  width={24} height={3}  fill="#3a2010" />
          <rect x={10} y={8}  width={3}  height={8}  fill="#3a2010" />
          <rect x={31} y={8}  width={3}  height={8}  fill="#3a2010" />
          {/* beard */}
          <rect x={10} y={28} width={24} height={10} fill="#3a2010" opacity={0.95} />
          <rect x={11} y={38} width={22} height={2}  fill="#3a2010" opacity={0.7} />
          {/* eyes */}
          <rect x={14} y={20} width={3} height={3} fill="#0b0e14" />
          <rect x={27} y={20} width={3} height={3} fill="#0b0e14" />
          {/* frown */}
          <rect x={16} y={30} width={12} height={2} fill="#0b0e14" />
        </g>
      );
  }
}

function SpeechBubble({ text }: { text: string }) {
  const pad = 10;
  const charW = 8.4;
  const w = Math.max(90, text.length * charW + pad * 2);
  const h = 28;
  return (
    <g transform={`translate(36 -30)`}>
      <rect x={0} y={0} width={w} height={h} fill="#f4ecd8" stroke="#0b0e14" strokeWidth={1.5} />
      <polygon points={`10,${h - 0.5} 16,${h + 10} 24,${h - 0.5}`} fill="#f4ecd8" stroke="#0b0e14" strokeWidth={1.5} />
      <text
        x={pad}
        y={19}
        fill="#0b0e14"
        style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace', fontWeight: 500 }}
      >
        {text}
      </text>
    </g>
  );
}
