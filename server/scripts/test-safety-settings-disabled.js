import assert from 'node:assert/strict';

// config.js parses API keys at import time; provide a valid-format dummy so it doesn't throw.
process.env.GEMINI_API_KEYS = 'AIzaSyDummyKeyForSafetyRegression0000000000';

const { SAFETY_SETTINGS } = await import('../config.js');
const { HarmBlockThreshold } = await import('@google/genai');

// Legal/criminal court text is legitimate but was tripping Gemini safety filters
// (finishReason=SAFETY), which failed analyses. Per Google's docs, the filter is fully
// disabled with threshold OFF. Every category must be OFF.
function testAllSafetyCategoriesAreOff() {
  assert(Array.isArray(SAFETY_SETTINGS), 'SAFETY_SETTINGS must be an array');
  assert(SAFETY_SETTINGS.length >= 4, 'expected at least the 4 harm categories');
  for (const setting of SAFETY_SETTINGS) {
    assert.equal(
      setting.threshold,
      HarmBlockThreshold.OFF,
      `category ${setting.category} must be OFF (got ${setting.threshold})`
    );
  }
}

testAllSafetyCategoriesAreOff();
console.log('Safety-settings-disabled regression passed.');
