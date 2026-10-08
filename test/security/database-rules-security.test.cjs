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
  serverTimestamp,
  query,
  orderByChild,
  equalTo
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

test('passenger may stage a share-required request and activate it after sharing', async () => {
  const db = dbFor('passenger-auth');

  await assertSucceeds(set(ref(db, 'requests/share-stage'), {
    commuterId: 'p1',
    status: 'share_required',
    safetyShareRequired: true,
    safetyShareCompleted: false,
    createdAt: 2
  }));

  await assertSucceeds(update(ref(db, 'requests/share-stage'), {
    status: 'pending',
    safetyShareCompleted: true,
    liveTrackingUrl:
      'https://app.asiye.cloud/track.html?share=secure-token-placeholder'
  }));
});

test('trip share capability records are never readable or writable by clients', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'tripShareTokens/private-token'), {
      requestId: 'trip1',
      expiresAt: Date.now() + 60_000
    });

    await set(ref(context.database(), 'tripShareIssuers/trip1/passenger-auth'), {
      token: 'private-token'
    });
  });

  await assertFails(
    get(ref(dbFor('passenger-auth'), 'tripShareTokens/private-token'))
  );

  await assertFails(
    set(ref(dbFor('passenger-auth'), 'tripShareTokens/forged-token'), {
      requestId: 'trip1'
    })
  );

  await assertFails(
    get(ref(dbFor('passenger-auth'), 'tripShareIssuers/trip1/passenger-auth'))
  );

  await assertFails(
    set(ref(dbFor('passenger-auth'), 'tripShareIssuers/trip1/passenger-auth'), {
      token: 'forged-token'
    })
  );
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

test('trip status changes are role-specific while legitimate lifecycle actions still work', async () => {
  await assertSucceeds(update(ref(dbFor('passenger-auth'), 'requests/unassigned'), {
    status: 'searching'
  }));

  await assertSucceeds(update(ref(dbFor('passenger-auth'), 'requests/trip1'), {
    status: 'cancelled_by_commuter'
  }));

  await env.withSecurityRulesDisabled(async context => {
    await update(ref(context.database(), 'requests/trip1'), {
      status: 'accepted'
    });
  });

  await assertSucceeds(update(ref(dbFor('driver-auth'), 'requests/trip1'), {
    status: 'completed'
  }));

  await env.withSecurityRulesDisabled(async context => {
    await update(ref(context.database(), 'requests/trip1'), {
      status: 'accepted'
    });
  });

  await assertFails(update(ref(dbFor('passenger-auth'), 'requests/trip1'), {
    status: 'cancelled_by_driver'
  }));

  await assertFails(update(ref(dbFor('driver-auth'), 'requests/trip1'), {
    status: 'cancelled_by_commuter'
  }));

  await assertFails(set(ref(dbFor('passenger-auth'), 'requests/invalid-initial-state'), {
    commuterId: 'p1',
    status: 'completed',
    createdAt: 3
  }));
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


test('passenger cannot mint wallet balance or payment markers from the client', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await update(ref(context.database(), 'commuters/p1'), {
      walletBalance: 100,
      credits: 100,
      walletAppliedPayments: {
        existing: {
          provider: 'server',
          amount: 100
        }
      },
      walletUpdatedAt: 1
    });
  });

  const db = dbFor('passenger-auth');

  await assertFails(update(ref(db, 'commuters/p1'), {
    walletBalance: 9999
  }));

  await assertFails(update(ref(db, 'commuters/p1'), {
    credits: 9999
  }));

  await assertFails(update(ref(db, 'commuters/p1'), {
    walletAppliedPayments: {
      forged: {
        provider: 'paystack',
        amount: 9999
      }
    }
  }));

  await assertSucceeds(update(ref(db, 'commuters/p1'), {
    name: 'Passenger One Updated'
  }));
});

test('wallet payment ledger is not readable or writable by normal clients', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'walletPayments/ASIYE-TEST-1234'), {
      uid: 'passenger-auth',
      passengerId: 'p1',
      provider: 'paystack',
      amount: 100,
      status: 'initialized'
    });
  });

  await assertFails(
    get(ref(dbFor('passenger-auth'), 'walletPayments/ASIYE-TEST-1234'))
  );

  await assertFails(
    set(ref(dbFor('passenger-auth'), 'walletPayments/ASIYE-FORGED-1'), {
      uid: 'passenger-auth',
      provider: 'paystack',
      amount: 5000,
      status: 'complete'
    })
  );
});

test('support ticket creation requires authenticated ownership and starts open', async () => {
  const ownTicket = ref(dbFor('passenger-auth'), 'support_chats/ticket-own');

  await assertSucceeds(set(ownTicket, {
    ticketId: 'ticket-own',
    userId: 'p1',
    authUid: 'passenger-auth',
    role: 'passenger',
    subject: 'payment',
    message: 'Please check my payment.',
    status: 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));

  await assertFails(set(
    ref(dbFor('attacker-auth'), 'support_chats/ticket-forged'),
    {
      ticketId: 'ticket-forged',
      userId: 'p1',
      authUid: 'passenger-auth',
      role: 'passenger',
      subject: 'account',
      message: 'Forged',
      status: 'open',
      createdAt: serverTimestamp()
    }
  ));

  await assertFails(update(ownTicket, {
    status: 'resolved'
  }));
});

test('legacy driver application is self-submission only and no longer public', async () => {
  const anonymous = env.unauthenticatedContext().database();

  await assertFails(set(
    ref(anonymous, 'driver_applications/public-application'),
    {
      userUid: 'driver-auth',
      status: 'pending'
    }
  ));

  await assertSucceeds(set(
    ref(dbFor('driver-auth'), 'driver_applications/own-application'),
    {
      userUid: 'driver-auth',
      status: 'pending',
      fullName: 'Driver One'
    }
  ));

  await assertFails(set(
    ref(dbFor('attacker-auth'), 'driver_applications/forged-application'),
    {
      userUid: 'driver-auth',
      status: 'pending',
      fullName: 'Forged Driver'
    }
  ));
});

test('remaining legacy communication trees no longer allow anonymous access', async () => {
  const anonymous = env.unauthenticatedContext().database();

  for (const pathName of [
    'chats/sample',
    'subscriptions/sample',
    'ambassador_team_chat/sample'
  ]) {
    await assertFails(get(ref(anonymous, pathName)));
    await assertFails(set(ref(anonymous, pathName), {
      test: true
    }));
  }

  await assertSucceeds(set(
    ref(dbFor('passenger-auth'), 'chats/compatibility-chat'),
    {
      test: true
    }
  ));
});

test('voucher usage, settings writes, admin queue and market ad writes are protected', async () => {
  const db = dbFor('passenger-auth');

  await assertFails(set(ref(db, 'voucherUsage/forged'), {
    code: 'FREE'
  }));

  await assertFails(update(ref(db, 'settings'), {
    platformFee: 0
  }));

  await assertFails(set(ref(db, 'admin_queue/forged'), {
    action: 'approve'
  }));

  await assertFails(set(ref(db, 'marketAds/forged'), {
    userId: 'passenger-auth',
    status: 'active'
  }));
});


test('passenger cannot delete and recreate profile to bypass wallet idempotency', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await update(ref(context.database(), 'commuters/p1'), {
      walletBalance: 120,
      credits: 120,
      walletAppliedPayments: {
        paystack_ASIYE_TEST: {
          provider: 'paystack',
          amount: 120
        }
      }
    });
  });

  const db = dbFor('passenger-auth');

  await assertFails(
    set(ref(db, 'commuters/p1'), null)
  );

  await assertFails(
    update(ref(db, 'commuters/p1'), {
      walletAppliedPayments: null
    })
  );

  await assertFails(
    update(ref(db, 'commuters/p1'), {
      authUid: 'attacker-auth'
    })
  );
});

test('passenger cannot self-promote account or ambassador privileges', async () => {
  const db = dbFor('passenger-auth');

  await assertFails(update(ref(db, 'commuters/p1'), {
    isAdmin: true
  }));

  await assertFails(update(ref(db, 'commuters/p1'), {
    isAmbassador: true
  }));

  await assertFails(update(ref(db, 'commuters/p1'), {
    accountType: 'premium'
  }));

  await assertFails(update(ref(db, 'commuters/p1'), {
    trialActive: true
  }));
});

test('driver cannot self-verify or approve vehicle and cannot delete profile', async () => {
  const db = dbFor('driver-auth');

  await assertFails(update(ref(db, 'taxis/driver-record'), {
    verificationStatus: 'verified'
  }));

  await assertFails(update(ref(db, 'taxis/driver-record'), {
    vehicleApproved: true
  }));

  await assertFails(update(ref(db, 'taxis/driver-record'), {
    provisionalActivation: true
  }));

  await assertFails(set(ref(db, 'taxis/driver-record'), null));

  await assertSucceeds(update(ref(db, 'taxis/driver-record'), {
    isOnline: false
  }));
});


test('delivery request mirror follows trip ownership and assigned driver', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'requests/delivery1'), {
      commuterId: 'p1',
      type: 'delivery',
      status: 'pending',
      createdAt: 1
    });
  });

  await assertSucceeds(set(
    ref(dbFor('passenger-auth'), 'delivery_requests/delivery1'),
    {
      commuterId: 'p1',
      type: 'delivery',
      status: 'pending'
    }
  ));

  await assertFails(update(
    ref(dbFor('attacker-auth'), 'delivery_requests/delivery1'),
    {
      status: 'completed'
    }
  ));

  await env.withSecurityRulesDisabled(async context => {
    await update(ref(context.database(), 'requests/delivery1'), {
      taxiId: 'driver-record',
      driverAuthUid: 'driver-auth',
      status: 'accepted'
    });
  });

  await assertSucceeds(update(
    ref(dbFor('driver-auth'), 'delivery_requests/delivery1'),
    {
      status: 'accepted',
      taxiId: 'driver-record'
    }
  ));

  await assertFails(update(
    ref(dbFor('passenger-auth'), 'delivery_requests/delivery1'),
    {
      commuterId: 'p2'
    }
  ));
});

test('legacy finance and voucher trees reject ordinary client writes', async () => {
  const db = dbFor('passenger-auth');

  for (const [pathName, value] of [
    ['pending_deliveries/fake', { orderId: 'fake' }],
    ['payout_requests/fake', { amount: 999 }],
    ['earnings/fake', { amount: 999 }],
    ['vouchers/FAKE', { code: 'FAKE', amount: 999 }],
    ['voucher_requests/fake', { ambassadorPhone: '000' }],
    ['businesses/fake', { name: 'Forged' }],
    ['campuses/fake', { name: 'Forged' }]
  ]) {
    await assertFails(set(ref(db, pathName), value));
  }
});

test('handler data is no longer anonymous and handler applications require auth', async () => {
  const anonymous = env.unauthenticatedContext().database();

  await assertFails(get(ref(anonymous, 'handlers/sample')));
  await assertFails(set(ref(anonymous, 'handlers/sample'), {
    name: 'Anonymous Handler'
  }));

  await assertFails(set(ref(anonymous, 'handler_applications/application1'), {
    name: 'Anonymous Applicant'
  }));

  await assertSucceeds(set(
    ref(dbFor('passenger-auth'), 'handler_applications/application2'),
    {
      name: 'Authenticated Applicant'
    }
  ));
});

test('Club waiting list can only be written at the authenticated user key', async () => {
  await assertSucceeds(set(
    ref(dbFor('passenger-auth'), 'club_pools/waiting_list/passenger-auth'),
    {
      createdAt: 1
    }
  ));

  await assertFails(set(
    ref(dbFor('passenger-auth'), 'club_pools/waiting_list/attacker-auth'),
    {
      createdAt: 1
    }
  ));
});


test('passenger cannot alter server-owned ride payment holds', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await update(ref(context.database(), 'commuters/p1'), {
      walletBalance: 80,
      credits: 80,
      walletRideHolds: {
        trip1: {
          amount: 20,
          status: 'held'
        }
      }
    });
  });

  const db = dbFor('passenger-auth');

  await assertFails(update(ref(db, 'commuters/p1'), {
    walletRideHolds: null
  }));

  await assertFails(update(ref(db, 'commuters/p1/walletRideHolds/trip1'), {
    status: 'released'
  }));

  await assertSucceeds(update(ref(db, 'commuters/p1'), {
    name: 'Passenger One Payment Safe'
  }));
});

test('trip payment ledgers and card reference maps are server-only', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'tripPayments/trip1/p1'), {
      method: 'wallet',
      amount: 50,
      status: 'held'
    });

    await set(ref(context.database(), 'tripPaymentReferences/ASIYE-TEST-CARD-1'), {
      requestId: 'trip1',
      passengerId: 'p1'
    });
  });

  const db = dbFor('passenger-auth');

  await assertFails(get(ref(db, 'tripPayments/trip1/p1')));
  await assertFails(set(ref(db, 'tripPayments/trip1/p1'), {
    method: 'wallet',
    amount: 0,
    status: 'released'
  }));

  await assertFails(get(ref(db, 'tripPaymentReferences/ASIYE-TEST-CARD-1')));
  await assertFails(set(ref(db, 'tripPaymentReferences/FORGED'), {
    requestId: 'trip1',
    passengerId: 'p1'
  }));
});

test('support tickets are readable only through an owner-scoped query', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'support_chats'), {
      ticket1: {
        authUid: 'passenger-auth',
        userId: 'p1',
        role: 'passenger',
        message: 'I need help.',
        status: 'open',
        createdAt: 100
      },
      ticket2: {
        authUid: 'driver-auth',
        userId: 'driver-record',
        role: 'driver',
        message: 'Driver needs help.',
        status: 'open',
        createdAt: 100
      }
    });
  });

  await assertFails(get(ref(dbFor('passenger-auth'), 'support_chats')));
  await assertFails(get(ref(dbFor('attacker-auth'), 'support_chats/ticket1')));
  await assertSucceeds(get(ref(dbFor('passenger-auth'), 'support_chats/ticket1')));
  const onlyMyTickets = await assertSucceeds(get(query(
    ref(dbFor('passenger-auth'), 'support_chats'),
    orderByChild('authUid'),
    equalTo('passenger-auth')
  )));
  if (onlyMyTickets.hasChild('ticket2')) {
    throw Error('Another user ticket was leaked.');
  }
});

test('support messages allow owner replies but block tampering and impersonation', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'support_chats/ticket1'), {
      authUid: 'passenger-auth',
      userId: 'p1',
      role: 'passenger',
      message: 'My original support request.',
      status: 'open',
      createdAt: 100
    });
  });
  const base = 'support_chats/ticket1';
  await assertSucceeds(set(
    ref(dbFor('passenger-auth'), base + '/messages/owned-reply'),
    {
      senderUid: 'passenger-auth',
      senderRole: 'passenger',
      text: 'Here is more detail.',
      createdAt: 101
    }
  ));
  await assertFails(set(
    ref(dbFor('attacker-auth'), base + '/messages/fake-reply'),
    {
      senderUid: 'attacker-auth',
      senderRole: 'passenger',
      text: 'Trying to impersonate.',
      createdAt: 102
    }
  ));
  await assertFails(set(
    ref(dbFor('passenger-auth'), base + '/messages/forged-admin'),
    {
      senderUid: 'passenger-auth',
      senderRole: 'admin',
      text: 'Fake admin message.',
      createdAt: 103
    }
  ));
  await assertFails(update(
    ref(dbFor('passenger-auth'), base),
    { status: 'resolved' }
  ));
  await assertFails(update(
    ref(dbFor('passenger-auth'), base + '/messages/owned-reply'),
    { text: 'Rewritten history' }
  ));
});

test('passenger can open their own support ticket but not one for another user', async () => {
  await assertSucceeds(set(
    ref(dbFor('passenger-auth'), 'support_chats/own-new'),
    {
      ticketId: 'own-new',
      authUid: 'passenger-auth',
      userId: 'p1',
      role: 'passenger',
      status: 'open',
      subject: 'payment',
      message: 'Card payment failed.',
      createdAt: 100
    }
  ));
  await assertFails(set(
    ref(dbFor('passenger-auth'), 'support_chats/forged'),
    {
      ticketId: 'forged',
      authUid: 'attacker-auth',
      userId: 'p2',
      role: 'passenger',
      status: 'open',
      subject: 'payment',
      message: 'Forged ticket.',
      createdAt: 100
    }
  ));
});

test('v2 enrollment accepts only verified-phone owner and includes all required documents', async () => {
  const uid = 'new-driver-auth';
  const db = env.authenticatedContext(uid, {
    phone_number: '+27821234567'
  }).database();
  const docs = Object.fromEntries(['selfie','identity','car','licence','address']
    .map(name => [name, 'driverEnrollments/' + uid + '/submission-1/' + name]));
  const record = {
    version: 2,
    status: 'pending',
    authUid: uid,
    phone: '+27821234567',
    phoneVerified: true,
    fullName: 'New Driver One',
    residentialAddress: '22 Main Road, Durban, KwaZulu-Natal',
    vehicleReg: 'ND 123 456',
    vehiclePending: {
      type: 'sedan', make: 'Toyota', model: 'Corolla',
      colour: 'White', registration: 'ND 123 456',
      year: 2023, seats: 4
    },
    documents: docs,
    references: Object.fromEntries([1,2,3].map(n => ['reference'+n, {
      name: 'Reference '+n, phone: '082000000'+n, relationship: 'Colleague'
    }])),
    banking: {
      accountHolder: 'New Driver One', bank: 'Standard Bank',
      accountNumber: '123456789', branchCode: '051001', accountType: 'savings'
    },
    consent: true,
    submittedAt: serverTimestamp()
  };
  await assertSucceeds(set(ref(db, 'driverEnrollments/' + uid), record));
  await assertFails(update(ref(db, 'driverEnrollments/' + uid), {
    status: 'approved'
  }));
  await assertFails(set(ref(dbFor('attacker-auth'), 'driverEnrollments/' + uid + '-other'), {
    ...record, authUid: 'attacker-auth'
  }));
});

test('v2 enrollment rejects invented phone verification and missing address proof', async () => {
  const uid = 'new-driver-auth';
  const db = env.authenticatedContext(uid, {
    phone_number: '+27821234567'
  }).database();
  const base = {
    version: 2, status: 'pending', fullName: 'New Driver',
    authUid: uid, phone: '+27991111111', phoneVerified: true,
    residentialAddress: '22 Main Road, Durban',
    vehicleReg: 'ND 123 456',
    vehiclePending: {
      type: 'sedan', make: 'Toyota', model: 'Corolla', colour: 'White',
      registration: 'ND 123 456', year: 2023, seats: 4
    },
    documents: Object.fromEntries(['selfie','identity','car','licence']
      .map(name => [name, 'driverEnrollments/' + uid + '/s/' + name])),
    references: Object.fromEntries([1,2,3].map(n => ['reference'+n, {
      name: 'Reference '+n, phone: '082000000'+n, relationship: 'Colleague'
    }])),
    banking: {
      accountHolder: 'New Driver', bank: 'Standard Bank',
      accountNumber: '123456789', branchCode: '051001', accountType: 'savings'
    },
    consent: true,
    submittedAt: serverTimestamp()
  };
  await assertFails(set(ref(db, 'driverEnrollments/' + uid), base));
  await assertFails(set(ref(db, 'driverEnrollments/' + uid), {
    ...base, phone: '+27821234567'
  }));
});
