# Zendesk KPI Tracker

A Chrome extension for tracking Customer Support metrics in real-time with a Power BI-style dashboard.

## Features

- **Automatic Tracking**: Detects replies and chats from Zendesk's own API traffic, and calls from the Talk hang-up control
- **Manual Tracking**: Fallback buttons for when automatic detection doesn't work
- **Power BI-style Dashboard**: Beautiful dark-themed popup with scorecards and charts
- **Per-Company Zendesk Routing**: Auto-routes tracking data to the mapped company based on Zendesk subdomain
- **Daily Goals**: Set and track progress toward your daily targets
- **CSV Export**: Export your metrics to CSV for Google Sheets/Excel
- **Context Menu**: Right-click on Zendesk pages to quickly log metrics

## Installation

1. **Clone or download this repository**

2. **Load the extension in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `src` folder of this project

3. **Pin the extension** (optional but recommended):
   - Click the puzzle piece icon in Chrome toolbar
   - Click the pin icon next to "Zendesk KPI Tracker"

## Usage

### Tracked Metrics

| Metric | What it counts | How it is detected |
| --- | --- | --- |
| **Replies** | Every public reply you send, on any channel | Zendesk's own ticket API response confirms the comment was public and from staff |
| **Chats** | Each chat/messaging conversation you handle, counted once per ticket per day | The messaging session ending, or a public reply on a messaging ticket |
| **Calls** | Each call you finish, inbound or outbound | Clicking the Talk hang-up control |

#### What counts as a chat

A messaging conversation in Agent Workspace is an ordinary ticket, so a chat is
counted from two signals, whichever comes first:

1. **The messaging session ends.** Ending a session is an explicit agent action
   (the **End Session** button in the composer) that switches the messaging
   channel off for that conversation and stops the customer replying over it.
   It is the event shown in the ticket as *"Messaging session ended by agent"*,
   and it means one conversation finished.
2. **A public reply on a messaging ticket.** A fallback for agents who never
   press End Session, so chats are still counted.

Either way the counting is per ticket per day, so replying several times - or
replying and then ending the session - is still one chat.

A ticket counts as messaging when the intercepted payload says so, in this
order: an explicit `via.channel` of `native_messaging` (Agent Workspace
messaging, including the web widget, social and in-app conversations), `chat`
(legacy Zendesk Chat) or `messaging`; otherwise the conversation log's own
event types, since Sunshine Conversations events such as
`SunshineConversationsMessageStatus` only appear on messaging tickets. The
recognised channel values live in `CHAT_CHANNELS` in `metrics.js`.

#### If chats still are not counted

Zendesk does not document the conversation event behind "Messaging session
ended by agent", so the extension matches both the names it expects and
anything shaped like a session ending. To check what your account actually
sends, finish a chat and run this in the browser console:

```javascript
ZKT.diagnose()
```

It prints every GraphQL operation seen, every conversation event type with how
recently it appeared, and whether any of them matched the session-end shape -
without logging message contents. `ZKT.channel()` prints just the channel that
was resolved last. Add a missing event type to `SESSION_END_TYPENAMES` in
`content.js`, or a missing channel to `CHAT_CHANNELS` in `metrics.js`.

### Manual Tracking

If automatic tracking doesn't work for your Zendesk configuration:
1. Click the extension icon to open the dashboard
2. Use the +Reply, +Chat, +Call buttons

### Right-Click Menu

On any Zendesk page, right-click and select **Track Metric**, then
**+ Reply**, **+ Chat** or **+ Call**.

### Setting Goals

1. Click the extension icon
2. Click the gear icon in the top right
3. Enter your daily goals
4. Click "Save Settings"

### Multi-Company Tracking

If you use multiple Zendesk accounts/brands:

1. Open the relevant Zendesk account in the active browser tab
2. Open the extension popup
3. Select the company profile from the company dropdown

The extension will remember that Zendesk subdomain for the selected company and
automatically route future tracking events from that subdomain to that company.

### Exporting Data

1. Click the extension icon
2. Click the green "Export to CSV" button
3. A CSV file will download with all your tracked data

## Updating Selectors

Since Zendesk uses dynamic CSS classes that may change, you may need to update the selectors:

1. Open `content.js`
2. Find the `SELECTORS` object at the top of the file
3. Inspect the element in Zendesk (right-click > Inspect)
4. Update the relevant selector array

### Example Selector Update

```javascript
const SELECTORS = {
  CALL_END_BUTTONS: [
    '[data-test-id="end-call-button"]',  // Add your custom selector here
    // ... other selectors
  ],
  // ...
};
```

Replies and chats do not use selectors - they are read from Zendesk's API
responses, which survive UI redesigns. Only call detection depends on the DOM.

## File Structure

```
src/
├── manifest.json      # Extension configuration
├── metrics.js         # Shared metric schema, defaults & migrations
├── inject.js          # fetch/XHR interception (page context)
├── content.js         # Event detection & ticket time tracking
├── background.js      # Ticket reminders, context menu & badge
├── storage-utils.js   # Multi-company storage helpers
├── popup.html/js/css  # Toolbar popup
├── dashboard.html/js/css # Full analytics dashboard
└── icons/
    ├── icon.svg       # Source icon
    ├── icon16.png     # 16x16 icon
    ├── icon32.png     # 32x32 icon
    ├── icon48.png     # 48x48 icon
    └── icon128.png    # 128x128 icon
```

### Adding or changing a metric

`metrics.js` is the single source of truth. Its `METRICS` array drives the
scorecards, charts, comparison table, context menu and CSV columns, and its
`normalizeMetrics`/`normalizeGoals` helpers migrate previously stored data.

## Troubleshooting

### Extension shows "Not tracking"
- Make sure you're on a zendesk.com page
- Try refreshing the page
- Check if the content script is loaded (open DevTools > Console)

### Replies or chats not counted
- Run `ZKT.diagnose()` after finishing a conversation (see "If chats still are
  not counted" above) - it usually identifies the problem on its own
- Set `DEBUG_MODE = true` at the top of `content.js` for the full payloads,
  then reload the Zendesk tab
- Use the manual tracking buttons as a fallback

### Calls not counted
- Zendesk may have changed the Talk hang-up control
- Update `CALL_END_BUTTONS` in content.js (see "Updating Selectors" above)

### Data not persisting
- Check Chrome storage quota: `chrome://settings/siteData`
- Clear extension data and reinstall if needed

## Generating Better Icons

The included icons are placeholders. To generate proper icons:

1. Install dependencies:
   ```bash
   npm install sharp
   ```

2. Run the generator:
   ```bash
   cd src/icons
   node generate-icons.js
   ```

Or manually convert `icon.svg` using:
- [Convertio](https://convertio.co/svg-png/)
- [SVG to PNG](https://svgtopng.com/)
- Figma, Sketch, or any design tool

## Privacy

This extension:
- Does NOT send data to external servers
- Stores all data locally using Chrome Storage API
- Only activates on zendesk.com domains
- Does NOT access or store any ticket/customer data

## License

MIT License - Feel free to modify and distribute.
