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
| **Chats** | Each chat/messaging conversation you take part in, counted once per ticket per day | The same confirmed reply, when the ticket's Zendesk channel is a chat channel |
| **Calls** | Each call you finish, inbound or outbound | Clicking the Talk hang-up control |

#### What counts as a chat

Zendesk Agent Workspace has no "end chat" button to hook - a messaging
conversation is an ordinary ticket - so a chat is counted from the ticket's
originating channel instead. When a public reply is confirmed, the extension
reads the ticket's `via.channel` out of the intercepted API payload; if it is
`native_messaging` (Agent Workspace messaging, including the web widget, social
and in-app conversations), `chat` (legacy Zendesk Chat) or `messaging`, the
conversation is counted as one chat.

Counting is per ticket per day, so replying to the same conversation several
times adds replies, not chats. The recognised channel values live in
`CHAT_CHANNELS` in `metrics.js`.

If chats are not being counted, open a chat ticket, send a reply, and run
`ZKT.channel()` in the browser console: it prints the channel the extension
resolved and whether that channel counts as a chat. Add the value to
`CHAT_CHANNELS` if your account uses a channel that isn't listed.

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
- Set `DEBUG_MODE = true` at the top of `content.js` to log every intercepted
  API response, then reload the Zendesk tab
- Run `ZKT.channel()` to see the channel the extension resolved for the ticket
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
