/**
 * Zendesk Channel Detection Debugger
 *
 * Usage: Open a Zendesk ticket, then paste this entire script into the browser console.
 * It will inspect the channel switcher and show you exactly what the extension sees.
 *
 * Run this on different ticket types (Email, SMS, Chat, etc.) to compare.
 */

console.log('='.repeat(60));
console.log('🔍 ZENDESK CHANNEL DETECTION DEBUG');
console.log('='.repeat(60));

// Find the channel switcher button (same selector as the extension)
const channelSwitcher = document.querySelector('[data-test-id="omnichannel-channel-switcher-button"]');

if (!channelSwitcher) {
  console.log('❌ Channel Switcher NOT found');
  console.log('This could mean:');
  console.log('  1. Zendesk changed the selector');
  console.log('  2. This is an older Zendesk UI');
  console.log('  3. This is not a ticket page');
  console.log('\nSearching for alternative elements...');

  // Try to find any elements that might be the channel switcher
  const possibleSwitchers = document.querySelectorAll('[data-test-id*="channel"]');
  if (possibleSwitchers.length > 0) {
    console.log(`\nFound ${possibleSwitchers.length} elements with "channel" in data-test-id:`);
    possibleSwitchers.forEach((el, i) => {
      console.log(`\n${i + 1}.`, {
        selector: el.getAttribute('data-test-id'),
        ariaLabel: el.getAttribute('aria-label'),
        text: el.textContent.trim().substring(0, 50),
      });
    });
  }
} else {
  console.log('✅ Channel Switcher FOUND!\n');

  // Get all the attributes
  const ariaLabel = channelSwitcher.getAttribute('aria-label') || '';
  const dataChannel = channelSwitcher.getAttribute('data-channel') || '';
  const dataTestId = channelSwitcher.getAttribute('data-test-id') || '';
  const innerText = channelSwitcher.textContent.trim();

  console.log('📋 ATTRIBUTES:');
  console.log('  aria-label:', ariaLabel);
  console.log('  data-channel:', dataChannel);
  console.log('  data-test-id:', dataTestId);
  console.log('  innerText:', innerText);
  console.log('  class:', channelSwitcher.className);

  // Show ALL attributes
  console.log('\n  All attributes:', Array.from(channelSwitcher.attributes).map(a => `${a.name}="${a.value}"`).join('\n    '));

  console.log('\n🔎 DETECTION ANALYSIS:');

  // Simulate the extension's detection logic
  const ariaLabelLower = ariaLabel.toLowerCase();

  // Check for internal note
  const isInternal = ariaLabelLower.includes('internal') || dataChannel === 'internal';
  console.log('  Is Internal Note?', isInternal);

  // Check for channel type
  let channel = null;
  if (ariaLabelLower.includes('email')) {
    channel = 'email';
    console.log('  ✅ Detected as: EMAIL (aria-label contains "email")');
  } else if (ariaLabelLower.includes('sms')) {
    channel = 'sms';
    console.log('  ✅ Detected as: SMS (aria-label contains "sms")');
  } else if (ariaLabelLower.includes('chat')) {
    channel = 'chat';
    console.log('  ✅ Detected as: CHAT (aria-label contains "chat")');
  } else {
    console.log('  ⚠️ Not detected as email/sms/chat');
  }

  // Check if it matches public reply indicators
  const PUBLIC_REPLY_INDICATORS = [
    'Public reply',
    'Email',
    'SMS',
    'Web',
    'Chat',
    'Messaging',
  ];

  const matchedIndicators = PUBLIC_REPLY_INDICATORS.filter(
    indicator => ariaLabelLower.includes(indicator.toLowerCase())
  );

  console.log('\n  Matched Public Reply Indicators:', matchedIndicators.length > 0 ? matchedIndicators : 'None');

  const isPublic = matchedIndicators.length > 0;
  console.log('  Is Public Reply?', isPublic);

  console.log('\n📊 FINAL RESULT:');
  console.log('  {');
  console.log('    isPublic:', isPublic + ',');
  console.log('    channel:', channel ? `"${channel}"` : null);
  console.log('  }');

  // Show the actual HTML for inspection
  console.log('\n🔧 HTML ELEMENT:');
  console.log(channelSwitcher.outerHTML);

  // Check if the problem is substring matching
  console.log('\n🐛 POTENTIAL ISSUES:');
  if (channel === 'chat') {
    console.log('  ⚠️ Detected as CHAT. Checking if "chat" appears in unexpected places:');
    console.log('    - Full aria-label:', `"${ariaLabel}"`);
    console.log('    - Does it contain "email"?', ariaLabelLower.includes('email'));
    console.log('    - Does it contain "sms"?', ariaLabelLower.includes('sms'));
    console.log('    - Does it contain "chat"?', ariaLabelLower.includes('chat'));

    // Check if "chat" appears as part of a larger word
    const words = ariaLabelLower.split(/\s+/);
    const chatAsWord = words.some(w => w === 'chat' || w.startsWith('chat'));
    console.log('    - "chat" appears as a word?', chatAsWord);
    console.log('    - All words:', words);
  }
}

console.log('\n' + '='.repeat(60));
console.log('💡 INSTRUCTIONS:');
console.log('  1. Run this script on DIFFERENT ticket types');
console.log('  2. Compare the aria-label values');
console.log('  3. Share the output to diagnose the issue');
console.log('='.repeat(60));
