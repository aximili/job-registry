# The Job Registry browser extension

It shows a small panel on Seek, LinkedIn and Indeed job pages: whether you've saved the job, a one-click **Save**, and how well the job fits you. The toolbar button (or `Alt+Shift+J`) saves a job ad from any other website. It only talks to Job Registry on your own computer.

## Build it

`setup.bat` builds it. To build it again yourself: `npm run ext:build`. That makes `extension\dist\firefox` and `extension\dist\chrome`.

## Firefox

**To try it now** (it's removed when Firefox restarts):
1. Go to `about:debugging#/runtime/this-firefox`.
2. Press **Load Temporary Add-on…** and pick `extension\dist\firefox\manifest.json`.

**To keep it installed**, sign it once as a private ("unlisted") add-on. Nobody else can find it or install it.
1. Make a free account at https://addons.mozilla.org, then open https://addons.mozilla.org/developers/addon/api/key/ and generate API credentials.
2. In a terminal in the Job Registry folder. In **PowerShell** (Windows' usual terminal):
   ```
   $env:WEB_EXT_API_KEY = "user:12345:678"
   $env:WEB_EXT_API_SECRET = "your-secret"
   npm run ext:sign
   ```
   Or in **Command Prompt** (cmd):
   ```
   set WEB_EXT_API_KEY=user:12345:678
   set WEB_EXT_API_SECRET=your-secret
   npm run ext:sign
   ```
   The keys only last for that terminal window. They're never saved in the project.
3. The signed file appears in `extension\dist\signed\` (a `.xpi`). Drag it onto a Firefox window, and confirm.

When you update Job Registry, sign it again to get the new version. Each signing gets a new version number by itself (addons.mozilla.org refuses a number it already has).

## Chrome (or Edge)

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Press **Load unpacked** and pick the `extension\dist\chrome` folder.

After an update, press the reload button on the extension's card.

## Options

Right-click the toolbar button → **Manage extension** → **Options** (Firefox: **Preferences**):
- **Server address:** where Job Registry runs. Usually `http://127.0.0.1:4777`.
- **Rate jobs automatically on job pages:** on by default. Ratings need your master profile in Job Registry.

If the options page says the extension isn't allowed to reach Job Registry, press **Allow access**.

## When a site changes its layout

The panel will say it couldn't read the job (you can still save the selected text or the whole page). To help fix it, save the page from your browser (**File → Save Page As**, "Web Page, HTML only"), then run:

```
npm run ext:check -- path\to\saved-page.html "https://www.seek.com.au/job/81234567"
```

with the page's real address. It prints what the extension found. Each site's reader is one small file in `extension\src\sites\`.
