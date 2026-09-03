const dotenv = require('dotenv');
const fs = require('fs');
const cp = require('child_process');
const p = '/app/apps/server/data/pipelines/Notch.fm/Infra/provision-dev/.env';
const c = dotenv.parse(fs.readFileSync(p));
console.log('has key:', Object.prototype.hasOwnProperty.call(c, 'NOTCH_IMAGE_TAG'));
console.log('typeof:', typeof c.NOTCH_IMAGE_TAG);
console.log('JSON value:', JSON.stringify(c.NOTCH_IMAGE_TAG));
console.log('all keys:', Object.keys(c).join(','));
// mimic EZPipelineController: for (const k in envConfig) process.env[k] = envConfig[k]
for (const k in c) { if (k === 'NOTCH_IMAGE_TAG') process.env[k] = c[k]; }
const probe = 'if [ -z "${NOTCH_IMAGE_TAG+x}" ]; then echo CHILD_UNSET; else echo CHILD_SET_len=${#NOTCH_IMAGE_TAG}; fi; printenv NOTCH_IMAGE_TAG >/dev/null 2>&1 && echo printenv_exit_0 || echo printenv_exit_nonzero';
console.log(cp.execSync(probe, { encoding: 'utf8', shell: '/bin/sh' }).trim());
