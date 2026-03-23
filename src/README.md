# Zendesk KPI Tracker

A Chrome extension for tracking Customer Support metrics in real-time with a Power BI-style dashboard.

## Features

- **Automatic Tracking**: Detects replies, chats, and calls directly from the Zendesk interface
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

### Automatic Tracking

The extension automatically tracks metrics when you:
- **Replies**: Click Submit/Send on ticket replies
- **Chats**: Click "End Chat" or when a chat ends
- **Inbound Calls**: When an incoming call ends
- **Outbound Calls**: When you complete a dialed call

### Manual Tracking

If automatic tracking doesn't work for your Zendesk configuration:
1. Click the extension icon to open the dashboard
2. Use the +Reply, +Chat, +Inbound, +Outbound buttons

### Right-Click Menu

On any Zendesk page, right-click and select:
- Zendesk KPI Tracker > Track Reply
- Zendesk KPI Tracker > Track Chat
- etc.

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
  REPLY_SUBMIT_BUTTONS: [
    '[data-test-id="submit-button"]',  // Add your custom selector here
    // ... other selectors
  ],
  // ...
};
```

## File Structure

```
src/
├── manifest.json      # Extension configuration
├── content.js         # DOM scraping & event detection
├── background.js      # Data persistence & messaging
├── popup.html         # Dashboard UI
├── popup.js           # Dashboard logic & charts
├── popup.css          # Power BI-style styling
└── icons/
    ├── icon.svg       # Source icon
    ├── icon16.png     # 16x16 icon
    ├── icon32.png     # 32x32 icon
    ├── icon48.png     # 48x48 icon
    └── icon128.png    # 128x128 icon
```

## Troubleshooting

### Extension shows "Not tracking"
- Make sure you're on a zendesk.com page
- Try refreshing the page
- Check if the content script is loaded (open DevTools > Console)

### Automatic tracking not working
- Zendesk may have updated their UI
- Use manual tracking buttons as a fallback
- Update selectors in content.js (see "Updating Selectors" above)

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
