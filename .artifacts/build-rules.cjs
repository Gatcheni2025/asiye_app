const fs = require('node:fs');

const source = JSON.parse(
  fs.readFileSync('database.rules.json', 'utf8')
);

if (!source.rules || typeof source.rules !== 'object') {
  throw new Error('database.rules.json does not contain a rules object');
}

// Keep the generated test fixture aligned with the hardened production rules.
// Never regenerate from permissive legacy allow-lists.
const tripFragment = JSON.parse(
  fs.readFileSync('test/trip-chat.rules.fragment.json', 'utf8')
);

if (
  !source.rules.tripChats &&
  tripFragment.rules?.tripChats
) {
  source.rules.tripChats =
    tripFragment.rules.tripChats;
}

fs.writeFileSync(
  'test/firebase.rules.merged.json',
  JSON.stringify(source, null, 2) + '\n'
);
