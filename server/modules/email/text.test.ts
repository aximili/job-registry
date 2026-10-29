import { describe, expect, it } from 'vitest';
import { emailText } from './text.ts';

describe('emailText', () => {
  it('drops quoted lines from a reply', () => {
    expect(emailText('Thanks, see you Tuesday.\n> Can you do Tuesday?\n> Sam')).toBe('Thanks, see you Tuesday.');
  });

  it('cuts at the line that starts the quoted email', () => {
    const text = 'We would like to invite you to an interview.\n\nOn Tue, 27 Oct 2026 at 9:00 am, Sam <sam@x.com> wrote:\nHi there';
    expect(emailText(text)).toBe('We would like to invite you to an interview.');
    expect(emailText('Yes please.\n-----Original Message-----\nFrom: someone')).toBe('Yes please.');
  });

  it('keeps a forwarded email, which is the part that matters', () => {
    const text = [
      'Good news, see below.',
      '',
      '---------- Forwarded message ---------',
      'From: Sam Lee <sam@atlassian.com>',
      'Subject: Interview',
      '',
      "We'd like to invite you to an interview on Tuesday.",
    ].join('\n');
    expect(emailText(text)).toContain("We'd like to invite you to an interview on Tuesday.");
    expect(emailText(`See below.\n\nBegin forwarded message:\n\nFrom: Sam\nUnfortunately we won't progress.`)).toContain(
      "Unfortunately we won't progress.",
    );
  });

  it('tidies white space', () => {
    expect(emailText('  Hello\u00A0there  \r\n\r\n\r\n\r\nBye  ')).toBe('Hello there\n\nBye');
  });

  it('keeps at most 4,000 characters', () => {
    expect(emailText('a'.repeat(10_000))).toHaveLength(4000);
  });
});
