const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '../../assets/member-pages.js'), 'utf8');

for (const driver of [false, true]) {
  test(`${driver ? 'driver' : 'passenger'} support contacts preserve the ticket form listener`, async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'https://asiye-80386.web.app/', runScripts: 'outside-only'
    });
    try {
      const w = dom.window;
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
      w.firebase = { auth: () => ({ currentUser: null }) };
      w[driver ? 'ASIYE_DRIVER' : 'ASIYE'] = {
        state: { userId: 'passenger', driverId: 'driver', user: {}, driver: {} }
      };
      w.eval(code);
      await w.AsiyePages.open('support');
      const body = w.AsiyePages.dialog.querySelector('main');
      assert.equal(decodeURIComponent(body.querySelector('a[href^="mailto:"]').getAttribute('href')),
        'mailto:admin@asiye.cloud');
      assert.match(body.querySelector('a[href="tel:+27315661165"]').textContent, /031 566 1165/);
      body.querySelector('[data-support-form]').dispatchEvent(
        new w.Event('submit', { bubbles: true, cancelable: true })
      );
      assert.match(body.querySelector('[data-support-status]').textContent,
        /Sign in again before contacting support/);
    } finally {
      dom.window.close();
    }
  });
}
