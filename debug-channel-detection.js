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

  // Check for channel type using NEW detection logic
  let channel = null;
  console.log('\n  🆕 NEW DETECTION (using data-channel attribute):');

  // Priority 1: Use data-channel attribute (more reliable)
  if (dataChannel) {
    const dataChannelLower = dataChannel.toLowerCase();
    if (dataChannelLower === 'sms') {
      channel = 'sms';
      console.log('    ✅ Detected as: SMS (data-channel="sms")');
    } else if (dataChannelLower === 'web' || dataChannelLower === 'email') {
      channel = 'email';
      console.log('    ✅ Detected as: EMAIL (data-channel="' + dataChannelLower + '")');
    } else if (dataChannelLower === 'native_messaging' || dataChannelLower === 'chat') {
      channel = 'chat';
      console.log('    ✅ Detected as: CHAT (data-channel="' + dataChannelLower + '")');
    } else {
      console.log('    ⚠️ Unrecognized data-channel: "' + dataChannel + '"');
    }
  }

  // Priority 2: Fallback to aria-label if data-channel didn't match
  if (!channel) {
    console.log('    Falling back to aria-label detection...');
    if (ariaLabelLower.includes('email')) {
      channel = 'email';
      console.log('    ✅ Detected as: EMAIL (aria-label contains "email")');
    } else if (ariaLabelLower.includes('sms')) {
      channel = 'sms';
      console.log('    ✅ Detected as: SMS (aria-label contains "sms")');
    } else if (ariaLabelLower.includes('chat') || ariaLabelLower.includes('messaging')) {
      channel = 'chat';
      console.log('    ✅ Detected as: CHAT (aria-label contains "chat" or "messaging")');
    } else {
      console.log('    ⚠️ Not detected as email/sms/chat');
    }
  }

  // OLD detection logic for comparison
  console.log('\n  ⚠️ OLD DETECTION (aria-label only - for comparison):');
  let oldChannel = null;
  if (ariaLabelLower.includes('email')) {
    oldChannel = 'email';
    console.log('    Would detect as: EMAIL');
  } else if (ariaLabelLower.includes('sms')) {
    oldChannel = 'sms';
    console.log('    Would detect as: SMS');
  } else if (ariaLabelLower.includes('chat')) {
    oldChannel = 'chat';
    console.log('    Would detect as: CHAT');
  } else {
    console.log('    Would NOT detect channel (null)');
  }

  if (oldChannel !== channel) {
    console.log('    🔄 Detection changed! Old: ' + (oldChannel || 'null') + ' → New: ' + (channel || 'null'));
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

  // Summary
  console.log('\n✅ DETECTION SUMMARY:');
  console.log('  The extension now uses data-channel as the primary detection method,');
  console.log('  which is more reliable than aria-label after Zendesk UI updates.');
  console.log('\n  Mappings:');
  console.log('    data-channel="web"              → Email');
  console.log('    data-channel="email"            → Email');
  console.log('    data-channel="sms"              → SMS');
  console.log('    data-channel="native_messaging" → Chat');
  console.log('    data-channel="chat"             → Chat');
}

console.log('\n' + '='.repeat(60));
console.log('💡 INSTRUCTIONS:');
console.log('  1. Run this script on different ticket types to verify the fix');
console.log('  2. Check that "NEW DETECTION" correctly identifies each channel');
console.log('  3. Compare with "OLD DETECTION" to see what changed');
console.log('  4. Reload the extension after deploying the fix');
console.log('='.repeat(60));
