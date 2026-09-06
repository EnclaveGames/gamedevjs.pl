/*
 * Data model types for gamedevjs.pl.
 *
 * These types describe the shape of data loaded from the `data/` directory
 * (event / people / organization / venue / page YAML + Markdown) and are
 * exported so that components and pages can type-check their props.
 */

export interface ImageAsset {
  normal: string;
  width?: number;
  height?: number;
}

export interface PersonName {
  given: string;
  family: string;
}

export interface PersonBio {
  summary?: string;
  full?: string;
}

export interface Event {
  kind?: string;
  title: string;
  slug: string;
  timeframe?: Timeframe;
  venue?: Venue | null;
  description?: string;
  schedule?: Event[];
  recording?: string;
  people?: PersonMinimal[];
  resources?: Link[];
  data?: Record<string, unknown>;
  parent?: Event | null;
}

export interface Person {
  name: PersonName;
  slug: string;
  slack?: string;
  github?: string;
  twitter?: string;
  linkedin?: string;
  homepage?: string;
  bio: PersonBio;
  photo: ImageAsset;
  events?: Event[];
  previous?: PersonMinimal;
  next?: PersonMinimal;
}

export type PersonMinimal = Omit<Person, 'events' | 'previous' | 'next'>;

export interface Coordinates {
  lat?: number;
  long?: number;
  minLat?: number;
  minLong?: number;
  maxLat?: number;
  maxLong?: number;
}

export interface VenueName {
  full: string;
  short?: string;
}

export interface Venue {
  name: VenueName;
  slug: string;
  location: {
    address: string;
    city: { name: string; slug: string };
    coordinates?: Coordinates;
  };
}

export interface Timeframe {
  start?: string;
  end?: string;
}

export interface Link {
  rel?: string;
  label?: string;
  href?: string;
  id?: string;
  resource?: unknown;
}

export interface Organization {
  name: string;
  slug: string;
  homepage: string;
  logo: ImageAsset;
  description?: string;
}

export interface Page {
  title: string;
  slug: string;
  content: string;
  data?: Record<string, unknown>;
}
