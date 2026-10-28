# Job ads for the parse quality check

`npm run eval:parse` reads each ad here with the AI in your settings, and compares what it read with the answers filled in by hand.

## What's here now

The three ads here are **made-up examples**, so the tool has something to run on. They aren't real ads and don't say how well the AI reads real ones.

## Adding real ads (8 to 10 is plenty)

1. Open a job ad on Seek, LinkedIn or Indeed. Select the whole ad and copy it.
2. Paste it into a new file here, such as `04-seek-data-analyst.txt`.
3. Make a file with the same name ending in `.expected.json`, such as `04-seek-data-analyst.expected.json`. Fill in only the fields you want checked, for example:

   ```json
   {
     "title": "Data Analyst",
     "company": "Xero",
     "agency": null,
     "location": "Melbourne VIC",
     "workMode": "hybrid",
     "employmentType": "full-time",
     "salary": { "min": 90000, "max": 110000, "currency": "AUD", "period": "year", "text": "$90k - $110k" },
     "closingDate": null,
     "requirements": ["SQL", "Python", "Three years in a data role"]
   }
   ```

4. Run `npm run eval:parse`.

How fields are checked:
- **Text** (title, company, agency, location) ignores case, extra spaces and endings such as "Pty Ltd".
- **Salary** min and max must be within 1%, and the period must match. The salary text isn't checked.
- **workMode, employmentType and closingDate** must match exactly. Use `null` for "not given".
- **Lists** pass when at least 7 in 10 of your items are found. An item counts as found when at least half its words appear in one of the AI's items.

A mix helps: an agency ad that hides the employer, an hourly or daily contract rate, an ad with no salary, and an ad that gives a closing date.
