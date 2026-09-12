const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/trip-chat.js'), 'utf8');

function element() {
    return {
        children: [], selectors: {}, value: '', textContent: '', scrollHeight: 0, scrollTop: 0, clientHeight: 0,
        setAttribute() {}, addEventListener() {}, showModal() {}, focus() {}, remove() {},
        append(...items) { this.children.push(...items); },
        replaceChildren() { this.children = []; },
        querySelector(selector) { return this.selectors[selector] ||= element(); }
    };
}
function client(role, database) {
    const app = { state: { userId: 'passenger' }, ui: { toast() {} } };
    const uid = role === 'driver' ? 'driver-auth' : 'passenger';
    const firebase = { auth: () => ({ currentUser: { uid } }), database: () => database };
    firebase.database.ServerValue = { TIMESTAMP: 123 };
    const context = { document: { body: element(), createElement: element, addEventListener() {} }, firebase,
        [role === 'driver' ? 'ASIYE_DRIVER' : 'ASIYE']: app };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    return context.AsiyeTripChat;
}
function database() {
    const rooms = {};
    return {
        fail: false,
        ref(key) {
            const room = rooms[key] ||= { data: [], listeners: new Set() };
            const snapshot = () => ({ forEach: visit => room.data.forEach(message => visit({ val: () => message })) });
            return {
                orderByChild() { return this; }, limitToLast() { return this; },
                on(event, callback) { room.listeners.add(callback); callback(snapshot()); return callback; },
                off(event, callback) { room.listeners.delete(callback); },
                push: async message => {
                    if (this.fail) throw new Error('Denied');
                    room.data.push(message);
                    room.listeners.forEach(listener => listener(snapshot()));
                }
            };
        }
    };
}
async function send(chat, text) {
    chat.dialog.querySelector('textarea').value = text;
    await chat.dialog.querySelector('form').onsubmit({ preventDefault() {} });
}
test('driver and passenger receive each other’s messages and reopen history', async () => {
    const db = database(), driver = client('driver', db), passenger = client('passenger', db);
    const request = { commuterId: 'passenger', driverName: 'Driver' };
    driver.open(request, 'trip'); passenger.open(request, 'trip');
    await send(passenger, 'I am at the entrance.');
    await send(driver, 'I will meet you there.');
    const log = driver.dialog.querySelector('.trip-chat-messages');
    assert.equal(log.children.length, 2);
    assert.equal(log.children[0].children[0].textContent, 'I am at the entrance.');
    passenger.close(); passenger.open(request, 'trip');
    assert.equal(passenger.dialog.querySelector('.trip-chat-messages').children.length, 2);
});
test('failed sends retain drafts and HTML is rendered as literal text', async () => {
    const db = database(), chat = client('passenger', db);
    chat.open({ commuterId: 'passenger' }, 'trip');
    db.fail = true;
    await send(chat, 'Please wait');
    assert.equal(chat.dialog.querySelector('textarea').value, 'Please wait');
    assert.match(chat.dialog.querySelector('.trip-chat-status').textContent, /not sent/);
    db.fail = false;
    await send(chat, '<img src=x onerror=alert(1)>');
    assert.equal(chat.dialog.querySelector('.trip-chat-messages').children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
});
test('Club conversations are separated by passenger', async () => {
    const db = database(), driver = client('driver', db), passenger = client('passenger', db);
    const request = { type: 'club', passengers: { passenger: {}, other: {} } };
    driver.open(request, 'club', 'other'); passenger.open(request, 'club');
    await send(driver, 'Message for other passenger');
    assert.equal(passenger.dialog.querySelector('.trip-chat-messages').children.length, 0);
});
