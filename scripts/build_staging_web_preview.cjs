'use strict';

// Produces an isolated WEB-ONLY staging preview; never rewrites tracked
// production assets, native Android/iOS binaries or the live Firebase project.
const fs = require('node:fs');
const path = require('node:path');
const PRODUCTION = 'asiye-80386';
const REPO = path.resolve(__dirname, '..');

function requireStagingConfig(input, expectedProject) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Staging Firebase WEB config is required.');
  const projectId = String(input.projectId || '');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
      projectId === PRODUCTION || projectId !== expectedProject) {
    throw Error('Staging web project must exactly match the isolated FIREBASE_STAGING_PROJECT.');
  }
  const required = ['apiKey','authDomain','databaseURL','storageBucket','messagingSenderId','appId'];
  for (const k of required) if (typeof input[k] !== 'string' || !input[k].trim()) {
    throw Error('Staging Firebase web config missing ' + k);
  }
  const url = new URL(input.databaseURL);
  if (url.protocol !== 'https:' || !url.hostname.includes(projectId) ||
      !/\.firebaseio\.com$|\.firebasedatabase\.app$/.test(url.hostname)) {
    throw Error('Staging database URL must belong to the isolated Firebase project.');
  }
  if (input.authDomain !== projectId + '.firebaseapp.com') throw Error('Staging auth domain differs from project.');
  if (!input.storageBucket.startsWith(projectId + '.')) throw Error('Staging storage bucket differs from project.');
  if (!/^[0-9]+$/.test(input.messagingSenderId) ||
      !new RegExp('^1:' + input.messagingSenderId + ':web:[A-Za-z0-9]+$').test(input.appId)) {
    throw Error('Staging sender ID and app ID are inconsistent.');
  }
  if (!/^AIza[A-Za-z0-9_-]{20,}$/.test(input.apiKey)) throw Error('Invalid staging Firebase WEB API key format.');
  if (JSON.stringify(input).includes(PRODUCTION)) throw Error('Production reference in staging web config.');
  return input;
}

function extractProductionWebConfig(file) {
  const source = fs.readFileSync(file, 'utf8');
  const data = {};
  for (const key of ['apiKey','authDomain','databaseURL','projectId',
    'storageBucket','messagingSenderId','appId']) {
    const match = source.match(new RegExp('\\b' + key + '\\s*:\\s*["\\x27]([^"\\x27]+)["\\x27]'));
    if (!match) throw Error('Unable to read production ' + key + ' from passenger Firebase config.');
    data[key] = match[1];
  }
  if (data.projectId !== PRODUCTION) throw Error('Checked-in production Firebase config unexpectedly changed.');
  return data;
}

function rewrite(source, current, target) {
  // Replace longer identifiers first so the bare project ID does not alter a
  // hostname before we can replace it with a custom staging RTDB hostname.
  const replacements = [
    [current.databaseURL, target.databaseURL],
    ['https://' + PRODUCTION + '.web.app', 'https://' + target.projectId + '.web.app'],
    [current.authDomain, target.authDomain],
    [current.storageBucket, target.storageBucket],
    [current.apiKey, target.apiKey],
    [current.appId, target.appId],
    [current.messagingSenderId, target.messagingSenderId],
    [PRODUCTION, target.projectId]
  ];
  let output = source;
  for (const [oldValue, newValue] of replacements) {
    output = output.split(oldValue).join(newValue);
  }
  return output;
}

const TEXT = /\.(?:html?|js|mjs|cjs|css|json|webmanifest|txt|svg|xml)$/i;

function createStagingPreview({assetsRoot, outputDir, firebaseConfig, expectedProject}) {
  const config = requireStagingConfig(firebaseConfig, expectedProject);
  const current = extractProductionWebConfig(path.join(assetsRoot, 'passenger-v2/js/firebase.js'));
  const src = path.resolve(assetsRoot);
  const out = path.resolve(outputDir);
  if (out === src || out.startsWith(src + path.sep) || src.startsWith(out + path.sep)) {
    throw Error('Staging preview must be separate from production source assets.');
  }
  fs.rmSync(out, {recursive:true, force:true});
  let rewrittenFiles = 0, examined = 0;
  function walk(root, dest) {
    fs.mkdirSync(dest, {recursive:true});
    for (const item of fs.readdirSync(root, {withFileTypes:true})) {
      const from = path.join(root, item.name);
      const to = path.join(dest, item.name);
      if (item.isSymbolicLink()) throw Error('Cannot package symlinks into staging preview.');
      if (item.isDirectory()) {walk(from, to); continue;}
      if (!item.isFile()) continue;
      if (!TEXT.test(item.name)) {fs.copyFileSync(from, to); continue;}
      examined++;
      const original = fs.readFileSync(from, 'utf8');
      const changed = rewrite(original, current, config);
      if (changed !== original) rewrittenFiles++;
      if (changed.includes(PRODUCTION) ||
          changed.includes(current.apiKey) ||
          changed.includes(current.appId) ||
          changed.includes(current.databaseURL)) {
        throw Error('Production Firebase identifier remains in staging preview: ' + path.relative(src, from));
      }
      fs.writeFileSync(to, changed, 'utf8');
    }
  }
  walk(src, out);
  if (rewrittenFiles < 3) throw Error('Too few client files rewritten; refuse incomplete staging preview.');
  fs.writeFileSync(path.join(out, 'STAGING_ONLY.txt'),
    'Asiye TEST staging preview. No real driver, passenger or banking information.\n');
  const originalFirebase = JSON.parse(fs.readFileSync(path.join(REPO,'firebase.json'), 'utf8'));
  originalFirebase.hosting = {
    public: path.relative(REPO, out).replaceAll(path.sep, '/'),
    ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
    headers: [{
      source: '**',
      headers: [
        {key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive'},
        {key: 'Cache-Control', value: 'private, no-store, max-age=0'}
      ]
    }]
  };
  const generatedConfig = path.join(REPO, 'firebase.staging.generated.json');
  fs.writeFileSync(generatedConfig, JSON.stringify(originalFirebase, null, 2) + '\n');
  return {projectId:config.projectId, rewrittenFiles, examined,
    generatedConfig, preview: out, hostingOrigin:'https://'+config.projectId+'.web.app'};
}

if (require.main === module) {
  try {
    const project = String(process.env.FIREBASE_STAGING_PROJECT || '').trim();
    const config = JSON.parse(process.env.FIREBASE_STAGING_WEB_CONFIG || '{}');
    const result = createStagingPreview({
      assetsRoot: path.join(REPO, 'assets'),
      outputDir: path.join(REPO, 'staging-preview'),
      firebaseConfig: config, expectedProject: project
    });
    console.log(JSON.stringify({projectId:result.projectId,
      rewrittenFiles:result.rewrittenFiles, examined:result.examined,
      hostingOrigin: result.hostingOrigin, productionAssetsUntouched:true}));
  } catch (error) {
    console.error('Isolated staging web preview BLOCKED:', error.message);
    process.exitCode = 1;
  }
}
module.exports = {requireStagingConfig, extractProductionWebConfig, rewrite, createStagingPreview};
