/*
 * Data layer — TypeScript re-implementation of `github.com/muyo/ships`.
 *
 * Reads event / people / organization / venue / page data from the `data/`
 * directory (YAML + Markdown with `~directive` keys) and exposes it through a
 * shared module-level singleton behind the `getEvents` / `getPerson` / ...
 * helpers. The data-model types are re-exported from @/lib/types; the
 * parsing / linking helpers (YAML front matter, markdown rendering, timeframe
 * parsing, directive resolution, file-system utilities), formatting, timeline
 * construction, RSS generation, and person/event display utilities are all
 * internal to this module.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { marked } from 'marked';
import type {
  Event,
  Organization,
  Page,
  Person,
  PersonMinimal,
  Venue,
  Timeframe,
} from './types';

export function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

export const SLACK_INVITE_URL =
  'https://join.slack.com/t/gamedevjs/shared_invite/enQtMjY4OTQ5MTQxNDQ1LTkzMzBiYjhhYmJiMGNhOTg1YjJlNzYyNDdiNGVhYzIxNjJhNDIyNWZiYTU3OWYzYzVjZDZlODY2NTJmNGZjOTY';

export const PEOPLE_PHOTO_PLACEHOLDER = '/img/people/__placeholder.png';

export const SOCIAL_LINKS = [
  { href: SLACK_INVITE_URL, sprite: 'i-slack', title: 'Slack', label: 'gamedevjs' },
  { href: 'https://twitter.com/gamedevjs', sprite: 'i-twitter', title: 'Twitter', label: 'gamedevjs' },
  { href: 'https://www.facebook.com/gamedevjs', sprite: 'i-fb', title: 'Facebook', label: 'gamedevjs' },
  { href: 'https://www.youtube.com/c/gamedevjs', sprite: 'i-youtube', title: 'YouTube', label: 'gamedevjs' },
  { href: 'https://github.com/enclavegames/gamedevjs.pl', sprite: 'i-gh', title: 'GitHub', label: 'gamedevjs.pl' },
];

/* ---- YAML parsing (preprocess ~directive keys for js-yaml) ---- */

// Key names in YAML that are structural (not passed through to ~resolve/~markdown
// directive processing on events). Used during decoding to separate recognised
// fields from the flexible `data` bag.
const EVENT_RESERVED_KEYS = new Set([
  'kind', 'title', 'slug', 'time', 'venue', 'description',
  'recording', 'schedule', 'people', 'resources',
]);

const DIRECTIVE_KEY_RE = /^(\s*)(~[^:]+):/gm;

function preprocessDirectiveKeys(src: string): string {
  return src.replace(DIRECTIVE_KEY_RE, (_m, indent: string, key: string) => `${indent}"${key}":`);
}

function parseYaml(src: string): any {
  return yaml.load(preprocessDirectiveKeys(src));
}

function parseFrontMatter(src: string): { meta: any; content: string } {
  const trimmed = src.replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(trimmed);
  if (!match) return { meta: {}, content: trimmed };
  return { meta: parseYaml(match[1]), content: trimmed.slice(match[0].length) };
}

/* ---- Markdown rendering ---- */

marked.setOptions({ gfm: true, breaks: false });

function renderMarkdown(src: string | undefined | null): string {
  if (!src) return '';
  return marked.parse(src) as string;
}

/* ---- Timeframe parsing (port of Go server's auxTimeframe.parse) ---- */

const TIME_SEPARATOR = ' - ';

function tzOffsetMs(tz: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
    hour: 'numeric',
  });
  const name = dtf.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const mins = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + mins) * 60_000;
}

function instantToWall(instant: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  let h = parseInt(get('hour'), 10);
  if (h === 24) h = 0;
  return {
    y: +get('year'), m: +get('month'), d: +get('day'),
    h, min: +get('minute'), sec: +get('second'),
  };
}

function wallTimeToInstant(y: number, m: number, d: number, h: number, min: number, sec: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min, sec);
  const offset = tzOffsetMs(tz, new Date(guess));
  return new Date(guess - offset);
}

function parseWall(s: string): { y?: number; m?: number; d?: number; h?: number; min?: number; sec?: number } | null {
  const full = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (full) return { y: +full[1], m: +full[2], d: +full[3], h: +full[4], min: +full[5], sec: full[6] ? +full[6] : 0 };
  const clock = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (clock) return { h: +clock[1], min: +clock[2], sec: 0 };
  return null;
}

interface InternalTimeframe {
  start: Date | null;
  end: Date | null;
}

function parseTimeComponent(s: string, tz: string | undefined, refDate: Date | null): Date | null {
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const wall = parseWall(s);
  const effectiveTz = tz ?? 'UTC';
  if (wall && wall.y !== undefined) {
    return wallTimeToInstant(wall.y, wall.m!, wall.d!, wall.h!, wall.min!, wall.sec ?? 0, effectiveTz);
  }
  if (wall && wall.h !== undefined && refDate) {
    const ref = instantToWall(refDate, effectiveTz);
    return wallTimeToInstant(ref.y, ref.m, ref.d, wall.h, wall.min!, wall.sec ?? 0, effectiveTz);
  }
  return null;
}

function parseTimeframe(
  timeStr: string | undefined,
  tz: string | undefined,
  parentStart: Date | null,
): InternalTimeframe {
  if (!timeStr) return { start: null, end: null };
  const parts = timeStr.split(TIME_SEPARATOR);
  const start = parseTimeComponent(parts[0], tz, parentStart);
  const end = start != null && parts.length === 2 ? parseTimeComponent(parts[1], tz, start) : null;
  return { start, end };
}

function formatISOTz(instant: Date, tz: string | undefined): string {
  if (!tz) return instant.toISOString();
  const { y, m, d, h, min, sec } = instantToWall(instant, tz);
  const off = tzOffsetMs(tz, instant);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const oh = pad(Math.floor(abs / 3_600_000));
  const om = pad(Math.floor((abs % 3_600_000) / 60_000));
  return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:${pad(sec)}${sign}${oh}:${om}`;
}

/* ---- Directive resolution ---- */

type ResolveRef = (kind: string, field: string, value: string) => unknown;

function parseDirectiveKey(key: string): { name: string; args: string } | null {
  const k = key.startsWith('"') && key.endsWith('"') ? key.slice(1, -1) : key;
  const m = /^~([a-zA-Z]+)\((.*)\)$/.exec(k);
  if (!m) return null;
  return { name: m[1], args: m[2] };
}

function processDirectives(node: unknown, resolveRef: ResolveRef): unknown {
  if (Array.isArray(node)) return node.map((n) => processDirectives(n, resolveRef));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      const dir = parseDirectiveKey(key);
      if (!dir) {
        out[key] = processDirectives(val, resolveRef);
        continue;
      }
      if (dir.name === 'markdown') {
        out[dir.args.trim()] = renderMarkdown(typeof val === 'string' ? val : '');
        continue;
      }
      if (dir.name === 'resolve') {
        const parts = dir.args.split('|').map((s) => s.trim());
        const target = parts[0];
        const kind = (parts[1] ?? '').replace(/^kind\s+/, '');
        const field = (parts[2] ?? '').replace(/^by\s+/, '');
        const flat = parts.includes('flat');
        const list = Array.isArray(val) ? val : [val];
        const resolved = list.map((v) => resolveRef(kind, field, String(v))).filter((v): v is unknown => v != null);
        out[target] = flat
          ? resolved
          : Object.fromEntries(resolved.map((r: any) => [r?.[field] ?? r?.slug ?? r?.name ?? String(r), r]));
      }
    }
    return out;
  }
  return node;
}

/* ---- File-system + string helpers ---- */

const DIACRITICS: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z',
};

function slugify(input: string): string {
  let s = input
    .split('')
    .map((ch) => DIACRITICS[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s;
}

function normalizePath(p: string | undefined): string {
  if (!p) return '';
  if (p[0] === 'h' || p[0] === '/') return p;
  return '/' + p;
}

const PROJECT_ROOT = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../..',
);

export function getImageDimensions(src: string): { width: number; height: number } | null {
  const cleanSrc = src[0] === '/' ? src : '/' + src;
  const filePath = path.join(PROJECT_ROOT, 'public', cleanSrc);
  if (!fs.existsSync(filePath)) return null;

  try {
    const header = Buffer.alloc(24);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, header, 0, 24, 0);
    } finally {
      fs.closeSync(fd);
    }

    // PNG: signature(8) + IHDR length(4) + "IHDR"(4) + width(4) + height(4)
    if (header.readUInt32BE(12) === 0x49484452) {
      return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
    }

    // JPEG: SOI marker at 0xFFD8, then scan for SOF marker
    if (header.readUInt16BE(0) === 0xffd8) {
      const buffer = fs.readFileSync(filePath);
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buffer[offset + 1];
        // SOF markers (C0-C3, C5-C7, C9-CB, CD-CF), excluding C4=DQT, C8=JPG, CC=DAC
        if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }
        if (marker >= 0xd0 && marker <= 0xd7) {
          offset += 2;
          continue;
        }
        if (marker === 0xda || marker === 0xd9) break;
        const segmentLength = buffer.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function walk(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.isFile() && full.endsWith(ext)) out.push(full);
  }
  return out;
}

function yamlBaseNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'))
    .map((f) => f.slice(0, -5));
}

function readYamlFile(file: string): any {
  return parseYaml(fs.readFileSync(file, 'utf8')) ?? {};
}

/* ---- DataStore ---- */

class DataStore {
  private organizationsByName = new Map<string, Organization>();
  private peopleByName = new Map<string, Person>();
  private peopleBySlug = new Map<string, Person>();
  private venuesByPath = new Map<string, { venue: Venue; timezone?: string }>();
  private events = new Map<string, Event>();
  private pages = new Map<string, Page>();
  private personEvents = new Map<string, Event[]>();
  private sortedPeople: PersonMinimal[] = [];

  constructor(private dataDir: string) {
    this.build();
  }

  private build(): void {
    this.loadOrganizations();
    this.loadPeople();
    this.loadGeo();
    this.loadEvents();
    this.sortPersonEvents();
    this.loadPages();
    this.sortedPeople = this.sortPeople();
  }

  private sortPeople(): PersonMinimal[] {
    return [...this.peopleByName.values()]
      .sort((a, b) => (a.name.family + a.name.given).localeCompare(b.name.family + b.name.given))
      .map((p) => this.toPersonMinimal(p));
  }

  private indexPersonEvents(person: PersonMinimal, event: Event): void {
    if (!person.slug) return;
    const list = this.personEvents.get(person.slug) ?? [];
    if (!list.some((e) => e.slug === event.slug)) list.push(event);
    this.personEvents.set(person.slug, list);
  }

  private sortPersonEvents(): void {
    for (const events of this.personEvents.values()) {
      events.sort((a, b) => (b.timeframe?.start ?? '').localeCompare(a.timeframe?.start ?? ''));
    }
  }

  private resolveRef(kind: string, field: string, value: string): unknown {
    switch (kind) {
      case 'organization':
        return field === 'name' ? (this.organizationsByName.get(value) ?? null) : null;
      case 'person':
        return field === 'name'
          ? (this.peopleByName.get(value) ?? null)
          : field === 'slug'
            ? (this.peopleBySlug.get(value) ?? null)
            : null;
      case 'event':
        return field === 'slug' ? (this.events.get(value) ?? null) : null;
      case 'venue':
        return field === 'path' ? (this.venuesByPath.get(value)?.venue ?? null) : null;
      default:
        return null;
    }
  }

  private loadOrganizations(): void {
    const dir = path.join(this.dataDir, 'organizations');
    for (const base of yamlBaseNames(dir)) {
      const raw = readYamlFile(path.join(dir, `${base}.yaml`));
      const logoPath = normalizePath(raw.logo?.normal ?? raw.logo);
      const dimensions = getImageDimensions(logoPath);
      const org: Organization = {
        name: raw.name,
        slug: raw.slug || slugify(raw.name),
        homepage: raw.homepage ?? '',
        logo: { normal: logoPath, width: dimensions?.width, height: dimensions?.height },
        description: raw.description ?? '',
      };
      this.organizationsByName.set(org.name, org);
    }
  }

  private loadPeople(): void {
    const dir = path.join(this.dataDir, 'people');
    for (const base of yamlBaseNames(dir)) {
      const raw = readYamlFile(path.join(dir, `${base}.yaml`));
      const fullName = `${raw.name?.given ?? ''} ${raw.name?.family ?? ''}`.trim();
      const rawFull = raw.bio?.full ?? '';
      const bioFull = rawFull ? renderMarkdown(rawFull) : '';
      let rawSummary = raw.bio?.summary ?? rawFull;
      if (rawSummary && rawSummary.length > 400) rawSummary = rawSummary.slice(0, 400) + '...';
      const bioSummary = rawSummary ? renderMarkdown(rawSummary) : '';
      const person: Person = {
        name: { given: raw.name?.given ?? '', family: raw.name?.family ?? '' },
        slug: raw.slug || slugify(fullName),
        slack: raw.slack, github: raw.github, twitter: raw.twitter,
        linkedin: raw.linkedin, homepage: raw.homepage,
        bio: { summary: bioSummary, full: bioFull },
        photo: { normal: raw.photo?.normal ? normalizePath(raw.photo.normal) : PEOPLE_PHOTO_PLACEHOLDER },
      };
      this.peopleByName.set(fullName, person);
      this.peopleBySlug.set(person.slug, person);
    }
  }

  private loadGeo(): void {
    const geoDir = path.join(this.dataDir, 'geo');
    for (const countryCode of yamlBaseNames(geoDir)) {
      const countryRaw = readYamlFile(path.join(geoDir, `${countryCode}.yaml`));
      const tz = countryRaw.location?.timezone?.name;
      for (const cityBase of yamlBaseNames(path.join(geoDir, countryCode))) {
        const cityRaw = readYamlFile(path.join(geoDir, countryCode, `${cityBase}.yaml`));
        const cityName = cityRaw.name ?? cityBase;
        const venuesDir = path.join(geoDir, countryCode, cityBase);
        for (const venueBase of yamlBaseNames(venuesDir)) {
          const venueRaw = readYamlFile(path.join(venuesDir, `${venueBase}.yaml`));
          const nameRaw = venueRaw.name ?? {};
          const venue: Venue = {
            name: {
              full: typeof nameRaw === 'string' ? nameRaw : nameRaw.full,
              short: typeof nameRaw === 'string' ? undefined : nameRaw.short,
            },
            slug: venueBase,
            location: {
              address: venueRaw.location?.address ?? '',
              city: { name: cityName, slug: cityBase },
              coordinates: venueRaw.location?.lat != null || venueRaw.location?.long != null
                ? { lat: venueRaw.location?.lat, long: venueRaw.location?.long }
                : undefined,
            },
          };
          const key = `${countryCode}/${cityBase}/${venueBase}`;
          this.venuesByPath.set(key, { venue, timezone: tz });
        }
      }
    }
  }

  private loadEvents(): void {
    const dir = path.join(this.dataDir, 'events');
    for (const base of yamlBaseNames(dir)) {
      const raw = readYamlFile(path.join(dir, `${base}.yaml`));
      const event = this.decodeEvent(raw, base, null, undefined, null);
      this.events.set(event.slug, event);
    }
  }

  private decodeEvent(
    raw: any,
    defaultSlug: string,
    parentSlug: string | null,
    parentVenueTz: string | undefined,
    parentStart: Date | null,
  ): Event {
    const kind: string | undefined = raw.kind;
    const title: string = raw.title ?? '';
    const slug = raw.slug || (parentSlug ? `${parentSlug}/${slugify(title)}` : defaultSlug);

    let venue: Venue | null = null;
    let venueTz: string | undefined = parentVenueTz;
    if (typeof raw.venue === 'string') {
      const found = this.venuesByPath.get(raw.venue);
      if (found) {
        venue = found.venue;
        venueTz = found.timezone ?? venueTz;
      }
    }

    const { start, end } = parseTimeframe(
      typeof raw.time === 'string' ? raw.time : undefined,
      venueTz,
      parentStart,
    );
    const timeframe: Timeframe | undefined = start != null
      ? { start: formatISOTz(start, venueTz), end: end != null ? formatISOTz(end, venueTz) : undefined }
      : undefined;

    const people: PersonMinimal[] | undefined = Array.isArray(raw.people)
      ? (raw.people as string[])
          .map((n) => this.resolveRef('person', 'name', n))
          .filter((p): p is Person => p != null)
          .map((p) => this.toPersonMinimal(p))
      : undefined;

    let schedule: Event[] | undefined;
    if (Array.isArray(raw.schedule) && raw.schedule.length) {
      schedule = raw.schedule.map((child: any) => this.decodeEvent(child, '', slug, venueTz, start));
    }

    // Separate recognised event fields from the flexible `data` bag that may
    // contain ~resolve / ~markdown directives.
    const rest = Object.fromEntries(
      Object.entries(raw).filter(([k]) => !EVENT_RESERVED_KEYS.has(k)),
    );
    const data = processDirectives(rest, this.resolveRef.bind(this)) as Record<string, unknown>;
    const cleanedData = Object.keys(data).length ? data : undefined;

    const event: Event = {
      kind: kind || undefined, title, slug, timeframe,
      venue: venue ?? null,
      description: renderMarkdown(raw.description) || undefined,
      schedule,
      recording: raw.recording || undefined,
      people,
      resources: Array.isArray(raw.resources) ? raw.resources : undefined,
      data: cleanedData,
    };

    if (people) {
      for (const person of people) this.indexPersonEvents(person, event);
    }
    return event;
  }

  private loadPages(): void {
    const dir = path.join(this.dataDir, 'pages');
    for (const file of walk(dir, '.md')) {
      const { meta, content } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
      const slug = path.basename(file, '.md');
      const rest = Object.fromEntries(
        Object.entries(meta ?? {}).filter(([k]) => k !== 'title' && k !== 'slug'),
      );
      const data = processDirectives(rest, this.resolveRef.bind(this)) as Record<string, unknown>;
      const page: Page = {
        title: (meta?.title as string) ?? slug,
        slug,
        content: renderMarkdown(content),
        data: Object.keys(data).length ? data : undefined,
      };
      this.pages.set(slug, page);
    }
  }

  private toPersonMinimal(p: Person): PersonMinimal {
    return {
      name: p.name, slug: p.slug, slack: p.slack, github: p.github,
      twitter: p.twitter, linkedin: p.linkedin, homepage: p.homepage,
      bio: { summary: p.bio.summary }, photo: p.photo,
    };
  }

  getEvents(): Event[] {
    return [...this.events.values()].sort((a, b) => {
      const ad = a.timeframe?.start ?? '';
      const bd = b.timeframe?.start ?? '';
      return bd.localeCompare(ad);
    });
  }

  getEvent(slug: string): Event | undefined {
    return this.events.get(slug);
  }

  getPeople(): PersonMinimal[] {
    return this.sortedPeople;
  }

  getPerson(slug: string): Person | undefined {
    const person = this.peopleBySlug.get(slug);
    if (!person) return undefined;
    const idx = this.sortedPeople.findIndex((p) => p.slug === slug);
    const previous = idx > 0 ? this.sortedPeople[idx - 1] : undefined;
    const next = idx < this.sortedPeople.length - 1 ? this.sortedPeople[idx + 1] : undefined;
    return {
      ...this.toPersonMinimal(person),
      bio: { summary: person.bio.summary, full: person.bio.full },
      events: this.personEvents.get(slug) ?? [],
      previous,
      next,
    };
  }

  getPartners(): Organization[] {
    return [...this.organizationsByName.values()];
  }

  getPage(slug: string): Page | undefined {
    return this.pages.get(slug);
  }
}

/* ---- Module-level singleton ---- */

const DATA_DIR = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../data',
);

const dataStore = new DataStore(DATA_DIR);

export const getEvents = () => dataStore.getEvents();
export const getEvent = (slug: string) => dataStore.getEvent(slug);
export const getPeople = () => dataStore.getPeople();
export const getPerson = (slug: string) => dataStore.getPerson(slug);
export const getPartners = () => dataStore.getPartners();
export const getPage = (slug: string) => dataStore.getPage(slug);

/* ---- Rendering helpers (formatting, timeline, RSS, display utilities) ---- */

export const MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

const MONTHS_SHORT = [
  'Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze',
  'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru',
];

const DAYS = [
  'niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota',
];

export function kindToLocalizedString(kind?: string): string {
  switch (kind) {
    case 'meetup': return 'Meetup';
    case 'conference': return 'Konferencja';
    case 'panel': return 'Panel dyskusyjny';
    case 'talk': return 'Prelekcja';
    case 'hackathon': return 'Hackaton';
    case 'workshop': return 'Workshop';
    default: return 'Inne';
  }
}

export function eventToPeopleHeaderString(event: { kind?: string; people?: unknown[] }): string {
  switch (event.kind) {
    case 'talk':
      return (event.people?.length ?? 0) === 1 ? 'Prelegent' : 'Prelegenci';
    case 'hackathon':
      return (event.people?.length ?? 0) === 1 ? 'Mentor' : 'Mentorzy';
  }
  return 'Prowadzący';
}

export function personFullName(person: Pick<Person, 'name'>): string {
  return `${person.name.given} ${person.name.family}`.trim();
}

export function personPhotoUrl(person: Pick<Person, 'photo'>): string {
  return person.photo?.normal || PEOPLE_PHOTO_PLACEHOLDER;
}

export function personUrl(person: Pick<Person, 'slug'>): string {
  return '/prelegenci/' + person.slug;
}

export function excerpt(html: string | undefined, limit = 160): string {
  return (html ?? '').replace(/<[^>]+>/g, '').slice(0, limit);
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string),
  );
}

export function generateRSS(events: Event[]): string {
  const items = events
    .map((e) => {
      const link = `https://gamedevjs.pl/wydarzenia/${e.slug}`;
      const desc = excerpt(e.description, 200);
      return `    <item>
      <title>${escapeXml(e.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid>${escapeXml(e.slug)}</guid>
      <description>${escapeXml(desc)}</description>
${e.timeframe?.start ? `      <pubDate>${new Date(e.timeframe.start).toUTCString()}</pubDate>` : ''}
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Gamedev.js - Wydarzenia</title>
    <link>https://gamedevjs.pl/wydarzenia</link>
    <description></description>
${items}
  </channel>
</rss>`;
}

export type TimelineItem =
  | { type: 'year'; year: number }
  | { type: 'month'; month: string; isBreak: number }
  | { type: 'day'; day: string; upcoming: boolean }
  | { type: 'event'; event: Event; upcoming: boolean }
  | { type: 'prehistory' };

export function buildEventTimeline(events: Event[]): TimelineItem[] {
  const now = Date.now();
  const timeline: TimelineItem[] = [];
  let lastYear: number | undefined;
  let lastMonth: number | undefined;
  let lastDay: number | undefined;
  let lastDateStart: Date | undefined;
  let yearChanged = false;
  let monthChanged = false;

  for (const event of events) {
    const start = new Date(event.timeframe?.start ?? '');
    const curYear = start.getFullYear();
    const curMonth = start.getMonth();
    const curDay = start.getDate();

    yearChanged = false;
    monthChanged = false;

    if (lastDateStart === undefined) lastDateStart = start;

    const upcoming = event.timeframe?.end
      ? now < new Date(event.timeframe.end).getTime()
      : now < start.getTime();

    if (curYear !== lastYear) {
      timeline.push({ type: 'year', year: curYear });
      lastYear = curYear;
      yearChanged = true;
    }
    if (yearChanged || curMonth !== lastMonth) {
      timeline.push({
        type: 'month',
        month: MONTHS[curMonth],
        isBreak: !yearChanged ? (lastDateStart ? getMonthDiff(start, lastDateStart) : 0) : 0,
      });
      lastMonth = curMonth;
      monthChanged = true;
    }
    if (monthChanged || curDay !== lastDay) {
      timeline.push({ type: 'day', day: formatDate(event.timeframe?.start ?? '', 'DD'), upcoming });
      lastDay = curDay;
    }
    timeline.push({ type: 'event', event, upcoming });
    lastDateStart = start;
  }

  timeline.push({ type: 'prehistory' });
  return timeline;
}

const getMonthDiff = (a: Date, b: Date) => {
  let m = (b.getFullYear() - a.getFullYear()) * 12;
  m -= a.getMonth() + 1;
  m += b.getMonth();
  return m > 0 ? m : 0;
};

export function formatDate(iso: string, pattern: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';

  return pattern.replace(/YYYY|MMMM|MMM|MM|Do|DD|dddd|ddd|HH|H|mm|ss/g, (token) => {
    switch (token) {
      case 'YYYY': return String(d.getFullYear());
      case 'MMMM': return MONTHS[d.getMonth()];
      case 'MMM': return MONTHS_SHORT[d.getMonth()];
      case 'MM': return pad(d.getMonth() + 1);
      case 'Do': return `${d.getDate()}.`;
      case 'DD': return pad(d.getDate());
      case 'dddd': return DAYS[d.getDay()];
      case 'ddd': return DAYS[d.getDay()].slice(0, 3);
      case 'HH': return pad(d.getHours());
      case 'H': return String(d.getHours());
      case 'mm': return pad(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
      default: return token;
    }
  });
}

const FULL_DATETIME = '<b>DD.MM.YYYY</b> (dddd), H:mm';
const HOUR = 'H:mm';

function sameCalendarDate(a: Date, b: Date): boolean {
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

export function timeframeToLocalizedString(
  timeframe?: { start?: string; end?: string } | null,
  parentTimeframe?: { start?: string } | null,
): string {
  if (!timeframe || !timeframe.start) return '';

  const start = new Date(timeframe.start);
  const end = timeframe.end ? new Date(timeframe.end) : null;
  let startStr: string;

  if (parentTimeframe?.start) {
    const parentStart = new Date(parentTimeframe.start);
    startStr = sameCalendarDate(start, parentStart)
      ? formatDate(timeframe.start, HOUR)
      : formatDate(timeframe.start, FULL_DATETIME);
  } else {
    startStr = formatDate(timeframe.start, FULL_DATETIME);
  }

  if (!end) return startStr;
  return startStr + ' - ' + formatDate(timeframe.end!, sameCalendarDate(start, end) ? HOUR : FULL_DATETIME);
}

export function splitPersonEvents(
  events: Event[] | undefined,
  getEvent: (slug: string) => Event | undefined,
): { events: Event[]; talks: Event[] } {
  const out: { events: Event[]; talks: Event[] } = { events: [], talks: [] };
  if (!events) return out;

  const evSeen = new Set<string>();
  const talkSeen = new Set<string>();

  function pushParent(slug: string): Event | null {
    if (!slug.includes('/')) return null;
    const parentSlug = slug.split('/')[0];
    if (evSeen.has(parentSlug)) return null;
    const parent = getEvent(parentSlug);
    if (!parent) return null;
    evSeen.add(parentSlug);
    out.events.push(parent);
    return parent;
  }

  for (const e of events) {
    if (e.kind === 'talk') {
      if (!talkSeen.has(e.slug)) {
        const talk: Event = { ...e };
        const parent = pushParent(e.slug);
        if (parent) talk.parent = parent;
        out.talks.push(talk);
        talkSeen.add(e.slug);
      }
      continue;
    }

    if (!e.slug.includes('/')) {
      if (!evSeen.has(e.slug)) {
        out.events.push(e);
        evSeen.add(e.slug);
      }
    } else {
      pushParent(e.slug);
    }
  }

  return out;
}
