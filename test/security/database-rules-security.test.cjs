const { test, before, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require('@firebase/rules-unit-testing');
const {
  ref,
  get,
  set,
  update,
  runTransaction,
  serverTimestamp
} = require('firebase/database');

let env;

const rules = fs.readFileSync(
  path.join(__dirname, '../../database.rules.json'),
  'utf8'
);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'asiye-security-validation',
    database: { rules }
  });
});

beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await set(ref(db), {
      commuters: {
        p1: { authUid: 'passenger-auth', name: 'Passenger One' },
        p2: { authUid: 'attacker-auth', name: 'Other Passenger' },
        club2: { authUid: 'club-auth', name: 'Club Two' },
        club3: { authUid: 'club-join-auth', name: 'Club Three' }
      },
      taxis: {
        'driver-record': {
          authUid: 'driver-auth',
          userUid: 'driver-auth',
          name: 'Driver One',
          isOnline: true
        },
        'other-driver': {
          authUid: 'other-driver-auth',
          userUid: 'other-driver-auth',
          name: 'Other Driver',
          isOnline: true
        }
      },
      requests: {
        trip1: {
          commuterId: 'p1',
          status: 'accepted',
          taxiId: 'driver-record',
          driverAuthUid: 'driver-auth',
          createdAt: 1
        },
        unassigned: {
          commuterId: 'p1',
          status: 'pending',
          createdAt: 1
        },
        club1: {
          type: 'club',
          commuterId: 'p1',
          status: 'driver_waiting',
          taxiId: 'driver-record',
          driverAuthUid: 'driver-auth',
          passengerCount: 2,
          passengers: {
            p1: { commuterId: 'p1', status: 'waiting' },
            club2: { commuterId: 'club2', status: 'waiting' }
          },
          createdAt: 1
        },
        'club-open': {
          type: 'club',
          commuterId: 'p1',
          status: 'pooling',
          passengerCount: 1,
          capacity: 3,
          passengers: {
            p1: { commuterId: 'p1', status: 'waiting' }
          },
          createdAt: 1
        }
      }
    });
  });
});

after(async () => {
  if (env) await env.cleanup();
});

function dbFor(uid) {
  return env.authenticatedContext(uid).database();
}

test('anonymous users cannot read protected profiles or requests', async () => {
  const db = env.unauthenticatedContext().database();
  await assertFails(get(ref(db, 'commuters/p1')));
  await assertFails(get(ref(db, 'taxis/driver-record')));
  await assertFails(get(ref(db, 'requests/trip1')));
});

test('passenger can update own profile but attacker cannot', async () => {
  await assertSucceeds(update(ref(dbFor('passenger-auth'), 'commuters/p1'), { name: 'Updated' }));
  await assertFails(update(ref(dbFor('attacker-auth'), 'commuters/p1'), { name: 'Hijacked' }));
});

test('passenger can create own request but attacker cannot create it for another passenger', async () => {
  await assertSucceeds(set(ref(dbFor('passenger-auth'), 'requests/new-own-trip'), {
    commuterId: 'p1',
    status: 'pending',
    createdAt: 2
  }));

  await assertFails(set(ref(dbFor('attacker-auth'), 'requests/fake-trip'), {
    commuterId: 'p1',
    status: 'pending',
    createdAt: 2
  }));
});

test('unrelated authenticated user cannot mutate another trip', async () => {
  await assertFails(update(ref(dbFor('attacker-auth'), 'requests/trip1'), {
    status: 'completed'
  }));
});

test('commuterId is immutable after request creation', async () => {
  await assertFails(update(ref(dbFor('passenger-auth'), 'requests/trip1'), {
    commuterId: 'p2'
  }));
});

test('assigned driver can advance trip status', async () => {
  await assertSucceeds(update(ref(dbFor('driver-auth'), 'requests/trip1'), {
    status: 'driver_on_way'
  }));
});

test('legitimate driver can claim an unassigned request', async () => {
  await assertSucceeds(update(ref(dbFor('driver-auth'), 'requests/unassigned'), {
    taxiId: 'driver-record',
    driverAuthUid: 'driver-auth',
    status: 'accepted'
  }));
});

test('another driver cannot steal an already assigned trip', async () => {
  await assertFails(update(ref(dbFor('other-driver-auth'), 'requests/trip1'), {
    taxiId: 'other-driver',
    driverAuthUid: 'other-driver-auth'
  }));
});

test('passenger cannot forge driverAuthUid and gain driver identity', async () => {
  await assertFails(update(ref(dbFor('passenger-auth'), 'requests/trip1'), {
    driverAuthUid: 'passenger-auth'
  }));
});

test('Club passenger may update own member state but not another passenger', async () => {
  await assertSucceeds(update(ref(dbFor('club-auth'), 'requests/club1/passengers/club2'), {
    status: 'ready'
  }));

  await assertFails(update(ref(dbFor('club-auth'), 'requests/club1/passengers/p1'), {
    status: 'removed'
  }));
});

test('direct client Club join transaction is blocked; pool-wide joining is server-owned', async () => {
  const db = dbFor('club-join-auth');
  await assertFails(runTransaction(
    ref(db, 'requests/club-open'),
    pool => {
      if (!pool) return pool;
      pool.passengers = pool.passengers || {};
      pool.passengers.club3 = {
        commuterId: 'club3',
        status: 'waiting'
      };
      pool.passengerCount = 2;
      pool.status = 'pooling';
      return pool;
    },
    { applyLocally: false }
  ));
});

test('driver can notify assigned passenger and unrelated user cannot forge that notification', async () => {
  await assertSucceeds(set(
    ref(dbFor('driver-auth'), 'notifications/commuters/p1/legit'),
    { requestId: 'trip1', type: 'driver_on_way' }
  ));

  await assertFails(set(
    ref(dbFor('attacker-auth'), 'notifications/commuters/p1/forged'),
    { requestId: 'trip1', type: 'driver_on_way' }
  ));
});

test('passenger can notify assigned driver and unrelated user cannot forge that notification', async () => {
  await assertSucceeds(set(
    ref(dbFor('passenger-auth'), 'notifications/taxis/driver-record/legit'),
    { requestId: 'trip1', type: 'passenger_message' }
  ));

  await assertFails(set(
    ref(dbFor('attacker-auth'), 'notifications/taxis/driver-record/forged'),
    { requestId: 'trip1', type: 'passenger_message' }
  ));
});

test('passenger cannot clear an assigned taxi or mark a trip completed', async () => {
  await assertFails(update(ref(dbFor('passenger-auth'), 'requests/trip1'), {
    taxiId: null
  }));

  await assertFails(update(ref(dbFor('passenger-auth'), 'requests/trip1'), {
    status: 'completed'
  }));
});

test('notification recipient may delete own notification but unrelated user may not', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'notifications/taxis/driver-record/delete-me'), {
      requestId: 'trip1',
      type: 'ride_request'
    });
  });

  await assertSucceeds(set(
    ref(dbFor('driver-auth'), 'notifications/taxis/driver-record/delete-me'),
    null
  ));

  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'notifications/taxis/driver-record/keep-me'), {
      requestId: 'trip1',
      type: 'ride_request'
    });
  });

  await assertFails(set(
    ref(dbFor('attacker-auth'), 'notifications/taxis/driver-record/keep-me'),
    null
  ));
});

test('trip chat allows participants and blocks unrelated authenticated users', async () => {
  await assertSucceeds(set(
    ref(dbFor('passenger-auth'), 'tripChats/trip1/p1/passenger-message'),
    {
      text: 'I am waiting.',
      senderUid: 'passenger-auth',
      role: 'passenger',
      createdAt: serverTimestamp()
    }
  ));

  await assertSucceeds(set(
    ref(dbFor('driver-auth'), 'tripChats/trip1/p1/driver-message'),
    {
      text: 'I am arriving.',
      senderUid: 'driver-auth',
      role: 'driver',
      createdAt: serverTimestamp()
    }
  ));

  await assertFails(get(ref(dbFor('attacker-auth'), 'tripChats/trip1/p1')));

  await assertFails(set(
    ref(dbFor('attacker-auth'), 'tripChats/trip1/p1/forged-message'),
    {
      text: 'Forged message',
      senderUid: 'attacker-auth',
      role: 'passenger',
      createdAt: serverTimestamp()
    }
  ));
});
