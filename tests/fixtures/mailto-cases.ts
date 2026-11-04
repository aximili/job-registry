// How a mailto: link reads as text. Both readers (the extension's and the
// server's) loop over this one table, so they can't drift apart. Seek shows a
// contact as "••••@example.com.au" and only the link holds the real address.

export const MAILTO_CASES: { html: string; text: string }[] = [
  {
    html: '<a href="mailto:Alex@example-recruit.com.au">••••@example-recruit.com.au</a>',
    text: '••••@example-recruit.com.au (Alex@example-recruit.com.au)',
  },
  { html: '<a href="mailto:jobs@example.com">jobs@example.com</a>', text: 'jobs@example.com' },
  { html: '<a href="mailto:JOBS@example.com">jobs@example.com</a>', text: 'jobs@example.com' },
  { html: '<a href="mailto:alex@example.com?subject=Role">email Alex</a>', text: 'email Alex (alex@example.com)' },
  { html: '<a href="mailto:alex%40example.com"></a>', text: 'alex@example.com' },
  // An icon or a space for its text: the address stands apart from the words around it.
  { html: 'Sam Lee<a href="mailto:sam@example.com"><img src="m.png"></a>', text: 'Sam Lee sam@example.com' },
  { html: '<p>Email<a href="mailto:sam@example.com"> </a>today</p>', text: 'Email sam@example.com today' },
  { html: '<a href="mailto:">Email us</a>', text: 'Email us' },
  { html: '<a href="mailto:nobody">Email us</a>', text: 'Email us' },
  { html: '<a href="https://example.com">Apply</a>', text: 'Apply' },
  { html: '<a href="MAILTO:sam@example.com">Write to Sam</a>', text: 'Write to Sam (sam@example.com)' },
  {
    html: '<a href="mailto:sam@example.com,alex@example.com">Email the team</a>',
    text: 'Email the team (sam@example.com,alex@example.com)',
  },
  // A bad %-code can't be decoded, so the address stays as written.
  { html: '<a href="mailto:sam%ZZ@example.com">Email Sam</a>', text: 'Email Sam (sam%ZZ@example.com)' },
  {
    html: '<p>Questions? Email <a href="mailto:Alex@example-recruit.com.au">••••@example-recruit.com.au</a> by Friday.</p>',
    text: 'Questions? Email ••••@example-recruit.com.au (Alex@example-recruit.com.au) by Friday.',
  },
];
