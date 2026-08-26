#!/usr/bin/env node
'use strict';

const { main } = require('../lib/launch');

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`holidaytw: unexpected error: ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
