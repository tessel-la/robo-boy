import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branding } from './config.mjs';

test('existing company files keep static login copy and the default eyebrow', () => {
  const result = branding({ loginTitle: 'Robot operations', loginMessage: 'Sign in to continue.' });
  assert.equal(result.loginTitle, 'Robot operations');
  assert.equal(result.loginMessage, 'Sign in to continue.');
  assert.equal(result.loginEyebrow, 'Your robotics workspace');
  assert.deepEqual(result.loginSlides, []);
});

test('accepts an editable or hidden eyebrow and bounded plain-text slides', () => {
  const loginSlides = [
    { title: 'Start your shift.', message: 'Choose a robot and open your workspace.' },
    { title: 'See your fleet.', message: '' },
  ];
  assert.deepEqual(branding({ loginEyebrow: 'Company operations', loginSlides }).loginSlides, loginSlides);
  assert.equal(branding({ loginEyebrow: '' }).loginEyebrow, '');
  assert.equal(branding({ loginSlides: Array(8).fill(loginSlides[0]) }).loginSlides.length, 8);
});

test('rejects malformed, excessive and executable login configuration', () => {
  const slide = { title: 'Robot operations', message: 'Choose your tools.' };
  for (const value of [
    { loginEyebrow: 1 },
    { loginEyebrow: 'x'.repeat(201) },
    { loginEyebrow: 'Company\noperations' },
    { loginSlides: null },
    { loginSlides: {} },
    { loginSlides: Array(9).fill(slide) },
    { loginSlides: Array(1) },
    ...[
      null,
      [],
      'text',
      {},
      { title: ' ', message: '' },
      { title: 'One' },
      { title: 1, message: '' },
      { ...slide, title: 'x'.repeat(201) },
      { ...slide, message: 'x'.repeat(501) },
      { ...slide, message: 'line\nbreak' },
      { ...slide, html: '<script>alert(1)</script>' },
    ].map(item => ({ loginSlides: [item] })),
  ])
    assert.throws(() => branding(value), JSON.stringify(value));
});
