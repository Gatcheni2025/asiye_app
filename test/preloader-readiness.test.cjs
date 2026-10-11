'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

test('Flutter keeps the dashboard covered until app JavaScript reports ready', () => {
  const source = fs.readFileSync(
    'lib/main.dart',
    'utf8'
  );

  assert.match(
    source,
    /Duration\(seconds: 15\)/
  );
  assert.match(
    source,
    /waitsForAppReady/
  );
  assert.match(
    source,
    /if \(!waitsForAppReady && mounted\)/
  );
  assert.match(
    source,
    /action == 'hidePreloader'/
  );
});

test('passenger signals ready only after auth profile and ride restoration bootstrap', () => {
  const source = fs.readFileSync(
    'assets/passenger-v2/js/app.js',
    'utf8'
  );

  const restore = source.lastIndexOf(
    'restored ='
  );
  const signal = source.lastIndexOf(
    "'hidePreloader'"
  );

  assert.ok(restore >= 0);
  assert.ok(signal > restore);
  assert.match(
    source.slice(signal - 2200, signal + 200),
    /Passenger dashboard is fully initialized/
  );
});

test('driver signals ready after active-trip restoration', () => {
  const source = fs.readFileSync(
    'assets/driver-v2/js/app.js',
    'utf8'
  );

  const restore = source.lastIndexOf(
    'restoreActiveRequest'
  );
  const signal = source.lastIndexOf(
    "'hidePreloader'"
  );

  assert.ok(restore >= 0);
  assert.ok(signal > restore);
});
