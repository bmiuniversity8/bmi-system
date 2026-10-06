import { describe, it, expect } from 'vitest';
import { canonicalProgramLevel, canonicalCourseLevel } from './normalize-taxonomy';

describe('canonicalProgramLevel', () => {
  it.each([
    ['undergraduate', 'undergraduate'],
    ['Undergraduate', 'undergraduate'],
    [' UNDERGRADUATE ', 'undergraduate'],
    ['bachelor', 'undergraduate'],
    ['Bachelors', 'undergraduate'],
    ['BACHELOR', 'undergraduate'],
    ['undergrad', 'undergraduate'],
    ['ug', 'undergraduate'],
    ['graduate', 'graduate'],
    ['Graduate', 'graduate'],
    ['master', 'graduate'],
    ['Masters', 'graduate'],
    ['MASTER', 'graduate'],
    ['postgraduate', 'graduate'],
    ['grad', 'graduate'],
    ['pg', 'graduate'],
    ['doctorate', 'doctorate'],
    ['Doctoral', 'doctorate'],
    ['PhD', 'doctorate'],
    ['diploma', 'diploma'],
    ['DIP', 'diploma'],
    ['certificate', 'certificate'],
    ['Cert', 'certificate'],
  ])('maps %p → %p', (raw, expected) => {
    expect(canonicalProgramLevel(raw)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', 'fellowship', '100', 'associate'])(
    'leaves %p unclassified (null)',
    (raw) => {
      expect(canonicalProgramLevel(raw)).toBeNull();
    },
  );
});

describe('canonicalCourseLevel', () => {
  it('keeps canonical numeric bands verbatim', () => {
    for (const band of ['100', '200', '300', '400', '500', '600', '700', '800']) {
      expect(canonicalCourseLevel(band, 'ANY101', 'undergraduate')).toBe(band);
    }
  });

  it('fixes capitalisation of named canonical values', () => {
    expect(canonicalCourseLevel('undergraduate', 'X', null)).toBe('Undergraduate');
    expect(canonicalCourseLevel('POSTGRADUATE', 'X', null)).toBe('Postgraduate');
    expect(canonicalCourseLevel('diploma', 'X', null)).toBe('Diploma');
    expect(canonicalCourseLevel('Certificate', 'X', null)).toBe('Certificate');
  });

  it('derives the band from the course code first digit', () => {
    expect(canonicalCourseLevel('bachelor', 'BABS101', 'undergraduate')).toBe('100');
    expect(canonicalCourseLevel('bachelor', 'BABS204', 'undergraduate')).toBe('200');
    expect(canonicalCourseLevel('master', 'APO501', 'graduate')).toBe('500');
    expect(canonicalCourseLevel('whatever', 'RES701', 'doctorate')).toBe('700');
  });

  it('keeps certificate/diploma categories for their code prefixes', () => {
    expect(canonicalCourseLevel('100', 'GCBS101', 'certificate')).toBe('100'); // already canonical — kept
    expect(canonicalCourseLevel('bachelor', 'GCBS101', 'certificate')).toBe('Certificate');
    expect(canonicalCourseLevel('x', 'GCCS201', null)).toBe('Certificate');
    expect(canonicalCourseLevel('x', 'DIM101', null)).toBe('Diploma');
    expect(canonicalCourseLevel('x', 'DCMT101', null)).toBe('Diploma');
  });

  it('falls back to the linked program level when the code gives no band', () => {
    expect(canonicalCourseLevel('bachelor', 'APO999', 'graduate')).toBe('Postgraduate');
    expect(canonicalCourseLevel('x', 'NOCODE', 'undergraduate')).toBe('Undergraduate');
    expect(canonicalCourseLevel(null, 'THESIS', 'doctorate')).toBe('Postgraduate');
    expect(canonicalCourseLevel('x', 'FIELD', 'certificate')).toBe('Certificate');
    expect(canonicalCourseLevel('x', 'FIELD', 'diploma')).toBe('Diploma');
  });

  it('falls back to alias spellings with no code or program signal', () => {
    expect(canonicalCourseLevel('bachelor', 'SEMINAR', null)).toBe('Undergraduate');
    expect(canonicalCourseLevel('masters', 'SEMINAR', null)).toBe('Postgraduate');
    expect(canonicalCourseLevel('phd', 'SEMINAR', null)).toBe('Postgraduate');
  });

  it('returns null (leave untouched) when unclassifiable', () => {
    expect(canonicalCourseLevel('fellowship', 'SEMINAR', null)).toBeNull();
    expect(canonicalCourseLevel(null, 'SEMINAR', null)).toBeNull();
    expect(canonicalCourseLevel('', '', '')).toBeNull();
  });
});
