# Phase 6: Windows checks (follow-ups and the board)

Input for the Windows handover, not a checklist to tick by hand.

Follow-ups and the board were built and tested on macOS. Browser tests ran in Firefox and Chromium, with the dates in Sydney time. These checks need the Windows PC.

## Follow-ups

- **The date field in Firefox on Windows:** in a job's **Follow up** dialog, the date field opens Firefox's date picker, and the date shows in day-month-year order (it follows Windows' region setting). A quick pick (In a week) fills it in.
- **The right day:** set a follow-up for tomorrow late at night (after 11 pm). Tomorrow morning, the home page lists it under "Due" as "Today", not "1 day late".
- **Firefox's privacy mode:** if `about:config` has `privacy.resistFingerprinting` set to true, Firefox tells pages the time is UTC. Then **Tomorrow** can pick today before 10 or 11 am, and the call sheet and home page can disagree. Note whether it's on.
- **A tab left open overnight:** the home page's "Due" list and the call sheet use the day the page loaded until something changes or the tab comes back to the front. Note whether that's a problem in practice.

## The board

- **Drag and drop in real Firefox on Windows,** with a mouse and with a touchpad. Drag a card from Applied to Interview 1: it moves, "Moved … to Interview 1." shows, and the job's page shows the new status.
- **The Move to menu with the keyboard:** Tab to a card's "Move to", choose a status with the arrow keys (the card must not move yet), then Tab to **Move** and press Enter. The card moves, and the focus is on its "Move to" in the new column.
- **The Move to menu with the mouse in Firefox:** the menu opens and you can choose a status, even though the card around it can be dragged. **Move** then moves it.
- **Dragging to a column off screen:** with the window narrow, drag a card towards the right edge. Note whether Firefox scrolls the board, or whether the column must be in view first.
- **NVDA (if you use a screen reader):** after **Move**, NVDA reads "Moved … to …".
- **Many jobs:** with 50 or more jobs, the board scrolls sideways and the columns stay readable.
